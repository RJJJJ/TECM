\set ON_ERROR_STOP on
do $$ begin
  if (select count(*) from public.cohort_students cs join public.exam_cohorts ec on ec.id=cs.cohort_id where cs.student_id='63000000-0000-4000-8000-000000000001' and cs.is_active_membership and ec.course_id='61000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'concurrent same-course enrollment did not converge to one active row';
  end if;
end $$;
