\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select public.__test_race_ready(:'race_name', :'worker_name');
select public.__test_race_wait(:'race_name', :'worker_name');
select public.record_payment(
  '10000000-0000-4000-8000-000000000000',
  '13000000-0000-4000-8000-000000000001',
  :'charge_id'::uuid, :'amount_minor'::bigint, :'method', :'idempotency_key'
);
