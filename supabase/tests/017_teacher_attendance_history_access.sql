\set ON_ERROR_STOP on

-- Fixtures are created as the migration owner, then every teacher assertion is
-- executed through the authenticated role and auth.uid() claim.
insert into public.lesson_sessions (
  id, cohort_id, lesson_plan_id, teacher_id, starts_at, ends_at, status, organization_id
) values (
  '1d000000-0000-4000-8000-000000000017',
  '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  '2020-01-10 09:00:00+08', '2020-01-10 10:00:00+08', 'completed',
  '10000000-0000-4000-8000-000000000000'
) on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, status = excluded.status;

do $$
declare
  baseline_index oid;
  baseline_valid boolean;
  baseline_ready boolean;
  baseline_method text;
  baseline_predicate pg_node_tree;
  baseline_key_count integer;
  baseline_first_key text;
  baseline_second_key text;
  audit_index oid;
  audit_valid boolean;
  audit_ready boolean;
  audit_method text;
  audit_predicate text;
  audit_options text;
  audit_key_count integer;
  audit_first_key text;
  audit_second_key text;
begin
  select
    i.indexrelid,
    i.indisvalid,
    i.indisready,
    am.amname,
    i.indpred,
    i.indnkeyatts,
    pg_get_indexdef(i.indexrelid, 1, true),
    pg_get_indexdef(i.indexrelid, 2, true)
  into
    baseline_index,
    baseline_valid,
    baseline_ready,
    baseline_method,
    baseline_predicate,
    baseline_key_count,
    baseline_first_key,
    baseline_second_key
  from pg_index i
  join pg_class index_rel on index_rel.oid = i.indexrelid
  join pg_class table_rel on table_rel.oid = i.indrelid
  join pg_namespace schema_rel on schema_rel.oid = table_rel.relnamespace
  join pg_am am on am.oid = index_rel.relam
  where schema_rel.nspname = 'public'
    and table_rel.relname = 'lesson_sessions'
    and index_rel.relname = 'idx_lesson_sessions_teacher_starts';

  if baseline_index is null
     or not baseline_valid
     or not baseline_ready
     or baseline_method <> 'btree'
     or baseline_predicate is not null
     or baseline_key_count <> 2
     or baseline_first_key <> 'teacher_id'
     or baseline_second_key <> 'starts_at' then
    raise exception 'existing teacher attendance index is missing or has an unexpected contract';
  end if;

  if exists (
    select 1
    from pg_class index_rel
    join pg_index i on i.indexrelid = index_rel.oid
    join pg_class table_rel on table_rel.oid = i.indrelid
    join pg_namespace schema_rel on schema_rel.oid = table_rel.relnamespace
    where schema_rel.nspname = 'public'
      and table_rel.relname = 'lesson_sessions'
      and index_rel.relname = 'idx_lesson_sessions_teacher_history'
  ) then
    raise exception 'redundant teacher attendance history index exists';
  end if;

  if exists (
    select 1
    from pg_index i
    join pg_class index_rel on index_rel.oid = i.indexrelid
    join pg_class table_rel on table_rel.oid = i.indrelid
    join pg_namespace schema_rel on schema_rel.oid = table_rel.relnamespace
    join pg_am am on am.oid = index_rel.relam
    where i.indexrelid <> baseline_index
      and schema_rel.nspname = 'public'
      and table_rel.relname = 'lesson_sessions'
      and am.amname = 'btree'
      and i.indisvalid
      and i.indisready
      and i.indpred is null
      and i.indexprs is null
      and i.indnkeyatts >= 2
      and pg_get_indexdef(i.indexrelid, 1, true) = 'teacher_id'
      and regexp_replace(pg_get_indexdef(i.indexrelid, 2, true), '\s+(ASC|DESC)$', '', 'i') = 'starts_at'
  ) then
    raise exception 'redundant teacher attendance history index exists';
  end if;

  select
    i.indexrelid,
    i.indisvalid,
    i.indisready,
    am.amname,
    pg_get_expr(i.indpred, i.indrelid),
    i.indoption::text,
    i.indnkeyatts,
    pg_get_indexdef(i.indexrelid, 1, true),
    pg_get_indexdef(i.indexrelid, 2, true)
  into
    audit_index,
    audit_valid,
    audit_ready,
    audit_method,
    audit_predicate,
    audit_options,
    audit_key_count,
    audit_first_key,
    audit_second_key
  from pg_index i
  join pg_class index_rel on index_rel.oid = i.indexrelid
  join pg_class table_rel on table_rel.oid = i.indrelid
  join pg_namespace schema_rel on schema_rel.oid = table_rel.relnamespace
  join pg_am am on am.oid = index_rel.relam
  where schema_rel.nspname = 'public'
    and table_rel.relname = 'audit_logs'
    and index_rel.relname = 'idx_audit_logs_attendance_history';

  if audit_index is null
     or not audit_valid
     or not audit_ready
     or audit_method <> 'btree'
     or audit_key_count <> 2
     or audit_first_key <> 'organization_id'
     or audit_second_key <> 'occurred_at'
     or audit_options <> '0 3'
     or audit_predicate not in (
       '(table_name = ''attendance_records''::text)',
       '(table_name = ''attendance_records'')'
     ) then
    raise exception 'attendance audit history index is missing or has an unexpected contract';
  end if;
end
$$;

insert into public.attendance_records (
  organization_id, session_id, student_id, status, recorded_by, recorded_at
) values (
  '10000000-0000-4000-8000-000000000000',
  '1d000000-0000-4000-8000-000000000017',
  '15000000-0000-4000-8000-000000000001', 'absent',
  '10000000-0000-4000-8000-000000000001', '2020-01-10 10:00:00+08'
) on conflict (organization_id, session_id, student_id) do update set status = 'absent';

insert into public.lesson_sessions (
  id, cohort_id, lesson_plan_id, teacher_id, starts_at, ends_at, status, organization_id
) values (
  '1d000000-0000-4000-8000-000000000018',
  '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  now() + interval '1 day', now() + interval '1 day 1 hour', 'scheduled',
  '10000000-0000-4000-8000-000000000000'
) on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, status = excluded.status;

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);

do $$
declare
  first_version timestamptz;
  second_version timestamptz;
  result jsonb;
begin
  if not exists (select 1 from public.get_teacher_attendance_sessions() where session_id = '1d000000-0000-4000-8000-000000000017') then
    raise exception 'assigned teacher could not read historical session';
  end if;
  if not exists (select 1 from public.get_teacher_attendance_sessions() where session_id = '1d000000-0000-4000-8000-000000000018') then
    raise exception 'assigned teacher could not read future session';
  end if;

  select updated_at into first_version from public.attendance_records
  where session_id = '1d000000-0000-4000-8000-000000000017' and student_id = '15000000-0000-4000-8000-000000000001';

  result := public.submit_teacher_attendance(
    '1d000000-0000-4000-8000-000000000017', '15000000-0000-4000-8000-000000000001',
    'excused', first_version, '補登請假原因', 'teacher-history-017-first'
  );
  if result->>'changed' <> 'true' then raise exception 'historical correction unexpectedly became a no-op'; end if;
  select updated_at into second_version from public.attendance_records
  where session_id = '1d000000-0000-4000-8000-000000000017' and student_id = '15000000-0000-4000-8000-000000000001';

  perform public.submit_teacher_attendance(
    '1d000000-0000-4000-8000-000000000017', '15000000-0000-4000-8000-000000000001',
    'excused', second_version, '重試不應新增紀錄', 'teacher-history-017-retry'
  );

  begin
    perform public.submit_teacher_attendance(
      '1d000000-0000-4000-8000-000000000017', '15000000-0000-4000-8000-000000000001',
      'present', second_version, '', 'teacher-history-017-missing-reason'
    );
    raise exception 'historical correction without a reason unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'historical correction without a reason unexpectedly succeeded' then raise; end if;
  end;

  perform public.submit_teacher_attendance(
    '1d000000-0000-4000-8000-000000000017', '15000000-0000-4000-8000-000000000001',
    'present', second_version, '更正出席', 'teacher-history-017-second'
  );
  begin
    perform public.submit_teacher_attendance(
      '1d000000-0000-4000-8000-000000000018', '15000000-0000-4000-8000-000000000001',
      'absent', null, '', 'teacher-history-017-future'
    );
    raise exception 'future attendance unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'future attendance unexpectedly succeeded' then raise; end if;
  end;

  update public.attendance_records set status = 'absent'
  where session_id = '1d000000-0000-4000-8000-000000000017';
  if found then raise exception 'teacher direct attendance DML unexpectedly changed a row'; end if;
end
$$;

reset role;
do $$
begin
  if (select count(*) from public.audit_logs
      where table_name = 'attendance_records'
        and new_data->'attendance_history'->>'request_id' = 'teacher-history-017-first') <> 1 then
    raise exception 'historical correction did not create exactly one audit row';
  end if;
  if exists (
    select 1 from public.audit_logs
    where table_name = 'attendance_records'
      and new_data->'attendance_history'->>'request_id' = 'teacher-history-017-retry'
  ) then raise exception 'idempotent retry created a duplicate audit row'; end if;
  if not exists (
    select 1 from public.audit_logs
    where table_name = 'attendance_records'
      and new_data->'attendance_history'->>'request_id' = 'teacher-history-017-first'
      and new_data->'attendance_history'->>'previous_status' = 'absent'
      and new_data->'attendance_history'->>'new_status' = 'excused'
      and new_data->'attendance_history'->>'actor_role' = 'teacher'
  ) then raise exception 'historical audit context is incomplete'; end if;
end
$$;
insert into public.leave_requests (
  id, organization_id, student_id, lesson_session_id, reason, status
) values (
  '1e000000-0000-4000-8000-000000000017', '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001', '1d000000-0000-4000-8000-000000000017', 'finalized leave fixture', 'approved'
) on conflict (id) do update set status = 'approved';

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
do $$
declare current_version timestamptz;
begin
  select updated_at into current_version from public.attendance_records
  where session_id = '1d000000-0000-4000-8000-000000000017' and student_id = '15000000-0000-4000-8000-000000000001';
  begin
    perform public.submit_teacher_attendance(
      '1d000000-0000-4000-8000-000000000017', '15000000-0000-4000-8000-000000000001',
      'absent', current_version, '不能覆寫已批准請假', 'teacher-history-017-finalized'
    );
    raise exception 'finalized leave attendance mutation unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'finalized leave attendance mutation unexpectedly succeeded' then raise; end if;
  end;
end
$$;

-- An unassigned teacher cannot list or mutate the assigned teacher's session.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', false);
do $$
begin
  if exists (select 1 from public.get_teacher_attendance_sessions() where session_id = '1d000000-0000-4000-8000-000000000017') then
    raise exception 'unassigned teacher read an assigned session';
  end if;
  begin
    perform public.submit_teacher_attendance(
      '1d000000-0000-4000-8000-000000000017', '15000000-0000-4000-8000-000000000001',
      'absent', null, '越權測試', 'teacher-history-017-cross-teacher'
    );
    raise exception 'unassigned teacher mutation unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'unassigned teacher mutation unexpectedly succeeded' then raise; end if;
  end;
end
$$;

reset role;
select '017_teacher_attendance_history_access: assigned history, audit, idempotency, stale guard, future guard, and direct-DML denial' as passed;
