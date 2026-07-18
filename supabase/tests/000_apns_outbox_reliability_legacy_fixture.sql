\set ON_ERROR_STOP on

-- Upgrade-path fixture for APNs reliability migration 006. These rows model
-- backlog created by migration 004/005 code before reliability columns existed.
delete from public.notification_delivery_attempts
where notification_id in (
  '94900000-0000-4000-8000-000000000001',
  '94900000-0000-4000-8000-000000000002'
);
delete from public.notification_outbox
where notification_id in (
  '94900000-0000-4000-8000-000000000001',
  '94900000-0000-4000-8000-000000000002'
);
delete from public.notifications
where id in (
  '94900000-0000-4000-8000-000000000001',
  '94900000-0000-4000-8000-000000000002'
);
delete from public.push_devices
where id in (
  '94910000-0000-4000-8000-000000000001',
  '94910000-0000-4000-8000-000000000002'
);
update public.push_devices
set is_active=false,
    invalidated_at=coalesce(invalidated_at,statement_timestamp()),
    updated_at=statement_timestamp()
where user_id='10000000-0000-4000-8000-000000000003'
  and is_active;

update public.parent_profiles
set user_id='10000000-0000-4000-8000-000000000003',
    email='guardian-a@tecm.test',
    account_status='active',
    linked_at=coalesce(linked_at,statement_timestamp()),
    updated_at=statement_timestamp()
where id='13000000-0000-4000-8000-000000000001';

insert into public.notifications(
  id,organization_id,parent_id,recipient_user_id,category,title,body,event_key,source,expires_at,read_at
) values
(
  '94900000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000000',
  '13000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003',
  'transactional',
  'Legacy inactive device backlog',
  'Body',
  '009:legacy:inactive-device',
  'legacy-fixture',
  statement_timestamp()+interval '1 hour',
  statement_timestamp()
),
(
  '94900000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000000',
  '13000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003',
  'transactional',
  'Legacy expired notification backlog',
  'Body',
  '009:legacy:expired-notification',
  'legacy-fixture',
  statement_timestamp()-interval '1 minute',
  statement_timestamp()
);

insert into public.push_devices(
  id,organization_id,user_id,installation_id,device_token,environment,bundle_id,
  app_version,device_model,is_active,invalidated_at
) values
(
  '94910000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000000',
  '10000000-0000-4000-8000-000000000003',
  '009-legacy-inactive',
  repeat('1',64),
  'sandbox',
  'app.TECM',
  '1.0',
  'iPhone',
  false,
  statement_timestamp()-interval '1 minute'
),
(
  '94910000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000000',
  '10000000-0000-4000-8000-000000000003',
  '009-legacy-expired',
  repeat('2',64),
  'sandbox',
  'app.TECM',
  '1.0',
  'iPhone',
  true,
  null
);

insert into public.notification_outbox(
  organization_id,notification_id,device_id,status,available_at,attempt_count
) values
(
  '10000000-0000-4000-8000-000000000000',
  '94900000-0000-4000-8000-000000000001',
  '94910000-0000-4000-8000-000000000001',
  'pending',
  statement_timestamp()-interval '1 minute',
  0
),
(
  '10000000-0000-4000-8000-000000000000',
  '94900000-0000-4000-8000-000000000002',
  '94910000-0000-4000-8000-000000000002',
  'pending',
  statement_timestamp()-interval '1 minute',
  0
)
on conflict (notification_id,device_id) do update
set status='pending',
    available_at=statement_timestamp()-interval '1 minute',
    attempt_count=0,
    claimed_at=null,
    claimed_by=null,
    lease_expires_at=null,
    last_error=null,
    delivered_at=null,
    dead_lettered_at=null;

update public.push_devices
set is_active=false,
    invalidated_at=coalesce(invalidated_at,statement_timestamp()),
    updated_at=statement_timestamp()
where id='94910000-0000-4000-8000-000000000002';
