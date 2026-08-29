\set ON_ERROR_STOP on
delete from public.push_devices
where user_id='90000000-0000-4000-8000-000000000095';
update public.parent_profiles
set account_status='active',linked_at=coalesce(linked_at,statement_timestamp())
where id='93000000-0000-4000-8000-000000000095';

do $$ begin
  if (select count(*) from public.parent_profiles
      where id='93000000-0000-4000-8000-000000000095'
        and account_status='active') <> 1 then
    raise exception 'device race reset did not restore one active parent profile';
  end if;
  if exists(select 1 from public.push_devices
      where user_id='90000000-0000-4000-8000-000000000095') then
    raise exception 'device race reset retained a prior push device';
  end if;
end $$;
