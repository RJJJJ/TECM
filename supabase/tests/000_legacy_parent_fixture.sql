\set ON_ERROR_STOP on

-- Upgrade-path fixture: this account predates account_status and linked_at.
insert into auth.users(id,email,role)
values('90000000-0000-4000-8000-000000000099','legacy-parent@tecm.test','authenticated');

insert into public.parent_profiles(id,organization_id,user_id,full_name)
values(
  '93000000-0000-4000-8000-000000000099',
  '00000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000099',
  'Legacy Linked Parent'
);
