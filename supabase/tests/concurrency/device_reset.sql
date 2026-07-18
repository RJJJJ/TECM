\set ON_ERROR_STOP on
delete from public.push_devices
where user_id='90000000-0000-4000-8000-000000000095';
update public.parent_profiles
set account_status='active',linked_at=coalesce(linked_at,statement_timestamp())
where id='93000000-0000-4000-8000-000000000095';
