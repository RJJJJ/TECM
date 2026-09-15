\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select public.__test_race_ready('course-transfer-enroll','first');
select public.__test_race_wait('course-transfer-enroll','first');
select public.transfer_student_between_cohorts('10000000-0000-4000-8000-000000000000','63000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000011','61000000-0000-4000-8000-000000000012',true);
