-- Replace the timestamp-shaped teacher attendance revision with an explicit,
-- database-enforced monotonic counter. PostgreSQL now()/transaction_timestamp()
-- is stable for an entire transaction, so updated_at cannot prove that every
-- successful mutation advances the optimistic-concurrency token.

set lock_timeout = '5s';
set statement_timeout = '60s';

alter table public.attendance_records
  add column if not exists revision bigint not null default 1;

comment on column public.attendance_records.revision is
  'Monotonic optimistic-concurrency revision; initialized at 1 and advanced by a database trigger.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.attendance_records'::regclass
      and conname = 'attendance_records_revision_positive'
  ) then
    alter table public.attendance_records
      add constraint attendance_records_revision_positive check (revision >= 1);
  end if;
end
$$;

create or replace function public.set_attendance_revision()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
  else
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_attendance_records_revision on public.attendance_records;
create trigger trg_attendance_records_revision
before insert or update on public.attendance_records
for each row execute function public.set_attendance_revision();

-- Remove the timestamp overload so no authenticated caller can bypass the
-- monotonic revision contract through the former RPC signature.
drop function if exists public.submit_teacher_attendance(uuid,uuid,text,timestamptz,text,text);

create or replace function public.submit_teacher_attendance(
  target_session_id uuid,
  target_student_id uuid,
  target_status text,
  target_expected_revision bigint,
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
  request_history jsonb;
  request_seen boolean := false;
begin
  if auth.uid() is null then raise exception 'authenticated user required'; end if;
  if target_status not in ('present', 'absent', 'excused') then raise exception 'invalid attendance status'; end if;
  if target_expected_revision is not null and target_expected_revision < 1 then raise exception 'invalid attendance revision'; end if;
  if length(normalized_request_id) not between 1 and 200 then raise exception 'invalid attendance request id'; end if;

  -- Resolve only the immutable attendance identity before taking any blocking
  -- row lock. The identity-scoped advisory lock must be attempted first so a
  -- concurrent write to the same attendance row can fail immediately.
  select * into session_row
  from public.lesson_sessions
  where id = target_session_id;
  if session_row.id is null then raise exception 'lesson session not found'; end if;

  if not pg_try_advisory_xact_lock(hashtextextended(
    'teacher-attendance:' || session_row.organization_id::text || ':' || target_session_id::text || ':' || target_student_id::text,
    0
  )) then
    raise exception 'attendance update is already in progress';
  end if;

  -- Re-read under the existing row lock after the non-blocking identity lock.
  -- This preserves the original session-state serialization and ensures every
  -- authorization and lifecycle check below uses the locked current row.
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

  select * into attendance_row
  from public.attendance_records
  where organization_id = session_row.organization_id
    and session_id = target_session_id
    and student_id = target_student_id
  for update;

  -- A transport retry reuses the same request ID. It is a no-op only when the
  -- completed request had the same identity and payload; a reused ID with a
  -- different payload is treated as stale instead of becoming a mutation.
  select al.new_data->'attendance_history'
    into request_history
  from public.audit_logs al
  where al.organization_id = session_row.organization_id
    and al.table_name = 'attendance_records'
    and al.new_data->'attendance_history'->>'session_id' = target_session_id::text
    and al.new_data->'attendance_history'->>'student_id' = target_student_id::text
    and al.new_data->'attendance_history'->>'request_id' = normalized_request_id
  order by al.occurred_at
  limit 1;
  request_seen := found;

  if request_seen then
    if attendance_row.id is null
       or request_history->>'new_status' is distinct from target_status
       or coalesce(request_history->>'reason', '') is distinct from normalized_reason then
      raise exception 'attendance has changed; reload before submitting';
    end if;
    return jsonb_build_object(
      'changed', false,
      'revision', attendance_row.revision,
      'idempotent_replay', true
    );
  end if;

  if attendance_row.id is null then
    if target_expected_revision is not null then
      raise exception 'attendance has changed; reload before submitting';
    end if;
  elsif target_expected_revision is null
        or target_expected_revision <> attendance_row.revision then
    raise exception 'attendance has changed; reload before submitting';
  end if;

  if attendance_row.id is not null and attendance_row.status = target_status then
    return jsonb_build_object('changed', false, 'revision', attendance_row.revision);
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

  return jsonb_build_object('changed', true, 'revision', attendance_row.revision);
end;
$$;

-- Function EXECUTE is granted to PUBLIC by default. Make the internal trigger
-- helper unreachable and expose only the authenticated application RPC.
revoke all on function public.set_attendance_revision() from public;
revoke all on function public.set_attendance_revision() from anon;
revoke all on function public.set_attendance_revision() from authenticated;
revoke all on function public.set_attendance_revision() from service_role;

revoke all on function public.submit_teacher_attendance(uuid,uuid,text,bigint,text,text) from public;
revoke all on function public.submit_teacher_attendance(uuid,uuid,text,bigint,text,text) from anon;
revoke all on function public.submit_teacher_attendance(uuid,uuid,text,bigint,text,text) from authenticated;
revoke all on function public.submit_teacher_attendance(uuid,uuid,text,bigint,text,text) from service_role;
grant execute on function public.submit_teacher_attendance(uuid,uuid,text,bigint,text,text) to authenticated;

reset lock_timeout;
reset statement_timeout;
