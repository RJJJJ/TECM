\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select public.__test_race_ready('course-transfer-enroll','second');
select public.__test_race_wait('course-transfer-enroll','second');
select public.enroll_student_in_cohort('10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000013','63000000-0000-4000-8000-000000000002');
