\set ON_ERROR_STOP on
set role service_role;
do $$ begin
  begin
    update public.exam_cohorts
    set course_id='61000000-0000-4000-8000-000000000001'
    where id='64000000-0000-4000-8000-000000000011';
    raise exception 'enroll-first race allowed privileged Course link after conflicting enrollment';
  exception when others then
    if sqlerrm not like '%course link conflicts with active student enrollment%' then raise; end if;
    insert into public.__test_course_link_race_outcomes(race,outcome)
    values('enroll-first-link','link-safely-rejected');
  end;
end $$;
