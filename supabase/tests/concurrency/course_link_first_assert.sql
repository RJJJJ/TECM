\set ON_ERROR_STOP on
do $$ begin
  if not exists(select 1 from public.__test_course_link_race_outcomes where race='link-first' and outcome='link-committed')
     or not exists(select 1 from public.__test_course_link_race_outcomes where race='link-first-enroll' and outcome='enrollment-safely-rejected') then
    raise exception 'link-first race did not record the expected serialized outcome';
  end if;
  if not exists(select 1 from public.exam_cohorts where id='64000000-0000-4000-8000-000000000021' and course_id='61000000-0000-4000-8000-000000000001' and subject='Python') then
    raise exception 'link-first race left legacy Cohort partially linked';
  end if;
  if (select count(*) from public.cohort_students cs join public.exam_cohorts ec on ec.id=cs.cohort_id where cs.student_id='64000000-0000-4000-8000-000000000002' and cs.is_active_membership and ec.course_id='61000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'link-first Course link race violated active membership invariant';
  end if;
  if exists(select 1 from public.cohort_students where student_id='64000000-0000-4000-8000-000000000002' and cohort_id='64000000-0000-4000-8000-000000000022') then
    raise exception 'link-first race created an unexpected target history row';
  end if;
end $$;
