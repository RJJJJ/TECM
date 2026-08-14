-- Teacher attendance history is intentionally isolated to a controlled RPC.
-- This migration leaves the existing staff/admin submission path intact while
-- preventing a teacher from bypassing the history, audit, and concurrency rules.

-- idx_lesson_sessions_teacher_starts already provides a (teacher_id, starts_at)
-- B-tree. Teacher history queries constrain teacher_id by equality, and PostgreSQL
-- can scan that B-tree backward for starts_at DESC, so no redundant index is created.

create index if not exists idx_audit_logs_attendance_history
  on public.audit_logs (organization_id, occurred_at desc)
  where table_name = 'attendance_records';

create or replace function public.capture_attendance_history_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_json jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  new_json jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  org_id uuid := coalesce((new_json->>'organization_id')::uuid, (old_json->>'organization_id')::uuid);
  row_id text := coalesce(new_json->>'id', old_json->>'id');
  actor_role text;
  history jsonb;
begin
  select om.role into actor_role
  from public.organization_members om
  where om.organization_id = org_id
    and om.user_id = auth.uid()
    and om.status = 'active'
  order by case om.role when 'admin' then 1 when 'staff' then 2 when 'teacher' then 3 else 4 end
  limit 1;

  history := jsonb_strip_nulls(jsonb_build_object(
    'organization_id', org_id,
    'session_id', coalesce(new_json->>'session_id', old_json->>'session_id'),
    'student_id', coalesce(new_json->>'student_id', old_json->>'student_id'),
    'actor_user_id', auth.uid(),
    'actor_role', actor_role,
    'previous_status', old_json->>'status',
    'new_status', new_json->>'status',
    'reason', nullif(current_setting('app.teacher_attendance_reason', true), ''),
    'request_id', nullif(current_setting('app.teacher_attendance_request_id', true), '')
  ));

  insert into public.audit_logs (organization_id, actor_user_id, table_name, record_id, action, old_data, new_data)
  values (
    org_id,
    auth.uid(),
    tg_table_name,
    row_id,
    tg_op,
    old_json,
    coalesce(new_json, '{}'::jsonb) || jsonb_build_object('attendance_history', history)
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_attendance_records_audit on public.attendance_records;
create trigger trg_attendance_records_audit
after insert or update or delete on public.attendance_records
for each row execute function public.capture_attendance_history_audit();

create or replace function public.get_teacher_attendance_sessions()
returns table (
  session_id uuid,
  cohort_id uuid,
  course_title text,
  cohort_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  session_status text,
  attended_count bigint,
  roster_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ls.id,
    ls.cohort_id,
    c.title,
    ec.name,
    ls.starts_at,
    ls.ends_at,
    ls.status,
    count(ar.id) filter (where ar.status is not null),
    count(cs.id)
  from public.lesson_sessions ls
  join public.organization_members om
    on om.organization_id = ls.organization_id
   and om.user_id = auth.uid()
   and om.status = 'active'
   and om.role = 'teacher'
  join public.teacher_profiles tp
    on tp.id = ls.teacher_id
   and tp.organization_id = ls.organization_id
   and tp.user_id = auth.uid()
   and tp.is_active
  join public.exam_cohorts ec
    on ec.id = ls.cohort_id
   and ec.organization_id = ls.organization_id
  left join public.courses c on c.id = ec.course_id
  left join public.cohort_students cs
    on cs.organization_id = ls.organization_id
   and cs.cohort_id = ls.cohort_id
   and cs.status = 'active'
  left join public.attendance_records ar
    on ar.organization_id = ls.organization_id
   and ar.session_id = ls.id
   and ar.student_id = cs.student_id
  group by ls.id, ec.id, c.id
  order by ls.starts_at desc;
$$;

create or replace function public.submit_teacher_attendance(
  target_session_id uuid,
  target_student_id uuid,
  target_status text,
  target_expected_updated_at timestamptz,
  target_reason text,
  target_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.lesson_sessions%rowtype;
  attendance_row public.attendance_records%rowtype;
  actor_role text;
  normalized_reason text := btrim(coalesce(target_reason, ''));
  normalized_request_id text := btrim(coalesce(target_request_id, ''));
begin
  if auth.uid() is null then raise exception 'authenticated user required'; end if;
  if target_status not in ('present', 'absent', 'excused') then raise exception 'invalid attendance status'; end if;
  if length(normalized_request_id) not between 1 and 200 then raise exception 'invalid attendance request id'; end if;

  select * into session_row
  from public.lesson_sessions
  where id = target_session_id
  for update;
  if session_row.id is null then raise exception 'lesson session not found'; end if;

  select om.role into actor_role
  from public.organization_members om
  where om.organization_id = session_row.organization_id
    and om.user_id = auth.uid()
    and om.status = 'active'
  limit 1;
  if actor_role <> 'teacher' then raise exception 'teacher role required'; end if;

  if not exists (
    select 1 from public.teacher_profiles tp
    where tp.id = session_row.teacher_id
      and tp.organization_id = session_row.organization_id
      and tp.user_id = auth.uid()
      and tp.is_active
  ) then raise exception 'teacher is not assigned to this session'; end if;

  if session_row.status = 'cancelled' then raise exception 'attendance cannot be submitted for a cancelled session'; end if;
  if session_row.starts_at > now() then raise exception 'future session attendance is not allowed'; end if;

  if not exists (
    select 1 from public.students s
    join public.cohort_students cs
      on cs.organization_id = s.organization_id
     and cs.cohort_id = session_row.cohort_id
     and cs.student_id = s.id
     and cs.status = 'active'
    where s.id = target_student_id
      and s.organization_id = session_row.organization_id
      and s.status = 'active'
  ) then raise exception 'student is not active in this session cohort'; end if;

  -- One lock per attendance identity makes a missing-row insert and an update
  -- equally safe from competing browser tabs.
  perform pg_advisory_xact_lock(hashtextextended(
    'teacher-attendance:' || session_row.organization_id::text || ':' || target_session_id::text || ':' || target_student_id::text,
    0
  ));

  select * into attendance_row
  from public.attendance_records
  where organization_id = session_row.organization_id
    and session_id = target_session_id
    and student_id = target_student_id
  for update;

  if attendance_row.id is not null and attendance_row.status = target_status then
    return jsonb_build_object('changed', false, 'updated_at', attendance_row.updated_at);
  end if;

  if attendance_row.id is not null
     and target_expected_updated_at is distinct from attendance_row.updated_at then
    raise exception 'attendance has changed; reload before submitting';
  end if;
  if attendance_row.id is null and target_expected_updated_at is not null then
    raise exception 'attendance has changed; reload before submitting';
  end if;

  if session_row.ends_at < now() and normalized_reason = '' then
    raise exception 'attendance correction reason is required';
  end if;

  if attendance_row.id is not null and (
    exists (
      select 1 from public.leave_requests lr
      where lr.organization_id = session_row.organization_id
        and lr.lesson_session_id = target_session_id
        and lr.student_id = target_student_id
        and lr.status = 'approved'
    )
    or exists (
      select 1 from public.makeup_tasks mt
      where mt.attendance_record_id = attendance_row.id
        and mt.status in ('scheduled', 'completed', 'waived')
    )
    or exists (
      select 1 from public.makeup_entitlements me
      where me.attendance_record_id = attendance_row.id
        and me.status in ('reserved', 'consumed')
    )
  ) then
    raise exception 'attendance is linked to finalized leave or makeup records';
  end if;

  perform set_config('app.teacher_attendance_reason', normalized_reason, true);
  perform set_config('app.teacher_attendance_request_id', normalized_request_id, true);

  if attendance_row.id is null then
    insert into public.attendance_records (
      organization_id, session_id, student_id, status, recorded_by, recorded_at, internal_note
    ) values (
      session_row.organization_id, target_session_id, target_student_id, target_status, auth.uid(), now(), nullif(normalized_reason, '')
    ) returning * into attendance_row;
  else
    update public.attendance_records
    set status = target_status,
        recorded_by = auth.uid(),
        recorded_at = now(),
        internal_note = nullif(normalized_reason, '')
    where id = attendance_row.id
    returning * into attendance_row;
  end if;

  return jsonb_build_object('changed', true, 'updated_at', attendance_row.updated_at);
end;
$$;

-- The legacy batch RPC is retained for staff/admin workflows only. A teacher
-- must use submit_teacher_attendance so historic writes cannot skip a reason,
-- finalized-record guard, audit context, or optimistic concurrency check.
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
  if session_organization_id is null then raise exception 'lesson session not found'; end if;
  if session_status = 'cancelled' then raise exception 'attendance cannot be submitted for a cancelled session'; end if;
  if auth.uid() is null then raise exception 'authenticated user required'; end if;
  if not public.can_manage_organization(session_organization_id) then raise exception 'staff authorization required'; end if;
  if records is null or jsonb_typeof(records) <> 'array' or jsonb_array_length(records) = 0 then raise exception 'attendance records must be a non-empty JSON array'; end if;
  for item in select value from jsonb_array_elements(records) loop
    if jsonb_typeof(item) <> 'object' then raise exception 'each attendance record must be a JSON object'; end if;
    begin submitted_student_id := nullif(item->>'student_id', '')::uuid; exception when invalid_text_representation then raise exception 'attendance student_id must be a valid UUID'; end;
    if submitted_student_id is null then raise exception 'attendance student_id must be a valid UUID'; end if;
    if submitted_student_id = any(seen_student_ids) then raise exception 'duplicate student_id in attendance records'; end if;
    seen_student_ids := array_append(seen_student_ids, submitted_student_id);
    submitted_status := item->>'status';
    if submitted_status is null or submitted_status not in ('present', 'absent', 'excused', 'makeup_completed') then raise exception 'invalid attendance status'; end if;
    if not exists (
      select 1 from public.students s join public.cohort_students cs
        on cs.organization_id = s.organization_id and cs.student_id = s.id and cs.cohort_id = session_cohort_id and cs.status = 'active'
      where s.id = submitted_student_id and s.organization_id = session_organization_id and s.status = 'active'
    ) then raise exception 'student % is not active in this session cohort', submitted_student_id; end if;
  end loop;
  for item in select value from jsonb_array_elements(records) loop
    submitted_student_id := (item->>'student_id')::uuid;
    submitted_status := item->>'status';
    insert into public.attendance_records (organization_id, session_id, student_id, status, recorded_by, recorded_at, internal_note)
    values (session_organization_id, target_session_id, submitted_student_id, submitted_status, auth.uid(), now(), nullif(item->>'internal_note', ''))
    on conflict (organization_id, session_id, student_id) do update set
      status = excluded.status, recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at,
      internal_note = excluded.internal_note, updated_at = now();
  end loop;
end;
$$;

-- Keep the established admin/staff direct-table capability intact, but remove
-- the former teacher policy so a teacher can write only through the guarded
-- RPC above. (Privileges alone are not authorization; RLS remains decisive.)
drop policy if exists attendance_teacher_write_own_session on public.attendance_records;
drop policy if exists attendance_staff_manage on public.attendance_records;
drop policy if exists attendance_teacher_read_assigned on public.attendance_records;
create policy attendance_teacher_read_assigned
on public.attendance_records for select
using (
  public.is_teacher_for_session(session_id)
  and exists (
    select 1 from public.organization_members om
    where om.organization_id = attendance_records.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
      and om.role = 'teacher'
  )
);
create policy attendance_staff_manage
on public.attendance_records for all
using (public.can_manage_organization(organization_id))
with check (public.can_manage_organization(organization_id));

revoke all on function public.capture_attendance_history_audit() from public;
revoke all on function public.get_teacher_attendance_sessions() from public;
revoke all on function public.submit_teacher_attendance(uuid,uuid,text,timestamptz,text,text) from public;
grant execute on function public.get_teacher_attendance_sessions() to authenticated;
grant execute on function public.submit_teacher_attendance(uuid,uuid,text,timestamptz,text,text) to authenticated;
