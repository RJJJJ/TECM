\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_id', false);
select public.__test_race_ready(:'race_name', :'worker_name');
select public.__test_race_wait(:'race_name', :'worker_name');
select public.submit_staff_attendance(
  :'session_id'::uuid,
  '15000000-0000-4000-8000-000000000001',
  :'target_status',
  nullif(:'expected_revision','')::bigint,
  :'reason',
  :'request_id'
);
