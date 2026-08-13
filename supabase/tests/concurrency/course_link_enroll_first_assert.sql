\set ON_ERROR_STOP on
do $$ begin
  if not exists(select 1 from public.__test_course_link_race_outcomes where race='enroll-first' and outcome='enrollment-committed')
     or not exists(select 1 from public.__test_course_link_race_outcomes where race='enroll-first-link' and outcome='link-safely-rejected') then
    raise exception 'enroll-first race did not record the expected serialized outcome';
  end if;
  if not exists(select 1 from public.exam_cohorts where id='64000000-0000-4000-8000-000000000011' and course_id is null and subject='Python') then
    raise exception 'enroll-first race left the rejected legacy Cohort partially linked';
  end if;
  if (select count(*) from public.cohort_students cs join public.exam_cohorts ec on ec.id=cs.cohort_id where cs.student_id='64000000-0000-4000-8000-000000000001' and cs.is_active_membership and ec.course_id='61000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'enroll-first Course link race violated active membership invariant';
  end if;
  if not exists(select 1 from public.cohort_students where student_id='64000000-0000-4000-8000-000000000001' and cohort_id='64000000-0000-4000-8000-000000000012' and is_active_membership) then
    raise exception 'enroll-first race lost the committed target enrollment';
  end if;
end $$;
