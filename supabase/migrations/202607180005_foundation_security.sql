-- Foundation security hardening for legacy parent links, account lifecycle,
-- notification preferences, leave idempotency, and device registration.
-- Additive/forward-only: no operational or audit history is deleted.

-- This guard must remain before every mutable statement. Migration runners are
-- not assumed to wrap files in a transaction, so unsafe legacy data must fail
-- before even additive DDL is applied.
do $$
declare
  v_unsafe_parent_links bigint;
  v_unsafe_notifications bigint;
  v_leave_collisions bigint;
begin
  select count(*) into v_unsafe_parent_links
  from public.parent_student_links psl
  join public.parent_profiles pp on pp.id=psl.parent_profile_id
  join public.students s on s.id=psl.student_id
  where pp.user_id is not null and (
    psl.organization_id<>pp.organization_id
    or psl.organization_id<>s.organization_id
    or (psl.parent_user_id is not null and psl.parent_user_id<>pp.user_id)
  );

  select count(*) into v_unsafe_notifications
  from public.notifications n
  join public.parent_profiles pp on pp.id=n.parent_id
  where n.organization_id<>pp.organization_id
     or (n.recipient_user_id is not null and pp.user_id is not null
         and n.recipient_user_id<>pp.user_id);

  select count(*) into v_leave_collisions
  from (
    select organization_id,btrim(idempotency_key)
    from public.leave_requests
    where nullif(btrim(idempotency_key),'') is not null
    group by organization_id,btrim(idempotency_key)
    having count(*)>1
  ) collisions;

  if v_unsafe_parent_links<>0 or v_unsafe_notifications<>0 or v_leave_collisions<>0 then
    raise exception 'foundation security preflight failed before mutation: %',
      jsonb_build_object(
        'unsafe_parent_links',v_unsafe_parent_links,
        'unsafe_notifications',v_unsafe_notifications,
        'leave_normalization_collisions',v_leave_collisions
      );
  end if;
end $$;

alter table public.parent_profiles
  drop constraint if exists parent_profiles_account_status_check;
alter table public.parent_profiles
  add constraint parent_profiles_account_status_check
  check (account_status in ('unlinked','invited','active','expired','disabled'));

alter table public.parent_account_invitations
  add column if not exists expires_at timestamptz;
update public.parent_account_invitations
set expires_at=coalesce(sent_at,created_at)+interval '7 days'
where expires_at is null;
alter table public.parent_account_invitations
  alter column expires_at set default (statement_timestamp()+interval '7 days');
alter table public.parent_account_invitations
  alter column expires_at set not null;
create index if not exists idx_parent_invitations_expiry
  on public.parent_account_invitations(parent_profile_id,status,expires_at desc);

create or replace function public.foundation_security_preflight()
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with counts as (
    select
      (select count(*) from public.parent_student_links psl
       join public.parent_profiles pp on pp.id=psl.parent_profile_id
       join public.students s on s.id=psl.student_id
       where psl.parent_user_id is null and pp.user_id is not null
         and psl.organization_id=pp.organization_id
         and psl.organization_id=s.organization_id) as inferable_parent_links,
      (select count(*) from public.parent_student_links psl
       join public.parent_profiles pp on pp.id=psl.parent_profile_id
       join public.students s on s.id=psl.student_id
       where pp.user_id is not null and (
         psl.organization_id<>pp.organization_id
         or psl.organization_id<>s.organization_id
         or (psl.parent_user_id is not null and psl.parent_user_id<>pp.user_id)
       )) as unsafe_parent_links,
      (select count(*) from public.notifications n
       join public.parent_profiles pp on pp.id=n.parent_id
       where n.recipient_user_id is null and pp.user_id is not null
         and n.organization_id=pp.organization_id) as inferable_notifications,
      (select count(*) from public.notifications n
       join public.parent_profiles pp on pp.id=n.parent_id
       where n.organization_id<>pp.organization_id
          or (n.recipient_user_id is not null and pp.user_id is not null
              and n.recipient_user_id<>pp.user_id)) as unsafe_notifications,
      (select count(*) from (
        select organization_id,btrim(idempotency_key)
        from public.leave_requests
        where nullif(btrim(idempotency_key),'') is not null
        group by organization_id,btrim(idempotency_key)
        having count(*)>1
      ) collisions) as leave_normalization_collisions
  )
  select jsonb_build_object(
    'safe_to_apply',unsafe_parent_links=0 and unsafe_notifications=0 and leave_normalization_collisions=0,
    'inferable_parent_links',inferable_parent_links,
    'unsafe_parent_links',unsafe_parent_links,
    'inferable_notifications',inferable_notifications,
    'unsafe_notifications',unsafe_notifications,
    'leave_normalization_collisions',leave_normalization_collisions
  ) from counts
$$;

revoke all on function public.foundation_security_preflight() from public;
grant execute on function public.foundation_security_preflight() to service_role;

do $$ declare report jsonb; begin
  report:=public.foundation_security_preflight();
  if not (report->>'safe_to_apply')::boolean then
    raise exception 'foundation security preflight failed: %',report;
  end if;
end $$;

-- Only uniquely inferable, same-tenant legacy relationships are backfilled.
update public.parent_student_links psl
set parent_user_id=pp.user_id
from public.parent_profiles pp,public.students s
where pp.id=psl.parent_profile_id
  and s.id=psl.student_id
  and psl.parent_user_id is null
  and pp.user_id is not null
  and psl.organization_id=pp.organization_id
  and psl.organization_id=s.organization_id;

update public.notifications n
set recipient_user_id=pp.user_id
from public.parent_profiles pp
where pp.id=n.parent_id
  and n.recipient_user_id is null
  and pp.user_id is not null
  and n.organization_id=pp.organization_id;

-- Invitation state is enforced at every DB authorization boundary. Invited and
-- expired accounts never receive operational data through an existing session.
create or replace function public.can_access_organization_data(target_organization_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.can_access_organization(target_organization_id)
    or exists(
      select 1 from public.parent_profiles pp
      where pp.organization_id=target_organization_id
        and pp.user_id=auth.uid()
        and pp.account_status='active'
    )
$$;

create or replace function public.has_parent_account_access(target_parent_profile_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.parent_profiles pp
    where pp.id=target_parent_profile_id
      and pp.user_id=auth.uid()
      and pp.account_status='active'
  )
$$;

create or replace function public.is_parent_of_student(target_student_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1
    from public.parent_student_links psl
    join public.parent_profiles pp
      on pp.id=psl.parent_profile_id
     and pp.organization_id=psl.organization_id
    join public.students s
      on s.id=psl.student_id
     and s.organization_id=psl.organization_id
    where psl.student_id=target_student_id
      and psl.parent_user_id=auth.uid()
      and pp.user_id=auth.uid()
      and pp.account_status='active'
  )
$$;

create or replace function public.protect_parent_profile_account_fields()
returns trigger language plpgsql set search_path=public as $$ begin
  if current_user='authenticated' then
    if tg_op='INSERT' and (
      new.user_id is not null
      or new.email is not null
      or new.account_status<>'unlinked'
      or new.invited_at is not null
      or new.linked_at is not null
    ) then
      raise exception 'parent account fields are server controlled';
    elsif tg_op='UPDATE'
      and (new.id,new.organization_id,new.user_id,new.email,new.account_status,new.invited_at,new.linked_at,new.created_at)
        is distinct from
          (old.id,old.organization_id,old.user_id,old.email,old.account_status,old.invited_at,old.linked_at,old.created_at)
    then
      raise exception 'parent account fields are server controlled';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_parent_profiles_protect_account on public.parent_profiles;
create trigger trg_parent_profiles_protect_account
before insert or update on public.parent_profiles
for each row execute function public.protect_parent_profile_account_fields();

create or replace function public.enforce_parent_invitation_auth_link()
returns trigger language plpgsql set search_path=public as $$
declare p_org uuid; p_user uuid; begin
  select organization_id,user_id into p_org,p_user
  from public.parent_profiles where id=new.parent_profile_id;
  if p_org is distinct from new.organization_id then
    raise exception 'cross-tenant parent invitation';
  end if;
  if new.status in ('pending','sent','accepted')
    and new.auth_user_id is not null
    and p_user is distinct from new.auth_user_id then
    raise exception 'invitation auth user does not match parent profile';
  end if;
  return new;
end $$;

create or replace function public.activate_parent_account()
returns boolean language plpgsql security definer set search_path=public as $$
declare
  v_profile_id uuid;
  v_org uuid;
  v_status text;
  v_invitation_id uuid;
begin
  if auth.uid() is null then raise exception 'authenticated user required'; end if;

  select id,organization_id,account_status
  into v_profile_id,v_org,v_status
  from public.parent_profiles
  where user_id=auth.uid()
  for update;

  if v_profile_id is null then raise exception 'parent profile required'; end if;
  if v_status='active' then return true; end if;
  if v_status='disabled' then return false; end if;

  update public.parent_account_invitations
  set status='expired',updated_at=statement_timestamp()
  where parent_profile_id=v_profile_id
    and organization_id=v_org
    and status in ('pending','sent')
    and expires_at<=statement_timestamp();

  select id into v_invitation_id
  from public.parent_account_invitations
  where parent_profile_id=v_profile_id
    and organization_id=v_org
    and auth_user_id=auth.uid()
    and status in ('pending','sent')
    and expires_at>statement_timestamp()
  order by created_at desc
  limit 1
  for update;

  if v_invitation_id is null then
    update public.parent_profiles
    set account_status='expired',updated_at=statement_timestamp()
    where id=v_profile_id and account_status in ('invited','expired');
    return false;
  end if;

  update public.parent_profiles
  set account_status='active',linked_at=coalesce(linked_at,statement_timestamp()),
      updated_at=statement_timestamp()
  where id=v_profile_id;

  update public.parent_account_invitations
  set status=case when id=v_invitation_id then 'accepted' else 'expired' end,
      accepted_at=case when id=v_invitation_id then coalesce(accepted_at,statement_timestamp()) else accepted_at end,
      updated_at=statement_timestamp()
  where parent_profile_id=v_profile_id
    and organization_id=v_org
    and status in ('pending','sent');
  return true;
end $$;

create or replace function public.link_parent_auth_account(
  p_organization_id uuid,p_parent_profile_id uuid,p_auth_user_id uuid,p_email text,
  p_idempotency_key text,p_invited_by uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_invitation_id uuid;
  v_profile_user_id uuid;
  v_profile_email text;
  v_profile_status text;
  v_existing public.parent_account_invitations%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role'
    and coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role'
    and current_user<>'service_role' then raise exception 'service role required'; end if;

  p_email:=lower(trim(coalesce(p_email,'')));
  p_idempotency_key:=trim(coalesce(p_idempotency_key,''));
  if length(p_email) not between 3 and 254
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  then raise exception 'invalid parent email'; end if;
  if length(p_idempotency_key) not between 1 and 200 then
    raise exception 'invalid idempotency key';
  end if;

  select user_id,email,account_status
  into v_profile_user_id,v_profile_email,v_profile_status
  from public.parent_profiles
  where id=p_parent_profile_id and organization_id=p_organization_id
  for update;
  if not found then raise exception 'parent profile not found'; end if;

  select * into v_existing
  from public.parent_account_invitations
  where organization_id=p_organization_id and idempotency_key=p_idempotency_key
  for update;
  if found then
    if v_existing.parent_profile_id<>p_parent_profile_id
      or v_existing.auth_user_id is distinct from p_auth_user_id
      or lower(v_existing.email)<>p_email then
      raise exception 'idempotency key payload mismatch';
    end if;
    return v_existing.id;
  end if;

  if v_profile_status in ('active','disabled') then
    raise exception 'parent profile cannot be invited from current state';
  end if;
  if v_profile_user_id is not null and v_profile_user_id<>p_auth_user_id then
    raise exception 'parent profile already linked to another auth user';
  end if;
  if v_profile_user_id is not null and v_profile_email is not null
    and lower(v_profile_email)<>p_email then
    raise exception 'parent profile email identity mismatch';
  end if;
  if exists(select 1 from public.parent_profiles
      where user_id=p_auth_user_id and id<>p_parent_profile_id) then
    raise exception 'auth user already linked to another parent profile';
  end if;

  update public.parent_account_invitations
  set status='expired',updated_at=statement_timestamp()
  where organization_id=p_organization_id
    and parent_profile_id=p_parent_profile_id
    and status in ('pending','sent');

  update public.parent_profiles
  set email=p_email,user_id=p_auth_user_id,account_status='invited',
      invited_at=statement_timestamp(),updated_at=statement_timestamp()
  where id=p_parent_profile_id and organization_id=p_organization_id;

  update public.parent_student_links psl
  set parent_user_id=p_auth_user_id
  from public.students s
  where psl.organization_id=p_organization_id
    and psl.parent_profile_id=p_parent_profile_id
    and s.id=psl.student_id and s.organization_id=psl.organization_id;

  update public.notifications
  set recipient_user_id=p_auth_user_id
  where organization_id=p_organization_id
    and parent_id=p_parent_profile_id
    and recipient_user_id is null;

  insert into public.parent_account_invitations(
    organization_id,parent_profile_id,email,auth_user_id,status,idempotency_key,
    invited_by,sent_at,expires_at
  ) values(
    p_organization_id,p_parent_profile_id,p_email,p_auth_user_id,'sent',p_idempotency_key,
    p_invited_by,statement_timestamp(),statement_timestamp()+interval '7 days'
  ) returning id into v_invitation_id;
  return v_invitation_id;
end $$;

create or replace function public.register_push_device(
  p_installation_id text,p_device_token text,p_environment text,p_bundle_id text,
  p_app_version text default null,p_device_model text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_profile_id uuid; v_id uuid; begin
  if auth.uid() is null then raise exception 'authenticated user required'; end if;
  if nullif(trim(p_installation_id),'') is null or length(p_installation_id)>200 then raise exception 'invalid installation id'; end if;
  if p_device_token is null or length(p_device_token) not between 64 and 200 or p_device_token !~ '^[0-9A-Fa-f]+$' then raise exception 'invalid APNs device token'; end if;
  if nullif(trim(p_bundle_id),'') is null or length(p_bundle_id)>255 or p_bundle_id !~ '^[A-Za-z0-9][A-Za-z0-9.-]{2,254}$' then raise exception 'invalid bundle id'; end if;
  if p_app_version is not null and length(p_app_version)>100 then raise exception 'invalid app version'; end if;
  if p_device_model is not null and length(p_device_model)>200 then raise exception 'invalid device model'; end if;
  if p_environment not in ('sandbox','production') then raise exception 'invalid APNs environment'; end if;

  -- Lock order shared with disable_parent_account: profile first, devices second.
  select id,organization_id into v_profile_id,v_org
  from public.parent_profiles
  where user_id=auth.uid() and account_status='active'
  for update;
  if v_profile_id is null then raise exception 'active parent profile required'; end if;

  update public.push_devices set is_active=false,invalidated_at=statement_timestamp(),updated_at=statement_timestamp()
  where environment=p_environment and bundle_id=p_bundle_id and device_token=p_device_token
    and (user_id<>auth.uid() or installation_id<>p_installation_id) and is_active;
  insert into public.push_devices(
    organization_id,user_id,installation_id,device_token,environment,bundle_id,app_version,device_model
  ) values(
    v_org,auth.uid(),p_installation_id,p_device_token,p_environment,p_bundle_id,p_app_version,p_device_model
  ) on conflict(user_id,installation_id) do update
  set organization_id=excluded.organization_id,device_token=excluded.device_token,
      environment=excluded.environment,bundle_id=excluded.bundle_id,
      app_version=excluded.app_version,device_model=excluded.device_model,
      is_active=true,last_seen_at=statement_timestamp(),invalidated_at=null,
      updated_at=statement_timestamp()
  returning id into v_id;
  insert into public.notification_preferences(organization_id,user_id)
  values(v_org,auth.uid()) on conflict do nothing;
  return v_id;
end $$;

create or replace function public.disable_parent_account(p_organization_id uuid,p_parent_profile_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_user_id uuid; begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role'
    and coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role'
    and current_user<>'service_role' then raise exception 'service role required'; end if;

  select user_id into v_user_id from public.parent_profiles
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
    set is_active=false,invalidated_at=statement_timestamp(),updated_at=statement_timestamp()
    where organization_id=p_organization_id and user_id=v_user_id and is_active;
  end if;
  return true;
end $$;

-- Timezone writes normalize through PostgreSQL's own timezone catalog. The
-- enqueue path repeats validation to isolate any pre-existing corrupt recipient.
create or replace function public.normalize_notification_timezone(p_timezone text)
returns text language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce((
    select name from pg_catalog.pg_timezone_names
    where name=nullif(btrim(p_timezone),'')
    limit 1
  ),'Asia/Macau')
$$;

create or replace function public.validate_notification_preference_timezone()
returns trigger language plpgsql set search_path=public as $$ begin
  new.timezone:=public.normalize_notification_timezone(new.timezone);
  return new;
end $$;
drop trigger if exists trg_notification_preferences_validate_timezone
  on public.notification_preferences;
create trigger trg_notification_preferences_validate_timezone
before insert or update of timezone on public.notification_preferences
for each row execute function public.validate_notification_preference_timezone();

update public.notification_preferences
set timezone=public.normalize_notification_timezone(timezone)
where timezone is distinct from public.normalize_notification_timezone(timezone);

create or replace function public.enqueue_notification_devices()
returns trigger language plpgsql security definer set search_path=public as $$ begin
  insert into public.notification_outbox(organization_id,notification_id,device_id,available_at)
  select new.organization_id,new.id,pd.id,
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
    end
  from public.push_devices pd
  left join public.notification_preferences np
    on np.organization_id=pd.organization_id and np.user_id=pd.user_id
  where pd.organization_id=new.organization_id and pd.user_id=new.recipient_user_id and pd.is_active
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

-- Normalize legacy keys before enforcing the storage invariant. Existing null
-- keys receive a deterministic server-generated value derived from the row id.
do $$ begin
  if exists(
    select 1 from (
      select organization_id,btrim(idempotency_key)
      from public.leave_requests
      where nullif(btrim(idempotency_key),'') is not null
      group by organization_id,btrim(idempotency_key)
      having count(*)>1
    ) collisions
  ) then raise exception 'leave idempotency normalization collision'; end if;
end $$;

update public.leave_requests
set idempotency_key=case
  when nullif(btrim(idempotency_key),'') is null then 'legacy:'||id::text
  else btrim(idempotency_key)
end;
alter table public.leave_requests
  alter column idempotency_key set default ('leave:'||gen_random_uuid()::text);
alter table public.leave_requests
  alter column idempotency_key set not null;
alter table public.leave_requests
  drop constraint if exists leave_requests_idempotency_key_check;
alter table public.leave_requests
  add constraint leave_requests_idempotency_key_check
  check (length(btrim(idempotency_key)) between 1 and 200);

create or replace function public.submit_parent_leave_request(
  p_student_id uuid,p_session_id uuid,p_reason text,p_idempotency_key text
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_org uuid;
  v_id uuid;
  v_existing public.leave_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated user required'; end if;
  p_idempotency_key:=btrim(coalesce(p_idempotency_key,''));
  p_reason:=btrim(coalesce(p_reason,''));
  if length(p_idempotency_key) not between 1 and 200 then
    raise exception 'invalid idempotency key';
  end if;
  if length(p_reason) not between 1 and 2000 then raise exception 'invalid leave reason'; end if;
  if not public.is_parent_of_student(p_student_id) then raise exception 'not authorized'; end if;

  select organization_id into v_org from public.students where id=p_student_id;
  if not exists(
    select 1 from public.lesson_sessions ls
    join public.cohort_students cs
      on cs.cohort_id=ls.cohort_id and cs.organization_id=ls.organization_id
    where ls.id=p_session_id and ls.organization_id=v_org
      and ls.status='scheduled' and ls.starts_at>statement_timestamp()
      and cs.student_id=p_student_id and cs.status='active' and cs.is_active_membership
  ) then raise exception 'session is not available for this student'; end if;

  select * into v_existing from public.leave_requests
  where organization_id=v_org and idempotency_key=p_idempotency_key
  for update;
  if found then
    if v_existing.requested_by is distinct from auth.uid()
      or v_existing.student_id<>p_student_id
      or v_existing.lesson_session_id is distinct from p_session_id
      or v_existing.reason<>p_reason then
      raise exception 'idempotency key payload mismatch';
    end if;
    return v_existing.id;
  end if;

  insert into public.leave_requests(
    organization_id,student_id,lesson_session_id,requested_by,reason,idempotency_key
  ) values(v_org,p_student_id,p_session_id,auth.uid(),p_reason,p_idempotency_key)
  returning id into v_id;
  return v_id;
end $$;

-- Staff lifecycle DML must use the server-side allowlist. Ordinary preference
-- self-service remains available, and service-role RPCs retain their grants.
revoke insert,update,delete on public.parent_account_invitations from authenticated;
revoke delete on public.parent_profiles from authenticated;
revoke usage,select on all sequences in schema public from anon,authenticated;
grant usage,select on all sequences in schema public to service_role;

revoke all on function public.normalize_notification_timezone(text) from public;
revoke all on function public.validate_notification_preference_timezone() from public;
grant execute on function public.normalize_notification_timezone(text) to authenticated,service_role;

drop policy if exists receipts_parent_read on public.receipts;
create policy receipts_parent_read on public.receipts for select using(
  guardian_id in (
    select id from public.parent_profiles
    where user_id=auth.uid() and account_status='active'
  )
);

create or replace function public.get_parent_attendance_summary()
returns table(
  student_id uuid,student_name text,cohort_id uuid,cohort_name text,
  completed_lessons bigint,recorded_lessons bigint,pending_makeup_count bigint,
  scheduled_makeup_count bigint,display_text text
) language sql stable security definer set search_path=public as $$
  select s.student_id,s.student_name,s.cohort_id,s.cohort_name,s.completed_lessons,
    s.recorded_lessons,s.pending_makeup_count,s.scheduled_makeup_count,s.display_text
  from public.parent_exam_attendance_summary s
  where s.parent_user_id=auth.uid()
    and exists(
      select 1 from public.parent_profiles pp
      where pp.user_id=auth.uid() and pp.account_status='active'
    )
$$;

-- Refresh the explicit SECURITY DEFINER allowlist after replacing functions.
do $$ declare sig text; begin
  for sig in select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
  loop execute format('revoke all on function %s from public',sig); end loop;
end $$;
grant execute on function public.can_access_organization_data(uuid) to authenticated,service_role;
grant execute on function public.has_parent_account_access(uuid) to authenticated,service_role;
grant execute on function public.is_parent_of_student(uuid) to authenticated,service_role;
grant execute on function public.activate_parent_account() to authenticated;
grant execute on function public.register_push_device(text,text,text,text,text,text) to authenticated;
grant execute on function public.submit_parent_leave_request(uuid,uuid,text,text) to authenticated;
grant execute on function public.get_parent_attendance_summary() to authenticated;
grant execute on function public.link_parent_auth_account(uuid,uuid,uuid,text,text,uuid) to service_role;
grant execute on function public.disable_parent_account(uuid,uuid) to service_role;
grant execute on function public.foundation_security_preflight() to service_role;
grant execute on function public.normalize_notification_timezone(text) to authenticated,service_role;
