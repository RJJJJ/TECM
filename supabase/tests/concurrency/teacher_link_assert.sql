\set ON_ERROR_STOP on
do $$ begin
  if (select count(*) from public.teacher_profiles
      where user_id = '44000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'teacher link race created multiple profiles';
  end if;
  if exists (
    select 1
    from public.teacher_profiles
    where user_id = '44000000-0000-4000-8000-000000000001'
      and organization_id <> '10000000-0000-4000-8000-000000000000'
  ) then
    raise exception 'teacher link race crossed organization boundary';
  end if;
end $$;
