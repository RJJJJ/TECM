\set ON_ERROR_STOP on

insert into public.lesson_sessions (
  id, cohort_id, lesson_plan_id, teacher_id, starts_at, ends_at, status, organization_id
) values
  ('1d000000-0000-4000-8000-000000000031','1a000000-0000-4000-8000-000000000001','1c000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001',now()-interval '2 hours',now()-interval '1 hour','completed','10000000-0000-4000-8000-000000000000'),
  ('1d000000-0000-4000-8000-000000000032','1a000000-0000-4000-8000-000000000001','1c000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001',now()-interval '2 hours',now()-interval '1 hour','completed','10000000-0000-4000-8000-000000000000'),
  ('1d000000-0000-4000-8000-000000000033','1a000000-0000-4000-8000-000000000001','1c000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001',now()-interval '2 hours',now()-interval '1 hour','completed','10000000-0000-4000-8000-000000000000')
on conflict (id) do update set starts_at=excluded.starts_at,ends_at=excluded.ends_at,status=excluded.status;

delete from public.attendance_records
where session_id in (
  '1d000000-0000-4000-8000-000000000031',
  '1d000000-0000-4000-8000-000000000032',
  '1d000000-0000-4000-8000-000000000033'
);
insert into public.attendance_records (
  organization_id,session_id,student_id,status,recorded_by,recorded_at
) values
  ('10000000-0000-4000-8000-000000000000','1d000000-0000-4000-8000-000000000032','15000000-0000-4000-8000-000000000001','present','10000000-0000-4000-8000-000000000001',statement_timestamp()),
  ('10000000-0000-4000-8000-000000000000','1d000000-0000-4000-8000-000000000033','15000000-0000-4000-8000-000000000001','present','10000000-0000-4000-8000-000000000001',statement_timestamp());

insert into public.charges (
  id,organization_id,student_id,description,amount_minor,currency_code,status,due_on,idempotency_key
) values
  ('41000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000000','15000000-0000-4000-8000-000000000001','race payment same',1000000,'MOP','open',current_date,'race-payment-charge-same'),
  ('41000000-0000-4000-8000-000000000022','10000000-0000-4000-8000-000000000000','15000000-0000-4000-8000-000000000001','race payment different',1000000,'MOP','open',current_date,'race-payment-charge-different')
on conflict (id) do update set amount_minor=excluded.amount_minor,status='open';

create table if not exists public.__test_batch1_effect_baseline (
  race text primary key,
  notification_count bigint not null,
  outbox_count bigint not null,
  credit_count bigint not null,
  leave_count bigint not null,
  entitlement_count bigint not null
);
alter table public.__test_batch1_effect_baseline add column if not exists credit_count bigint not null default 0;
alter table public.__test_batch1_effect_baseline add column if not exists leave_count bigint not null default 0;
alter table public.__test_batch1_effect_baseline add column if not exists entitlement_count bigint not null default 0;
insert into public.__test_batch1_effect_baseline(race,notification_count,outbox_count,credit_count,leave_count,entitlement_count)
select race,(select count(*) from public.notifications),(select count(*) from public.notification_outbox),
  (
    select count(*)
    from public.credit_ledger cl
    join public.attendance_records ar
      on cl.source_type='attendance_records'
     and cl.source_id=ar.id
    where ar.session_id=case race
      when 'staff-absent' then '1d000000-0000-4000-8000-000000000031'::uuid
      when 'staff-existing' then '1d000000-0000-4000-8000-000000000032'::uuid
      when 'staff-cross-role' then '1d000000-0000-4000-8000-000000000033'::uuid
    end
      and ar.student_id='15000000-0000-4000-8000-000000000001'
  ),
  (select count(*) from public.leave_requests),
  (select count(*) from public.makeup_entitlements)
from (values ('staff-existing'),('staff-absent'),('staff-cross-role')) names(race)
on conflict(race) do update set notification_count=excluded.notification_count,outbox_count=excluded.outbox_count,
  credit_count=excluded.credit_count,leave_count=excluded.leave_count,entitlement_count=excluded.entitlement_count;

create table if not exists public.__test_batch1_worker_results (
  race text not null,
  worker text not null check (worker in ('first','second')),
  operation text not null check (operation in ('payment','intake')),
  outcome text not null check (outcome in ('committed','rejected')),
  sqlstate text,
  classification text not null check (classification in (
    'committed','idempotency_payload_mismatch','unique_violation','unexpected_sql_failure'
  )),
  error_identifier text,
  payload_identity text not null,
  fingerprint_classification text not null,
  result_id uuid,
  recorded_at timestamptz not null default statement_timestamp(),
  primary key (race,worker),
  check (
    (outcome='committed' and classification='committed' and sqlstate is null
      and error_identifier is null and result_id is not null)
    or
    (outcome='rejected' and classification<>'committed' and sqlstate is not null
      and result_id is null)
  )
);
truncate table public.__test_batch1_worker_results;
revoke all on table public.__test_batch1_worker_results from public,anon,authenticated;
grant insert,select on table public.__test_batch1_worker_results to authenticated;
grant select,insert,update,delete on table public.__test_batch1_worker_results to service_role;

create table if not exists public.__test_batch1_operation_baseline (
  race text primary key,
  audit_count bigint not null,
  notification_count bigint not null,
  outbox_count bigint not null,
  receipt_count bigint not null,
  payment_count bigint not null,
  allocation_count bigint not null,
  parent_count bigint not null,
  child_count bigint not null,
  student_count bigint not null,
  parent_link_count bigint not null,
  cohort_count bigint not null,
  package_count bigint not null,
  credit_count bigint not null,
  charge_count bigint not null
);
truncate table public.__test_batch1_operation_baseline;
