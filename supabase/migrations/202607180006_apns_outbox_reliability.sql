-- APNs outbox reliability hardening.
-- Forward-only: preserve published migrations and existing RPC call signatures.

alter table public.push_devices
  add column if not exists registration_generation integer not null default 1;
alter table public.push_devices
  drop constraint if exists push_devices_registration_generation_check;
alter table public.push_devices
  add constraint push_devices_registration_generation_check
  check (registration_generation >= 1);

alter table public.notification_outbox
  add column if not exists device_registration_generation integer,
  add column if not exists expires_at timestamptz,
  add column if not exists apns_request_id uuid,
  add column if not exists provider_response jsonb,
  add column if not exists replay_request_id uuid,
  add column if not exists replay_preserved_attempt_count integer not null default 0,
  add column if not exists replayed_at timestamptz,
  add column if not exists replayed_by text,
  add column if not exists replay_reason text;

alter table public.notification_delivery_attempts
  add column if not exists apns_request_id uuid,
  add column if not exists device_registration_generation integer,
  add column if not exists provider_response jsonb;

update public.notification_outbox
set attempt_count=8,
    last_error=coalesce(last_error,'legacy attempt count exceeded APNs ceiling'),
    updated_at=statement_timestamp()
where attempt_count>8;

alter table public.notification_outbox
  drop constraint if exists notification_outbox_status_check;
alter table public.notification_outbox
  add constraint notification_outbox_status_check
  check (status in ('pending','claimed','retry','delivered','would_send','dead_letter','cancelled','expired'));

alter table public.notification_delivery_attempts
  drop constraint if exists notification_delivery_attempts_result_check;
alter table public.notification_delivery_attempts
  add constraint notification_delivery_attempts_result_check
  check (result in ('delivered','would_send','retry','dead_letter','cancelled','expired'));

alter table public.notification_outbox
  drop constraint if exists notification_outbox_attempt_count_check;
alter table public.notification_outbox
  add constraint notification_outbox_attempt_count_check
  check (attempt_count between 0 and 8);

alter table public.notification_outbox
  drop constraint if exists notification_outbox_replay_reason_check;
alter table public.notification_outbox
  add constraint notification_outbox_replay_reason_check
  check (replay_reason is null or length(replay_reason) between 1 and 500);
alter table public.notification_outbox
  drop constraint if exists notification_outbox_replay_preserved_attempt_count_check;
alter table public.notification_outbox
  add constraint notification_outbox_replay_preserved_attempt_count_check
  check (replay_preserved_attempt_count >= 0);

update public.notification_outbox o
set device_registration_generation=coalesce(o.device_registration_generation,d.registration_generation,1),
    expires_at=coalesce(o.expires_at,n.expires_at),
    apns_request_id=coalesce(o.apns_request_id,gen_random_uuid()),
    updated_at=statement_timestamp()
from public.push_devices d,public.notifications n
where d.id=o.device_id
  and n.id=o.notification_id
  and (o.device_registration_generation is null
       or o.expires_at is distinct from n.expires_at
       or o.apns_request_id is null);

update public.notification_delivery_attempts a
set apns_request_id=coalesce(a.apns_request_id,o.apns_request_id),
    device_registration_generation=coalesce(a.device_registration_generation,o.device_registration_generation),
    provider_response=coalesce(
      a.provider_response,
      jsonb_strip_nulls(jsonb_build_object(
        'provider_request_id',a.provider_request_id,
        'http_status',a.http_status,
        'sanitized_error',a.sanitized_error
      ))
    )
from public.notification_outbox o
where o.id=a.outbox_id
  and (a.apns_request_id is null
       or a.device_registration_generation is null
       or a.provider_response is null);

update public.notification_outbox o
set status='expired',
    lease_expires_at=null,
    last_error='notification expired before delivery',
    updated_at=statement_timestamp()
from public.notifications n
where n.id=o.notification_id
  and n.expires_at is not null
  and n.expires_at<=statement_timestamp()
  and o.status in ('pending','retry','claimed');

update public.notification_outbox o
set status='cancelled',
    lease_expires_at=null,
    last_error='device registration is no longer eligible',
    updated_at=statement_timestamp()
from public.push_devices d
where d.id=o.device_id
  and o.status in ('pending','retry','claimed')
  and (not d.is_active
       or d.invalidated_at is not null
       or o.device_registration_generation is distinct from d.registration_generation);

update public.notification_outbox
set status='dead_letter',
    lease_expires_at=null,
    dead_lettered_at=coalesce(dead_lettered_at,statement_timestamp()),
    last_error=coalesce(last_error,'attempt ceiling reached'),
    updated_at=statement_timestamp()
where status in ('pending','retry','claimed')
  and attempt_count>=8;

alter table public.notification_outbox
  alter column device_registration_generation set not null,
  alter column apns_request_id set not null;

create unique index if not exists uq_notification_outbox_replay_request
  on public.notification_outbox(replay_request_id)
  where replay_request_id is not null;
create index if not exists idx_notification_outbox_reliable_claim
  on public.notification_outbox(status,available_at,expires_at,created_at)
  where status in ('pending','retry','claimed');
create index if not exists idx_notification_outbox_generation
  on public.notification_outbox(device_id,device_registration_generation,status);
create index if not exists idx_notification_outbox_apns_request
  on public.notification_outbox(apns_request_id);
create index if not exists idx_delivery_attempts_apns_request
  on public.notification_delivery_attempts(apns_request_id,attempted_at desc);

create or replace function public.is_service_role()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(current_setting('request.jwt.claim.role',true),'')='service_role'
    or coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')='service_role'
    or current_user='service_role'
$$;

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
    and old.status is distinct from 'dead_letter' then
    new.expires_at:=v_notification.expires_at;
  end if;
  if new.apns_request_id is null then
    new.apns_request_id:=gen_random_uuid();
  end if;

  if tg_op='UPDATE' and old.status in ('delivered','would_send','cancelled','expired')
    and new.status<>old.status then
    raise exception 'terminal APNs outbox status is immutable';
  end if;
  if tg_op='UPDATE' and old.status='dead_letter' and new.status not in ('dead_letter','pending') then
    raise exception 'dead-letter outbox can only be replayed to pending';
  end if;
  if new.status in ('pending','retry')
    and new.attempt_count>=8 then
    raise exception 'claimable APNs outbox exceeded attempt ceiling';
  end if;
  if new.status='claimed' and new.attempt_count>8 then
    raise exception 'claimed APNs outbox exceeded attempt ceiling';
  end if;
  if new.status='claimed' and (
    nullif(btrim(coalesce(new.claimed_by,'')),'') is null
    or new.claimed_at is null
    or new.lease_expires_at is null
  ) then
    raise exception 'claimed APNs outbox requires a valid lease owner';
  end if;
  if new.replay_request_id is not null and new.replay_reason is null then
    raise exception 'APNs replay evidence requires a reason';
  end if;
  return new;
end $$;

drop trigger if exists trg_notification_outbox_reliability
  on public.notification_outbox;
create trigger trg_notification_outbox_reliability
before insert or update on public.notification_outbox
for each row execute function public.enforce_notification_outbox_reliability();

create or replace function public.cancel_push_device_outbox(
  p_device_id uuid,
  p_generation integer,
  p_reason text
) returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  n integer;
begin
  update public.notification_outbox
  set status='cancelled',
      lease_expires_at=null,
      last_error=left(coalesce(p_reason,'device registration is no longer eligible'),500),
      updated_at=statement_timestamp()
  where device_id=p_device_id
    and device_registration_generation=p_generation
    and status in ('pending','retry','claimed');
  get diagnostics n=row_count;
  return n;
end $$;

create or replace function public.advance_push_device_generation()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if tg_op='UPDATE' and (
    new.device_token is distinct from old.device_token
    or new.environment is distinct from old.environment
    or new.bundle_id is distinct from old.bundle_id
    or new.is_active is distinct from old.is_active
    or new.invalidated_at is distinct from old.invalidated_at
  ) then
    new.registration_generation:=greatest(old.registration_generation+1,new.registration_generation);
  end if;
  return new;
end $$;

drop trigger if exists trg_push_devices_advance_generation on public.push_devices;
create trigger trg_push_devices_advance_generation
before update of device_token,environment,bundle_id,is_active,invalidated_at
on public.push_devices
for each row execute function public.advance_push_device_generation();

create or replace function public.terminalize_old_push_device_generation()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if tg_op='UPDATE' and new.registration_generation<>old.registration_generation then
    perform public.cancel_push_device_outbox(
      old.id,
      old.registration_generation,
      'device registration generation advanced'
    );
  end if;
  return new;
end $$;

drop trigger if exists trg_push_devices_terminalize_generation on public.push_devices;
create trigger trg_push_devices_terminalize_generation
after update
on public.push_devices
for each row execute function public.terminalize_old_push_device_generation();

create or replace function public.register_push_device(
  p_installation_id text,p_device_token text,p_environment text,p_bundle_id text,
  p_app_version text default null,p_device_model text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_org uuid;
  v_profile_id uuid;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'authenticated user required'; end if;
  p_installation_id:=btrim(coalesce(p_installation_id,''));
  p_bundle_id:=btrim(coalesce(p_bundle_id,''));
  if length(p_installation_id) not between 1 and 200 then raise exception 'invalid installation id'; end if;
  if p_device_token is null or length(p_device_token) not between 64 and 200 or p_device_token !~ '^[0-9A-Fa-f]+$' then raise exception 'invalid APNs device token'; end if;
  if length(p_bundle_id) not between 3 and 255 or p_bundle_id !~ '^[A-Za-z0-9][A-Za-z0-9.-]{2,254}$' then raise exception 'invalid bundle id'; end if;
  if p_app_version is not null and length(p_app_version)>100 then raise exception 'invalid app version'; end if;
  if p_device_model is not null and length(p_device_model)>200 then raise exception 'invalid device model'; end if;
  if p_environment not in ('sandbox','production') then raise exception 'invalid APNs environment'; end if;

  select id,organization_id into v_profile_id,v_org
  from public.parent_profiles
  where user_id=auth.uid() and account_status='active'
  for update;
  if v_profile_id is null then raise exception 'active parent profile required'; end if;

  update public.push_devices
  set is_active=false,
      invalidated_at=coalesce(invalidated_at,statement_timestamp()),
      updated_at=statement_timestamp()
  where environment=p_environment and bundle_id=p_bundle_id and device_token=p_device_token
    and (user_id<>auth.uid() or installation_id<>p_installation_id)
    and is_active;

  insert into public.push_devices(
    organization_id,user_id,installation_id,device_token,environment,bundle_id,app_version,device_model
  ) values(
    v_org,auth.uid(),p_installation_id,p_device_token,p_environment,p_bundle_id,p_app_version,p_device_model
  ) on conflict(user_id,installation_id) do update
  set organization_id=excluded.organization_id,
      device_token=excluded.device_token,
      environment=excluded.environment,
      bundle_id=excluded.bundle_id,
      app_version=excluded.app_version,
      device_model=excluded.device_model,
      is_active=true,
      last_seen_at=statement_timestamp(),
      invalidated_at=null,
      updated_at=statement_timestamp()
  returning id into v_id;

  insert into public.notification_preferences(organization_id,user_id)
  values(v_org,auth.uid()) on conflict do nothing;
  return v_id;
end $$;

create or replace function public.deactivate_push_device(p_installation_id text)
returns integer language plpgsql security definer set search_path=public as $$
declare
  n integer;
begin
  update public.push_devices
  set is_active=false,
      invalidated_at=coalesce(invalidated_at,statement_timestamp()),
      updated_at=statement_timestamp()
  where user_id=auth.uid()
    and installation_id=p_installation_id
    and is_active;
  get diagnostics n=row_count;
  return n;
end $$;

create or replace function public.disable_parent_account(p_organization_id uuid,p_parent_profile_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare
  v_user_id uuid;
begin
  if not public.is_service_role() then raise exception 'service role required'; end if;

  select user_id into v_user_id
  from public.parent_profiles
  where id=p_parent_profile_id and organization_id=p_organization_id
  for update;
  if not found then raise exception 'parent profile not found'; end if;

  update public.parent_profiles
  set account_status='disabled',updated_at=statement_timestamp()
  where id=p_parent_profile_id and organization_id=p_organization_id;
  update public.parent_account_invitations
  set status='disabled',disabled_at=statement_timestamp(),updated_at=statement_timestamp()
  where organization_id=p_organization_id and parent_profile_id=p_parent_profile_id
    and status in ('pending','sent','expired','accepted');
  if v_user_id is not null then
    update public.push_devices
    set is_active=false,
        invalidated_at=coalesce(invalidated_at,statement_timestamp()),
        updated_at=statement_timestamp()
    where organization_id=p_organization_id and user_id=v_user_id and is_active;
  end if;
  return true;
end $$;

create or replace function public.enqueue_notification_devices()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.expires_at is not null and new.expires_at<=statement_timestamp() then
    return new;
  end if;

  insert into public.notification_outbox(
    organization_id,notification_id,device_id,device_registration_generation,
    expires_at,available_at,apns_request_id
  )
  select new.organization_id,new.id,pd.id,pd.registration_generation,new.expires_at,
    case
      when new.category in ('security','transactional','payments','payment','receipt') then statement_timestamp()
      when np.quiet_hours_start is null or np.quiet_hours_end is null then statement_timestamp()
      when np.quiet_hours_start=np.quiet_hours_end then statement_timestamp()
      when np.quiet_hours_start<np.quiet_hours_end
        and (statement_timestamp() at time zone public.normalize_notification_timezone(np.timezone))::time>=np.quiet_hours_start
        and (statement_timestamp() at time zone public.normalize_notification_timezone(np.timezone))::time<np.quiet_hours_end
        then (((statement_timestamp() at time zone public.normalize_notification_timezone(np.timezone))::date+np.quiet_hours_end)
          at time zone public.normalize_notification_timezone(np.timezone))
      when np.quiet_hours_start>np.quiet_hours_end
        and (statement_timestamp() at time zone public.normalize_notification_timezone(np.timezone))::time>=np.quiet_hours_start
        then ((((statement_timestamp() at time zone public.normalize_notification_timezone(np.timezone))::date+1)+np.quiet_hours_end)
          at time zone public.normalize_notification_timezone(np.timezone))
      when np.quiet_hours_start>np.quiet_hours_end
        and (statement_timestamp() at time zone public.normalize_notification_timezone(np.timezone))::time<np.quiet_hours_end
        then (((statement_timestamp() at time zone public.normalize_notification_timezone(np.timezone))::date+np.quiet_hours_end)
          at time zone public.normalize_notification_timezone(np.timezone))
      else statement_timestamp()
    end,
    gen_random_uuid()
  from public.push_devices pd
  left join public.notification_preferences np
    on np.organization_id=pd.organization_id and np.user_id=pd.user_id
  where pd.organization_id=new.organization_id
    and pd.user_id=new.recipient_user_id
    and pd.is_active
    and pd.invalidated_at is null
    and case
      when new.category='marketing' then coalesce(np.marketing_enabled,false)
      when new.category='announcement' then coalesce(np.announcements_enabled,true)
      when new.category in ('booking','class','class_reminder','session') then coalesce(np.class_reminders_enabled,true)
      when new.category='attendance' then coalesce(np.attendance_enabled,true)
      when new.category in ('leave','makeup','leave_makeup') then coalesce(np.leave_makeup_enabled,true)
      when new.category in ('payments','payment','receipt') then coalesce(np.payments_enabled,true)
      when new.category='security' then true
      else coalesce(np.transactional_enabled,true)
    end
  on conflict(notification_id,device_id) do nothing;
  return new;
end $$;

drop function if exists public.claim_notification_outbox(text,int,int);
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

  update public.notification_outbox o
  set status='expired',
      lease_expires_at=null,
      last_error='notification expired before delivery',
      updated_at=statement_timestamp()
  from public.notifications n
  where n.id=o.notification_id
    and n.expires_at is not null
    and n.expires_at<=statement_timestamp()
    and o.status in ('pending','retry','claimed');

  update public.notification_outbox o
  set status='cancelled',
      lease_expires_at=null,
      last_error='device registration is no longer eligible',
      updated_at=statement_timestamp()
  from public.push_devices d
  where d.id=o.device_id
    and o.status in ('pending','retry','claimed')
    and (not d.is_active
         or d.invalidated_at is not null
         or o.device_registration_generation is distinct from d.registration_generation);

  update public.notification_outbox o
  set status='dead_letter',
      lease_expires_at=null,
      dead_lettered_at=coalesce(o.dead_lettered_at,statement_timestamp()),
      last_error=coalesce(o.last_error,'attempt ceiling reached'),
      updated_at=statement_timestamp()
  where o.status in ('pending','retry')
    and o.attempt_count>=8;

  update public.notification_outbox o
  set status='dead_letter',
      lease_expires_at=null,
      dead_lettered_at=coalesce(o.dead_lettered_at,statement_timestamp()),
      last_error=coalesce(o.last_error,'expired lease reached attempt ceiling'),
      updated_at=statement_timestamp()
  where o.status='claimed'
    and o.lease_expires_at<=statement_timestamp()
    and o.attempt_count>=8;

  update public.notification_outbox o
  set status='retry',
      available_at=statement_timestamp(),
      lease_expires_at=null,
      claimed_by=null,
      last_error='invalid or expired lease recovered',
      updated_at=statement_timestamp()
  where o.status='claimed'
    and o.attempt_count<8
    and (
      o.lease_expires_at is null
      or o.lease_expires_at<=statement_timestamp()
      or nullif(btrim(coalesce(o.claimed_by,'')),'') is null
    );

  return query
  with candidates as (
    select o.id
    from public.notification_outbox o
    join public.push_devices d on d.id=o.device_id
    join public.notifications n on n.id=o.notification_id
    where o.available_at<=statement_timestamp()
      and o.attempt_count<8
      and (
        o.status in ('pending','retry')
        or (o.status='claimed' and o.lease_expires_at<=statement_timestamp())
      )
      and d.is_active
      and d.invalidated_at is null
      and o.device_registration_generation=d.registration_generation
      and (n.expires_at is null or n.expires_at>statement_timestamp())
    order by o.available_at,o.created_at
    for update of o skip locked
    limit greatest(1,least(coalesce(p_limit,25),100))
  ), claimed as (
    update public.notification_outbox o
    set status='claimed',
        claimed_at=statement_timestamp(),
        claimed_by=p_worker_id,
        lease_expires_at=statement_timestamp()+make_interval(secs=>greatest(10,coalesce(p_lease_seconds,60))),
        attempt_count=o.attempt_count+1,
        apns_request_id=coalesce(o.apns_request_id,gen_random_uuid()),
        provider_response=null,
        last_error=null,
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
  if o.status<>'claimed'
    or o.claimed_by<>p_worker_id
    or o.lease_expires_at is null
    or o.lease_expires_at<=statement_timestamp() then
    raise exception 'outbox lease not owned';
  end if;

  select * into d from public.push_devices where id=o.device_id for update;
  select * into n from public.notifications where id=o.notification_id for update;

  if n.expires_at is not null and n.expires_at<=statement_timestamp() then
    update public.notification_outbox
    set status='expired',lease_expires_at=null,last_error='notification expired before completion',
        updated_at=statement_timestamp()
    where id=o.id;
    return;
  end if;
  if not d.is_active or d.invalidated_at is not null
    or o.device_registration_generation is distinct from d.registration_generation then
    update public.notification_outbox
    set status='cancelled',lease_expires_at=null,last_error='device registration is no longer eligible',
        updated_at=statement_timestamp()
    where id=o.id;
    return;
  end if;

  v_provider_response:=jsonb_strip_nulls(jsonb_build_object(
    'provider','apns',
    'provider_request_id',p_provider_request_id,
    'http_status',p_http_status,
    'apns_request_id',o.apns_request_id
  ));

  update public.notification_outbox
  set status=p_delivery_status,
      delivered_at=case when p_delivery_status='delivered' then statement_timestamp() else null end,
      lease_expires_at=null,
      claimed_by=null,
      provider_response=v_provider_response,
      last_error=null,
      updated_at=statement_timestamp()
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

drop function if exists public.retry_notification_delivery(uuid,text,int,text,bool,bool);
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
  if o.status<>'claimed'
    or o.claimed_by<>p_worker_id
    or o.lease_expires_at is null
    or o.lease_expires_at<=statement_timestamp() then
    raise exception 'outbox lease not owned';
  end if;

  select * into d from public.push_devices where id=o.device_id for update;
  select * into n from public.notifications where id=o.notification_id for update;

  if n.expires_at is not null and n.expires_at<=statement_timestamp() then
    update public.notification_outbox
    set status='expired',lease_expires_at=null,last_error='notification expired before retry',
        updated_at=statement_timestamp()
    where id=o.id;
    return 'expired';
  end if;
  if not d.is_active or d.invalidated_at is not null
    or o.device_registration_generation is distinct from d.registration_generation then
    update public.notification_outbox
    set status='cancelled',lease_expires_at=null,last_error='device registration is no longer eligible',
        updated_at=statement_timestamp()
    where id=o.id;
    return 'cancelled';
  end if;

  v_error:=left(coalesce(nullif(btrim(p_error),''),'delivery failed'),500);
  v_provider_response:=jsonb_strip_nulls(jsonb_build_object(
    'provider','apns',
    'provider_request_id',p_provider_request_id,
    'http_status',p_http_status,
    'sanitized_error',v_error,
    'retryable',coalesce(p_retryable,false),
    'apns_request_id',o.apns_request_id
  ));
  v_status:=case when coalesce(p_retryable,false) and o.attempt_count<8 then 'retry' else 'dead_letter' end;

  if p_invalidate_device then
    update public.notification_outbox
    set status='dead_letter',
        lease_expires_at=null,
        claimed_by=null,
        provider_response=v_provider_response,
        last_error=v_error,
        dead_lettered_at=statement_timestamp(),
        updated_at=statement_timestamp()
    where id=o.id;

    insert into public.notification_delivery_attempts(
      organization_id,outbox_id,notification_id,device_id,provider_request_id,http_status,result,
      sanitized_error,retryable,apns_request_id,device_registration_generation,provider_response
    ) values(
      o.organization_id,o.id,o.notification_id,o.device_id,p_provider_request_id,p_http_status,'dead_letter',
      v_error,coalesce(p_retryable,false),o.apns_request_id,o.device_registration_generation,
      v_provider_response
    );

    update public.push_devices
    set is_active=false,
        invalidated_at=coalesce(invalidated_at,statement_timestamp()),
        updated_at=statement_timestamp()
    where id=o.device_id
      and registration_generation=o.device_registration_generation
      and is_active;
    return 'dead_letter';
  end if;

  update public.notification_outbox
  set status=v_status,
      available_at=case
        when v_status='retry'
          then statement_timestamp()+make_interval(secs=>least(3600,(power(2,greatest(0,o.attempt_count-1))*30)::int))
        else available_at
      end,
      lease_expires_at=null,
      claimed_by=null,
      provider_response=v_provider_response,
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

  select id into existing_id
  from public.notification_outbox
  where replay_request_id=p_replay_request_id
  for update;
  if found then
    if existing_id is distinct from p_outbox_id then raise exception 'replay request id payload mismatch'; end if;
    return existing_id;
  end if;

  select * into o
  from public.notification_outbox
  where id=p_outbox_id
  for update;
  if not found then raise exception 'outbox row not found'; end if;
  if o.status<>'dead_letter' then raise exception 'only dead-letter outbox can be replayed'; end if;
  if o.replay_request_id is not null then
    raise exception 'outbox row has already been replayed';
  end if;

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
  set status='pending',
      available_at=statement_timestamp(),
      claimed_at=null,
      claimed_by=null,
      lease_expires_at=null,
      last_error=null,
      dead_lettered_at=null,
      provider_response=null,
      replay_request_id=p_replay_request_id,
      replayed_at=statement_timestamp(),
      replayed_by=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),current_user),
      replay_reason=v_reason,
      replay_preserved_attempt_count=o.attempt_count,
      attempt_count=0,
      apns_request_id=gen_random_uuid(),
      updated_at=statement_timestamp()
  where id=o.id;
  return o.id;
end $$;

-- Refresh security-definer execute privileges after replacing APNs functions.
do $$
declare
  sig text;
begin
  for sig in
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
  loop
    execute format('revoke all on function %s from public',sig);
  end loop;
end $$;

grant execute on function public.can_access_organization_data(uuid) to authenticated,service_role;
grant execute on function public.has_parent_account_access(uuid) to authenticated,service_role;
grant execute on function public.is_parent_of_student(uuid) to authenticated,service_role;
grant execute on function public.activate_parent_account() to authenticated;
grant execute on function public.register_push_device(text,text,text,text,text,text) to authenticated;
grant execute on function public.deactivate_push_device(text) to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
grant execute on function public.get_unread_notification_count() to authenticated;
grant execute on function public.submit_parent_leave_request(uuid,uuid,text,text) to authenticated;
grant execute on function public.get_parent_lesson_sessions(uuid) to authenticated;
grant execute on function public.get_parent_attendance_summary() to authenticated;
grant execute on function public.publish_notification_announcement(uuid,text,text,text,text) to authenticated,service_role;
grant execute on function public.link_parent_auth_account(uuid,uuid,uuid,text,text,uuid) to service_role;
grant execute on function public.disable_parent_account(uuid,uuid) to service_role;
grant execute on function public.foundation_security_preflight() to service_role;
grant execute on function public.normalize_notification_timezone(text) to authenticated,service_role;
grant execute on function public.is_service_role() to service_role;
grant execute on function public.cancel_push_device_outbox(uuid,integer,text) to service_role;
grant execute on function public.claim_notification_outbox(text,int,int) to service_role;
grant execute on function public.complete_notification_delivery(uuid,text,text,int,text) to service_role;
grant execute on function public.retry_notification_delivery(uuid,text,int,text,bool,bool,text) to service_role;
grant execute on function public.replay_dead_letter_notification_outbox(uuid,uuid,text) to service_role;

revoke all on function public.cancel_push_device_outbox(uuid,integer,text) from anon,authenticated;
revoke all on function public.claim_notification_outbox(text,int,int) from anon,authenticated;
revoke all on function public.complete_notification_delivery(uuid,text,text,int,text) from anon,authenticated;
revoke all on function public.retry_notification_delivery(uuid,text,int,text,bool,bool,text) from anon,authenticated;
revoke all on function public.replay_dead_letter_notification_outbox(uuid,uuid,text) from anon,authenticated;

revoke all on public.notification_outbox,public.notification_delivery_attempts from anon;
revoke insert,update,delete on public.notification_outbox,public.notification_delivery_attempts from authenticated;
grant select on public.notification_outbox,public.notification_delivery_attempts to authenticated;
grant select,insert,update,delete on public.notification_outbox,public.notification_delivery_attempts to service_role;
