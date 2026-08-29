\set ON_ERROR_STOP on

select set_config('app.test_race', :'race_name', false);
select set_config('app.test_session_id', :'session_id', false);

begin;
select pg_advisory_xact_lock(hashtextextended(
  'teacher-attendance:10000000-0000-4000-8000-000000000000:'
  || current_setting('app.test_session_id')
  || ':15000000-0000-4000-8000-000000000001',
  0
));
select public.__test_race_ready(current_setting('app.test_race'), 'first');
select public.__test_race_wait(current_setting('app.test_race'), 'first');
commit;

select 'teacher attendance contention holder released cleanly' as passed;
