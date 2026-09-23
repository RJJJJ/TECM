-- Parent account linking, tenant-safe notifications, push registration, and delivery outbox.
-- Additive only: all legacy compatibility columns and APIs remain available.

alter table public.parent_profiles add column if not exists email text;
alter table public.parent_profiles add column if not exists account_status text not null default 'unlinked'
  check (account_status in ('unlinked','invited','active','disabled'));
alter table public.parent_profiles add column if not exists invited_at timestamptz;
alter table public.parent_profiles add column if not exists linked_at timestamptz;

-- Preserve legacy account access when upgrading profiles that were already linked.
update public.parent_profiles
set account_status = 'active',
    linked_at = coalesce(linked_at, updated_at, created_at, now())
where user_id is not null
  and account_status = 'unlinked';

create unique index if not exists uq_parent_profiles_organization_email
  on public.parent_profiles (organization_id, lower(email)) where email is not null;

create table if not exists public.parent_account_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  parent_profile_id uuid not null references public.parent_profiles(id) on delete cascade,
  email text not null,
  auth_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','sent','accepted','expired','disabled','failed')),
  idempotency_key text not null,
  invited_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz,
  accepted_at timestamptz,
  disabled_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);
create index if not exists idx_parent_invitations_profile_status
  on public.parent_account_invitations (parent_profile_id, status, created_at desc);

-- Parents are tenant principals without being exposed through organization_members.
create or replace function public.can_access_organization_data(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_access_organization(target_organization_id)
    or exists (
      select 1 from public.parent_profiles pp
      where pp.organization_id = target_organization_id
        and pp.user_id = auth.uid()
        and pp.account_status in ('invited','active')
    )
$$;

create or replace function public.has_parent_account_access(target_parent_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.parent_profiles pp
    where pp.id = target_parent_profile_id
      and pp.user_id = auth.uid()
      and pp.account_status in ('invited','active')
  )
$$;

create or replace function public.is_parent_of_student(target_student_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.parent_student_links psl
    join public.parent_profiles pp
      on pp.id = psl.parent_profile_id
     and pp.organization_id = psl.organization_id
    where psl.student_id = target_student_id
      and psl.parent_user_id = auth.uid()
      and pp.user_id = auth.uid()
      and pp.account_status in ('invited','active')
  )
$$;

-- Remove global staff-role authorization from tenant tables. Organization membership is canonical.
do $$
declare t text;
begin
  foreach t in array array[
    'parent_profiles','children','campuses','courses','course_tags','news_items','faq_topics','faq_items',
    'bookings','booking_status_logs','follow_up_tasks','notifications','booking_parent_notifications','students',
    'parent_student_links','teacher_profiles','exam_cohorts','cohort_students','lesson_plans','lesson_sessions',
    'attendance_records','makeup_tasks','makeup_sessions','makeup_recommendations'
  ] loop
    execute format('drop policy if exists tenant_boundary on public.%I', t);
    execute format(
      'create policy tenant_boundary on public.%I as restrictive for all using (public.can_access_organization_data(organization_id)) with check (public.can_access_organization_data(organization_id))', t
    );
  end loop;
end $$;

-- Gate legacy parent self-service policies on account status as well as UID.
drop policy if exists parent_profiles_select_own on public.parent_profiles;
create policy parent_profiles_select_own on public.parent_profiles for select
  using(public.has_parent_account_access(id));
drop policy if exists parent_profiles_update_own on public.parent_profiles;
create policy parent_profiles_update_own on public.parent_profiles for update
  using(public.has_parent_account_access(id)) with check(public.has_parent_account_access(id));
drop policy if exists children_select_own on public.children;
create policy children_select_own on public.children for select
  using(public.has_parent_account_access(parent_id));
drop policy if exists children_insert_own on public.children;
create policy children_insert_own on public.children for insert
  with check(public.has_parent_account_access(parent_id));
drop policy if exists children_update_own on public.children;
create policy children_update_own on public.children for update
  using(public.has_parent_account_access(parent_id)) with check(public.has_parent_account_access(parent_id));
drop policy if exists bookings_select_own on public.bookings;
create policy bookings_select_own on public.bookings for select
  using(public.has_parent_account_access(parent_id));
drop policy if exists bookings_insert_own_parent on public.bookings;
create policy bookings_insert_own_parent on public.bookings for insert
  with check(public.has_parent_account_access(parent_id));
drop policy if exists parent_student_links_parent_read on public.parent_student_links;
create policy parent_student_links_parent_read on public.parent_student_links for select
  using(public.has_parent_account_access(parent_profile_id));

drop policy if exists parent_profiles_staff_read on public.parent_profiles;
drop policy if exists children_staff_read on public.children;
drop policy if exists campuses_staff_manage on public.campuses;
drop policy if exists courses_staff_manage on public.courses;
drop policy if exists course_tags_staff_manage on public.course_tags;
drop policy if exists news_staff_manage on public.news_items;
drop policy if exists faq_topics_staff_manage on public.faq_topics;
drop policy if exists faq_items_staff_manage on public.faq_items;
drop policy if exists bookings_staff_manage on public.bookings;
drop policy if exists booking_logs_staff_manage on public.booking_status_logs;
drop policy if exists follow_up_tasks_staff_manage on public.follow_up_tasks;
drop policy if exists notifications_staff_manage on public.notifications;
drop policy if exists booking_parent_notifications_staff_manage on public.booking_parent_notifications;
drop policy if exists students_staff_manage on public.students;
drop policy if exists parent_student_links_staff_manage on public.parent_student_links;
drop policy if exists teacher_profiles_staff_manage on public.teacher_profiles;
drop policy if exists exam_cohorts_staff_manage on public.exam_cohorts;
drop policy if exists cohort_students_staff_manage on public.cohort_students;
drop policy if exists lesson_plans_staff_manage on public.lesson_plans;
drop policy if exists lesson_sessions_staff_manage on public.lesson_sessions;
drop policy if exists makeup_tasks_staff_manage on public.makeup_tasks;
drop policy if exists makeup_sessions_staff_manage on public.makeup_sessions;
drop policy if exists makeup_recommendations_staff_manage on public.makeup_recommendations;

do $$
declare t text;
begin
  foreach t in array array[
    'parent_profiles','children','campuses','courses','course_tags','news_items','faq_topics','faq_items',
    'bookings','booking_status_logs','follow_up_tasks','notifications','booking_parent_notifications','students',
    'parent_student_links','teacher_profiles','exam_cohorts','cohort_students','lesson_plans','lesson_sessions',
    'attendance_records','makeup_tasks','makeup_sessions','makeup_recommendations'
  ] loop
    execute format('drop policy if exists organization_staff_manage on public.%I', t);
    execute format('create policy organization_staff_manage on public.%I for all using (public.can_manage_organization(organization_id)) with check (public.can_manage_organization(organization_id))', t);
  end loop;
end $$;

alter table public.notifications add column if not exists recipient_user_id uuid references auth.users(id) on delete cascade;
alter table public.notifications add column if not exists category text not null default 'general';
alter table public.notifications add column if not exists body text;
alter table public.notifications add column if not exists deep_link text;
alter table public.notifications add column if not exists entity_type text;
alter table public.notifications add column if not exists entity_id uuid;
alter table public.notifications add column if not exists event_key text;
alter table public.notifications add column if not exists read_at timestamptz;
alter table public.notifications add column if not exists expires_at timestamptz;
alter table public.notifications add column if not exists source text not null default 'system';
alter table public.notifications add column if not exists actor_user_id uuid references auth.users(id) on delete set null;
update public.notifications n set
  recipient_user_id = pp.user_id,
  body = coalesce(n.body,n.detail),
  read_at = case when n.is_read then coalesce(n.read_at,n.created_at) else n.read_at end
from public.parent_profiles pp where pp.id=n.parent_id and n.recipient_user_id is null;
create unique index if not exists uq_notifications_event_key
  on public.notifications (organization_id,event_key) where event_key is not null;
create index if not exists idx_notifications_recipient_unread
  on public.notifications (recipient_user_id,read_at,created_at desc);

create table if not exists public.push_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id text not null,
  device_token text not null,
  environment text not null check (environment in ('sandbox','production')),
  bundle_id text not null,
  app_version text,
  device_model text,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id,installation_id)
);
create unique index if not exists uq_push_devices_active_token
  on public.push_devices(environment,bundle_id,device_token) where is_active;
create index if not exists idx_push_devices_user_active on public.push_devices(user_id,is_active);

create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  transactional_enabled boolean not null default true,
  announcements_enabled boolean not null default true,
  marketing_enabled boolean not null default false,
  class_reminders_enabled boolean not null default true,
  attendance_enabled boolean not null default true,
  leave_makeup_enabled boolean not null default true,
  payments_enabled boolean not null default true,
  quiet_hours_start time,
  quiet_hours_end time,
  timezone text not null default 'Asia/Macau',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,user_id)
);

create table if not exists public.notification_announcements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  title text not null,
  body text not null,
  category text not null default 'announcement',
  deep_link text,
  status text not null default 'draft' check (status in ('draft','sent','cancelled')),
  recipient_count integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  template_key text not null check(template_key ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  name text not null check(length(name) between 1 and 100),
  category text not null default 'announcement' check(category in ('announcement','class_reminder','attendance','leave','makeup','payments','marketing','transactional','security')),
  title text not null check(length(title) between 1 and 120),
  body text not null check(length(body) between 1 and 2000),
  deep_link text check(deep_link is null or deep_link ~ '^tecm://(home|bookings|schedule|attendance|leave|makeup|payments|notifications)(/[-A-Za-z0-9_./]*)?$'),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,template_key)
);

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  device_id uuid not null references public.push_devices(id) on delete cascade,
  channel text not null default 'apns' check (channel='apns'),
  status text not null default 'pending' check (status in ('pending','claimed','retry','delivered','would_send','dead_letter')),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count>=0),
  last_error text,
  delivered_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(notification_id,device_id)
);
create index if not exists idx_notification_outbox_claim
  on public.notification_outbox(status,available_at,lease_expires_at,created_at);

create table if not exists public.notification_delivery_attempts (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  outbox_id uuid not null references public.notification_outbox(id) on delete cascade,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  device_id uuid not null references public.push_devices(id) on delete cascade,
  provider text not null default 'apns',
  provider_request_id text,
  http_status integer,
  result text not null check (result in ('delivered','would_send','retry','dead_letter')),
  sanitized_error text,
  retryable boolean not null default false,
  attempted_at timestamptz not null default now()
);
create index if not exists idx_delivery_attempts_outbox_time on public.notification_delivery_attempts(outbox_id,attempted_at desc);

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  payment_id uuid not null unique references public.payments(id) on delete restrict,
  guardian_id uuid references public.parent_profiles(id) on delete set null,
  receipt_number text not null,
  amount_minor bigint not null check (amount_minor>0),
  currency_code text not null,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(organization_id,receipt_number)
);

-- Cross-tenant reference enforcement for new tables.
create trigger trg_parent_account_invitations_tenant_fk before insert or update on public.parent_account_invitations
for each row execute function public.enforce_tenant_foreign_keys('parent_profile_id','parent_profiles');
create or replace function public.enforce_parent_invitation_auth_link()
returns trigger language plpgsql set search_path=public as $$ declare p_org uuid; p_user uuid; begin
  select organization_id,user_id into p_org,p_user from public.parent_profiles where id=new.parent_profile_id;
  if p_org is distinct from new.organization_id then raise exception 'cross-tenant parent invitation'; end if;
  if new.auth_user_id is not null and p_user is distinct from new.auth_user_id then raise exception 'invitation auth user does not match parent profile'; end if;
  return new;
end $$;
create trigger trg_parent_invitations_auth_link before insert or update on public.parent_account_invitations
for each row execute function public.enforce_parent_invitation_auth_link();
create trigger trg_notification_outbox_tenant_fk before insert or update on public.notification_outbox
for each row execute function public.enforce_tenant_foreign_keys('notification_id','notifications','device_id','push_devices');
create trigger trg_notification_delivery_attempts_tenant_fk before insert or update on public.notification_delivery_attempts
for each row execute function public.enforce_tenant_foreign_keys('outbox_id','notification_outbox','notification_id','notifications','device_id','push_devices');
create trigger trg_receipts_tenant_fk before insert or update on public.receipts
for each row execute function public.enforce_tenant_foreign_keys('payment_id','payments','guardian_id','parent_profiles');

do $$ declare t text; begin
  foreach t in array array['parent_account_invitations','push_devices','notification_preferences','notification_announcements','notification_templates','notification_outbox','notification_delivery_attempts','receipts'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
  end loop;
end $$;

create policy parent_invitations_staff on public.parent_account_invitations for all
  using(public.can_manage_organization(organization_id)) with check(public.can_manage_organization(organization_id));
create policy push_devices_own_read on public.push_devices for select using(user_id=auth.uid());
create policy notification_preferences_own on public.notification_preferences for all
  using(user_id=auth.uid() and public.can_access_organization_data(organization_id))
  with check(user_id=auth.uid() and public.can_access_organization_data(organization_id));
create policy announcements_staff on public.notification_announcements for all
  using(public.can_manage_organization(organization_id)) with check(public.can_manage_organization(organization_id));
create policy notification_templates_staff on public.notification_templates for all
  using(public.can_manage_organization(organization_id)) with check(public.can_manage_organization(organization_id));
create policy outbox_staff_read on public.notification_outbox for select using(public.can_manage_organization(organization_id));
create policy attempts_staff_read on public.notification_delivery_attempts for select using(public.can_manage_organization(organization_id));
create policy receipts_staff on public.receipts for all using(public.can_manage_organization(organization_id)) with check(public.can_manage_organization(organization_id));
create policy receipts_parent_read on public.receipts for select using(
  guardian_id in (select id from public.parent_profiles where user_id=auth.uid() and account_status in ('invited','active'))
);

drop policy if exists notifications_update_own on public.notifications;
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select using(
  recipient_user_id=auth.uid() and public.has_parent_account_access(parent_id)
);

-- Parent self-service may change ordinary contact details, never tenant or onboarding state.
create or replace function public.protect_parent_profile_account_fields()
returns trigger language plpgsql set search_path=public as $$
declare v_trusted_activation boolean; begin
  v_trusted_activation :=
    coalesce(current_setting('tecm.parent_account_activation',true)='on',false)
    and current_user=pg_get_userbyid((
      select proowner from pg_proc where oid=to_regprocedure('public.activate_parent_account()')
    ));
  if auth.uid()=old.user_id and not public.can_manage_organization(old.organization_id) and
    not v_trusted_activation and
    (new.id,new.organization_id,new.user_id,new.email,new.account_status,new.invited_at,new.linked_at,new.created_at)
      is distinct from
    (old.id,old.organization_id,old.user_id,old.email,old.account_status,old.invited_at,old.linked_at,old.created_at)
  then raise exception 'parent account fields are server controlled'; end if;
  return new;
end $$;
create trigger trg_parent_profiles_protect_account before update on public.parent_profiles
for each row execute function public.protect_parent_profile_account_fields();

create or replace function public.protect_notification_preference_identity()
returns trigger language plpgsql set search_path=public as $$ begin
  if (new.id,new.organization_id,new.user_id,new.created_at) is distinct from
     (old.id,old.organization_id,old.user_id,old.created_at)
  then raise exception 'notification preference identity is immutable'; end if;
  return new;
end $$;
create trigger trg_notification_preferences_protect_identity before update on public.notification_preferences
for each row execute function public.protect_notification_preference_identity();

-- Parent read/write policies for operational data; internal attendance notes remain RPC-only.
create policy leave_requests_parent_read on public.leave_requests for select using(public.is_parent_of_student(student_id));
-- Parent writes must use submit_parent_leave_request so session/cohort, status,
-- requester, future-date, and idempotency validation cannot be bypassed.
drop policy if exists leave_requests_parent_insert on public.leave_requests;
create policy makeup_entitlements_parent_read on public.makeup_entitlements for select using(public.is_parent_of_student(student_id));
create policy makeup_tasks_parent_read on public.makeup_tasks for select using(public.is_parent_of_student(student_id));
create policy makeup_sessions_parent_read on public.makeup_sessions for select using(public.is_parent_of_student(student_id));
create policy student_packages_parent_read on public.student_packages for select using(public.is_parent_of_student(student_id));
create policy credit_ledger_parent_read on public.credit_ledger for select using(public.is_parent_of_student(student_id));
create policy charges_parent_read on public.charges for select using(public.is_parent_of_student(student_id));
create policy payment_allocations_parent_read on public.payment_allocations for select using(
  exists(select 1 from public.charges c where c.id=charge_id and public.is_parent_of_student(c.student_id))
);
create policy payments_parent_read on public.payments for select using(
  public.has_parent_account_access(guardian_id)
  or exists(select 1 from public.payment_allocations pa join public.charges c on c.id=pa.charge_id where pa.payment_id=payments.id and public.is_parent_of_student(c.student_id))
);

create or replace function public.set_notification_compatibility()
returns trigger language plpgsql set search_path=public as $$ begin
  new.body := coalesce(new.body,new.detail);
  new.detail := coalesce(new.detail,new.body);
  new.is_read := new.read_at is not null;
  if new.recipient_user_id is null then select user_id into new.recipient_user_id from public.parent_profiles where id=new.parent_id; end if;
  return new;
end $$;
create trigger trg_notifications_compatibility before insert or update on public.notifications
for each row execute function public.set_notification_compatibility();

create or replace function public.enqueue_notification_devices()
returns trigger language plpgsql security definer set search_path=public as $$ begin
  insert into public.notification_outbox(organization_id,notification_id,device_id,available_at)
  select new.organization_id,new.id,pd.id,
    case
      when new.category in ('security','transactional','payments','payment','receipt') then now()
      when np.quiet_hours_start is null or np.quiet_hours_end is null then now()
      when np.quiet_hours_start=np.quiet_hours_end then now()
      when np.quiet_hours_start<np.quiet_hours_end
        and (now() at time zone np.timezone)::time>=np.quiet_hours_start
        and (now() at time zone np.timezone)::time<np.quiet_hours_end
        then (((now() at time zone np.timezone)::date + np.quiet_hours_end) at time zone np.timezone)
      when np.quiet_hours_start>np.quiet_hours_end
        and (now() at time zone np.timezone)::time>=np.quiet_hours_start
        then ((((now() at time zone np.timezone)::date + 1) + np.quiet_hours_end) at time zone np.timezone)
      when np.quiet_hours_start>np.quiet_hours_end
        and (now() at time zone np.timezone)::time<np.quiet_hours_end
        then (((now() at time zone np.timezone)::date + np.quiet_hours_end) at time zone np.timezone)
      else now()
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
create trigger trg_notifications_enqueue after insert on public.notifications
for each row execute function public.enqueue_notification_devices();

create or replace function public.activate_parent_account()
returns boolean language plpgsql security definer set search_path=public as $$
declare v_org uuid; begin
  if auth.uid() is null then raise exception 'authenticated user required'; end if;
  perform set_config('tecm.parent_account_activation','on',true);
  update public.parent_profiles
  set account_status='active',linked_at=coalesce(linked_at,now()),updated_at=now()
  where user_id=auth.uid() and account_status in ('invited','active')
  returning organization_id into v_org;
  if v_org is null then raise exception 'invited or active parent profile required'; end if;
  update public.parent_account_invitations
  set status='accepted',accepted_at=coalesce(accepted_at,now()),updated_at=now()
  where organization_id=v_org and auth_user_id=auth.uid() and status in ('pending','sent','expired');
  return true;
end $$;

create or replace function public.register_push_device(
  p_installation_id text,p_device_token text,p_environment text,p_bundle_id text,
  p_app_version text default null,p_device_model text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_id uuid; begin
  if auth.uid() is null then raise exception 'authenticated user required'; end if;
  if nullif(trim(p_installation_id),'') is null or length(p_installation_id)>200 then raise exception 'invalid installation id'; end if;
  if p_device_token is null or length(p_device_token) not between 64 and 200 or p_device_token !~ '^[0-9A-Fa-f]+$' then raise exception 'invalid APNs device token'; end if;
  if nullif(trim(p_bundle_id),'') is null or length(p_bundle_id)>255 or p_bundle_id !~ '^[A-Za-z0-9][A-Za-z0-9.-]{2,254}$' then raise exception 'invalid bundle id'; end if;
  if p_app_version is not null and length(p_app_version)>100 then raise exception 'invalid app version'; end if;
  if p_device_model is not null and length(p_device_model)>200 then raise exception 'invalid device model'; end if;
  if p_environment not in ('sandbox','production') then raise exception 'invalid APNs environment'; end if;
  select organization_id into v_org from public.parent_profiles where user_id=auth.uid() and account_status in ('invited','active');
  if v_org is null then raise exception 'active parent profile required'; end if;
  update public.push_devices set is_active=false,invalidated_at=now(),updated_at=now()
    where environment=p_environment and bundle_id=p_bundle_id and device_token=p_device_token
      and (user_id<>auth.uid() or installation_id<>p_installation_id) and is_active;
  insert into public.push_devices(organization_id,user_id,installation_id,device_token,environment,bundle_id,app_version,device_model)
  values(v_org,auth.uid(),p_installation_id,p_device_token,p_environment,p_bundle_id,p_app_version,p_device_model)
  on conflict(user_id,installation_id) do update set organization_id=excluded.organization_id,device_token=excluded.device_token,
    environment=excluded.environment,bundle_id=excluded.bundle_id,app_version=excluded.app_version,device_model=excluded.device_model,
    is_active=true,last_seen_at=now(),invalidated_at=null,updated_at=now()
  returning id into v_id;
  insert into public.notification_preferences(organization_id,user_id) values(v_org,auth.uid()) on conflict do nothing;
  update public.parent_profiles set account_status='active',linked_at=coalesce(linked_at,now()),updated_at=now()
    where organization_id=v_org and user_id=auth.uid() and account_status='invited';
  update public.parent_account_invitations set status='accepted',accepted_at=coalesce(accepted_at,now()),updated_at=now()
    where organization_id=v_org and auth_user_id=auth.uid() and status in ('pending','sent','expired');
  return v_id;
end $$;

create or replace function public.deactivate_push_device(p_installation_id text)
returns integer language plpgsql security definer set search_path=public as $$ declare n integer; begin
  update public.push_devices set is_active=false,invalidated_at=now(),updated_at=now()
  where user_id=auth.uid() and installation_id=p_installation_id and is_active;
  get diagnostics n=row_count; return n;
end $$;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$ declare n integer; begin
  update public.notifications set read_at=coalesce(read_at,now()),is_read=true
  where id=p_notification_id and recipient_user_id=auth.uid()
    and public.has_parent_account_access(parent_id); get diagnostics n=row_count; return n=1;
end $$;
create or replace function public.mark_all_notifications_read()
returns integer language plpgsql security definer set search_path=public as $$ declare n integer; begin
  update public.notifications set read_at=now(),is_read=true
  where recipient_user_id=auth.uid() and read_at is null and public.has_parent_account_access(parent_id);
  get diagnostics n=row_count; return n;
end $$;
create or replace function public.get_unread_notification_count()
returns bigint language sql stable security definer set search_path=public as $$
  select count(*) from public.notifications
  where recipient_user_id=auth.uid() and public.has_parent_account_access(parent_id)
    and read_at is null and (expires_at is null or expires_at>now())
$$;

create or replace function public.get_parent_attendance_summary()
returns table (
  student_id uuid,student_name text,cohort_id uuid,cohort_name text,
  completed_lessons bigint,recorded_lessons bigint,pending_makeup_count bigint,
  scheduled_makeup_count bigint,display_text text
) language sql stable security definer set search_path=public as $$
  select s.student_id,s.student_name,s.cohort_id,s.cohort_name,s.completed_lessons,
    s.recorded_lessons,s.pending_makeup_count,s.scheduled_makeup_count,s.display_text
  from public.parent_exam_attendance_summary s
  where s.parent_user_id=auth.uid()
    and exists (
      select 1 from public.parent_profiles pp
      where pp.user_id=auth.uid() and pp.account_status in ('invited','active')
    )
$$;

create or replace function public.submit_parent_leave_request(p_student_id uuid,p_session_id uuid,p_reason text,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public as $$ declare v_org uuid; v_id uuid; begin
  if not public.is_parent_of_student(p_student_id) then raise exception 'not authorized'; end if;
  select organization_id into v_org from public.students where id=p_student_id;
  if not exists(
    select 1
    from public.lesson_sessions ls
    join public.cohort_students cs on cs.cohort_id=ls.cohort_id
    where ls.id=p_session_id and ls.organization_id=v_org
      and ls.status='scheduled' and ls.starts_at>now()
      and cs.student_id=p_student_id and cs.status='active' and cs.is_active_membership
  ) then raise exception 'session is not available for this student'; end if;
  insert into public.leave_requests(organization_id,student_id,lesson_session_id,requested_by,reason,idempotency_key)
  values(v_org,p_student_id,p_session_id,auth.uid(),p_reason,p_idempotency_key)
  on conflict(organization_id,idempotency_key) do update set reason=excluded.reason,updated_at=now()
  returning id into v_id; return v_id;
end $$;

create or replace function public.get_parent_lesson_sessions(p_student_id uuid)
returns table(session_id uuid,cohort_id uuid,cohort_name text,lesson_title text,starts_at timestamptz,ends_at timestamptz,status text)
language sql stable security definer set search_path=public as $$
  select ls.id,ec.id,ec.name,lp.title,ls.starts_at,ls.ends_at,ls.status
  from public.lesson_sessions ls
  join public.exam_cohorts ec on ec.id=ls.cohort_id and ec.organization_id=ls.organization_id
  join public.lesson_plans lp on lp.id=ls.lesson_plan_id and lp.organization_id=ls.organization_id
  join public.cohort_students cs on cs.cohort_id=ls.cohort_id and cs.organization_id=ls.organization_id
  where public.is_parent_of_student(p_student_id)
    and cs.student_id=p_student_id and cs.status='active' and cs.is_active_membership
    and ls.status='scheduled' and ls.starts_at>now()
  order by ls.starts_at
$$;

create or replace function public.link_parent_auth_account(
  p_organization_id uuid,p_parent_profile_id uuid,p_auth_user_id uuid,p_email text,
  p_idempotency_key text,p_invited_by uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_invitation_id uuid; begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role'
    and coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role'
    and current_user<>'service_role' then raise exception 'service role required'; end if;
  if p_email is null or length(p_email) not between 3 and 254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'invalid parent email'; end if;
  if nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key)>200 then raise exception 'invalid idempotency key'; end if;
  if not exists(select 1 from public.parent_profiles where id=p_parent_profile_id and organization_id=p_organization_id for update) then raise exception 'parent profile not found'; end if;
  if exists(select 1 from public.parent_profiles where user_id=p_auth_user_id and id<>p_parent_profile_id) then raise exception 'auth user already linked to another parent profile'; end if;
  update public.parent_profiles set email=lower(trim(p_email)),user_id=p_auth_user_id,account_status='invited',invited_at=now(),updated_at=now()
    where id=p_parent_profile_id and organization_id=p_organization_id;
  update public.parent_student_links set parent_user_id=p_auth_user_id
    where organization_id=p_organization_id and parent_profile_id=p_parent_profile_id;
  insert into public.parent_account_invitations(organization_id,parent_profile_id,email,auth_user_id,status,idempotency_key,invited_by,sent_at)
    values(p_organization_id,p_parent_profile_id,lower(trim(p_email)),p_auth_user_id,'sent',p_idempotency_key,p_invited_by,now())
    on conflict(organization_id,idempotency_key) do update set email=excluded.email,auth_user_id=excluded.auth_user_id,
      invited_by=excluded.invited_by,status='sent',sent_at=excluded.sent_at,last_error=null,updated_at=now()
    returning id into v_invitation_id;
  return v_invitation_id;
end $$;

create or replace function public.disable_parent_account(p_organization_id uuid,p_parent_profile_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_user_id uuid; begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role'
    and coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role'
    and current_user<>'service_role' then raise exception 'service role required'; end if;
  select user_id into v_user_id from public.parent_profiles
    where id=p_parent_profile_id and organization_id=p_organization_id for update;
  if not found then raise exception 'parent profile not found'; end if;
  update public.parent_profiles set account_status='disabled',updated_at=now()
    where id=p_parent_profile_id and organization_id=p_organization_id;
  update public.parent_account_invitations set status='disabled',disabled_at=now(),updated_at=now()
    where organization_id=p_organization_id and parent_profile_id=p_parent_profile_id
      and status in ('pending','sent','expired','accepted');
  if v_user_id is not null then
    update public.push_devices set is_active=false,invalidated_at=now(),updated_at=now()
      where organization_id=p_organization_id and user_id=v_user_id and is_active;
  end if;
  return true;
end $$;

create or replace function public.publish_notification_announcement(p_organization_id uuid,p_title text,p_body text,p_category text default 'announcement',p_deep_link text default null)
returns jsonb language plpgsql security definer set search_path=public as $$ declare v_id uuid; n integer; begin
  if not public.can_manage_organization(p_organization_id) then raise exception 'not authorized'; end if;
  p_title:=trim(coalesce(p_title,'')); p_body:=trim(coalesce(p_body,'')); p_category:=trim(coalesce(p_category,''));
  if length(p_title) not between 1 and 120 then raise exception 'title must be 1 to 120 characters'; end if;
  if length(p_body) not between 1 and 2000 then raise exception 'body must be 1 to 2000 characters'; end if;
  if p_category not in ('announcement','class_reminder','attendance','leave','makeup','payments','marketing','transactional','security') then raise exception 'invalid notification category'; end if;
  if p_deep_link is not null and p_deep_link !~ '^tecm://(home|bookings|schedule|attendance|leave|makeup|payments|notifications)(/[-A-Za-z0-9_./]*)?$' then raise exception 'invalid deep link'; end if;
  insert into public.notification_announcements(organization_id,title,body,category,deep_link,status,created_by,sent_at)
  values(p_organization_id,p_title,p_body,p_category,p_deep_link,'sent',auth.uid(),now()) returning id into v_id;
  insert into public.notifications(organization_id,parent_id,recipient_user_id,category,title,detail,body,deep_link,entity_type,entity_id,event_key,source,actor_user_id)
  select p_organization_id,pp.id,pp.user_id,p_category,p_title,p_body,p_body,p_deep_link,'announcement',v_id,
    'announcement:'||v_id::text||':'||pp.id::text,'admin',auth.uid()
  from public.parent_profiles pp where pp.organization_id=p_organization_id and pp.user_id is not null and pp.account_status='active';
  get diagnostics n=row_count; update public.notification_announcements set recipient_count=n where id=v_id;
  return jsonb_build_object('announcement_id',v_id,'recipient_count',n);
end $$;

create or replace function public.claim_notification_outbox(p_worker_id text,p_limit int default 25,p_lease_seconds int default 60)
returns table(outbox_id uuid,notification_id uuid,device_id uuid,device_token text,environment text,bundle_id text,title text,body text,category text,deep_link text,attempt_count int)
language plpgsql security definer set search_path=public as $$ begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role'
    and coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role'
    and current_user<>'service_role' then raise exception 'service role required'; end if;
  return query with candidates as (
    select o.id from public.notification_outbox o join public.push_devices d on d.id=o.device_id
    where d.is_active and o.available_at<=now() and (o.status in ('pending','retry') or (o.status='claimed' and o.lease_expires_at<=now()))
    order by o.available_at,o.created_at for update of o skip locked limit greatest(1,least(coalesce(p_limit,25),100))
  ), claimed as (
    update public.notification_outbox o set status='claimed',claimed_at=now(),claimed_by=p_worker_id,
      lease_expires_at=now()+make_interval(secs=>greatest(10,coalesce(p_lease_seconds,60))),attempt_count=o.attempt_count+1,updated_at=now()
    from candidates c where o.id=c.id returning o.*
  ) select c.id,c.notification_id,c.device_id,d.device_token,d.environment,d.bundle_id,n.title,coalesce(n.body,n.detail),n.category,n.deep_link,c.attempt_count
    from claimed c join public.push_devices d on d.id=c.device_id join public.notifications n on n.id=c.notification_id;
end $$;

create or replace function public.complete_notification_delivery(p_outbox_id uuid,p_worker_id text,p_provider_request_id text,p_http_status int,p_delivery_status text default 'delivered')
returns void language plpgsql security definer set search_path=public as $$ declare o public.notification_outbox%rowtype; begin
  if p_delivery_status not in ('delivered','would_send') then raise exception 'invalid delivery status'; end if;
  select * into o from public.notification_outbox where id=p_outbox_id for update;
  if o.status<>'claimed' or o.claimed_by<>p_worker_id then raise exception 'outbox lease not owned'; end if;
  update public.notification_outbox set status=p_delivery_status,
    delivered_at=case when p_delivery_status='delivered' then now() else null end,
    lease_expires_at=null,last_error=null,updated_at=now() where id=o.id;
  insert into public.notification_delivery_attempts(organization_id,outbox_id,notification_id,device_id,provider_request_id,http_status,result)
  values(o.organization_id,o.id,o.notification_id,o.device_id,p_provider_request_id,p_http_status,p_delivery_status);
end $$;

create or replace function public.retry_notification_delivery(p_outbox_id uuid,p_worker_id text,p_http_status int,p_error text,p_retryable bool,p_invalidate_device bool default false)
returns text language plpgsql security definer set search_path=public as $$ declare o public.notification_outbox%rowtype; v_status text; begin
  select * into o from public.notification_outbox where id=p_outbox_id for update;
  if o.status<>'claimed' or o.claimed_by<>p_worker_id then raise exception 'outbox lease not owned'; end if;
  v_status:=case when p_retryable and o.attempt_count<8 then 'retry' else 'dead_letter' end;
  update public.notification_outbox set status=v_status,available_at=case when v_status='retry' then now()+make_interval(secs=>least(3600,(power(2,greatest(0,o.attempt_count-1))*30)::int)) else available_at end,
    lease_expires_at=null,last_error=left(coalesce(p_error,'delivery failed'),500),dead_lettered_at=case when v_status='dead_letter' then now() else null end,updated_at=now() where id=o.id;
  if p_invalidate_device then update public.push_devices set is_active=false,invalidated_at=now(),updated_at=now() where id=o.device_id; end if;
  insert into public.notification_delivery_attempts(organization_id,outbox_id,notification_id,device_id,http_status,result,sanitized_error,retryable)
  values(o.organization_id,o.id,o.notification_id,o.device_id,p_http_status,v_status,left(coalesce(p_error,'delivery failed'),500),p_retryable);
  return v_status;
end $$;

create or replace function public.create_receipt_for_payment()
returns trigger language plpgsql security definer set search_path=public as $$ begin
  if new.status='received' then insert into public.receipts(organization_id,payment_id,guardian_id,receipt_number,amount_minor,currency_code,issued_at)
    values(new.organization_id,new.id,new.guardian_id,'R-'||replace(new.id::text,'-',''),new.amount_minor,new.currency_code,new.received_at) on conflict(payment_id) do nothing; end if; return new;
end $$;
create trigger trg_payments_receipt after insert or update of status on public.payments for each row execute function public.create_receipt_for_payment();
insert into public.receipts(organization_id,payment_id,guardian_id,receipt_number,amount_minor,currency_code,issued_at)
select organization_id,id,guardian_id,'R-'||replace(id::text,'-',''),amount_minor,currency_code,received_at from public.payments where status='received' on conflict(payment_id) do nothing;

-- Keep timestamps reliable for all new mutable tables.
do $$ declare t text; begin
  foreach t in array array['organizations','organization_members','leave_requests','makeup_entitlements','fee_plans','student_packages','charges','parent_account_invitations','push_devices','notification_preferences','notification_announcements','notification_templates','notification_outbox'] loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I',t,t);
    execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',t,t);
  end loop;
end $$;
create index if not exists idx_organization_members_user_active on public.organization_members(user_id,status,organization_id);
create index if not exists idx_leave_requests_parent on public.leave_requests(organization_id,student_id,status,created_at desc);
create index if not exists idx_makeup_entitlements_parent on public.makeup_entitlements(organization_id,student_id,status,created_at desc);
create index if not exists idx_payment_allocations_charge on public.payment_allocations(charge_id);

-- Explicit function privilege allowlist.
do $$ declare sig text; begin for sig in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef loop execute format('revoke all on function %s from public',sig); end loop; end $$;
grant execute on function public.can_access_organization_data(uuid) to authenticated,service_role;
grant execute on function public.has_parent_account_access(uuid) to authenticated,service_role;
grant execute on function public.activate_parent_account() to authenticated;
grant execute on function public.register_push_device(text,text,text,text,text,text) to authenticated;
grant execute on function public.deactivate_push_device(text) to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
grant execute on function public.get_unread_notification_count() to authenticated;
grant execute on function public.submit_parent_leave_request(uuid,uuid,text,text) to authenticated;
grant execute on function public.get_parent_lesson_sessions(uuid) to authenticated;
grant execute on function public.link_parent_auth_account(uuid,uuid,uuid,text,text,uuid) to service_role;
grant execute on function public.disable_parent_account(uuid,uuid) to service_role;
grant execute on function public.publish_notification_announcement(uuid,text,text,text,text) to authenticated,service_role;
grant execute on function public.claim_notification_outbox(text,int,int) to service_role;
grant execute on function public.complete_notification_delivery(uuid,text,text,int,text) to service_role;
grant execute on function public.retry_notification_delivery(uuid,text,int,text,bool,bool) to service_role;

revoke all on public.push_devices,public.notification_preferences,public.notification_outbox,public.notification_delivery_attempts from anon;
grant select,insert,update,delete on public.parent_account_invitations,public.notification_preferences,public.notification_announcements,public.notification_templates,public.receipts to authenticated,service_role;
grant select on public.push_devices,public.notification_outbox,public.notification_delivery_attempts to authenticated;
grant select,insert,update,delete on public.push_devices,public.notification_outbox,public.notification_delivery_attempts to service_role;
grant usage,select on all sequences in schema public to authenticated,service_role;
revoke insert,update,delete on public.notification_outbox,public.notification_delivery_attempts from authenticated;
