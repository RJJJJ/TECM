\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select public.__test_race_ready('makeup-same-task', 'first');
select public.__test_race_wait('makeup-same-task', 'first');
begin;
select public.book_makeup_session(
  '10000000-0000-4000-8000-000000000000',
  '44000000-0000-4000-8000-000000000301',
  '19000000-0000-4000-8000-000000000001',
  ((now() at time zone 'Asia/Macau')::date + 44 + time '09:00') at time zone 'Asia/Macau',
  'race-same-task-booking'
);
commit;
