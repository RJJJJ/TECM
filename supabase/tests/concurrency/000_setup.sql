\set ON_ERROR_STOP on

update public.parent_profiles
set user_id=null,email=null,account_status='unlinked',invited_at=null,linked_at=null
where id='93000000-0000-4000-8000-000000000096';

delete from public.parent_account_invitations
where parent_profile_id='93000000-0000-4000-8000-000000000096';

delete from public.push_devices
where user_id='90000000-0000-4000-8000-000000000095';

update public.parent_profiles
set account_status='active',linked_at=statement_timestamp()
where id='93000000-0000-4000-8000-000000000095';
