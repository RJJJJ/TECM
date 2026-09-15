\set ON_ERROR_STOP on
set role service_role;
do $$ begin
  begin
    insert into public.cohort_students(organization_id,cohort_id,student_id,status)
    values(
      '10000000-0000-4000-8000-000000000000',
      '64000000-0000-4000-8000-000000000022',
      '64000000-0000-4000-8000-000000000002',
      'active'
    );
    raise exception 'link-first race accepted privileged enrollment after Course link';
  exception when others then
    if sqlerrm not like '%student already has active membership in this course%' then raise; end if;
    insert into public.__test_course_link_race_outcomes(race,outcome)
    values('link-first-enroll','enrollment-safely-rejected');
  end;
end $$;
