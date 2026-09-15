\set ON_ERROR_STOP on
do $$ begin
  if (select count(*) from public.cohort_students cs join public.exam_cohorts ec on ec.id=cs.cohort_id where cs.student_id='63000000-0000-4000-8000-000000000002' and cs.is_active_membership and ec.course_id='61000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'concurrent enrollment and transfer produced inconsistent active state';
  end if;
  if not exists(select 1 from public.cohort_students where student_id='63000000-0000-4000-8000-000000000002' and cohort_id='61000000-0000-4000-8000-000000000012' and is_active_membership) then
    raise exception 'transfer did not win canonical enrollment race';
  end if;
end $$;
