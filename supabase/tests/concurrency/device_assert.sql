\set ON_ERROR_STOP on
do $$ begin
  if (select account_status from public.parent_profiles
      where id='93000000-0000-4000-8000-000000000095')<>'disabled' then
    raise exception 'disable/register race did not leave the profile disabled';
  end if;
  if exists(select 1 from public.push_devices
      where user_id='90000000-0000-4000-8000-000000000095' and is_active) then
    raise exception 'disable/register race retained an active device';
  end if;
end $$;
