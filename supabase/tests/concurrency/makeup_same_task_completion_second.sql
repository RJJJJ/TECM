\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select public.__test_race_ready('makeup-same-task', 'second');
select public.__test_race_wait('makeup-same-task', 'second');
select public.complete_makeup_task('44000000-0000-4000-8000-000000000301');
