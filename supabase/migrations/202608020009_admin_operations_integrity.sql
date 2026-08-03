-- Close Admin Web onboarding and leave-integrity gaps with atomic, tenant-safe RPCs.

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

  -- Serialize all attempts for one Auth identity, including cross-tenant attempts.
  perform pg_advisory_xact_lock(hashtextextended(target_user_id::text, 0));

  select * into existing_teacher
  from public.teacher_profiles
  where user_id = target_user_id
  for update;
  if found and existing_teacher.organization_id <> target_organization_id then
    raise exception 'teacher identity belongs to another organization';
  end if;

  select * into existing_member
  from public.organization_members
  where organization_id = target_organization_id and user_id = target_user_id
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
  if length(target_reason) not between 1 and 2000 then
    raise exception 'invalid leave reason';
  end if;
  if length(target_idempotency_key) not between 1 and 200 then
    raise exception 'invalid idempotency key';
  end if;

  -- Serialize retries for one tenant/key so concurrent submissions return the
  -- same request instead of racing into the unique constraint.
  perform pg_advisory_xact_lock(
    hashtextextended(target_organization_id::text || ':' || target_idempotency_key, 0)
  );

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

-- All application writes now use the guarded parent/staff/decision RPCs.
revoke insert, update, delete on public.leave_requests from authenticated;

revoke all on function public.link_teacher_profile(uuid, uuid, text, text) from public;
revoke all on function public.submit_staff_leave_request(uuid, uuid, uuid, text, text) from public;
grant execute on function public.link_teacher_profile(uuid, uuid, text, text) to authenticated;
grant execute on function public.submit_staff_leave_request(uuid, uuid, uuid, text, text) to authenticated;
