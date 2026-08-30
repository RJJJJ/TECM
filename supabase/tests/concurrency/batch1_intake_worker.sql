\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select public.__test_race_ready(:'race_name', :'worker_name');
select public.__test_race_wait(:'race_name', :'worker_name');
select public.create_guardian_student_enrollment_package(
  '10000000-0000-4000-8000-000000000000', :'guardian_name', :'phone',
  :'student_name', 'Batch1 Race School', '1a000000-0000-4000-8000-000000000001',
  '1e000000-0000-4000-8000-000000000001', :'idempotency_key'
);
