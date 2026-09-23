\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select public.__test_race_ready('course-enroll','first');
select public.__test_race_wait('course-enroll','first');
select public.enroll_student_in_cohort('10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000011','63000000-0000-4000-8000-000000000001');
