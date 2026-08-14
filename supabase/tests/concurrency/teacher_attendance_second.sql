\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
select public.__test_race_ready('teacher-attendance', 'second');
select public.__test_race_wait('teacher-attendance', 'second');
select public.submit_teacher_attendance(
  '1d000000-0000-4000-8000-000000000019',
  '15000000-0000-4000-8000-000000000001',
  'excused', null, '並行測試第二筆', 'teacher-attendance-race-second'
);
