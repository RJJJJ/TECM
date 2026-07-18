\set ON_ERROR_STOP on
reset role;

drop table if exists public.__test_outbox_claim_barrier;
create table public.__test_outbox_claim_barrier(
  worker text primary key,
  ready_at timestamptz not null default statement_timestamp()
);
grant select,insert,update on public.__test_outbox_claim_barrier to service_role;

-- The preceding state-machine suite deliberately leaves retryable rows behind.
-- Terminalize them so both workers race for this fixture's single eligible row.
update public.notification_outbox
set status='cancelled',
    lease_expires_at=null,
    last_error='concurrency fixture isolation',
    updated_at=statement_timestamp()
where status in ('pending','retry','claimed');

delete from public.notification_delivery_attempts
where notification_id in (select id from public.notifications where event_key='concurrency:outbox:claim');
delete from public.notification_outbox
where notification_id in (select id from public.notifications where event_key='concurrency:outbox:claim');
delete from public.notifications where event_key='concurrency:outbox:claim';
delete from public.push_devices
where user_id='10000000-0000-4000-8000-000000000003'
  and installation_id='outbox-race-install';

update public.parent_profiles
set user_id='10000000-0000-4000-8000-000000000003',
    email='guardian-a@tecm.test',
    account_status='active',
    linked_at=coalesce(linked_at,statement_timestamp()),
    updated_at=statement_timestamp()
where id='13000000-0000-4000-8000-000000000001';

insert into public.notification_preferences(organization_id,user_id)
values('10000000-0000-4000-8000-000000000000','10000000-0000-4000-8000-000000000003')
on conflict (organization_id,user_id) do update
set transactional_enabled=true,
    announcements_enabled=true,
    quiet_hours_start=null,
    quiet_hours_end=null,
    updated_at=statement_timestamp();

set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
select public.register_push_device('outbox-race-install',repeat('e',64),'sandbox','app.TECM','2.0','iPhone');
reset role;

insert into public.notifications(
  organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
) values(
  '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','transactional','Outbox race','Body',
  'concurrency:outbox:claim','test'
);

-- Earlier suites intentionally leave other active registrations for this user.
-- Keep the race fixture to one eligible row without weakening normal fan-out.
delete from public.notification_outbox o
using public.notifications n, public.push_devices d
where o.notification_id=n.id
  and o.device_id=d.id
  and n.event_key='concurrency:outbox:claim'
  and d.installation_id<>'outbox-race-install';

do $$ begin
  if (select count(*) from public.notification_outbox o join public.notifications n on n.id=o.notification_id
      where n.event_key='concurrency:outbox:claim' and o.status='pending')<>1 then
    raise exception 'outbox race setup did not create exactly one pending row';
  end if;
end $$;
