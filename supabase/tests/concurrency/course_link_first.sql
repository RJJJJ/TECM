\set ON_ERROR_STOP on
begin;
set role service_role;
update public.exam_cohorts
set course_id='61000000-0000-4000-8000-000000000001'
where id='64000000-0000-4000-8000-000000000021';
insert into public.__test_course_link_race_outcomes(race,outcome)
values('link-first','link-committed');
-- Keep the linked row uncommitted while the second independent session enrolls.
select pg_sleep(2);
commit;
