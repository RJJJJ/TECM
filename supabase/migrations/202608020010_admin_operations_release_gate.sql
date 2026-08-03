-- Release-gate hardening for guarded Admin operations and parent recovery.

-- Parent recovery changes a server-controlled account field, so retain the
-- existing append-only audit contract for this narrowly scoped transition.
drop trigger if exists trg_parent_profiles_audit on public.parent_profiles;
create trigger trg_parent_profiles_audit
after insert or update or delete on public.parent_profiles
for each row execute function public.capture_audit_log();

create or replace function public.link_teacher_profile(
  target_organization_id uuid,
  target_user_id uuid,
  target_display_name text,
  target_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_member public.organization_members%rowtype;
  existing_teacher public.teacher_profiles%rowtype;
  teacher_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.organization_members
    where organization_id = target_organization_id
      and user_id = auth.uid()
      and role = 'admin'
      and status = 'active'
  ) then
    raise exception 'admin authorization required';
  end if;

  target_display_name := btrim(coalesce(target_display_name, ''));
  target_phone := nullif(btrim(coalesce(target_phone, '')), '');
  if length(target_display_name) not between 1 and 120 then
    raise exception 'invalid teacher display name';
  end if;
  if target_phone is not null and length(target_phone) > 40 then
    raise exception 'invalid teacher phone';
  end if;
  if not exists (select 1 from auth.users where id = target_user_id) then
    raise exception 'auth user not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('teacher:' || target_user_id::text, 0));

  -- Lock every tenant membership for this identity before checking the
  -- cross-organization invariant. This closes the partial-membership race.
  perform 1
  from public.organization_members
  where user_id = target_user_id
  for update;

  select * into existing_teacher
  from public.teacher_profiles
  where user_id = target_user_id
  for update;
  if found and existing_teacher.organization_id <> target_organization_id then
    raise exception 'teacher identity belongs to another organization';
  end if;

  if exists (
    select 1
    from public.organization_members
    where user_id = target_user_id
      and organization_id <> target_organization_id
  ) then
    raise exception 'teacher identity belongs to another organization';
  end if;

  select * into existing_member
  from public.organization_members
  where organization_id = target_organization_id
    and user_id = target_user_id
  for update;
  if found and existing_member.role <> 'teacher' then
    raise exception 'identity already has a different organization role';
  end if;

  if existing_member.id is null then
    insert into public.organization_members (organization_id, user_id, role, status)
    values (target_organization_id, target_user_id, 'teacher', 'active');
  elsif existing_member.status <> 'active' then
    update public.organization_members
    set status = 'active', updated_at = statement_timestamp()
    where id = existing_member.id;
  end if;

  if existing_teacher.id is null then
    insert into public.teacher_profiles (
      organization_id, user_id, display_name, phone, is_active
    ) values (
      target_organization_id, target_user_id, target_display_name, target_phone, true
    ) returning id into teacher_id;
  else
    teacher_id := existing_teacher.id;
    update public.teacher_profiles
    set display_name = target_display_name,
        phone = target_phone,
        is_active = true,
        updated_at = statement_timestamp()
    where id = existing_teacher.id;
  end if;

  return teacher_id;
end
$$;

create or replace function public.submit_staff_leave_request(
  target_organization_id uuid,
  target_student_id uuid,
  target_session_id uuid,
  target_reason text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_request public.leave_requests%rowtype;
  leave_request_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.organization_members
    where organization_id = target_organization_id
      and user_id = auth.uid()
      and role in ('admin', 'staff')
      and status = 'active'
  ) then
    raise exception 'manager authorization required';
  end if;

  target_reason := btrim(coalesce(target_reason, ''));
  target_idempotency_key := btrim(coalesce(target_idempotency_key, ''));
  if length(target_idempotency_key) not between 1 and 200 then
    raise exception 'invalid idempotency key';
  end if;
  if length(target_reason) not between 1 and 2000 then
    raise exception 'invalid leave reason';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('staff-leave:' || target_organization_id::text || ':' || target_idempotency_key, 0)
  );

  select * into existing_request
  from public.leave_requests
  where organization_id = target_organization_id
    and idempotency_key = target_idempotency_key
  for update;
  if found then
    if existing_request.requested_by is distinct from auth.uid()
      or existing_request.student_id <> target_student_id
      or existing_request.lesson_session_id is distinct from target_session_id
      or existing_request.reason <> target_reason then
      raise exception 'idempotency key payload mismatch';
    end if;
    return existing_request.id;
  end if;

  if not exists (
    select 1
    from public.lesson_sessions ls
    join public.cohort_students cs
      on cs.organization_id = ls.organization_id
      and cs.cohort_id = ls.cohort_id
      and cs.student_id = target_student_id
    join public.students s
      on s.organization_id = ls.organization_id
      and s.id = cs.student_id
    where ls.id = target_session_id
      and ls.organization_id = target_organization_id
      and ls.status = 'scheduled'
      and ls.starts_at > statement_timestamp()
      and s.status = 'active'
      and cs.status = 'active'
      and cs.is_active_membership
  ) then
    raise exception 'session is not available for this student';
  end if;

  insert into public.leave_requests (
    organization_id, student_id, lesson_session_id, requested_by,
    reason, status, idempotency_key
  ) values (
    target_organization_id, target_student_id, target_session_id, auth.uid(),
    target_reason, 'pending', target_idempotency_key
  ) returning id into leave_request_id;

  return leave_request_id;
end
$$;

create or replace function public.book_makeup_session(
  target_organization_id uuid,
  target_entitlement_id uuid,
  target_teacher_id uuid,
  target_scheduled_at timestamptz,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  entitlement_row public.makeup_entitlements%rowtype;
  existing_session public.makeup_sessions%rowtype;
  task_id uuid;
  session_id uuid;
  v_lesson_plan_id uuid;
  v_original_session_id uuid;
  v_cohort_id uuid;
  existing_task public.makeup_tasks%rowtype;
begin
  if not public.can_manage_organization(target_organization_id) then
    raise exception 'not authorized';
  end if;

  target_idempotency_key := btrim(coalesce(target_idempotency_key, ''));
  if length(target_idempotency_key) not between 1 and 200 then
    raise exception 'invalid idempotency key';
  end if;
  if target_teacher_id is null then
    raise exception 'active teacher required';
  end if;
  if target_scheduled_at is null then
    raise exception 'scheduled time required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('makeup-book:' || target_organization_id::text || ':' || target_idempotency_key, 0)
  );

  select * into existing_session
  from public.makeup_sessions
  where organization_id = target_organization_id
    and idempotency_key = target_idempotency_key
  for update;
  if found then
    if existing_session.entitlement_id is distinct from target_entitlement_id
      or existing_session.teacher_id is distinct from target_teacher_id
      or existing_session.scheduled_at <> target_scheduled_at then
      raise exception 'idempotency key payload mismatch';
    end if;
    return jsonb_build_object(
      'ok', true,
      'makeup_task_id', existing_session.makeup_task_id,
      'makeup_session_id', existing_session.id,
      'status', 'existing'
    );
  end if;

  if (target_scheduled_at at time zone 'Asia/Macau')
      <= (statement_timestamp() at time zone 'Asia/Macau') then
    raise exception 'scheduled time must be in the future';
  end if;

  if not exists (
    select 1
    from public.teacher_profiles tp
    join public.organization_members om
      on om.organization_id = tp.organization_id
      and om.user_id = tp.user_id
      and om.role = 'teacher'
      and om.status = 'active'
    where tp.id = target_teacher_id
      and tp.organization_id = target_organization_id
      and tp.is_active
  ) then
    raise exception 'teacher not found or inactive';
  end if;

  select * into entitlement_row
  from public.makeup_entitlements
  where id = target_entitlement_id
    and organization_id = target_organization_id
  for update;
  if entitlement_row.id is null then raise exception 'entitlement not found'; end if;
  if entitlement_row.status <> 'available' or entitlement_row.units_remaining < 1 then
    raise exception 'entitlement unavailable';
  end if;
  if entitlement_row.expires_at is not null and entitlement_row.expires_at <= statement_timestamp() then
    raise exception 'entitlement expired';
  end if;

  if exists (
    select 1
    from public.makeup_sessions
    where organization_id = target_organization_id
      and teacher_id = target_teacher_id
      and scheduled_at = target_scheduled_at
      and status = 'scheduled'
  ) then
    raise exception 'makeup slot is full';
  end if;

  if entitlement_row.leave_request_id is not null then
    select ls.lesson_plan_id, ls.id, ls.cohort_id
    into v_lesson_plan_id, v_original_session_id, v_cohort_id
    from public.leave_requests lr
    join public.lesson_sessions ls
      on ls.id = lr.lesson_session_id
      and ls.organization_id = lr.organization_id
    where lr.id = entitlement_row.leave_request_id
      and lr.organization_id = target_organization_id;
  else
    select ls.lesson_plan_id, ls.id, ls.cohort_id
    into v_lesson_plan_id, v_original_session_id, v_cohort_id
    from public.attendance_records ar
    join public.lesson_sessions ls
      on ls.id = ar.session_id
      and ls.organization_id = ar.organization_id
    where ar.id = entitlement_row.attendance_record_id
      and ar.organization_id = target_organization_id;
  end if;
  if v_lesson_plan_id is null or v_original_session_id is null or v_cohort_id is null then
    raise exception 'entitlement has no lesson context';
  end if;

  select * into existing_task
  from public.makeup_tasks
  where organization_id = target_organization_id
    and entitlement_id = entitlement_row.id
  for update;
  if found and existing_task.status in ('scheduled', 'completed', 'waived') then
    raise exception 'makeup entitlement already has a non-reopenable task';
  end if;

  insert into public.makeup_tasks (
    organization_id, student_id, cohort_id, lesson_plan_id, original_session_id,
    attendance_record_id, entitlement_id, missed_status, status, parent_visible_summary
  ) values (
    target_organization_id, entitlement_row.student_id, v_cohort_id, v_lesson_plan_id,
    v_original_session_id, entitlement_row.attendance_record_id, entitlement_row.id,
    'excused', 'scheduled', 'Makeup session scheduled.'
  )
  on conflict (entitlement_id) where entitlement_id is not null do update
    set status = case
          when public.makeup_tasks.status in ('completed', 'waived', 'cancelled')
            then public.makeup_tasks.status
          else 'scheduled'
        end,
        updated_at = statement_timestamp()
  returning id into task_id;

  insert into public.makeup_sessions (
    organization_id, makeup_task_id, entitlement_id, student_id, teacher_id,
    scheduled_at, status, created_by, idempotency_key
  ) values (
    target_organization_id, task_id, entitlement_row.id, entitlement_row.student_id,
    target_teacher_id, target_scheduled_at, 'scheduled', auth.uid(), target_idempotency_key
  ) returning id into session_id;

  update public.makeup_entitlements
  set status = 'reserved', updated_at = statement_timestamp()
  where id = entitlement_row.id;

  insert into public.communication_logs (
    organization_id, student_id, channel, direction, template_key, body, status, idempotency_key
  ) values (
    target_organization_id, entitlement_row.student_id, 'whatsapp', 'outbound', 'makeup_booked',
    'Makeup session booked for ' || to_char(target_scheduled_at at time zone 'Asia/Macau', 'YYYY-MM-DD HH24:MI') || '.',
    'queued', 'makeup-booked:' || entitlement_row.id::text
  ) on conflict (organization_id, idempotency_key) do update
    set body = excluded.body, status = 'queued';

  return jsonb_build_object(
    'ok', true,
    'makeup_task_id', task_id,
    'makeup_session_id', session_id,
    'status', 'created'
  );
end
$$;

create or replace function public.complete_makeup_task(target_makeup_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.makeup_tasks%rowtype;
  session_row public.makeup_sessions%rowtype;
  total_sessions integer;
  scheduled_sessions integer;
  completed_sessions integer;
begin
  select * into task_row
  from public.makeup_tasks
  where id = target_makeup_task_id
  for update;
  if task_row.id is null then raise exception 'makeup task not found'; end if;
  if not public.can_manage_organization(task_row.organization_id) then
    raise exception 'not authorized';
  end if;

  select count(*)::integer,
         count(*) filter (where status = 'scheduled')::integer,
         count(*) filter (where status = 'completed')::integer
  into total_sessions, scheduled_sessions, completed_sessions
  from public.makeup_sessions
  where organization_id = task_row.organization_id
    and makeup_task_id = task_row.id;

  if task_row.status = 'completed' then
    if total_sessions <> 1 or completed_sessions <> 1 then
      raise exception 'completed makeup task must have exactly one completed session';
    end if;
    select * into session_row from public.makeup_sessions
    where organization_id = task_row.organization_id and makeup_task_id = task_row.id and status = 'completed'
    for update;
    return jsonb_build_object(
      'ok', true,
      'makeup_task_id', task_row.id,
      'makeup_session_id', session_row.id,
      'status', 'existing'
    );
  end if;

  if task_row.status <> 'scheduled' then
    raise exception 'makeup task is not completable';
  end if;

  if total_sessions <> 1 or scheduled_sessions <> 1 then
    raise exception 'makeup task must have exactly one scheduled session';
  end if;

  select * into session_row
  from public.makeup_sessions
  where organization_id = task_row.organization_id
    and makeup_task_id = task_row.id
    and status = 'scheduled'
  order by scheduled_at asc, created_at asc
  limit 1
  for update;
  if session_row.id is null then
    raise exception 'scheduled makeup session not found';
  end if;

  update public.makeup_sessions
  set status = 'completed',
      completed_at = coalesce(completed_at, statement_timestamp()),
      updated_at = statement_timestamp()
  where id = session_row.id
    and status = 'scheduled'
  returning * into session_row;
  if session_row.id is null then
    raise exception 'makeup session completion race';
  end if;

  update public.makeup_tasks
  set status = 'completed',
      updated_at = statement_timestamp()
  where id = task_row.id
    and status <> 'completed'
  returning * into task_row;
  if task_row.id is null then
    raise exception 'makeup task completion race';
  end if;

  if session_row.entitlement_id is not null then
    update public.makeup_entitlements
    set units_remaining = 0,
        status = 'consumed',
        updated_at = statement_timestamp()
    where id = session_row.entitlement_id
      and organization_id = session_row.organization_id;
  end if;

  if task_row.attendance_record_id is not null then
    update public.attendance_records
    set status = 'makeup_completed', updated_at = statement_timestamp()
    where id = task_row.attendance_record_id
      and organization_id = task_row.organization_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'makeup_task_id', task_row.id,
    'makeup_session_id', session_row.id,
    'status', 'completed'
  );
end
$$;

create or replace function public.recover_parent_account(
  p_organization_id uuid,
  p_parent_profile_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row public.parent_profiles%rowtype;
begin
  if not public.can_manage_organization(p_organization_id) then
    raise exception 'not authorized';
  end if;

  select * into profile_row
  from public.parent_profiles
  where id = p_parent_profile_id
    and organization_id = p_organization_id
  for update;
  if profile_row.id is null then raise exception 'parent profile not found'; end if;
  if profile_row.user_id is null then raise exception 'linked parent auth user required'; end if;

  perform pg_advisory_xact_lock(hashtextextended('parent-recover:' || profile_row.user_id::text, 0));

  if exists (
    select 1
    from public.parent_profiles
    where user_id = profile_row.user_id
      and id <> profile_row.id
  ) then
    raise exception 'auth user already linked to another parent profile';
  end if;

  update public.parent_account_invitations
  set status = 'expired',
      disabled_at = null,
      updated_at = statement_timestamp()
  where organization_id = profile_row.organization_id
    and parent_profile_id = profile_row.id
    and status in ('pending', 'sent', 'accepted', 'disabled');

  update public.parent_profiles
  set account_status = 'expired',
      invited_at = null,
      updated_at = statement_timestamp()
  where id = profile_row.id
    and organization_id = profile_row.organization_id
    and account_status = 'disabled';

  if found then
    return true;
  end if;

  raise exception 'parent profile cannot be recovered from current state';
end
$$;

revoke insert, update, delete on public.organization_members from authenticated;
revoke insert, update, delete on public.teacher_profiles from authenticated;
revoke insert, update, delete on public.leave_requests from authenticated;
revoke insert, update, delete on public.makeup_entitlements from authenticated;
revoke insert, update, delete on public.makeup_tasks from authenticated;
revoke insert, update, delete on public.makeup_sessions from authenticated;
revoke insert, update, delete on public.parent_profiles from authenticated;
revoke insert, update, delete on public.parent_account_invitations from authenticated;
revoke insert, update, delete on public.push_devices from authenticated;

revoke all on function public.link_teacher_profile(uuid, uuid, text, text) from public;
revoke all on function public.submit_staff_leave_request(uuid, uuid, uuid, text, text) from public;
revoke all on function public.book_makeup_session(uuid, uuid, uuid, timestamptz, text) from public;
revoke all on function public.complete_makeup_task(uuid) from public;
revoke all on function public.recover_parent_account(uuid, uuid) from public;

grant execute on function public.link_teacher_profile(uuid, uuid, text, text) to authenticated;
grant execute on function public.submit_staff_leave_request(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.book_makeup_session(uuid, uuid, uuid, timestamptz, text) to authenticated, service_role;
grant execute on function public.complete_makeup_task(uuid) to authenticated, service_role;
grant execute on function public.recover_parent_account(uuid, uuid) to authenticated, service_role;
