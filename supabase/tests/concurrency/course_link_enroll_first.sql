\set ON_ERROR_STOP on
begin;
set role service_role;
insert into public.cohort_students(organization_id,cohort_id,student_id,status)
values(
  '10000000-0000-4000-8000-000000000000',
  '64000000-0000-4000-8000-000000000012',
  '64000000-0000-4000-8000-000000000001',
  'active'
);
insert into public.__test_course_link_race_outcomes(race,outcome)
values('enroll-first','enrollment-committed');
-- Hold the first independent transaction open so the second session overlaps it.
select pg_sleep(2);
commit;
