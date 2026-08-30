\set ON_ERROR_STOP on
select set_config('app.test_batch1_session_id', :'session_id', false);
select set_config('app.test_batch1_winner_revision', :'winner_revision', false);
select set_config('app.test_batch1_first_request', :'first_request', false);
select set_config('app.test_batch1_second_request', :'second_request', false);
select set_config('app.test_batch1_race_name', :'race_name', false);
select set_config('app.test_batch1_refresh_request', :'refresh_request', false);
select set_config('app.test_batch1_credit_delta', :'credit_delta', false);

do $$
declare
  target_session_id constant uuid := current_setting('app.test_batch1_session_id')::uuid;
  expected_winner_revision constant bigint := current_setting('app.test_batch1_winner_revision')::bigint;
  first_request constant text := current_setting('app.test_batch1_first_request');
  second_request constant text := current_setting('app.test_batch1_second_request');
  race_name constant text := current_setting('app.test_batch1_race_name');
  row_revision bigint;
  final_status text;
  first_count bigint;
  second_count bigint;
begin
  if (select count(*) from public.attendance_records
      where session_id=target_session_id
        and student_id='15000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'batch1 attendance race did not leave exactly one row';
  end if;
  select revision,status into row_revision,final_status
  from public.attendance_records
  where session_id=target_session_id
    and student_id='15000000-0000-4000-8000-000000000001';
  if row_revision <> expected_winner_revision or final_status not in ('absent','excused') then
    raise exception 'batch1 attendance race winner state/revision is incorrect';
  end if;
  select count(*) filter(where new_data->'attendance_history'->>'request_id'=first_request),
         count(*) filter(where new_data->'attendance_history'->>'request_id'=second_request)
  into first_count,second_count
  from public.audit_logs
  where table_name='attendance_records'
    and new_data->'attendance_history'->>'session_id'=target_session_id::text;
  if not ((first_count=1 and second_count=0) or (first_count=0 and second_count=1)) then
    raise exception 'batch1 attendance race did not produce exactly one winner audit';
  end if;
  if (select count(*) from public.notifications) <>
       (select notification_count from public.__test_batch1_effect_baseline where race=race_name)
     or (select count(*) from public.notification_outbox) <>
       (select outbox_count from public.__test_batch1_effect_baseline where race=race_name) then
    raise exception 'batch1 attendance loser created notification/outbox effects';
  end if;
end
$$;

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select public.submit_staff_attendance(
  current_setting('app.test_batch1_session_id')::uuid,
  '15000000-0000-4000-8000-000000000001','present',
  current_setting('app.test_batch1_winner_revision')::bigint,
  'batch1 deliberate refreshed retry',
  current_setting('app.test_batch1_refresh_request')
);
reset role;

do $$
declare
  target_session_id constant uuid := current_setting('app.test_batch1_session_id')::uuid;
  expected_winner_revision constant bigint := current_setting('app.test_batch1_winner_revision')::bigint;
  expected_credit_delta constant bigint := current_setting('app.test_batch1_credit_delta')::bigint;
  race_name constant text := current_setting('app.test_batch1_race_name');
  refresh_request constant text := current_setting('app.test_batch1_refresh_request');
  attendance_id uuid;
begin
  select id into attendance_id from public.attendance_records
  where session_id=target_session_id
    and student_id='15000000-0000-4000-8000-000000000001';
  if (select revision from public.attendance_records where id=attendance_id) <> expected_winner_revision+1
     or (select status from public.attendance_records where id=attendance_id) <> 'present' then
    raise exception 'batch1 refreshed deliberate retry did not advance once';
  end if;
  if (select count(*) from public.audit_logs where new_data->'attendance_history'->>'request_id'=refresh_request) <> 1 then
    raise exception 'batch1 refreshed deliberate retry audit is not singular';
  end if;
  if (select count(*) from public.credit_ledger
      where source_type='attendance_records' and source_id=attendance_id) <>
       (select credit_count+expected_credit_delta
        from public.__test_batch1_effect_baseline where race=race_name) then
    raise exception 'batch1 attendance race created an unexpected credit-ledger effect';
  end if;
  if (select count(*) from public.makeup_tasks where attendance_record_id=attendance_id) <> 1
     or (select status from public.makeup_tasks where attendance_record_id=attendance_id) <> 'cancelled' then
    raise exception 'batch1 attendance winner/refresh makeup effect is not singular';
  end if;
  if (select count(*) from public.leave_requests
      where lesson_session_id=target_session_id
        and student_id='15000000-0000-4000-8000-000000000001') <> 0
     or (select count(*) from public.makeup_entitlements where attendance_record_id=attendance_id) <> 0 then
    raise exception 'batch1 attendance loser created leave or entitlement effects';
  end if;
end
$$;

select 'batch1 attendance race: one writer, one rejection, shared revision identity, refreshed retry' as passed;
