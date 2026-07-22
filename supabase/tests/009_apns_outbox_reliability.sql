\set ON_ERROR_STOP on

-- Case 0: migration 006 terminalized legacy backlog created before reliability columns existed.
reset role;
do $$ begin
  if not exists(select 1 from public.notification_outbox o join public.notifications n on n.id=o.notification_id
      where n.event_key='009:legacy:inactive-device'
        and o.status='cancelled'
        and o.device_registration_generation is not null
        and o.apns_request_id is not null
        and o.last_error='device registration is no longer eligible') then
    raise exception 'case 0: migration did not cancel inactive-device legacy backlog';
  end if;
  if not exists(select 1 from public.notification_outbox o join public.notifications n on n.id=o.notification_id
      where n.event_key='009:legacy:expired-notification'
        and o.status='expired'
        and o.expires_at=n.expires_at
        and o.apns_request_id is not null
        and o.last_error='notification expired before delivery') then
    raise exception 'case 0: migration did not expire notification legacy backlog';
  end if;
end $$;

-- Deterministic fixture reset. Earlier suites intentionally disable this parent.
reset role;
delete from public.notification_delivery_attempts
where notification_id in (select id from public.notifications where event_key like '009:%');
delete from public.notification_outbox
where notification_id in (select id from public.notifications where event_key like '009:%');
delete from public.notifications where event_key like '009:%';
delete from public.push_devices
where user_id='10000000-0000-4000-8000-000000000003'
  and installation_id like '009-%';
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
    marketing_enabled=true,
    class_reminders_enabled=true,
    attendance_enabled=true,
    leave_makeup_enabled=true,
    payments_enabled=true,
    quiet_hours_start=null,
    quiet_hours_end=null,
    timezone='Asia/Macau',
    updated_at=statement_timestamp();

-- Case 1: authenticated parent can create an active APNs registration with generation 1.
set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
select public.register_push_device('009-main',repeat('9',64),'sandbox','app.TECM','2.0','iPhone');
do $$ begin
  if not exists(select 1 from public.push_devices
      where installation_id='009-main'
        and user_id=auth.uid()
        and is_active
        and invalidated_at is null
        and registration_generation=1) then
    raise exception 'case 1: active registration generation was not initialized';
  end if;
end $$;
reset role;

-- Case 2: enqueue snapshots device generation, notification expiry, and APNs request id.
insert into public.notifications(
  organization_id,parent_id,recipient_user_id,category,title,body,event_key,source,expires_at
) values(
  '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','transactional','009 snapshot','Body',
  '009:snapshot','test',statement_timestamp()+interval '1 hour'
);
do $$ begin
  if not exists(
    select 1
    from public.notification_outbox o
    join public.notifications n on n.id=o.notification_id
    join public.push_devices d on d.id=o.device_id
    where n.event_key='009:snapshot'
      and o.status='pending'
      and o.device_registration_generation=d.registration_generation
      and o.expires_at=n.expires_at
      and o.apns_request_id is not null
  ) then
    raise exception 'case 2: outbox did not snapshot reliability evidence';
  end if;
end $$;

-- Case 3: already expired notifications do not enqueue delivery work.
insert into public.notifications(
  organization_id,parent_id,recipient_user_id,category,title,body,event_key,source,expires_at
) values(
  '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','transactional','009 expired insert','Body',
  '009:expired-insert','test',statement_timestamp()-interval '1 second'
);
do $$ begin
  if exists(select 1 from public.notification_outbox o join public.notifications n on n.id=o.notification_id
      where n.event_key='009:expired-insert') then
    raise exception 'case 3: expired notification enqueued outbox work';
  end if;
end $$;

-- Case 4: service-role claim atomically leases one row and returns APNs request evidence.
set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
create temporary table tmp_009_claim as
select * from public.claim_notification_outbox('009-worker-a',1,60);
do $$ begin
  if (select count(*) from tmp_009_claim)<>1 then
    raise exception 'case 4: claim did not return exactly one row';
  end if;
  if exists(select 1 from tmp_009_claim where attempt_count<>1 or apns_request_id is null) then
    raise exception 'case 4: claim did not increment attempt and return request id';
  end if;
end $$;

-- Case 5: another worker cannot steal an active lease.
create temporary table tmp_009_steal as
select * from public.claim_notification_outbox('009-worker-steal',1,60);
do $$ declare v_outbox uuid; begin
  select outbox_id into v_outbox from tmp_009_claim;
  if exists(select 1 from public.notification_outbox
      where id=v_outbox and claimed_by<>'009-worker-a') then
    raise exception 'case 5: active lease was stolen';
  end if;
end $$;

-- Case 6: delivered completion records delivery timestamp and provider response evidence.
do $$ declare v_outbox uuid; v_request uuid; begin
  select outbox_id,apns_request_id into v_outbox,v_request from tmp_009_claim;
  perform public.begin_notification_dispatch(v_outbox,'009-worker-a',v_request);
  perform public.complete_notification_delivery(v_outbox,'009-worker-a','apns-009-delivered',200,'delivered');
  if not exists(select 1 from public.notification_outbox
      where id=v_outbox
        and status='delivered'
        and delivered_at is not null
        and provider_response->>'provider_request_id'='apns-009-delivered') then
    raise exception 'case 6: delivered completion did not persist provider evidence';
  end if;
  if not exists(select 1 from public.notification_delivery_attempts
      where outbox_id=v_outbox
        and result='delivered'
        and apns_request_id is not null
        and device_registration_generation is not null
        and provider_response->>'provider_request_id'='apns-009-delivered') then
    raise exception 'case 6: delivered completion did not write attempt evidence';
  end if;
end $$;
reset role;

-- Case 7: would_send completion remains terminal without a delivered timestamp.
insert into public.notifications(
  organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
) values(
  '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','transactional','009 dry run','Body','009:would-send','test'
);
set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
do $$ declare v_outbox uuid; begin
  select outbox_id into v_outbox from public.claim_notification_outbox('009-worker-dry',1,60);
  perform public.complete_notification_delivery(v_outbox,'009-worker-dry','apns-009-dry',200,'would_send');
  if not exists(select 1 from public.notification_outbox
      where id=v_outbox and status='would_send' and delivered_at is null) then
    raise exception 'case 7: would_send was treated as delivered';
  end if;
end $$;
reset role;

-- Case 8: retryable failure stores sanitized provider response and schedules backoff.
insert into public.notifications(
  organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
) values(
  '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','payments','009 retry','Body','009:retry','test'
);
set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
do $$ declare v_outbox uuid; begin
  select outbox_id into v_outbox from public.claim_notification_outbox('009-worker-retry',1,60);
  if public.retry_notification_delivery(v_outbox,'009-worker-retry',503,'Temporary APNs outage',true,false,'apns-009-retry')<>'retry' then
    raise exception 'case 8: retryable failure did not return retry';
  end if;
  if not exists(select 1 from public.notification_outbox
      where id=v_outbox
        and status='retry'
        and available_at>statement_timestamp()
        and provider_response->>'sanitized_error'='Temporary APNs outage') then
    raise exception 'case 8: retry backoff or provider response was not persisted';
  end if;
end $$;
reset role;

-- Case 9: claimable rows cannot be stored at the APNs attempt ceiling.
set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
do $$ declare v_outbox uuid; begin
  select o.id into v_outbox
  from public.notification_outbox o
  join public.notifications n on n.id=o.notification_id
  where n.event_key='009:retry';
  begin
    update public.notification_outbox set status='pending',attempt_count=8 where id=v_outbox;
    raise exception 'case 9: claimable ceiling row was accepted';
  exception when others then
    if sqlerrm='case 9: claimable ceiling row was accepted' then raise; end if;
  end;
end $$;

-- Case 10: a row claimed for attempt 8 dead-letters on retry failure.
update public.notification_outbox o
set status='retry',available_at=statement_timestamp()-interval '1 second',attempt_count=7
from public.notifications n
where n.id=o.notification_id and n.event_key='009:retry';
do $$ declare v_outbox uuid; begin
  select outbox_id into v_outbox from public.claim_notification_outbox('009-worker-max',1,60);
  if public.retry_notification_delivery(v_outbox,'009-worker-max',500,'Still failing',true,false,'apns-009-max')<>'dead_letter' then
    raise exception 'case 10: attempt 8 retry failure did not dead-letter';
  end if;
  if not exists(select 1 from public.notification_outbox where id=v_outbox and status='dead_letter' and dead_lettered_at is not null) then
    raise exception 'case 10: dead-letter state was not persisted';
  end if;
end $$;
reset role;

-- Case 11: claim terminalizes rows whose notification expires before delivery.
insert into public.notifications(
  organization_id,parent_id,recipient_user_id,category,title,body,event_key,source,expires_at
) values(
  '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','transactional','009 expires later','Body',
  '009:expires-before-claim','test',statement_timestamp()+interval '10 minutes'
);
update public.notifications set expires_at=statement_timestamp()-interval '1 second'
where event_key='009:expires-before-claim';
set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select public.claim_notification_outbox('009-worker-expiry',10,60);
do $$ begin
  if not exists(select 1 from public.notification_outbox o join public.notifications n on n.id=o.notification_id
      where n.event_key='009:expires-before-claim' and o.status='expired') then
    raise exception 'case 11: expired notification was not terminalized';
  end if;
end $$;
reset role;

-- Case 12: token rotation advances generation and cancels stale outbox work.
insert into public.notifications(
  organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
) values(
  '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','announcement','009 rotate','Body','009:rotate','test'
);
set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
select public.register_push_device('009-main',repeat('a',64),'sandbox','app.TECM','2.1','iPhone');
reset role;
do $$ begin
  if not exists(select 1 from public.push_devices where installation_id='009-main' and registration_generation=2) then
    raise exception 'case 12: token rotation did not advance generation';
  end if;
  if not exists(select 1 from public.notification_outbox o join public.notifications n on n.id=o.notification_id
      where n.event_key='009:rotate' and o.status='cancelled') then
    raise exception 'case 12: stale generation outbox was not cancelled';
  end if;
end $$;

-- Case 13: explicit deactivation cancels current-generation pending work.
insert into public.notifications(
  organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
) values(
  '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','announcement','009 deactivate','Body','009:deactivate','test'
);
set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
select public.deactivate_push_device('009-main');
reset role;
do $$ begin
  if not exists(select 1 from public.notification_outbox o join public.notifications n on n.id=o.notification_id
      where n.event_key='009:deactivate' and o.status='cancelled') then
    raise exception 'case 13: device deactivation did not cancel outbox work';
  end if;
end $$;

-- Case 13b: claim defensively cancels legacy/corrupt pending work for an inactive device.
do $$
declare v_device uuid;
begin
  insert into public.push_devices(
    organization_id,user_id,installation_id,device_token,environment,bundle_id,
    is_active,invalidated_at,registration_generation
  ) values(
    '10000000-0000-4000-8000-000000000000','10000000-0000-4000-8000-000000000003',
    '009-inactive-claim',repeat('c',64),'sandbox','app.TECM',false,statement_timestamp(),1
  ) returning id into v_device;
  insert into public.notifications(
    organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
  ) values(
    '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003','transactional','009 inactive claim','Body',
    '009:inactive-claim-defense','test'
  );
  insert into public.notification_outbox(
    organization_id,notification_id,device_id,status,device_registration_generation,apns_request_id
  )
  select n.organization_id,n.id,v_device,'pending',1,gen_random_uuid()
  from public.notifications n where n.event_key='009:inactive-claim-defense';
end $$;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select count(*) from public.claim_notification_outbox('worker-inactive-defense',100,60);
do $$ begin
  if not exists(
    select 1 from public.notification_outbox o
    join public.notifications n on n.id=o.notification_id
    where n.event_key='009:inactive-claim-defense' and o.status='cancelled'
  ) then
    raise exception 'case 13b: inactive legacy backlog survived claim cleanup';
  end if;
end $$;

-- Case 14: completion terminalizes a lease whose device generation changed after claim.
set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
select public.register_push_device('009-main',repeat('b',64),'sandbox','app.TECM','2.2','iPhone');
reset role;
insert into public.notifications(
  organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
) values(
  '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','transactional','009 stale complete','Body','009:stale-complete','test'
);
set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
create temporary table tmp_009_stale as
select * from public.claim_notification_outbox('009-worker-stale',1,60);
reset role;
alter table public.push_devices disable trigger trg_push_devices_terminalize_generation;
update public.push_devices d
set registration_generation=d.registration_generation+1,
    updated_at=statement_timestamp()
from tmp_009_stale s
where d.id=s.device_id;
alter table public.push_devices enable trigger trg_push_devices_terminalize_generation;
set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
do $$ declare v_outbox uuid; begin
  select outbox_id into v_outbox from tmp_009_stale;
  perform public.complete_notification_delivery(v_outbox,'009-worker-stale','apns-009-stale',200,'delivered');
  if not exists(select 1 from public.notification_outbox
      where id=v_outbox
        and status='cancelled'
        and delivered_at is null
        and provider_response @> jsonb_build_object(
          'provider','apns','provider_request_id','apns-009-stale','http_status',200
        )) then
    raise exception 'case 14: stale generation completion did not retain cancellation evidence';
  end if;
  if not exists(select 1 from public.notification_delivery_attempts
      where outbox_id=v_outbox
        and provider_request_id='apns-009-stale'
        and http_status=200
        and result='cancelled'
        and provider_response @> jsonb_build_object(
          'provider','apns','provider_request_id','apns-009-stale','http_status',200
        )) then
    raise exception 'case 14: stale generation completion did not write a cancelled attempt';
  end if;
end $$;
reset role;

-- Case 15: invalid APNs token response dead-letters the row and invalidates the device.
insert into public.notifications(
  organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
) values(
  '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','security','009 invalid token','Body','009:invalid-token','test'
);
set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
do $$ declare v_outbox uuid; v_device uuid; begin
  select outbox_id,device_id into v_outbox,v_device from public.claim_notification_outbox('009-worker-invalid',1,60);
  if public.retry_notification_delivery(v_outbox,'009-worker-invalid',410,'Unregistered',false,true,'apns-009-invalid')<>'dead_letter' then
    raise exception 'case 15: invalid-token response did not dead-letter';
  end if;
  if exists(select 1 from public.push_devices where id=v_device and is_active) then
    raise exception 'case 15: invalid-token response left device active';
  end if;
end $$;
reset role;

-- Case 16: dead-letter replay resets attempts, preserves evidence, and issues a new APNs id.
set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
select public.register_push_device('009-main',repeat('d',64),'sandbox','app.TECM','2.4','iPhone');
reset role;
insert into public.notifications(
  organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
) values(
  '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','payments','009 replay','Body','009:replay','test'
);
set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
do $$ declare v_outbox uuid; v_old_apns uuid; begin
  select outbox_id,apns_request_id into v_outbox,v_old_apns from public.claim_notification_outbox('009-worker-replay',1,60);
  if public.retry_notification_delivery(v_outbox,'009-worker-replay',500,'Permanent failure',false,false,'apns-009-replay')<>'dead_letter' then
    raise exception 'case 16: setup row did not dead-letter';
  end if;
  if public.replay_dead_letter_notification_outbox(
      v_outbox,'99000000-0000-4000-8000-000000000016','operator replay')<>v_outbox then
    raise exception 'case 16: replay did not return target outbox';
  end if;
  if not exists(select 1 from public.notification_outbox
      where id=v_outbox
        and status='pending'
        and attempt_count=0
        and replay_preserved_attempt_count=1
        and replay_reason='operator replay'
        and replay_request_id='99000000-0000-4000-8000-000000000016'
        and apns_request_id<>v_old_apns) then
    raise exception 'case 16: replay evidence was not persisted';
  end if;
end $$;

-- Case 17: replay request id is idempotent for the same row and rejected for another row.
do $$ declare v_outbox uuid; v_other uuid; begin
  select o.id into v_outbox
  from public.notification_outbox o join public.notifications n on n.id=o.notification_id
  where n.event_key='009:replay';
  if public.replay_dead_letter_notification_outbox(
      v_outbox,'99000000-0000-4000-8000-000000000016','operator replay')<>v_outbox then
    raise exception 'case 17: replay idempotency did not return existing row';
  end if;
  update public.notification_outbox
  set status='cancelled',
      lease_expires_at=null,
      claimed_by=null,
      last_error='test terminalized after replay idempotency proof',
      updated_at=statement_timestamp()
  where id=v_outbox;
  insert into public.notifications(
    organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
  ) values(
    '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003','payments','009 replay other','Body','009:replay-other','test'
  );
  select outbox_id into v_other from public.claim_notification_outbox('009-worker-replay-other',1,60);
  perform public.retry_notification_delivery(v_other,'009-worker-replay-other',500,'Permanent failure',false,false,'apns-009-replay-other');
  begin
    perform public.replay_dead_letter_notification_outbox(
      v_other,'99000000-0000-4000-8000-000000000016','operator replay');
    raise exception 'case 17: replay request id crossed outbox rows';
  exception when others then
    if sqlerrm='case 17: replay request id crossed outbox rows' then raise; end if;
  end;
end $$;

-- Case 18: expired claimed lease under the ceiling is recovered and reclaimed.
insert into public.notifications(
  organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
) values(
  '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','transactional','009 lease recovery','Body',
  '009:lease-recovery','test'
);
do $$ declare v_outbox uuid; begin
  update public.notification_outbox o
  set available_at=statement_timestamp()+interval '1 day'
  from public.notifications n
  where n.id=o.notification_id
    and o.status in ('pending','retry')
    and n.event_key<>'009:lease-recovery';
  update public.notification_outbox o
  set available_at=statement_timestamp()-interval '1 second'
  from public.notifications n
  where n.id=o.notification_id
    and n.event_key='009:lease-recovery';
  select outbox_id into v_outbox from public.claim_notification_outbox('009-worker-crash',1,10);
  update public.notification_outbox
  set lease_expires_at=statement_timestamp()+interval '1 millisecond'
  where id=v_outbox;
end $$;
select pg_sleep(0.05);
do $$ declare v_outbox uuid; begin
  select o.id into v_outbox
  from public.notification_outbox o
  join public.notifications n on n.id=o.notification_id
  where n.event_key='009:lease-recovery';
  if (select outbox_id from public.claim_notification_outbox('009-worker-recovery',1,60))<>v_outbox then
    raise exception 'case 18: expired lease under ceiling was not reclaimed';
  end if;
  if not exists(select 1 from public.notification_outbox
      where id=v_outbox
        and status='claimed'
        and claimed_by='009-worker-recovery'
        and attempt_count=2) then
    raise exception 'case 18: recovered lease did not increment attempt or owner';
  end if;
end $$;

-- Case 19: crashed claimed lease at the ceiling terminalizes without reclaim.
insert into public.notifications(
  organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
) values(
  '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','transactional','009 crash ceiling','Body',
  '009:crash-ceiling','test'
);
do $$ declare v_outbox uuid; begin
  select o.id into v_outbox
  from public.notification_outbox o
  join public.notifications n on n.id=o.notification_id
  where n.event_key='009:crash-ceiling';
  update public.notification_outbox
  set status='claimed',
      claimed_by='009-worker-ceiling',
      claimed_at=statement_timestamp(),
      lease_expires_at=statement_timestamp()+interval '1 millisecond',
      attempt_count=8
  where id=v_outbox;
end $$;
select pg_sleep(0.05);
do $$ declare v_outbox uuid; begin
  select o.id into v_outbox
  from public.notification_outbox o
  join public.notifications n on n.id=o.notification_id
  where n.event_key='009:crash-ceiling';
  if exists(select 1 from public.claim_notification_outbox('009-worker-ceiling-retry',10,60)
      where outbox_id=v_outbox) then
    raise exception 'case 19: ceiling crash row was reclaimed';
  end if;
  if not exists(select 1 from public.notification_outbox
      where id=v_outbox
        and status='dead_letter'
        and dead_lettered_at is not null
        and last_error='expired lease reached attempt ceiling') then
    raise exception 'case 19: ceiling crash row was not terminalized';
  end if;
end $$;
reset role;

-- Case 20: invalidation terminalizes additional same-registration backlog and reactivation does not revive it.
set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
select public.register_push_device('009-invalidation',repeat('3',64),'sandbox','app.TECM','3.0','iPhone');
reset role;
insert into public.notifications(
  organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
) values
(
  '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','security','009 invalidate primary','Body',
  '009:invalidate-primary','test'
),
(
  '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','security','009 invalidate backlog','Body',
  '009:invalidate-backlog','test'
);
set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
do $$ declare v_outbox uuid; begin
  select o.id into v_outbox
  from public.notification_outbox o
  join public.notifications n on n.id=o.notification_id
  join public.push_devices d on d.id=o.device_id
  where n.event_key='009:invalidate-primary'
    and d.installation_id='009-invalidation';
  update public.notification_outbox
  set available_at=statement_timestamp()-interval '1 second'
  where id=v_outbox;
  if (select outbox_id from public.claim_notification_outbox('009-worker-invalidate-primary',1,60))<>v_outbox then
    raise exception 'case 20: invalidation setup did not claim primary row';
  end if;
  if public.retry_notification_delivery(
      v_outbox,'009-worker-invalidate-primary',410,'Unregistered',false,true,'apns-009-invalidate-primary')<>'dead_letter' then
    raise exception 'case 20: invalidation primary did not dead-letter';
  end if;
  if not exists(select 1 from public.notification_outbox o join public.notifications n on n.id=o.notification_id
      join public.push_devices d on d.id=o.device_id
      where n.event_key='009:invalidate-backlog'
        and d.installation_id='009-invalidation'
        and o.status='cancelled') then
    raise exception 'case 20: invalidation did not cancel same-generation backlog';
  end if;
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
select public.register_push_device('009-invalidation',repeat('4',64),'sandbox','app.TECM','3.1','iPhone');
reset role;
do $$ begin
  if not exists(select 1 from public.notification_outbox o join public.notifications n on n.id=o.notification_id
      join public.push_devices d on d.id=o.device_id
      where n.event_key='009:invalidate-backlog'
        and d.installation_id='009-invalidation'
        and o.status='cancelled') then
    raise exception 'case 20: reactivation revived cancelled backlog';
  end if;
end $$;

-- Case 21: token, environment and bundle changes isolate old backlog from new generation work.
do $$
declare
  v_device uuid;
  v_generation integer;
begin
  select id,registration_generation into v_device,v_generation
  from public.push_devices
  where installation_id='009-invalidation';

  insert into public.notifications(
    organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
  ) values(
    '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003','announcement','009 token old','Body',
    '009:isolate-token-old','test'
  );

  update public.push_devices
  set device_token=repeat('5',64),updated_at=statement_timestamp()
  where id=v_device;
  if not exists(select 1 from public.notification_outbox o join public.notifications n on n.id=o.notification_id
      where n.event_key='009:isolate-token-old'
        and o.device_registration_generation=v_generation
        and o.status='cancelled') then
    raise exception 'case 21: token change did not isolate old backlog';
  end if;

  select registration_generation into v_generation from public.push_devices where id=v_device;
  insert into public.notifications(
    organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
  ) values(
    '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003','announcement','009 environment old','Body',
    '009:isolate-env-old','test'
  );
  update public.push_devices
  set environment='production',updated_at=statement_timestamp()
  where id=v_device;
  if not exists(select 1 from public.notification_outbox o join public.notifications n on n.id=o.notification_id
      where n.event_key='009:isolate-env-old'
        and o.device_registration_generation=v_generation
        and o.status='cancelled') then
    raise exception 'case 21: environment change did not isolate old backlog';
  end if;

  select registration_generation into v_generation from public.push_devices where id=v_device;
  insert into public.notifications(
    organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
  ) values(
    '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003','announcement','009 bundle old','Body',
    '009:isolate-bundle-old','test'
  );
  update public.push_devices
  set bundle_id='app.TECM.alt',updated_at=statement_timestamp()
  where id=v_device;
  if not exists(select 1 from public.notification_outbox o join public.notifications n on n.id=o.notification_id
      where n.event_key='009:isolate-bundle-old'
        and o.device_registration_generation=v_generation
        and o.status='cancelled') then
    raise exception 'case 21: bundle change did not isolate old backlog';
  end if;

  insert into public.notifications(
    organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
  ) values(
    '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003','announcement','009 new generation','Body',
    '009:isolate-new-generation','test'
  );
  if not exists(select 1 from public.notification_outbox o join public.notifications n on n.id=o.notification_id
      join public.push_devices d on d.id=o.device_id
      where n.event_key='009:isolate-new-generation'
        and o.status='pending'
        and o.device_registration_generation=d.registration_generation) then
    raise exception 'case 21: new generation work was not isolated as pending';
  end if;
end $$;

-- Case 21b: claim defensively cancels a legacy row from an older registration generation.
do $$
declare v_device uuid; v_generation integer;
begin
  select id,registration_generation into v_device,v_generation
  from public.push_devices where installation_id='009-invalidation';
  insert into public.notifications(
    organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
  ) values(
    '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003','transactional','009 stale generation claim','Body',
    '009:stale-generation-claim-defense','test'
  );
  delete from public.notification_outbox o using public.notifications n
  where o.notification_id=n.id and o.device_id=v_device
    and n.event_key='009:stale-generation-claim-defense';
  insert into public.notification_outbox(
    organization_id,notification_id,device_id,status,device_registration_generation,apns_request_id
  )
  select n.organization_id,n.id,v_device,'pending',v_generation-1,gen_random_uuid()
  from public.notifications n where n.event_key='009:stale-generation-claim-defense';
end $$;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select count(*) from public.claim_notification_outbox('worker-generation-defense',100,60);
do $$ begin
  if not exists(
    select 1 from public.notification_outbox o
    join public.notifications n on n.id=o.notification_id
    where n.event_key='009:stale-generation-claim-defense' and o.status='cancelled'
  ) then
    raise exception 'case 21b: stale-generation backlog survived claim cleanup';
  end if;
end $$;

-- Case 22: replay rejects non-terminal, expired, inactive-device, generation-mismatch and cross-tenant targets.
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
do $$
declare
  v_pending uuid;
  v_expired uuid;
  v_inactive uuid;
  v_mismatch uuid;
  v_cross uuid;
  v_device uuid;
begin
  select id into v_device from public.push_devices where installation_id='009-invalidation';

  insert into public.notifications(
    organization_id,parent_id,recipient_user_id,category,title,body,event_key,source,expires_at
  ) values
  (
    '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003','transactional','009 replay active','Body',
    '009:replay-reject-active','test',null
  ),
  (
    '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003','transactional','009 replay expired','Body',
    '009:replay-reject-expired','test',statement_timestamp()-interval '1 second'
  );
  select o.id into v_pending from public.notification_outbox o join public.notifications n on n.id=o.notification_id
  where n.event_key='009:replay-reject-active';
  begin
    perform public.replay_dead_letter_notification_outbox(v_pending,'99000000-0000-4000-8000-000000000022','active reject');
    raise exception 'case 22: replay accepted non-terminal row';
  exception when others then if sqlerrm='case 22: replay accepted non-terminal row' then raise; end if; end;

  insert into public.notification_outbox(
    organization_id,notification_id,device_id,status,device_registration_generation,expires_at,apns_request_id,attempt_count,dead_lettered_at
  )
  select n.organization_id,n.id,v_device,'dead_letter',d.registration_generation,n.expires_at,gen_random_uuid(),1,statement_timestamp()
  from public.notifications n cross join public.push_devices d
  where n.event_key='009:replay-reject-expired' and d.id=v_device
  returning id into v_expired;
  begin
    perform public.replay_dead_letter_notification_outbox(v_expired,'99000000-0000-4000-8000-000000000023','expired reject');
    raise exception 'case 22: replay accepted expired notification';
  exception when others then if sqlerrm='case 22: replay accepted expired notification' then raise; end if; end;

  insert into public.push_devices(
    organization_id,user_id,installation_id,device_token,environment,bundle_id,is_active,invalidated_at,registration_generation
  ) values(
    '10000000-0000-4000-8000-000000000000','10000000-0000-4000-8000-000000000003',
    '009-replay-inactive',repeat('6',64),'sandbox','app.TECM',false,statement_timestamp(),1
  ) returning id into v_device;
  insert into public.notifications(
    organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
  ) values(
    '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003','transactional','009 replay inactive','Body',
    '009:replay-reject-inactive','test'
  );
  insert into public.notification_outbox(
    organization_id,notification_id,device_id,status,device_registration_generation,apns_request_id,attempt_count,dead_lettered_at
  )
  select n.organization_id,n.id,v_device,'dead_letter',1,gen_random_uuid(),1,statement_timestamp()
  from public.notifications n
  where n.event_key='009:replay-reject-inactive'
  returning id into v_inactive;
  begin
    perform public.replay_dead_letter_notification_outbox(v_inactive,'99000000-0000-4000-8000-000000000024','inactive reject');
    raise exception 'case 22: replay accepted inactive device';
  exception when others then if sqlerrm='case 22: replay accepted inactive device' then raise; end if; end;

  select id into v_device from public.push_devices where installation_id='009-invalidation';
  insert into public.notifications(
    organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
  ) values(
    '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003','transactional','009 replay mismatch','Body',
    '009:replay-reject-generation','test'
  );
  delete from public.notification_outbox o
  using public.notifications n
  where o.notification_id=n.id
    and o.device_id=v_device
    and n.event_key='009:replay-reject-generation';
  insert into public.notification_outbox(
    organization_id,notification_id,device_id,status,device_registration_generation,apns_request_id,attempt_count,dead_lettered_at
  )
  select n.organization_id,n.id,v_device,'dead_letter',d.registration_generation-1,gen_random_uuid(),1,statement_timestamp()
  from public.notifications n join public.push_devices d on d.id=v_device
  where n.event_key='009:replay-reject-generation'
  returning id into v_mismatch;
  begin
    perform public.replay_dead_letter_notification_outbox(v_mismatch,'99000000-0000-4000-8000-000000000025','generation reject');
    raise exception 'case 22: replay accepted generation mismatch';
  exception when others then if sqlerrm='case 22: replay accepted generation mismatch' then raise; end if; end;

  insert into public.notifications(
    organization_id,parent_id,recipient_user_id,category,title,body,event_key,source
  ) values(
    '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003','transactional','009 replay cross tenant','Body',
    '009:replay-reject-cross-tenant','test'
  );
  delete from public.notification_outbox o
  using public.notifications n
  where o.notification_id=n.id
    and o.device_id=v_device
    and n.event_key='009:replay-reject-cross-tenant';
  alter table public.notification_outbox disable trigger trg_notification_outbox_reliability;
  alter table public.notification_outbox disable trigger trg_notification_outbox_tenant_fk;
  insert into public.notification_outbox(
    organization_id,notification_id,device_id,status,device_registration_generation,apns_request_id,attempt_count,dead_lettered_at
  )
  select '20000000-0000-4000-8000-000000000000',n.id,v_device,'dead_letter',d.registration_generation,gen_random_uuid(),1,statement_timestamp()
  from public.notifications n join public.push_devices d on d.id=v_device
  where n.event_key='009:replay-reject-cross-tenant'
  returning id into v_cross;
  alter table public.notification_outbox enable trigger trg_notification_outbox_tenant_fk;
  alter table public.notification_outbox enable trigger trg_notification_outbox_reliability;
  begin
    perform public.replay_dead_letter_notification_outbox(v_cross,'99000000-0000-4000-8000-000000000026','cross tenant reject');
    raise exception 'case 22: replay accepted cross-tenant references';
  exception when others then if sqlerrm='case 22: replay accepted cross-tenant references' then raise; end if; end;
end $$;

-- Case 23: APNs worker RPCs are executable only by service_role.
do $$ begin
  if not has_function_privilege('service_role','public.claim_notification_outbox(text,int,int)','EXECUTE') then
    raise exception 'case 23: service_role cannot execute claim RPC';
  end if;
  if has_function_privilege('authenticated','public.claim_notification_outbox(text,int,int)','EXECUTE')
     or has_function_privilege('authenticated','public.complete_notification_delivery(uuid,text,text,int,text)','EXECUTE')
     or has_function_privilege('authenticated','public.retry_notification_delivery(uuid,text,int,text,bool,bool,text)','EXECUTE')
     or has_function_privilege('authenticated','public.replay_dead_letter_notification_outbox(uuid,uuid,text)','EXECUTE')
     or has_function_privilege('anon','public.claim_notification_outbox(text,int,int)','EXECUTE')
     or has_function_privilege('anon','public.retry_notification_delivery(uuid,text,int,text,bool,bool,text)','EXECUTE')
     or has_function_privilege('anon','public.replay_dead_letter_notification_outbox(uuid,uuid,text)','EXECUTE') then
    raise exception 'case 23: anon or authenticated can execute APNs worker RPCs';
  end if;
  if has_table_privilege('anon','public.notification_outbox','SELECT')
     or has_table_privilege('authenticated','public.notification_outbox','INSERT')
     or has_table_privilege('authenticated','public.notification_delivery_attempts','UPDATE') then
    raise exception 'case 23: APNs tables retain unsafe grants';
  end if;
end $$;
set role authenticated;
select set_config('request.jwt.claims','{}',false);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
do $$ begin
  begin
    perform public.claim_notification_outbox('009-auth-denied',1,60);
    raise exception 'case 23: authenticated executed claim RPC';
  exception when others then if sqlerrm='case 23: authenticated executed claim RPC' then raise; end if; end;
  begin
    perform public.replay_dead_letter_notification_outbox(
      '94900000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000027','auth denied');
    raise exception 'case 23: authenticated executed replay RPC';
  exception when others then if sqlerrm='case 23: authenticated executed replay RPC' then raise; end if; end;
end $$;
set role anon;
select set_config('request.jwt.claims','{"role":"anon"}',false);
do $$ begin
  begin
    perform public.claim_notification_outbox('009-anon-denied',1,60);
    raise exception 'case 23: anon executed claim RPC';
  exception when others then if sqlerrm='case 23: anon executed claim RPC' then raise; end if; end;
  begin
    perform public.replay_dead_letter_notification_outbox(
      '94900000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000028','anon denied');
    raise exception 'case 23: anon executed replay RPC';
  exception when others then if sqlerrm='case 23: anon executed replay RPC' then raise; end if; end;
end $$;
reset role;

-- Case 24: replaced functions pin search_path and APNs tables retain FORCE RLS.
do $$ begin
  if exists(
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'is_service_role',
        'cancel_push_device_outbox',
        'claim_notification_outbox',
        'complete_notification_delivery',
        'retry_notification_delivery',
        'replay_dead_letter_notification_outbox',
        'register_push_device',
        'deactivate_push_device',
        'disable_parent_account',
        'enqueue_notification_devices'
      )
      and not ('search_path=public'=any(coalesce(p.proconfig,array[]::text[])))
  ) then
    raise exception 'case 24: APNs function missing fixed search_path';
  end if;
  if exists(
    select 1
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname=any(array[
        'parent_account_invitations',
        'push_devices',
        'notification_preferences',
        'notification_announcements',
        'notification_templates',
        'notification_outbox',
        'notification_delivery_attempts',
        'receipts'
      ])
      and (not c.relrowsecurity or not c.relforcerowsecurity)
  ) then
    raise exception 'case 24: APNs table missing RLS or FORCE RLS';
  end if;
end $$;
reset role;

select '009_apns_outbox_reliability: 24 reliability, migration-backfill, replay, grant, search_path and FORCE RLS cases' as passed;
