-- Recover orphaned makeup task state and enforce a canonical booking/completion lock order.

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
  task_row public.makeup_tasks%rowtype;
  task_id uuid;
  session_id uuid;
  v_lesson_plan_id uuid;
  v_original_session_id uuid;
  v_cohort_id uuid;
  task_session_count integer := 0;
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
    hashtextextended('makeup-entitlement:' || target_organization_id::text || ':' || target_entitlement_id::text, 0)
  );

  select * into entitlement_row
  from public.makeup_entitlements
  where id = target_entitlement_id
    and organization_id = target_organization_id
  for update;
  if entitlement_row.id is null then raise exception 'entitlement not found'; end if;

  select * into task_row
  from public.makeup_tasks
  where organization_id = target_organization_id
    and entitlement_id = entitlement_row.id
  for update;

  select * into existing_session
  from public.makeup_sessions
  where organization_id = target_organization_id
    and idempotency_key = target_idempotency_key
  for update;

  if existing_session.id is not null then
    if existing_session.entitlement_id is distinct from target_entitlement_id
      or existing_session.teacher_id is distinct from target_teacher_id
      or existing_session.scheduled_at <> target_scheduled_at then
      raise exception 'idempotency key payload mismatch';
    end if;
    if task_row.id is null
      or existing_session.makeup_task_id is distinct from task_row.id then
      raise exception 'idempotency key task mismatch';
    end if;
    return jsonb_build_object(
      'ok', true,
      'makeup_task_id', existing_session.makeup_task_id,
      'makeup_session_id', existing_session.id,
      'status', 'existing'
    );
  end if;

  if task_row.id is not null then
    if task_row.status in ('completed', 'waived', 'cancelled') then
      raise exception 'makeup entitlement already has a non-reopenable task';
    end if;

    perform 1
    from public.makeup_sessions
    where organization_id = target_organization_id
      and makeup_task_id = task_row.id
    for update;

    select count(*)::integer into task_session_count
    from public.makeup_sessions
    where organization_id = target_organization_id
      and makeup_task_id = task_row.id;

    if task_session_count > 0 then
      raise exception 'makeup entitlement already has a scheduled session';
    end if;
  end if;

  if entitlement_row.status <> 'available'
    and not (
      entitlement_row.status = 'reserved'
      and task_row.id is not null
      and task_row.status in ('pending', 'recommended', 'scheduled')
      and task_session_count = 0
    ) then
    raise exception 'entitlement unavailable';
  end if;
  if entitlement_row.units_remaining < 1 then
    raise exception 'entitlement unavailable';
  end if;
  if entitlement_row.expires_at is not null and entitlement_row.expires_at <= statement_timestamp() then
    raise exception 'entitlement expired';
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

  perform 1
  from public.makeup_sessions
  where organization_id = target_organization_id
    and teacher_id = target_teacher_id
    and scheduled_at = target_scheduled_at
    and status = 'scheduled'
  for update;
  if found then
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

  if task_row.id is not null then
    update public.makeup_tasks
    set status = 'scheduled',
        updated_at = statement_timestamp()
    where id = task_row.id
      and status in ('pending', 'recommended', 'scheduled')
    returning id into task_id;
  else
    insert into public.makeup_tasks (
      organization_id, student_id, cohort_id, lesson_plan_id, original_session_id,
      attendance_record_id, entitlement_id, missed_status, status, parent_visible_summary
    ) values (
      target_organization_id, entitlement_row.student_id, v_cohort_id, v_lesson_plan_id,
      v_original_session_id, entitlement_row.attendance_record_id, entitlement_row.id,
      'excused', 'scheduled', 'Makeup session scheduled.'
    )
    returning id into task_id;
  end if;
  if task_id is null then
    raise exception 'makeup task scheduling race';
  end if;

  insert into public.makeup_sessions (
    organization_id, makeup_task_id, entitlement_id, student_id, teacher_id,
    scheduled_at, status, created_by, idempotency_key
  ) values (
    target_organization_id, task_id, entitlement_row.id, entitlement_row.student_id,
    target_teacher_id, target_scheduled_at, 'scheduled', auth.uid(), target_idempotency_key
  ) returning id into session_id;

  update public.makeup_entitlements
  set status = 'reserved', updated_at = statement_timestamp()
  where id = entitlement_row.id
    and organization_id = target_organization_id;

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
  observed_organization_id uuid;
  observed_entitlement_id uuid;
  entitlement_row public.makeup_entitlements%rowtype;
  task_row public.makeup_tasks%rowtype;
  session_row public.makeup_sessions%rowtype;
  total_sessions integer;
  scheduled_sessions integer;
  completed_sessions integer;
begin
  select organization_id, entitlement_id
  into observed_organization_id, observed_entitlement_id
  from public.makeup_tasks
  where id = target_makeup_task_id;
  if observed_organization_id is null then raise exception 'makeup task not found'; end if;

  if not public.can_manage_organization(observed_organization_id) then
    raise exception 'not authorized';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      case
        when observed_entitlement_id is null
          then 'makeup-task:' || observed_organization_id::text || ':' || target_makeup_task_id::text
        else 'makeup-entitlement:' || observed_organization_id::text || ':' || observed_entitlement_id::text
      end,
      0
    )
  );

  if observed_entitlement_id is not null then
    select * into entitlement_row
    from public.makeup_entitlements
    where id = observed_entitlement_id
      and organization_id = observed_organization_id
    for update;
    if entitlement_row.id is null then
      raise exception 'makeup entitlement changed during completion';
    end if;
  end if;

  select * into task_row
  from public.makeup_tasks
  where id = target_makeup_task_id
  for update;
  if task_row.id is null then raise exception 'makeup task not found'; end if;
  if task_row.organization_id is distinct from observed_organization_id
    or task_row.entitlement_id is distinct from observed_entitlement_id then
    raise exception 'makeup task changed during completion';
  end if;

  perform 1
  from public.makeup_sessions
  where organization_id = task_row.organization_id
    and makeup_task_id = task_row.id
  for update;

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
    select * into session_row
    from public.makeup_sessions
    where organization_id = task_row.organization_id
      and makeup_task_id = task_row.id
      and status = 'completed'
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
  if session_row.entitlement_id is distinct from task_row.entitlement_id then
    raise exception 'makeup session entitlement mismatch';
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
    and status = 'scheduled'
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

revoke all on function public.book_makeup_session(uuid, uuid, uuid, timestamptz, text) from public;
revoke all on function public.complete_makeup_task(uuid) from public;
grant execute on function public.book_makeup_session(uuid, uuid, uuid, timestamptz, text) to authenticated, service_role;
grant execute on function public.complete_makeup_task(uuid) to authenticated, service_role;
