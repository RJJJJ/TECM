\set ON_ERROR_STOP on

reset role;
delete from public.notification_delivery_attempts
where notification_id in (select id from public.notifications where event_key like '011:%');
delete from public.notification_outbox
where notification_id in (select id from public.notifications where event_key like '011:%');
delete from public.notifications where event_key like '011:%';
delete from public.push_devices where installation_id='011-main';

update public.parent_profiles
set user_id='10000000-0000-4000-8000-000000000003',
    email='guardian-a@tecm.test',account_status='active',updated_at=statement_timestamp()
where id='13000000-0000-4000-8000-000000000001';

insert into public.push_devices(
  id,organization_id,user_id,installation_id,device_token,environment,bundle_id
) values(
  'a1100000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000000',
  '10000000-0000-4000-8000-000000000003',
  '011-main',repeat('b',64),'sandbox','app.TECM'
);

create or replace function pg_temp.make_011_outbox(p_suffix text)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_notification uuid;
  v_outbox uuid;
begin
  insert into public.notifications(
    organization_id,parent_id,recipient_user_id,category,title,body,event_key,source,expires_at
  ) values(
    '10000000-0000-4000-8000-000000000000',
    '13000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003',
    'transactional','011 completion outcome','Body','011:'||p_suffix,'test',
    statement_timestamp()+interval '1 hour'
  ) returning id into v_notification;
  select id into strict v_outbox from public.notification_outbox
  where notification_id=v_notification
    and device_id='a1100000-0000-4000-8000-000000000001';
  return v_outbox;
end $$;

set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);

-- Case 1: APNs 200 plus eligible completion returns and records delivered.
select pg_temp.make_011_outbox('delivered');
create temporary table tmp_011_delivered as
select * from public.claim_notification_outbox('011-worker-delivered',1,60);
do $$
declare
  r record;
  v_result text;
begin
  select * into strict r from tmp_011_delivered;
  perform public.begin_notification_dispatch(
    r.outbox_id,'011-worker-delivered',r.apns_request_id
  );
  v_result := public.complete_notification_delivery(
    r.outbox_id,'011-worker-delivered','apple-011-delivered',200,'delivered'
  );
  if v_result <> 'delivered' then
    raise exception 'case 1: delivered completion returned %', v_result;
  end if;
  if not exists(select 1 from public.notification_outbox
      where id=r.outbox_id and status='delivered' and delivered_at is not null
        and provider_response->>'provider_request_id'='apple-011-delivered'
        and provider_response->>'http_status'='200'
        and provider_response->>'apns_request_id'=r.apns_request_id::text) then
    raise exception 'case 1: delivered outbox evidence missing';
  end if;
  if not exists(select 1 from public.notification_delivery_attempts
      where outbox_id=r.outbox_id and result='delivered'
        and provider_request_id='apple-011-delivered'
        and http_status=200
        and provider_response->>'apns_request_id'=r.apns_request_id::text) then
    raise exception 'case 1: delivered attempt evidence missing';
  end if;
end $$;

-- Case 2: dry-run completion returns would_send and does not set delivered_at.
select pg_temp.make_011_outbox('would-send');
create temporary table tmp_011_would_send as
select * from public.claim_notification_outbox('011-worker-dry',1,60);
do $$
declare
  r record;
  v_result text;
begin
  select * into strict r from tmp_011_would_send;
  v_result := public.complete_notification_delivery(
    r.outbox_id,'011-worker-dry',r.apns_request_id::text,null,'would_send'
  );
  if v_result <> 'would_send' then
    raise exception 'case 2: would_send completion returned %', v_result;
  end if;
  if not exists(select 1 from public.notification_outbox
      where id=r.outbox_id and status='would_send' and delivered_at is null
        and provider_response->>'apns_request_id'=r.apns_request_id::text) then
    raise exception 'case 2: would_send outbox evidence missing';
  end if;
  if not exists(select 1 from public.notification_delivery_attempts
      where outbox_id=r.outbox_id and result='would_send'
        and provider_request_id=r.apns_request_id::text
        and http_status is null) then
    raise exception 'case 2: would_send attempt evidence missing';
  end if;
end $$;

-- Case 3: APNs 200 plus notification expiry returns expired and preserves provider evidence.
select pg_temp.make_011_outbox('expired');
create temporary table tmp_011_expired as
select * from public.claim_notification_outbox('011-worker-expired',1,60);
do $$
declare
  r record;
  v_result text;
begin
  select * into strict r from tmp_011_expired;
  perform public.begin_notification_dispatch(
    r.outbox_id,'011-worker-expired',r.apns_request_id
  );
  update public.notifications
  set expires_at=statement_timestamp()-interval '1 second'
  where id=r.notification_id;
  v_result := public.complete_notification_delivery(
    r.outbox_id,'011-worker-expired','apple-011-expired',200,'delivered'
  );
  if v_result <> 'expired' then
    raise exception 'case 3: expired completion returned %', v_result;
  end if;
  if exists(select 1 from public.notification_outbox
      where id=r.outbox_id and status='delivered') then
    raise exception 'case 3: expired completion was written as delivered';
  end if;
  if not exists(select 1 from public.notification_outbox
      where id=r.outbox_id and status='expired' and delivered_at is null
        and provider_response->>'provider_request_id'='apple-011-expired'
        and provider_response->>'http_status'='200'
        and provider_response->>'apns_request_id'=r.apns_request_id::text) then
    raise exception 'case 3: expired outbox evidence missing';
  end if;
  if not exists(select 1 from public.notification_delivery_attempts
      where outbox_id=r.outbox_id and result='expired'
        and provider_request_id='apple-011-expired'
        and http_status=200
        and provider_response->>'apns_request_id'=r.apns_request_id::text) then
    raise exception 'case 3: expired attempt evidence missing';
  end if;
end $$;

-- Case 4: APNs 200 plus stale device generation returns cancelled with provider evidence.
select pg_temp.make_011_outbox('cancelled');
create temporary table tmp_011_cancelled as
select * from public.claim_notification_outbox('011-worker-cancelled',1,60);
do $$
declare r record;
begin
  select * into strict r from tmp_011_cancelled;
  perform public.begin_notification_dispatch(
    r.outbox_id,'011-worker-cancelled',r.apns_request_id
  );
end $$;
reset role;
alter table public.push_devices disable trigger trg_push_devices_terminalize_generation;
update public.push_devices d
set registration_generation=d.registration_generation+1,
    updated_at=statement_timestamp()
from tmp_011_cancelled c
where d.id=c.device_id;
alter table public.push_devices enable trigger trg_push_devices_terminalize_generation;
set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
do $$
declare
  r record;
  v_result text;
begin
  select * into strict r from tmp_011_cancelled;
  v_result := public.complete_notification_delivery(
    r.outbox_id,'011-worker-cancelled','apple-011-cancelled',200,'delivered'
  );
  if v_result <> 'cancelled' then
    raise exception 'case 4: cancelled completion returned %', v_result;
  end if;
  if exists(select 1 from public.notification_outbox
      where id=r.outbox_id and status='delivered') then
    raise exception 'case 4: cancelled completion was written as delivered';
  end if;
  if not exists(select 1 from public.notification_outbox
      where id=r.outbox_id and status='cancelled' and delivered_at is null
        and provider_response->>'provider_request_id'='apple-011-cancelled'
        and provider_response->>'http_status'='200'
        and provider_response->>'apns_request_id'=r.apns_request_id::text) then
    raise exception 'case 4: cancelled outbox evidence missing';
  end if;
  if not exists(select 1 from public.notification_delivery_attempts
      where outbox_id=r.outbox_id and result='cancelled'
        and provider_request_id='apple-011-cancelled'
        and http_status=200
        and provider_response->>'apns_request_id'=r.apns_request_id::text) then
    raise exception 'case 4: cancelled attempt evidence missing';
  end if;
end $$;

-- Case 5: dry-run completion can also expire/cancel without being would_send.
select pg_temp.make_011_outbox('dry-expired');
create temporary table tmp_011_dry_expired as
select * from public.claim_notification_outbox('011-worker-dry-expired',1,60);
do $$
declare
  r record;
  v_result text;
begin
  select * into strict r from tmp_011_dry_expired;
  update public.notifications
  set expires_at=statement_timestamp()-interval '1 second'
  where id=r.notification_id;
  v_result := public.complete_notification_delivery(
    r.outbox_id,'011-worker-dry-expired',r.apns_request_id::text,null,'would_send'
  );
  if v_result <> 'expired' then
    raise exception 'case 5: dry expired completion returned %', v_result;
  end if;
  if exists(select 1 from public.notification_outbox
      where id=r.outbox_id and status='would_send') then
    raise exception 'case 5: dry expired completion became would_send';
  end if;
end $$;

update public.push_devices
set registration_generation=1,is_active=true,invalidated_at=null
where id='a1100000-0000-4000-8000-000000000001';

select pg_temp.make_011_outbox('dry-cancelled');
create temporary table tmp_011_dry_cancelled as
select * from public.claim_notification_outbox('011-worker-dry-cancelled',1,60);
reset role;
alter table public.push_devices disable trigger trg_push_devices_terminalize_generation;
update public.push_devices d
set registration_generation=d.registration_generation+1,
    updated_at=statement_timestamp()
from tmp_011_dry_cancelled c
where d.id=c.device_id;
alter table public.push_devices enable trigger trg_push_devices_terminalize_generation;
set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
do $$
declare
  r record;
  v_result text;
begin
  select * into strict r from tmp_011_dry_cancelled;
  v_result := public.complete_notification_delivery(
    r.outbox_id,'011-worker-dry-cancelled',r.apns_request_id::text,null,'would_send'
  );
  if v_result <> 'cancelled' then
    raise exception 'case 5: dry cancelled completion returned %', v_result;
  end if;
  if exists(select 1 from public.notification_outbox
      where id=r.outbox_id and status='would_send') then
    raise exception 'case 5: dry cancelled completion became would_send';
  end if;
end $$;

-- Case 6: complete_notification_delivery has only service_role execute.
do $$ begin
  if not has_function_privilege(
      'service_role','public.complete_notification_delivery(uuid,text,text,int,text)','EXECUTE') then
    raise exception 'case 6: service_role lacks completion execute';
  end if;
  if has_function_privilege(
      'authenticated','public.complete_notification_delivery(uuid,text,text,int,text)','EXECUTE')
    or has_function_privilege(
      'anon','public.complete_notification_delivery(uuid,text,text,int,text)','EXECUTE') then
    raise exception 'case 6: client role can execute completion';
  end if;
end $$;

set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
do $$ begin
  begin
    perform public.complete_notification_delivery(
      'a1100000-0000-4000-8000-000000000001','client','client',200,'delivered'
    );
    raise exception 'case 6: authenticated executed completion';
  exception when others then
    if sqlerrm='case 6: authenticated executed completion' then raise; end if;
  end;
end $$;

set role anon;
select set_config('request.jwt.claims','{"role":"anon"}',false);
do $$ begin
  begin
    perform public.complete_notification_delivery(
      'a1100000-0000-4000-8000-000000000001','client','client',200,'delivered'
    );
    raise exception 'case 6: anon executed completion';
  exception when others then
    if sqlerrm='case 6: anon executed completion' then raise; end if;
  end;
end $$;
reset role;

select 'apns completion outcome tests passed' as result;
