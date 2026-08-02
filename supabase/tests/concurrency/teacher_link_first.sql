\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select public.__test_race_ready('teacher-link', 'first');
select public.__test_race_wait('teacher-link', 'first');
begin;
select pg_advisory_xact_lock(hashtextextended('teacher:44000000-0000-4000-8000-000000000001', 0));
select public.link_teacher_profile(
  '10000000-0000-4000-8000-000000000000',
  '44000000-0000-4000-8000-000000000001',
  'Race Teacher A',
  null
);
commit;
