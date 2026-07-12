-- Release hardening: tenant-safe attendance RPCs and explicit function privileges.

create or replace function public.can_manage_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') = 'service_role'
    or exists (
      select 1
      from public.organization_members om
      where om.organization_id = target_organization_id
        and om.user_id = auth.uid()
        and om.status = 'active'
        and om.role in ('admin', 'staff')
    );
$$;

create or replace function public.is_teacher_for_cohort(target_cohort_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.exam_cohorts ec
    join public.teacher_profiles tp
      on tp.organization_id = ec.organization_id
     and tp.id = ec.lead_teacher_id
     and tp.is_active = true
    join public.organization_members om
      on om.organization_id = ec.organization_id
     and om.user_id = tp.user_id
     and om.role = 'teacher'
     and om.status = 'active'
    where ec.id = target_cohort_id
      and tp.user_id = auth.uid()
  );
$$;

create or replace function public.is_teacher_for_session(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lesson_sessions ls
    join public.teacher_profiles tp
      on tp.organization_id = ls.organization_id
     and tp.id = ls.teacher_id
     and tp.is_active = true
    join public.organization_members om
      on om.organization_id = ls.organization_id
     and om.user_id = tp.user_id
     and om.role = 'teacher'
     and om.status = 'active'
    where ls.id = target_session_id
      and tp.user_id = auth.uid()
  );
$$;

create or replace function public.get_teacher_today_sessions()
returns table (
  session_id uuid,
  cohort_id uuid,
  cohort_name text,
  subject text,
  level text,
  lesson_plan_id uuid,
  sequence_no integer,
  lesson_title text,
  teaching_content text,
  starts_at timestamptz,
  ends_at timestamptz,
  attendance_count bigint,
  student_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with macau_day as (
    select
      ((now() at time zone 'Asia/Macau')::date::timestamp at time zone 'Asia/Macau') as day_start,
      (((now() at time zone 'Asia/Macau')::date + 1)::timestamp at time zone 'Asia/Macau') as day_end
  )
  select
    ls.id,
    ec.id,
    ec.name,
    ec.subject,
    ec.level,
    lp.id,
    lp.sequence_no,
    lp.title,
    lp.teaching_content,
    ls.starts_at,
    ls.ends_at,
    count(distinct ar.id),
    count(distinct cs.student_id)
  from public.lesson_sessions ls
  cross join macau_day md
  join public.teacher_profiles tp
    on tp.organization_id = ls.organization_id
   and tp.id = ls.teacher_id
   and tp.user_id = auth.uid()
   and tp.is_active = true
  join public.organization_members om
    on om.organization_id = ls.organization_id
   and om.user_id = tp.user_id
   and om.role = 'teacher'
   and om.status = 'active'
  join public.exam_cohorts ec
    on ec.organization_id = ls.organization_id
   and ec.id = ls.cohort_id
  join public.lesson_plans lp
    on lp.organization_id = ls.organization_id
   and lp.id = ls.lesson_plan_id
  left join public.cohort_students cs
    on cs.organization_id = ls.organization_id
   and cs.cohort_id = ec.id
   and cs.status = 'active'
  left join public.attendance_records ar
    on ar.organization_id = ls.organization_id
   and ar.session_id = ls.id
  where ls.starts_at >= md.day_start
    and ls.starts_at < md.day_end
  group by ls.id, ec.id, ec.name, ec.subject, ec.level, lp.id, lp.sequence_no,
    lp.title, lp.teaching_content, ls.starts_at, ls.ends_at
  order by ls.starts_at;
$$;

create unique index if not exists attendance_records_tenant_session_student_key
  on public.attendance_records (organization_id, session_id, student_id);

create or replace function public.submit_attendance(target_session_id uuid, records jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  session_organization_id uuid;
  session_cohort_id uuid;
  session_status text;
  submitted_student_id uuid;
  submitted_status text;
  seen_student_ids uuid[] := array[]::uuid[];
begin
  select ls.organization_id, ls.cohort_id, ls.status
    into session_organization_id, session_cohort_id, session_status
  from public.lesson_sessions ls
  where ls.id = target_session_id;

  if session_organization_id is null then
    raise exception 'lesson session not found';
  end if;

  if session_status = 'cancelled' then
    raise exception 'attendance cannot be submitted for a cancelled session';
  end if;

  if auth.uid() is null then
    raise exception 'authenticated user required';
  end if;

  if not (
    public.can_manage_organization(session_organization_id)
    or public.is_teacher_for_session(target_session_id)
  ) then
    raise exception 'not authorized to submit attendance for this session';
  end if;

  if records is null
     or jsonb_typeof(records) <> 'array'
     or jsonb_array_length(records) = 0 then
    raise exception 'attendance records must be a non-empty JSON array';
  end if;

  -- Validate the entire batch before writing so errors are deterministic and a
  -- repeated student cannot create conflicting ledger adjustments in one call.
  for item in select value from jsonb_array_elements(records)
  loop
    if jsonb_typeof(item) <> 'object' then
      raise exception 'each attendance record must be a JSON object';
    end if;

    begin
      submitted_student_id := nullif(item->>'student_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'attendance student_id must be a valid UUID';
    end;

    if submitted_student_id is null then
      raise exception 'attendance student_id must be a valid UUID';
    end if;

    if submitted_student_id = any(seen_student_ids) then
      raise exception 'duplicate student_id in attendance records';
    end if;
    seen_student_ids := array_append(seen_student_ids, submitted_student_id);

    submitted_status := item->>'status';
    if submitted_status is null
       or submitted_status not in ('present', 'absent', 'excused', 'makeup_completed') then
      raise exception 'invalid attendance status';
    end if;

    if not exists (
      select 1
      from public.students s
      join public.cohort_students cs
        on cs.organization_id = s.organization_id
       and cs.student_id = s.id
       and cs.cohort_id = session_cohort_id
       and cs.status = 'active'
      where s.id = submitted_student_id
        and s.organization_id = session_organization_id
        and s.status = 'active'
    ) then
      raise exception 'student % is not active in this session cohort', submitted_student_id;
    end if;
  end loop;

  for item in select value from jsonb_array_elements(records)
  loop
    submitted_student_id := (item->>'student_id')::uuid;
    submitted_status := item->>'status';
    insert into public.attendance_records (
      organization_id,
      session_id,
      student_id,
      status,
      recorded_by,
      recorded_at,
      internal_note
    ) values (
      session_organization_id,
      target_session_id,
      submitted_student_id,
      submitted_status,
      auth.uid(),
      now(),
      nullif(item->>'internal_note', '')
    )
    on conflict (organization_id, session_id, student_id) do update set
      status = excluded.status,
      recorded_by = excluded.recorded_by,
      recorded_at = excluded.recorded_at,
      internal_note = excluded.internal_note,
      updated_at = now();
  end loop;
end;
$$;

create or replace function public.get_lesson_session_students(target_session_id uuid)
returns table (
  student_id uuid,
  display_name text,
  school_name text,
  attendance_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.display_name,
    s.school_name,
    ar.status
  from public.lesson_sessions ls
  join public.cohort_students cs
    on cs.organization_id = ls.organization_id
   and cs.cohort_id = ls.cohort_id
   and cs.status = 'active'
  join public.students s
    on s.organization_id = ls.organization_id
   and s.id = cs.student_id
   and s.status = 'active'
  left join public.attendance_records ar
    on ar.organization_id = ls.organization_id
   and ar.session_id = ls.id
   and ar.student_id = s.id
  where ls.id = target_session_id
    and (
      public.can_manage_organization(ls.organization_id)
      or public.is_teacher_for_session(ls.id)
    )
  order by s.display_name;
$$;

-- Audit rows come only from the SECURITY DEFINER capture trigger. Staff can
-- read their tenant's audit history but cannot forge or mutate it directly.
drop policy if exists org_staff_insert on public.audit_logs;
drop policy if exists org_staff_update on public.audit_logs;
drop policy if exists org_staff_delete on public.audit_logs;
revoke insert, update, delete on public.audit_logs from authenticated;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Remove that
-- implicit capability from every public SECURITY DEFINER function, including
-- trigger helpers that should never be called directly through the API.
do $$
declare
  function_signature text;
begin
  for function_signature in
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    execute format('revoke all on function %s from public', function_signature);
  end loop;
end
$$;

-- RLS helpers are available only to signed-in application and server roles.
grant execute on function public.can_access_organization(uuid) to authenticated, service_role;
grant execute on function public.can_manage_organization(uuid) to authenticated, service_role;
grant execute on function public.is_organization_admin(uuid) to authenticated, service_role;
grant execute on function public.is_staff_or_admin() to authenticated, service_role;
grant execute on function public.is_active_teacher() to authenticated, service_role;
grant execute on function public.is_teacher_for_cohort(uuid) to authenticated, service_role;
grant execute on function public.is_teacher_for_session(uuid) to authenticated, service_role;
grant execute on function public.is_parent_of_student(uuid) to authenticated, service_role;

-- User-facing RPCs. Anonymous callers intentionally receive no EXECUTE grant.
grant execute on function public.get_parent_attendance_summary() to authenticated;
grant execute on function public.get_teacher_today_sessions() to authenticated;
grant execute on function public.submit_attendance(uuid,jsonb) to authenticated;
grant execute on function public.get_lesson_session_students(uuid) to authenticated;
grant execute on function public.decide_leave_request(uuid,text) to authenticated, service_role;
grant execute on function public.record_payment(uuid,uuid,uuid,bigint,text,text) to authenticated, service_role;
grant execute on function public.create_guardian_student_enrollment_package(uuid,text,text,text,text,uuid,uuid,text) to authenticated, service_role;
grant execute on function public.book_makeup_session(uuid,uuid,uuid,timestamptz,text) to authenticated, service_role;
grant execute on function public.complete_follow_up_task(uuid,text) to authenticated, service_role;
grant execute on function public.run_automation_job(uuid,text,text) to authenticated, service_role;
