\set ON_ERROR_STOP on
begin;
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select public.link_teacher_profile(
  '10000000-0000-4000-8000-000000000000',
  '44000000-0000-4000-8000-000000000001',
  'Race Teacher A',
  null
);
select pg_sleep(2);
commit;
