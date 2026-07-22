\set ON_ERROR_STOP on

reset role;
delete from public.notification_delivery_attempts
where notification_id in (select id from public.notifications where event_key like '010:%');
delete from public.notification_outbox
where notification_id in (select id from public.notifications where event_key like '010:%');
delete from public.notifications where event_key like '010:%';
delete from public.push_devices where installation_id='010-main';

update public.parent_profiles
set user_id='10000000-0000-4000-8000-000000000003',
    email='guardian-a@tecm.test',account_status='active',updated_at=statement_timestamp()
where id='13000000-0000-4000-8000-000000000001';

insert into public.push_devices(
  id,organization_id,user_id,installation_id,device_token,environment,bundle_id
) values(
  'a1000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000000',
  '10000000-0000-4000-8000-000000000003',
  '010-main',repeat('a',64),'sandbox','app.TECM'
);

create or replace function pg_temp.make_010_outbox(p_suffix text)
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
    'transactional','010 dispatch ambiguity','Body','010:'||p_suffix,'test',
    statement_timestamp()+interval '1 hour'
  ) returning id into v_notification;
  select id into strict v_outbox from public.notification_outbox
  where notification_id=v_notification
    and device_id='a1000000-0000-4000-8000-000000000001';
  return v_outbox;
end $$;

set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);

-- Cases 1 and 3: claimed -> durable begin -> delivered, with stable dispatch evidence.
select pg_temp.make_010_outbox('delivered');
create temporary table tmp_010_delivered as
select * from public.claim_notification_outbox('010-worker-a',1,60);
do $$
declare
  r record;
begin
  select * into strict r from tmp_010_delivered;
  if public.begin_notification_dispatch(r.outbox_id,'010-worker-a',r.apns_request_id)<>'dispatching' then
    raise exception 'case 1: begin dispatch did not enter dispatching';
  end if;
  if public.begin_notification_dispatch(r.outbox_id,'010-worker-a',r.apns_request_id)<>'dispatching' then
    raise exception 'case 1: identical begin dispatch was not idempotent';
  end if;
  perform public.complete_notification_delivery(
    r.outbox_id,'010-worker-a','apple-010-delivered',200,'delivered'
  );
  if not exists(select 1 from public.notification_outbox
      where id=r.outbox_id and status='delivered' and dispatch_started_at is not null
        and apns_request_id=r.apns_request_id) then
    raise exception 'case 1: dispatched row did not complete delivered with stable evidence';
  end if;
end $$;

-- Case 1b: a real delivered completion cannot bypass durable dispatch evidence.
select pg_temp.make_010_outbox('completion-without-dispatch');
create temporary table tmp_010_completion_denied as
select * from public.claim_notification_outbox('010-worker-no-dispatch',1,60);
do $$
declare r record;
begin
  select * into strict r from tmp_010_completion_denied;
  begin
    perform public.complete_notification_delivery(
      r.outbox_id,'010-worker-no-dispatch','apple-010-invalid',200,'delivered'
    );
    raise exception 'case 1b: delivered completion bypassed dispatch evidence';
  exception when others then
    if sqlerrm='case 1b: delivered completion bypassed dispatch evidence' then raise; end if;
  end;
  if not exists(select 1 from public.notification_outbox
      where id=r.outbox_id and status='claimed' and dispatch_started_at is null) then
    raise exception 'case 1b: rejected completion changed the claimed row';
  end if;
end $$;

-- Case 2: wrong worker, wrong request UUID, and lost lease all fail before dispatch.
select pg_temp.make_010_outbox('begin-denied');
create temporary table tmp_010_denied as
select * from public.claim_notification_outbox('010-worker-owner',1,60);
do $$
declare
  r record;
begin
  select * into strict r from tmp_010_denied;
  begin
    perform public.begin_notification_dispatch(r.outbox_id,'010-worker-other',r.apns_request_id);
    raise exception 'case 2: wrong worker began dispatch';
  exception when others then
    if sqlerrm='case 2: wrong worker began dispatch' then raise; end if;
  end;
  begin
    perform public.begin_notification_dispatch(
      r.outbox_id,'010-worker-owner','a1000000-0000-4000-8000-000000000099'
    );
    raise exception 'case 2: mismatched request UUID began dispatch';
  exception when others then
    if sqlerrm='case 2: mismatched request UUID began dispatch' then raise; end if;
  end;
  if (select status from public.notification_outbox where id=r.outbox_id)<>'claimed' then
    raise exception 'case 2: failed begin changed the claimed row';
  end if;
end $$;

-- Cases 4-8: a dispatched lease expires to uncertainty and is never claimable/recovered.
do $$
declare
  r record;
  v_status text;
  v_attempt int;
  v_request uuid;
  v_started timestamptz;
begin
  select * into strict r from tmp_010_denied;
  perform public.begin_notification_dispatch(r.outbox_id,'010-worker-owner',r.apns_request_id);
  update public.notification_outbox
  set lease_expires_at=statement_timestamp()-interval '1 second'
  where id=r.outbox_id;
  perform public.claim_notification_outbox('010-worker-recovery',1,60);
  select status,attempt_count,apns_request_id,dispatch_started_at
    into v_status,v_attempt,v_request,v_started
  from public.notification_outbox where id=r.outbox_id;
  if v_status<>'delivery_uncertain' or v_attempt<>1
    or v_request<>r.apns_request_id or v_started is null then
    raise exception 'case 4: expired dispatch did not preserve uncertainty evidence';
  end if;
  if exists(select 1 from public.claim_notification_outbox('010-worker-reclaim',100,60)
      where outbox_id=r.outbox_id) then
    raise exception 'case 5: delivery_uncertain was claimable';
  end if;
  perform public.claim_notification_outbox('010-worker-recovery-again',100,60);
  if not exists(select 1 from public.notification_outbox
      where id=r.outbox_id and status='delivery_uncertain' and attempt_count=v_attempt
        and apns_request_id=v_request and dispatch_started_at=v_started) then
    raise exception 'case 6: generic recovery altered delivery_uncertain evidence';
  end if;
end $$;

-- Case 9: ambiguous network outcome is explicitly quarantined, never retried.
select pg_temp.make_010_outbox('network-uncertain');
create temporary table tmp_010_network as
select * from public.claim_notification_outbox('010-worker-network',1,60);
do $$
declare r record;
begin
  select * into strict r from tmp_010_network;
  perform public.begin_notification_dispatch(r.outbox_id,'010-worker-network',r.apns_request_id);
  if public.mark_notification_delivery_uncertain(
      r.outbox_id,'010-worker-network','TypeError')<>'delivery_uncertain' then
    raise exception 'case 9: ambiguous outcome was not quarantined';
  end if;
  if exists(select 1 from public.notification_outbox
      where id=r.outbox_id and status in ('pending','retry')) then
    raise exception 'case 9: ambiguous outcome became automatically retryable';
  end if;
end $$;

-- Case 10: explicit APNs non-2xx remains eligible for the existing retry policy.
select pg_temp.make_010_outbox('explicit-503');
create temporary table tmp_010_explicit as
select * from public.claim_notification_outbox('010-worker-explicit',1,60);
do $$
declare r record;
begin
  select * into strict r from tmp_010_explicit;
  perform public.begin_notification_dispatch(r.outbox_id,'010-worker-explicit',r.apns_request_id);
  if public.retry_notification_delivery(
      r.outbox_id,'010-worker-explicit',503,'ServiceUnavailable',true,false,'apple-010-503'
    )<>'retry' then
    raise exception 'case 10: explicit APNs 503 did not follow retry policy';
  end if;
end $$;

-- Cases 11-12: operator replay of uncertainty is validated, bounded, and idempotent.
do $$
declare
  r record;
  v_old_request uuid;
  v_replay uuid:='a1000000-0000-4000-8000-000000000011';
begin
  select * into strict r from tmp_010_network;
  select apns_request_id into v_old_request from public.notification_outbox where id=r.outbox_id;
  if public.replay_dead_letter_notification_outbox(r.outbox_id,v_replay,'operator investigated')<>r.outbox_id then
    raise exception 'case 11: uncertain replay failed';
  end if;
  if not exists(select 1 from public.notification_outbox
      where id=r.outbox_id and status='pending' and attempt_count=0
        and replay_preserved_attempt_count=1 and replay_request_id=v_replay
        and replay_reason='operator investigated' and apns_request_id<>v_old_request
        and dispatch_started_at is null) then
    raise exception 'case 11: replay did not preserve evidence or create a new logical request';
  end if;
  if public.replay_dead_letter_notification_outbox(r.outbox_id,v_replay,'operator investigated')<>r.outbox_id then
    raise exception 'case 12: identical replay was not idempotent';
  end if;
end $$;

-- Case 13: replay rejects a notification that expired during investigation.
select pg_temp.make_010_outbox('expired-replay');
create temporary table tmp_010_expired as
select * from public.claim_notification_outbox('010-worker-expired',1,60);
do $$
declare r record;
begin
  select * into strict r from tmp_010_expired;
  perform public.begin_notification_dispatch(r.outbox_id,'010-worker-expired',r.apns_request_id);
  perform public.mark_notification_delivery_uncertain(r.outbox_id,'010-worker-expired','timeout');
  update public.notifications set expires_at=statement_timestamp()-interval '1 second'
  where id=r.notification_id;
  begin
    perform public.replay_dead_letter_notification_outbox(
      r.outbox_id,'a1000000-0000-4000-8000-000000000013','expired investigation'
    );
    raise exception 'case 13: replay accepted expired notification';
  exception when others then
    if sqlerrm='case 13: replay accepted expired notification' then raise; end if;
  end;
end $$;

-- Case 14a: replay rejects an inactive device.
select pg_temp.make_010_outbox('inactive-replay');
create temporary table tmp_010_inactive as
select * from public.claim_notification_outbox('010-worker-inactive',1,60);
do $$
declare r record;
begin
  select * into strict r from tmp_010_inactive;
  perform public.begin_notification_dispatch(r.outbox_id,'010-worker-inactive',r.apns_request_id);
  perform public.mark_notification_delivery_uncertain(r.outbox_id,'010-worker-inactive','timeout');
  update public.push_devices set is_active=false where id=r.device_id;
  begin
    perform public.replay_dead_letter_notification_outbox(
      r.outbox_id,'a1000000-0000-4000-8000-000000000014','inactive investigation'
    );
    raise exception 'case 14: replay accepted inactive device';
  exception when others then
    if sqlerrm='case 14: replay accepted inactive device' then raise; end if;
  end;
  update public.push_devices set is_active=true,invalidated_at=null where id=r.device_id;
end $$;

-- Case 14b: replay rejects a stale registration generation.
select pg_temp.make_010_outbox('generation-replay');
create temporary table tmp_010_generation as
select * from public.claim_notification_outbox('010-worker-generation',1,60);
do $$
declare r record;
begin
  select * into strict r from tmp_010_generation;
  perform public.begin_notification_dispatch(r.outbox_id,'010-worker-generation',r.apns_request_id);
  perform public.mark_notification_delivery_uncertain(r.outbox_id,'010-worker-generation','timeout');
  update public.push_devices
  set registration_generation=registration_generation+1
  where id=r.device_id;
  begin
    perform public.replay_dead_letter_notification_outbox(
      r.outbox_id,'a1000000-0000-4000-8000-000000000015','generation investigation'
    );
    raise exception 'case 14: replay accepted stale registration generation';
  exception when others then
    if sqlerrm='case 14: replay accepted stale registration generation' then raise; end if;
  end;
end $$;

-- Case 15: dispatch and replay entry points are service-role only.
do $$
begin
  if not has_function_privilege(
      'service_role','public.begin_notification_dispatch(uuid,text,uuid)','EXECUTE')
    or not has_function_privilege(
      'service_role','public.mark_notification_delivery_uncertain(uuid,text,text)','EXECUTE') then
    raise exception 'case 15: service_role lacks dispatch RPC execute';
  end if;
  if has_function_privilege(
      'authenticated','public.begin_notification_dispatch(uuid,text,uuid)','EXECUTE')
    or has_function_privilege(
      'anon','public.begin_notification_dispatch(uuid,text,uuid)','EXECUTE')
    or has_function_privilege(
      'authenticated','public.replay_dead_letter_notification_outbox(uuid,uuid,text)','EXECUTE')
    or has_function_privilege(
      'anon','public.replay_dead_letter_notification_outbox(uuid,uuid,text)','EXECUTE') then
    raise exception 'case 15: client role can execute dispatch or replay';
  end if;
end $$;

set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
do $$ begin
  begin
    perform public.begin_notification_dispatch(
      'a1000000-0000-4000-8000-000000000001','client',
      'a1000000-0000-4000-8000-000000000002'
    );
    raise exception 'case 15: authenticated executed begin dispatch';
  exception when others then
    if sqlerrm='case 15: authenticated executed begin dispatch' then raise; end if;
  end;
end $$;

set role anon;
select set_config('request.jwt.claims','{"role":"anon"}',false);
do $$ begin
  begin
    perform public.begin_notification_dispatch(
      'a1000000-0000-4000-8000-000000000001','client',
      'a1000000-0000-4000-8000-000000000002'
    );
    raise exception 'case 15: anon executed begin dispatch';
  exception when others then
    if sqlerrm='case 15: anon executed begin dispatch' then raise; end if;
  end;
end $$;
reset role;

-- Case 17/M1-M8 sentinel: suite 009 ran before this file, and its replaced RPCs
-- retain fixed search_path plus force-RLS tables under migration 007.
do $$ begin
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'claim_notification_outbox','begin_notification_dispatch',
        'mark_notification_delivery_uncertain','complete_notification_delivery',
        'retry_notification_delivery','replay_dead_letter_notification_outbox'
      )
      and not ('search_path=public'=any(coalesce(p.proconfig,array[]::text[])))
  ) then
    raise exception 'case 17: replaced APNs RPC lost fixed search_path';
  end if;
  if not exists(select 1 from public.notification_delivery_attempts
      where result='delivery_uncertain' and sanitized_error='TypeError') then
    raise exception 'case 17: uncertain delivery attempt evidence missing';
  end if;
end $$;

select 'apns dispatch ambiguity tests passed' as result;
