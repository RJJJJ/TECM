-- Durable APNs pre-send dispatch boundary.
-- Forward-only: migration 006 remains immutable so the remediation history is explicit.

alter table public.notification_outbox
  add column if not exists dispatch_started_at timestamptz;

alter table public.notification_outbox
  drop constraint if exists notification_outbox_status_check;
alter table public.notification_outbox
  add constraint notification_outbox_status_check
  check (status in (
    'pending','claimed','dispatching','delivery_uncertain','retry',
    'delivered','would_send','dead_letter','cancelled','expired'
  ));

alter table public.notification_delivery_attempts
  drop constraint if exists notification_delivery_attempts_result_check;
alter table public.notification_delivery_attempts
  add constraint notification_delivery_attempts_result_check
  check (result in (
    'delivered','would_send','delivery_uncertain','retry',
    'dead_letter','cancelled','expired'
  ));

create index if not exists idx_notification_outbox_dispatch_recovery
  on public.notification_outbox(status,lease_expires_at,dispatch_started_at)
  where status in ('claimed','dispatching');

create or replace function public.enforce_notification_outbox_reliability()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_notification public.notifications%rowtype;
  v_device public.push_devices%rowtype;
begin
  select * into v_notification
  from public.notifications
  where id=new.notification_id;
  if not found then raise exception 'notification not found'; end if;

  select * into v_device
  from public.push_devices
  where id=new.device_id;
  if not found then raise exception 'push device not found'; end if;

  if new.organization_id<>v_notification.organization_id
    or new.organization_id<>v_device.organization_id then
    raise exception 'cross-tenant notification outbox';
  end if;

  if tg_op='INSERT' then
    new.device_registration_generation:=coalesce(
      new.device_registration_generation,
      v_device.registration_generation
    );
    new.expires_at:=coalesce(new.expires_at,v_notification.expires_at);
    new.apns_request_id:=coalesce(new.apns_request_id,gen_random_uuid());
  end if;

  if new.device_registration_generation is null then
    new.device_registration_generation:=v_device.registration_generation;
  end if;
  if tg_op='UPDATE'
    and new.expires_at is distinct from v_notification.expires_at
    and old.status not in ('dead_letter','delivery_uncertain') then
    new.expires_at:=v_notification.expires_at;
  end if;
  if new.apns_request_id is null then
    new.apns_request_id:=gen_random_uuid();
  end if;

  if tg_op='UPDATE' and old.status in ('delivered','would_send','cancelled','expired')
    and new.status<>old.status then
    raise exception 'terminal APNs outbox status is immutable';
  end if;
  if tg_op='UPDATE' and old.status in ('dead_letter','delivery_uncertain')
    and new.status not in (old.status,'pending') then
    raise exception 'operator-controlled APNs outbox can only be replayed to pending';
  end if;
  if new.status in ('pending','retry') and new.attempt_count>=8 then
    raise exception 'claimable APNs outbox exceeded attempt ceiling';
  end if;
  if new.status in ('claimed','dispatching') and new.attempt_count>8 then
    raise exception 'active APNs outbox exceeded attempt ceiling';
  end if;
  if new.status in ('claimed','dispatching') and (
    nullif(btrim(coalesce(new.claimed_by,'')),'') is null
    or new.claimed_at is null
    or new.lease_expires_at is null
  ) then
    raise exception 'active APNs outbox requires a valid lease owner';
  end if;
  if new.status='dispatching' and new.dispatch_started_at is null then
    raise exception 'dispatching APNs outbox requires dispatch evidence';
  end if;
  if new.status='delivery_uncertain' and (
    new.dispatch_started_at is null
    or new.apns_request_id is null
    or new.lease_expires_at is not null
  ) then
    raise exception 'uncertain APNs outbox requires durable dispatch evidence and no lease';
  end if;
  if new.replay_request_id is not null and new.replay_reason is null then
    raise exception 'APNs replay evidence requires a reason';
  end if;
  return new;
end $$;

create or replace function public.claim_notification_outbox(
  p_worker_id text,
  p_limit int default 25,
  p_lease_seconds int default 60
) returns table(
  outbox_id uuid,
  notification_id uuid,
  device_id uuid,
  device_token text,
  environment text,
  bundle_id text,
  title text,
  body text,
  category text,
  deep_link text,
  attempt_count int,
  apns_request_id uuid
) language plpgsql security definer set search_path=public as $$
begin
  if not public.is_service_role() then raise exception 'service role required'; end if;
  p_worker_id:=left(btrim(coalesce(p_worker_id,'')),200);
  if p_worker_id='' then raise exception 'worker id required'; end if;

  -- A dispatch may already have reached Apple. Lease expiry therefore removes it
  -- from automation instead of making it sendable again.
  update public.notification_outbox o
  set status='delivery_uncertain',
      lease_expires_at=null,
      last_error=coalesce(o.last_error,'dispatch outcome unknown after lease expiry'),
      provider_response=coalesce(
        o.provider_response,
        jsonb_build_object(
          'provider','apns',
          'apns_request_id',o.apns_request_id,
          'ambiguity','dispatch lease expired'
        )
      ),
      updated_at=statement_timestamp()
  where o.status='dispatching'
    and (o.lease_expires_at is null or o.lease_expires_at<=statement_timestamp());

  update public.notification_outbox o
  set status='expired',lease_expires_at=null,
      last_error='notification expired before delivery',updated_at=statement_timestamp()
  from public.notifications n
  where n.id=o.notification_id
    and n.expires_at is not null
    and n.expires_at<=statement_timestamp()
    and o.status in ('pending','retry','claimed');

  update public.notification_outbox o
  set status='cancelled',lease_expires_at=null,
      last_error='device registration is no longer eligible',updated_at=statement_timestamp()
  from public.push_devices d
  where d.id=o.device_id
    and o.status in ('pending','retry','claimed')
    and (not d.is_active or d.invalidated_at is not null
         or o.device_registration_generation is distinct from d.registration_generation);

  update public.notification_outbox o
  set status='dead_letter',lease_expires_at=null,
      dead_lettered_at=coalesce(o.dead_lettered_at,statement_timestamp()),
      last_error=coalesce(o.last_error,'attempt ceiling reached'),updated_at=statement_timestamp()
  where o.status in ('pending','retry') and o.attempt_count>=8;

  update public.notification_outbox o
  set status='dead_letter',lease_expires_at=null,
      dead_lettered_at=coalesce(o.dead_lettered_at,statement_timestamp()),
      last_error=coalesce(o.last_error,'expired lease reached attempt ceiling'),
      updated_at=statement_timestamp()
  where o.status='claimed'
    and o.lease_expires_at<=statement_timestamp()
    and o.attempt_count>=8;

  update public.notification_outbox o
  set status='retry',available_at=statement_timestamp(),lease_expires_at=null,
      claimed_by=null,last_error='invalid or expired pre-dispatch lease recovered',
      updated_at=statement_timestamp()
  where o.status='claimed' and o.attempt_count<8
    and (o.lease_expires_at is null or o.lease_expires_at<=statement_timestamp()
         or nullif(btrim(coalesce(o.claimed_by,'')),'') is null);

  return query
  with candidates as (
    select o.id
    from public.notification_outbox o
    join public.push_devices d on d.id=o.device_id
    join public.notifications n on n.id=o.notification_id
    where o.available_at<=statement_timestamp()
      and o.attempt_count<8
      and o.status in ('pending','retry')
      and d.is_active and d.invalidated_at is null
      and o.device_registration_generation=d.registration_generation
      and (n.expires_at is null or n.expires_at>statement_timestamp())
    order by o.available_at,o.created_at
    for update of o skip locked
    limit greatest(1,least(coalesce(p_limit,25),100))
  ), claimed as (
    update public.notification_outbox o
    set status='claimed',claimed_at=statement_timestamp(),claimed_by=p_worker_id,
        lease_expires_at=statement_timestamp()+make_interval(secs=>greatest(10,coalesce(p_lease_seconds,60))),
        attempt_count=o.attempt_count+1,apns_request_id=coalesce(o.apns_request_id,gen_random_uuid()),
        dispatch_started_at=null,provider_response=null,last_error=null,
        updated_at=statement_timestamp()
    from candidates c
    where o.id=c.id
    returning o.*
  )
  select c.id,c.notification_id,c.device_id,d.device_token,d.environment,d.bundle_id,
         n.title,coalesce(n.body,n.detail),n.category,n.deep_link,c.attempt_count,
         c.apns_request_id
  from claimed c
  join public.push_devices d on d.id=c.device_id
  join public.notifications n on n.id=c.notification_id;
end $$;

create or replace function public.begin_notification_dispatch(
  p_outbox_id uuid,
  p_worker_id text,
  p_apns_request_id uuid
) returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  o public.notification_outbox%rowtype;
  d public.push_devices%rowtype;
  n public.notifications%rowtype;
begin
  if not public.is_service_role() then raise exception 'service role required'; end if;
  if p_outbox_id is null or p_apns_request_id is null then
    raise exception 'outbox id and APNs request id required';
  end if;
  p_worker_id:=left(btrim(coalesce(p_worker_id,'')),200);
  if p_worker_id='' then raise exception 'worker id required'; end if;

  select * into o from public.notification_outbox where id=p_outbox_id for update;
  if not found then raise exception 'outbox row not found'; end if;

  if o.status not in ('claimed','dispatching') or o.claimed_by<>p_worker_id
    or o.lease_expires_at is null or o.lease_expires_at<=statement_timestamp() then
    raise exception 'outbox lease not owned';
  end if;
  if o.apns_request_id is distinct from p_apns_request_id then
    raise exception 'APNs request id does not match claimed outbox';
  end if;

  select * into d from public.push_devices where id=o.device_id for update;
  select * into n from public.notifications where id=o.notification_id for update;
  if o.organization_id<>d.organization_id or o.organization_id<>n.organization_id then
    raise exception 'cross-tenant dispatch target';
  end if;
  if n.expires_at is not null and n.expires_at<=statement_timestamp() then
    update public.notification_outbox
    set status='expired',lease_expires_at=null,claimed_by=null,
        last_error='notification expired before dispatch',updated_at=statement_timestamp()
    where id=o.id;
    return 'expired';
  end if;
  if not d.is_active or d.invalidated_at is not null
    or o.device_registration_generation is distinct from d.registration_generation then
    update public.notification_outbox
    set status='cancelled',lease_expires_at=null,claimed_by=null,
        last_error='device registration is no longer eligible',updated_at=statement_timestamp()
    where id=o.id;
    return 'cancelled';
  end if;

  if o.status='dispatching' then
    return 'dispatching';
  end if;

  update public.notification_outbox
  set status='dispatching',dispatch_started_at=statement_timestamp(),
      provider_response=jsonb_build_object(
        'provider','apns','apns_request_id',o.apns_request_id,'phase','dispatching'
      ),
      updated_at=statement_timestamp()
  where id=o.id;
  return 'dispatching';
end $$;

create or replace function public.mark_notification_delivery_uncertain(
  p_outbox_id uuid,
  p_worker_id text,
  p_reason text
) returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  o public.notification_outbox%rowtype;
  v_reason text;
  v_provider_response jsonb;
begin
  if not public.is_service_role() then raise exception 'service role required'; end if;
  v_reason:=left(coalesce(nullif(btrim(p_reason),''),'ambiguous APNs delivery outcome'),500);
  select * into o from public.notification_outbox where id=p_outbox_id for update;
  if not found then raise exception 'outbox row not found'; end if;
  if o.status='delivery_uncertain' then return 'delivery_uncertain'; end if;
  if o.status<>'dispatching' or o.claimed_by<>p_worker_id then
    raise exception 'dispatch lease not owned';
  end if;

  v_provider_response:=jsonb_strip_nulls(jsonb_build_object(
    'provider','apns','apns_request_id',o.apns_request_id,
    'ambiguity',v_reason,'dispatch_started_at',o.dispatch_started_at
  ));
  update public.notification_outbox
  set status='delivery_uncertain',lease_expires_at=null,
      provider_response=v_provider_response,last_error=v_reason,
      updated_at=statement_timestamp()
  where id=o.id;

  insert into public.notification_delivery_attempts(
    organization_id,outbox_id,notification_id,device_id,result,sanitized_error,
    retryable,apns_request_id,device_registration_generation,provider_response
  ) values(
    o.organization_id,o.id,o.notification_id,o.device_id,'delivery_uncertain',v_reason,
    false,o.apns_request_id,o.device_registration_generation,v_provider_response
  );
  return 'delivery_uncertain';
end $$;

create or replace function public.complete_notification_delivery(
  p_outbox_id uuid,
  p_worker_id text,
  p_provider_request_id text,
  p_http_status int,
  p_delivery_status text default 'delivered'
) returns void language plpgsql security definer set search_path=public as $$
declare
  o public.notification_outbox%rowtype;
  d public.push_devices%rowtype;
  n public.notifications%rowtype;
  v_provider_response jsonb;
begin
  if not public.is_service_role() then raise exception 'service role required'; end if;
  if p_delivery_status not in ('delivered','would_send') then raise exception 'invalid delivery status'; end if;
  select * into o from public.notification_outbox where id=p_outbox_id for update;
  if not found then raise exception 'outbox row not found'; end if;
  if o.status not in ('claimed','dispatching') or o.claimed_by<>p_worker_id
    or o.lease_expires_at is null or o.lease_expires_at<=statement_timestamp() then
    raise exception 'outbox lease not owned';
  end if;
  select * into d from public.push_devices where id=o.device_id for update;
  select * into n from public.notifications where id=o.notification_id for update;
  if o.organization_id<>d.organization_id or o.organization_id<>n.organization_id then
    raise exception 'cross-tenant delivery target';
  end if;
  if n.expires_at is not null and n.expires_at<=statement_timestamp() then
    update public.notification_outbox set status='expired',lease_expires_at=null,
      claimed_by=null,last_error='notification expired before completion',updated_at=statement_timestamp()
    where id=o.id;
    return;
  end if;
  if not d.is_active or d.invalidated_at is not null
    or o.device_registration_generation is distinct from d.registration_generation then
    update public.notification_outbox set status='cancelled',lease_expires_at=null,
      claimed_by=null,last_error='device registration is no longer eligible',updated_at=statement_timestamp()
    where id=o.id;
    return;
  end if;
  if p_delivery_status='delivered'
    and (o.status<>'dispatching' or o.dispatch_started_at is null) then
    raise exception 'delivered completion requires durable dispatch evidence';
  end if;

  v_provider_response:=jsonb_strip_nulls(jsonb_build_object(
    'provider','apns','provider_request_id',p_provider_request_id,
    'http_status',p_http_status,'apns_request_id',o.apns_request_id
  ));
  update public.notification_outbox
  set status=p_delivery_status,
      delivered_at=case when p_delivery_status='delivered' then statement_timestamp() else null end,
      lease_expires_at=null,claimed_by=null,provider_response=v_provider_response,
      last_error=null,updated_at=statement_timestamp()
  where id=o.id;
  insert into public.notification_delivery_attempts(
    organization_id,outbox_id,notification_id,device_id,provider_request_id,
    http_status,result,apns_request_id,device_registration_generation,provider_response
  ) values(
    o.organization_id,o.id,o.notification_id,o.device_id,p_provider_request_id,
    p_http_status,p_delivery_status,o.apns_request_id,o.device_registration_generation,
    v_provider_response
  );
end $$;

create or replace function public.retry_notification_delivery(
  p_outbox_id uuid,
  p_worker_id text,
  p_http_status int,
  p_error text,
  p_retryable bool,
  p_invalidate_device bool default false,
  p_provider_request_id text default null
) returns text language plpgsql security definer set search_path=public as $$
declare
  o public.notification_outbox%rowtype;
  d public.push_devices%rowtype;
  n public.notifications%rowtype;
  v_status text;
  v_error text;
  v_provider_response jsonb;
begin
  if not public.is_service_role() then raise exception 'service role required'; end if;
  select * into o from public.notification_outbox where id=p_outbox_id for update;
  if not found then raise exception 'outbox row not found'; end if;
  if o.status not in ('claimed','dispatching') or o.claimed_by<>p_worker_id
    or o.lease_expires_at is null or o.lease_expires_at<=statement_timestamp() then
    raise exception 'outbox lease not owned';
  end if;

  select * into d from public.push_devices where id=o.device_id for update;
  select * into n from public.notifications where id=o.notification_id for update;
  if o.organization_id<>d.organization_id or o.organization_id<>n.organization_id then
    raise exception 'cross-tenant retry target';
  end if;
  if n.expires_at is not null and n.expires_at<=statement_timestamp() then
    update public.notification_outbox set status='expired',lease_expires_at=null,
      claimed_by=null,last_error='notification expired before retry',updated_at=statement_timestamp()
    where id=o.id;
    return 'expired';
  end if;
  if not d.is_active or d.invalidated_at is not null
    or o.device_registration_generation is distinct from d.registration_generation then
    update public.notification_outbox set status='cancelled',lease_expires_at=null,
      claimed_by=null,last_error='device registration is no longer eligible',updated_at=statement_timestamp()
    where id=o.id;
    return 'cancelled';
  end if;

  v_error:=left(coalesce(nullif(btrim(p_error),''),'delivery failed'),500);
  v_provider_response:=jsonb_strip_nulls(jsonb_build_object(
    'provider','apns','provider_request_id',p_provider_request_id,
    'http_status',p_http_status,'sanitized_error',v_error,
    'retryable',coalesce(p_retryable,false),'apns_request_id',o.apns_request_id
  ));
  v_status:=case when coalesce(p_retryable,false) and o.attempt_count<8 then 'retry' else 'dead_letter' end;

  update public.notification_outbox
  set status=v_status,
      available_at=case when v_status='retry' then
        statement_timestamp()+make_interval(secs=>least(3600,(power(2,greatest(0,o.attempt_count-1))*30)::int))
        else available_at end,
      lease_expires_at=null,claimed_by=null,provider_response=v_provider_response,
      last_error=v_error,
      dead_lettered_at=case when v_status='dead_letter' then statement_timestamp() else dead_lettered_at end,
      updated_at=statement_timestamp()
  where id=o.id;

  insert into public.notification_delivery_attempts(
    organization_id,outbox_id,notification_id,device_id,provider_request_id,http_status,result,
    sanitized_error,retryable,apns_request_id,device_registration_generation,provider_response
  ) values(
    o.organization_id,o.id,o.notification_id,o.device_id,p_provider_request_id,p_http_status,v_status,
    v_error,coalesce(p_retryable,false),o.apns_request_id,o.device_registration_generation,
    v_provider_response
  );
  if p_invalidate_device then
    update public.push_devices
    set is_active=false,invalidated_at=coalesce(invalidated_at,statement_timestamp()),
        updated_at=statement_timestamp()
    where id=o.device_id and registration_generation=o.device_registration_generation and is_active;
  end if;
  return v_status;
end $$;

create or replace function public.replay_dead_letter_notification_outbox(
  p_outbox_id uuid,
  p_replay_request_id uuid,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  o public.notification_outbox%rowtype;
  existing_id uuid;
  d public.push_devices%rowtype;
  n public.notifications%rowtype;
  v_reason text;
begin
  if not public.is_service_role() then raise exception 'service role required'; end if;
  if p_outbox_id is null then raise exception 'outbox row id required'; end if;
  if p_replay_request_id is null then raise exception 'replay request id required'; end if;
  v_reason:=left(btrim(coalesce(p_reason,'')),500);
  if length(v_reason)<1 then raise exception 'replay reason required'; end if;

  select id into existing_id from public.notification_outbox
  where replay_request_id=p_replay_request_id for update;
  if found then
    if existing_id is distinct from p_outbox_id then
      raise exception 'replay request id payload mismatch';
    end if;
    return existing_id;
  end if;

  select * into o from public.notification_outbox where id=p_outbox_id for update;
  if not found then raise exception 'outbox row not found'; end if;
  if o.status not in ('dead_letter','delivery_uncertain') then
    raise exception 'only dead-letter or uncertain outbox can be replayed';
  end if;
  if o.replay_request_id is not null then raise exception 'outbox row has already been replayed'; end if;

  select * into d from public.push_devices where id=o.device_id for update;
  select * into n from public.notifications where id=o.notification_id for update;
  if o.organization_id<>d.organization_id or o.organization_id<>n.organization_id then
    raise exception 'cross-tenant replay target';
  end if;
  if not d.is_active or d.invalidated_at is not null then
    raise exception 'device is not eligible for replay';
  end if;
  if o.device_registration_generation is distinct from d.registration_generation then
    raise exception 'device registration generation is not eligible for replay';
  end if;
  if n.expires_at is not null and n.expires_at<=statement_timestamp() then
    raise exception 'notification is expired';
  end if;

  update public.notification_outbox
  set status='pending',available_at=statement_timestamp(),claimed_at=null,claimed_by=null,
      lease_expires_at=null,last_error=null,dead_lettered_at=null,provider_response=null,
      replay_request_id=p_replay_request_id,replayed_at=statement_timestamp(),
      replayed_by=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),current_user),
      replay_reason=v_reason,replay_preserved_attempt_count=o.attempt_count,
      attempt_count=0,apns_request_id=gen_random_uuid(),dispatch_started_at=null,
      updated_at=statement_timestamp()
  where id=o.id;
  return o.id;
end $$;

-- Revoke implicit execute before allowlisting service-role automation.
revoke all on function public.begin_notification_dispatch(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.mark_notification_delivery_uncertain(uuid,text,text) from public,anon,authenticated;
revoke all on function public.claim_notification_outbox(text,int,int) from public,anon,authenticated;
revoke all on function public.complete_notification_delivery(uuid,text,text,int,text) from public,anon,authenticated;
revoke all on function public.retry_notification_delivery(uuid,text,int,text,bool,bool,text) from public,anon,authenticated;
revoke all on function public.replay_dead_letter_notification_outbox(uuid,uuid,text) from public,anon,authenticated;

grant execute on function public.begin_notification_dispatch(uuid,text,uuid) to service_role;
grant execute on function public.mark_notification_delivery_uncertain(uuid,text,text) to service_role;
grant execute on function public.claim_notification_outbox(text,int,int) to service_role;
grant execute on function public.complete_notification_delivery(uuid,text,text,int,text) to service_role;
grant execute on function public.retry_notification_delivery(uuid,text,int,text,bool,bool,text) to service_role;
grant execute on function public.replay_dead_letter_notification_outbox(uuid,uuid,text) to service_role;
