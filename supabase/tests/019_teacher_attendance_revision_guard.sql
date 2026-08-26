\set ON_ERROR_STOP on

-- Exact schema, trigger, function, and ACL contract.
do $$
declare
  revision_default text;
begin
  select column_default into revision_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'attendance_records'
    and column_name = 'revision'
    and data_type = 'bigint'
    and is_nullable = 'NO';
  if revision_default is null or revision_default not like '1%' then
    raise exception '019 attendance revision column contract is missing';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.attendance_records'::regclass
      and conname = 'attendance_records_revision_positive'
      and pg_get_constraintdef(oid) like 'CHECK ((revision >= 1))%'
  ) then raise exception '019 attendance revision positive constraint is missing'; end if;
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.attendance_records'::regclass
      and tgname = 'trg_attendance_records_revision'
      and tgenabled = 'O'
  ) then raise exception '019 attendance revision trigger is missing'; end if;
  if to_regprocedure('public.submit_teacher_attendance(uuid,uuid,text,timestamptz,text,text)') is not null then
    raise exception '019 legacy timestamp RPC remains callable';
  end if;
  if to_regprocedure('public.submit_teacher_attendance(uuid,uuid,text,bigint,text,text)') is null then
    raise exception '019 monotonic revision RPC is missing';
  end if;
  if has_function_privilege('anon', 'public.submit_teacher_attendance(uuid,uuid,text,bigint,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.submit_teacher_attendance(uuid,uuid,text,bigint,text,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.submit_teacher_attendance(uuid,uuid,text,bigint,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_attendance_revision()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.set_attendance_revision()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.set_attendance_revision()', 'EXECUTE') then
    raise exception '019 attendance revision ACL matrix is incorrect';
  end if;
  if exists (
    select 1
    from pg_proc p
    where p.oid = 'public.submit_teacher_attendance(uuid,uuid,text,bigint,text,text)'::regprocedure
      and (not p.prosecdef or not (p.proconfig @> array['search_path=public']))
  ) then raise exception '019 teacher attendance RPC security/search_path contract changed'; end if;
  if exists (
    select 1
    from pg_proc p
    where p.oid = 'public.set_attendance_revision()'::regprocedure
      and (p.prosecdef or not (p.proconfig @> array['search_path=pg_catalog']))
  ) then raise exception '019 revision trigger helper security/search_path contract changed'; end if;
end
$$;

insert into public.lesson_sessions (
  id, cohort_id, lesson_plan_id, teacher_id, starts_at, ends_at, status, organization_id
) values
  (
    '1d000000-0000-4000-8000-000000000021',
    '1a000000-0000-4000-8000-000000000001',
    '1c000000-0000-4000-8000-000000000001',
    '19000000-0000-4000-8000-000000000001',
    '2020-01-12 09:00:00+08', '2020-01-12 10:00:00+08', 'completed',
    '10000000-0000-4000-8000-000000000000'
  ),
  (
    '1d000000-0000-4000-8000-000000000022',
    '1a000000-0000-4000-8000-000000000001',
    '1c000000-0000-4000-8000-000000000001',
    '19000000-0000-4000-8000-000000000001',
    '2020-01-13 09:00:00+08', '2020-01-13 10:00:00+08', 'completed',
    '10000000-0000-4000-8000-000000000000'
  )
on conflict (id) do update
set starts_at = excluded.starts_at, ends_at = excluded.ends_at, status = excluded.status;

insert into public.attendance_records (
  organization_id, session_id, student_id, status, recorded_by, recorded_at
) values (
  '10000000-0000-4000-8000-000000000000',
  '1d000000-0000-4000-8000-000000000021',
  '15000000-0000-4000-8000-000000000001', 'present',
  '10000000-0000-4000-8000-000000000001', '2020-01-12 10:00:00+08'
)
on conflict (organization_id, session_id, student_id) do update
set status = 'present';

delete from public.attendance_records
where session_id = '1d000000-0000-4000-8000-000000000022'
  and student_id = '15000000-0000-4000-8000-000000000001';

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);

-- Existing row: A advances N to N+1, stale B cannot mutate, retry is a no-op,
-- and a refreshed client can use N+1 for a valid N+2 correction.
do $$
declare
  revision_n bigint;
  revision_after_a bigint;
  result jsonb;
  notifications_before bigint;
  outbox_before bigint;
begin
  select revision into revision_n
  from public.attendance_records
  where session_id = '1d000000-0000-4000-8000-000000000021'
    and student_id = '15000000-0000-4000-8000-000000000001';
  if revision_n < 1 then raise exception '019 existing-row starting revision is invalid'; end if;
  select count(*) into notifications_before from public.notifications;
  select count(*) into outbox_before from public.notification_outbox;

  result := public.submit_teacher_attendance(
    '1d000000-0000-4000-8000-000000000021',
    '15000000-0000-4000-8000-000000000001',
    'absent', revision_n, '019 existing A', '019-existing-a'
  );
  if result->>'changed' <> 'true' or (result->>'revision')::bigint <> revision_n + 1 then
    raise exception '019 existing-row winner did not advance exactly once';
  end if;
  revision_after_a := (result->>'revision')::bigint;

  begin
    perform public.submit_teacher_attendance(
      '1d000000-0000-4000-8000-000000000021',
      '15000000-0000-4000-8000-000000000001',
      'excused', revision_n, '019 existing stale B', '019-existing-b'
    );
    raise exception '019 existing-row stale write unexpectedly succeeded';
  exception when others then
    if sqlerrm = '019 existing-row stale write unexpectedly succeeded' then raise; end if;
    if sqlerrm <> 'attendance has changed; reload before submitting' then
      raise exception '019 existing-row stale write returned an unsafe/unexpected error';
    end if;
  end;

  if (select status from public.attendance_records
      where session_id = '1d000000-0000-4000-8000-000000000021'
        and student_id = '15000000-0000-4000-8000-000000000001') <> 'absent'
     or (select revision from public.attendance_records
         where session_id = '1d000000-0000-4000-8000-000000000021'
           and student_id = '15000000-0000-4000-8000-000000000001') <> revision_after_a then
    raise exception '019 existing-row loser changed the winner state';
  end if;

  result := public.submit_teacher_attendance(
    '1d000000-0000-4000-8000-000000000021',
    '15000000-0000-4000-8000-000000000001',
    'absent', revision_n, '019 existing A', '019-existing-a'
  );
  if result->>'changed' <> 'false'
     or result->>'idempotent_replay' <> 'true'
     or (result->>'revision')::bigint <> revision_after_a then
    raise exception '019 same-operation retry was not idempotent';
  end if;

  begin
    perform public.submit_teacher_attendance(
      '1d000000-0000-4000-8000-000000000021',
      '15000000-0000-4000-8000-000000000001',
      'absent', revision_n, '019 different stale request', '019-existing-same-status-stale'
    );
    raise exception '019 same-status stale request unexpectedly bypassed the revision check';
  exception when others then
    if sqlerrm = '019 same-status stale request unexpectedly bypassed the revision check' then raise; end if;
    if sqlerrm <> 'attendance has changed; reload before submitting' then
      raise exception '019 same-status stale request returned an unsafe/unexpected error';
    end if;
  end;

  result := public.submit_teacher_attendance(
    '1d000000-0000-4000-8000-000000000021',
    '15000000-0000-4000-8000-000000000001',
    'excused', revision_after_a, '019 refreshed correction', '019-existing-refresh'
  );
  if result->>'changed' <> 'true' or (result->>'revision')::bigint <> revision_after_a + 1 then
    raise exception '019 refreshed client could not make a valid correction';
  end if;
  if (select count(*) from public.notifications) <> notifications_before
     or (select count(*) from public.notification_outbox) <> outbox_before then
    raise exception '019 attendance winner/loser created an unexpected notification outbox side effect';
  end if;
end
$$;

-- Initially absent row: both clients observed absence, exactly one creates
-- revision 1, and the second null-sentinel write is stale.
do $$
declare
  result jsonb;
begin
  result := public.submit_teacher_attendance(
    '1d000000-0000-4000-8000-000000000022',
    '15000000-0000-4000-8000-000000000001',
    'present', null, '019 absent A', '019-absent-a'
  );
  if result->>'changed' <> 'true' or (result->>'revision')::bigint <> 1 then
    raise exception '019 initially-absent winner did not create revision 1';
  end if;
  begin
    perform public.submit_teacher_attendance(
      '1d000000-0000-4000-8000-000000000022',
      '15000000-0000-4000-8000-000000000001',
      'absent', null, '019 absent stale B', '019-absent-b'
    );
    raise exception '019 initially-absent stale write unexpectedly succeeded';
  exception when others then
    if sqlerrm = '019 initially-absent stale write unexpectedly succeeded' then raise; end if;
    if sqlerrm <> 'attendance has changed; reload before submitting' then
      raise exception '019 initially-absent stale write returned an unsafe/unexpected error';
    end if;
  end;
  result := public.submit_teacher_attendance(
    '1d000000-0000-4000-8000-000000000022',
    '15000000-0000-4000-8000-000000000001',
    'present', null, '019 absent A', '019-absent-a'
  );
  if result->>'changed' <> 'false' or result->>'idempotent_replay' <> 'true' then
    raise exception '019 initially-absent transport retry was not idempotent';
  end if;
end
$$;

reset role;

do $$
declare
  revision_before bigint;
begin
  if (select status from public.attendance_records
      where session_id = '1d000000-0000-4000-8000-000000000021'
        and student_id = '15000000-0000-4000-8000-000000000001') <> 'excused' then
    raise exception '019 refresh-after-conflict final status is incorrect';
  end if;
  if (select count(*) from public.audit_logs
      where new_data->'attendance_history'->>'request_id' = '019-existing-a') <> 1
     or (select count(*) from public.audit_logs
         where new_data->'attendance_history'->>'request_id' in ('019-existing-b', '019-existing-same-status-stale')) <> 0
     or (select count(*) from public.audit_logs
         where new_data->'attendance_history'->>'request_id' = '019-existing-refresh') <> 1
     or (select count(*) from public.audit_logs
         where new_data->'attendance_history'->>'request_id' = '019-absent-a') <> 1
     or (select count(*) from public.audit_logs
         where new_data->'attendance_history'->>'request_id' = '019-absent-b') <> 0 then
    raise exception '019 winner/loser/idempotency audit counts are incorrect';
  end if;

  select revision into revision_before
  from public.attendance_records
  where session_id = '1d000000-0000-4000-8000-000000000021'
    and student_id = '15000000-0000-4000-8000-000000000001';
  update public.attendance_records
  set revision = 999
  where session_id = '1d000000-0000-4000-8000-000000000021'
    and student_id = '15000000-0000-4000-8000-000000000001';
  if (select revision from public.attendance_records
      where session_id = '1d000000-0000-4000-8000-000000000021'
        and student_id = '15000000-0000-4000-8000-000000000001') <> revision_before + 1 then
    raise exception '019 database trigger did not override a caller-supplied revision';
  end if;
end
$$;

select '019_teacher_attendance_revision_guard: exact monotonic revisions, stale rejection, absent sentinel, idempotency, refresh, ACL, audit, and outbox invariants' as passed;
