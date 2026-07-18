\set ON_ERROR_STOP on

-- Production-like partially migrated data. The profile identity exists, while the
-- legacy relationship and notification recipient columns were never backfilled.
insert into auth.users(id,email,role)
values(
  '90000000-0000-4000-8000-000000000098',
  'legacy-foundation-parent@tecm.test',
  'authenticated'
)
on conflict (id) do nothing;

insert into public.parent_profiles(
  id,organization_id,user_id,full_name,email,account_status,linked_at
)
values(
  '93000000-0000-4000-8000-000000000098',
  '10000000-0000-4000-8000-000000000000',
  '90000000-0000-4000-8000-000000000098',
  'Legacy Foundation Parent',
  'legacy-foundation-parent@tecm.test',
  'active',
  now() - interval '30 days'
)
on conflict (id) do nothing;

insert into public.parent_student_links(
  id,organization_id,parent_profile_id,parent_user_id,student_id,relationship,is_primary
)
values(
  '96000000-0000-4000-8000-000000000098',
  '10000000-0000-4000-8000-000000000000',
  '93000000-0000-4000-8000-000000000098',
  null,
  '15000000-0000-4000-8000-000000000001',
  'parent',
  true
)
on conflict (parent_profile_id,student_id) do update
set parent_user_id=null;

insert into public.notifications(
  id,organization_id,parent_id,recipient_user_id,category,title,detail,body,event_key,source
)
values(
  '94000000-0000-4000-8000-000000000098',
  '10000000-0000-4000-8000-000000000000',
  '93000000-0000-4000-8000-000000000098',
  null,
  'transactional',
  'Legacy foundation notice',
  'Fictional migration fixture',
  'Fictional migration fixture',
  'foundation:legacy:notice',
  'migration-fixture'
)
on conflict (id) do update set recipient_user_id=null;
