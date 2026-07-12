-- Additive education-operations migration. Existing v1 names remain canonical
-- compatibility surfaces for the iOS and Admin Web applications.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  timezone text not null default 'Asia/Macau',
  currency_code text not null default 'MOP' check (currency_code ~ '^[A-Z]{3}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'staff', 'teacher')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

alter table public.organizations add column if not exists low_credit_threshold integer not null default 2 check (low_credit_threshold >= 0);
alter table public.organizations add column if not exists unassigned_makeup_after_days integer not null default 2 check (unassigned_makeup_after_days >= 0);

insert into public.organizations (id, slug, name, timezone, currency_code)
values ('00000000-0000-4000-8000-000000000001', 'tecm-legacy', 'TECM', 'Asia/Macau', 'MOP')
on conflict (id) do nothing;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'staff_roles','parent_profiles','children','campuses','courses','course_tags',
    'news_items','faq_topics','faq_items','bookings','booking_status_logs',
    'follow_up_tasks','notifications','booking_parent_notifications','students',
    'parent_student_links','teacher_profiles','exam_cohorts','cohort_students',
    'lesson_plans','lesson_sessions','attendance_records','makeup_tasks',
    'makeup_sessions','makeup_recommendations'
  ]
  loop
    execute format('alter table public.%I add column if not exists organization_id uuid', table_name);
    execute format(
      'update public.%I set organization_id = %L where organization_id is null',
      table_name, '00000000-0000-4000-8000-000000000001'
    );
    execute format('alter table public.%I alter column organization_id set not null', table_name);
    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', table_name)::regclass
        and conname = table_name || '_organization_id_fkey'
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (organization_id) references public.organizations(id) on delete restrict',
        table_name, table_name || '_organization_id_fkey'
      );
    end if;
    execute format('create index if not exists %I on public.%I(organization_id)', 'idx_' || table_name || '_organization', table_name);
  end loop;
end
$$;

-- Preserve legacy role records while making organization membership canonical.
insert into public.organization_members (organization_id, user_id, role, status)
select organization_id, user_id, role, case when is_active then 'active' else 'inactive' end
from public.staff_roles
on conflict (organization_id, user_id) do update
set role = excluded.role, status = excluded.status, updated_at = now();

alter table public.follow_up_tasks alter column booking_id drop not null;
alter table public.follow_up_tasks add column if not exists task_type text;
alter table public.follow_up_tasks add column if not exists idempotency_key text;
alter table public.follow_up_tasks add column if not exists subject_student_id uuid references public.students(id) on delete set null;
alter table public.follow_up_tasks add column if not exists due_at timestamptz;
create unique index if not exists uq_follow_up_task_idempotency
  on public.follow_up_tasks(organization_id, task_type, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  lesson_session_id uuid references public.lesson_sessions(id) on delete restrict,
  requested_by uuid references auth.users(id) on delete set null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create table if not exists public.makeup_entitlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  leave_request_id uuid unique references public.leave_requests(id) on delete restrict,
  attendance_record_id uuid unique references public.attendance_records(id) on delete restrict,
  units_granted integer not null default 1 check (units_granted > 0),
  units_remaining integer not null default 1 check (units_remaining between 0 and units_granted),
  status text not null default 'available' check (status in ('available','reserved','consumed','expired','cancelled')),
  expires_at timestamptz,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

alter table public.makeup_tasks add column if not exists entitlement_id uuid references public.makeup_entitlements(id) on delete set null;
alter table public.makeup_tasks alter column attendance_record_id drop not null;
create unique index if not exists uq_makeup_task_entitlement on public.makeup_tasks(entitlement_id) where entitlement_id is not null;
alter table public.makeup_sessions add column if not exists entitlement_id uuid references public.makeup_entitlements(id) on delete restrict;
alter table public.makeup_sessions add column if not exists idempotency_key text;
create unique index if not exists uq_makeup_session_idempotency
  on public.makeup_sessions(organization_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists uq_makeup_teacher_slot
  on public.makeup_sessions(organization_id, teacher_id, scheduled_at) where status = 'scheduled';

create table if not exists public.fee_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  course_id uuid references public.courses(id) on delete set null,
  credit_units integer not null check (credit_units > 0),
  amount_minor bigint not null check (amount_minor >= 0),
  currency_code text not null default 'MOP' check (currency_code ~ '^[A-Z]{3}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.student_packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  fee_plan_id uuid not null references public.fee_plans(id) on delete restrict,
  status text not null default 'active' check (status in ('pending','active','exhausted','expired','cancelled')),
  starts_on date not null default current_date,
  expires_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.student_packages add column if not exists idempotency_key text;
create unique index if not exists uq_student_package_idempotency
  on public.student_packages(organization_id, idempotency_key) where idempotency_key is not null;

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  student_package_id uuid not null references public.student_packages(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  delta_units integer not null check (delta_units <> 0),
  entry_type text not null check (entry_type in ('purchase','attendance_deduction','adjustment','refund','reversal')),
  source_type text,
  source_id uuid,
  idempotency_key text not null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create table if not exists public.charges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  student_package_id uuid references public.student_packages(id) on delete set null,
  description text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency_code text not null default 'MOP' check (currency_code ~ '^[A-Z]{3}$'),
  status text not null default 'open' check (status in ('draft','open','partially_paid','paid','void')),
  due_on date,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  guardian_id uuid references public.parent_profiles(id) on delete set null,
  amount_minor bigint not null check (amount_minor > 0),
  currency_code text not null default 'MOP' check (currency_code ~ '^[A-Z]{3}$'),
  method text not null check (method in ('cash','card','bank_transfer','digital_wallet','other')),
  status text not null default 'received' check (status in ('pending','received','refunded','void')),
  received_at timestamptz not null default now(),
  external_reference text,
  idempotency_key text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  charge_id uuid not null references public.charges(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, charge_id)
);

create table if not exists public.communication_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  guardian_id uuid references public.parent_profiles(id) on delete set null,
  student_id uuid references public.students(id) on delete set null,
  channel text not null check (channel in ('in_app','email','sms','whatsapp','wechat','phone','other')),
  direction text not null check (direction in ('outbound','inbound')),
  template_key text,
  body text,
  status text not null default 'queued' check (status in ('queued','sent','delivered','failed','received')),
  idempotency_key text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_user_id uuid,
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_data jsonb,
  new_data jsonb,
  occurred_at timestamptz not null default now()
);

create table if not exists public.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  job_type text not null check (job_type in ('morning_summary','evening_summary','low_credit','overdue_payment','unassigned_makeup','weekly_report')),
  period_key text not null,
  status text not null default 'completed' check (status in ('running','completed','failed')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  last_run_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, job_type, period_key)
);

create index if not exists idx_credit_ledger_package_created on public.credit_ledger(student_package_id, created_at);
create index if not exists idx_charges_student_status on public.charges(organization_id, student_id, status);
create index if not exists idx_payments_received on public.payments(organization_id, received_at desc);
create index if not exists idx_audit_org_time on public.audit_logs(organization_id, occurred_at desc);
