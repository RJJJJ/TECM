-- Batch 1 release blockers: make staff attendance use the same optimistic
-- concurrency/lifecycle identity as teachers, remove direct authenticated DML,
-- and bind payment/intake idempotency keys to canonical server-side payloads.

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function public.operation_payload_fingerprint(payload jsonb)
returns text
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(payload::text, 'UTF8')),
    'hex'
  )
$$;

revoke all on function public.operation_payload_fingerprint(jsonb) from public;
revoke all on function public.operation_payload_fingerprint(jsonb) from anon;
revoke all on function public.operation_payload_fingerprint(jsonb) from authenticated;
revoke all on function public.operation_payload_fingerprint(jsonb) from service_role;

alter table public.payments
  add column if not exists request_fingerprint text;
alter table public.student_packages
  add column if not exists request_fingerprint text;
alter table public.payments
  add column if not exists request_fingerprint_version smallint;
alter table public.student_packages
  add column if not exists request_fingerprint_version smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_request_fingerprint_format'
  ) then
    alter table public.payments
      add constraint payments_request_fingerprint_format
      check (request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.student_packages'::regclass
      and conname = 'student_packages_request_fingerprint_format'
  ) then
    alter table public.student_packages
      add constraint student_packages_request_fingerprint_format
      check (request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_request_fingerprint_provenance'
  ) then
    alter table public.payments
      add constraint payments_request_fingerprint_provenance check (
        (request_fingerprint is null and request_fingerprint_version is null)
        or (request_fingerprint is not null and request_fingerprint_version = 1)
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.student_packages'::regclass
      and conname = 'student_packages_request_fingerprint_provenance'
  ) then
    alter table public.student_packages
      add constraint student_packages_request_fingerprint_provenance check (
        (request_fingerprint is null and request_fingerprint_version is null)
        or (request_fingerprint is not null and request_fingerprint_version = 1)
      );
  end if;
end
$$;

-- Historical rows have no immutable request envelope. Mutable payment,
-- profile, student, and enrollment state is not evidence of the original
-- request, so every pre-Batch-1 row deliberately remains (NULL, NULL). The
-- canonical RPCs fail closed when an existing key has that legacy provenance.

create or replace function public.record_payment(
  target_organization_id uuid,
  target_guardian_id uuid,
  target_charge_id uuid,
  target_amount_minor bigint,
  target_method text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  payment_row public.payments%rowtype;
  charge_row public.charges%rowtype;
  normalized_method text := lower(btrim(coalesce(target_method, '')));
  normalized_key text := btrim(coalesce(target_idempotency_key, ''));
  request_fingerprint text;
  paid bigint;
begin
  if auth.uid() is null then raise exception 'authenticated user required'; end if;
  if not public.can_manage_organization(target_organization_id) then raise exception 'not authorized'; end if;
  if length(normalized_key) not between 1 and 200 then raise exception 'invalid idempotency key'; end if;
  if target_amount_minor is null or target_amount_minor <= 0 then raise exception 'invalid payment amount'; end if;
  if normalized_method not in ('cash','card','bank_transfer','digital_wallet','other') then
    raise exception 'invalid payment method';
  end if;
  if target_charge_id is null then raise exception 'charge not found'; end if;

  request_fingerprint := public.operation_payload_fingerprint(jsonb_build_object(
    'operation', 'record_payment',
    'organization_id', target_organization_id,
    'guardian_id', target_guardian_id,
    'charge_id', target_charge_id,
    'amount_minor', target_amount_minor,
    'method', normalized_method
  ));

  -- The organization/operation/key lock serializes both equal and incompatible
  -- concurrent requests before either one can inspect or create business rows.
  perform pg_advisory_xact_lock(hashtextextended(
    'record-payment:' || target_organization_id::text || ':' || normalized_key,
    0
  ));

  select * into payment_row
  from public.payments
  where organization_id = target_organization_id
    and idempotency_key = normalized_key
  for update;

  if payment_row.id is not null then
    if payment_row.request_fingerprint is null
       or payment_row.request_fingerprint_version is distinct from 1 then
      raise exception 'legacy idempotency key conflict';
    end if;
    if payment_row.request_fingerprint <> request_fingerprint then
      raise exception 'idempotency key payload mismatch';
    end if;
    return payment_row.id;
  end if;

  select * into charge_row
  from public.charges
  where id = target_charge_id
    and organization_id = target_organization_id
  for update;
  if charge_row.id is null then raise exception 'charge not found'; end if;
  if target_guardian_id is not null and not exists (
    select 1 from public.parent_profiles pp
    where pp.id = target_guardian_id
      and pp.organization_id = target_organization_id
  ) then raise exception 'guardian not found'; end if;

  insert into public.payments (
    organization_id, guardian_id, amount_minor, currency_code, method,
    idempotency_key, request_fingerprint, request_fingerprint_version, created_by
  ) values (
    target_organization_id, target_guardian_id, target_amount_minor,
    charge_row.currency_code, normalized_method, normalized_key,
    request_fingerprint, 1, auth.uid()
  ) returning * into payment_row;

  insert into public.payment_allocations (
    organization_id, payment_id, charge_id, amount_minor
  ) values (
    target_organization_id, payment_row.id, target_charge_id, target_amount_minor
  );

  select coalesce(sum(amount_minor), 0) into paid
  from public.payment_allocations
  where charge_id = target_charge_id;
  update public.charges
  set status = case when paid = amount_minor then 'paid' else 'partially_paid' end,
      updated_at = now()
  where id = target_charge_id;
  return payment_row.id;
end
$$;

-- The supported staff contract is intentionally one attendance identity per
-- call. This keeps every operator mutation atomic while using the same lock,
-- null-sentinel, revision, replay, and lifecycle rules as the teacher RPC.
create or replace function public.submit_staff_attendance(
  target_session_id uuid,
  target_student_id uuid,
  target_status text,
  target_expected_revision bigint,
  target_reason text,
  target_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.lesson_sessions%rowtype;
  attendance_row public.attendance_records%rowtype;
  normalized_reason text := btrim(coalesce(target_reason, ''));
  normalized_request_id text := btrim(coalesce(target_request_id, ''));
  request_history jsonb;
  request_seen boolean := false;
begin
  if auth.uid() is null then raise exception 'authenticated user required'; end if;
  if target_status not in ('present', 'absent', 'excused') then raise exception 'invalid attendance status'; end if;
  if target_expected_revision is not null and target_expected_revision < 1 then raise exception 'invalid attendance revision'; end if;
  if length(normalized_request_id) not between 1 and 200 then raise exception 'invalid attendance request id'; end if;

  select * into session_row
  from public.lesson_sessions
  where id = target_session_id;
  if session_row.id is null then raise exception 'lesson session not found'; end if;

  if not pg_try_advisory_xact_lock(hashtextextended(
    'teacher-attendance:' || session_row.organization_id::text || ':' ||
    target_session_id::text || ':' || target_student_id::text,
    0
  )) then raise exception 'attendance update is already in progress'; end if;

  select * into session_row
  from public.lesson_sessions
  where id = target_session_id
  for update;
  if session_row.id is null then raise exception 'lesson session not found'; end if;
  if not exists (
    select 1 from public.organization_members om
    where om.organization_id = session_row.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
      and om.role in ('admin', 'staff')
  ) then raise exception 'staff authorization required'; end if;
  if session_row.status = 'cancelled' then raise exception 'attendance cannot be submitted for a cancelled session'; end if;
  if session_row.starts_at > now() then raise exception 'future session attendance is not allowed'; end if;

  if not exists (
    select 1 from public.students s
    join public.cohort_students cs
      on cs.organization_id = s.organization_id
     and cs.cohort_id = session_row.cohort_id
     and cs.student_id = s.id
     and cs.status = 'active'
    where s.id = target_student_id
      and s.organization_id = session_row.organization_id
      and s.status = 'active'
  ) then raise exception 'student is not active in this session cohort'; end if;

  select * into attendance_row
  from public.attendance_records
  where organization_id = session_row.organization_id
    and session_id = target_session_id
    and student_id = target_student_id
  for update;

  select al.new_data->'attendance_history' into request_history
  from public.audit_logs al
  where al.organization_id = session_row.organization_id
    and al.table_name = 'attendance_records'
    and al.new_data->'attendance_history'->>'session_id' = target_session_id::text
    and al.new_data->'attendance_history'->>'student_id' = target_student_id::text
    and al.new_data->'attendance_history'->>'request_id' = normalized_request_id
  order by al.occurred_at
  limit 1;
  request_seen := found;

  if request_seen then
    if attendance_row.id is null
       or request_history->>'new_status' is distinct from target_status
       or coalesce(request_history->>'reason', '') is distinct from normalized_reason then
      raise exception 'attendance has changed; reload before submitting';
    end if;
    return jsonb_build_object(
      'changed', false,
      'revision', attendance_row.revision,
      'idempotent_replay', true
    );
  end if;

  if attendance_row.id is null then
    if target_expected_revision is not null then
      raise exception 'attendance has changed; reload before submitting';
    end if;
  elsif target_expected_revision is null
        or target_expected_revision <> attendance_row.revision then
    raise exception 'attendance has changed; reload before submitting';
  end if;

  if attendance_row.id is not null and attendance_row.status = target_status then
    return jsonb_build_object('changed', false, 'revision', attendance_row.revision);
  end if;
  if session_row.ends_at < now() and normalized_reason = '' then
    raise exception 'attendance correction reason is required';
  end if;
  if attendance_row.id is not null and (
    exists (
      select 1 from public.leave_requests lr
      where lr.organization_id = session_row.organization_id
        and lr.lesson_session_id = target_session_id
        and lr.student_id = target_student_id
        and lr.status = 'approved'
    )
    or exists (
      select 1 from public.makeup_tasks mt
      where mt.attendance_record_id = attendance_row.id
        and mt.status in ('scheduled', 'completed', 'waived')
    )
    or exists (
      select 1 from public.makeup_entitlements me
      where me.attendance_record_id = attendance_row.id
        and me.status in ('reserved', 'consumed')
    )
  ) then raise exception 'attendance is linked to finalized leave or makeup records'; end if;

  perform set_config('app.teacher_attendance_reason', normalized_reason, true);
  perform set_config('app.teacher_attendance_request_id', normalized_request_id, true);
  if attendance_row.id is null then
    insert into public.attendance_records (
      organization_id, session_id, student_id, status, recorded_by,
      recorded_at, internal_note
    ) values (
      session_row.organization_id, target_session_id, target_student_id,
      target_status, auth.uid(), now(), nullif(normalized_reason, '')
    ) returning * into attendance_row;
  else
    update public.attendance_records
    set status = target_status,
        recorded_by = auth.uid(),
        recorded_at = now(),
        internal_note = nullif(normalized_reason, '')
    where id = attendance_row.id
    returning * into attendance_row;
  end if;
  return jsonb_build_object('changed', true, 'revision', attendance_row.revision);
end
$$;

create or replace function public.create_guardian_student_enrollment_package(
  target_organization_id uuid,
  target_guardian_name text,
  target_guardian_phone text,
  target_student_name text,
  target_school_name text,
  target_cohort_id uuid,
  target_fee_plan_id uuid,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_guardian_name text := btrim(coalesce(target_guardian_name, ''));
  normalized_guardian_phone text := btrim(coalesce(target_guardian_phone, ''));
  normalized_student_name text := btrim(coalesce(target_student_name, ''));
  normalized_school_name text := nullif(btrim(coalesce(target_school_name, '')), '');
  normalized_key text := btrim(coalesce(target_idempotency_key, ''));
  request_fingerprint text;
  v_guardian_id uuid;
  v_child_id uuid;
  v_student_id uuid;
  v_package_id uuid;
  v_charge_id uuid;
  existing_fingerprint text;
  existing_fingerprint_version smallint;
  plan_row public.fee_plans%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated user required'; end if;
  if not public.can_manage_organization(target_organization_id) then raise exception 'not authorized'; end if;
  if length(normalized_key) not between 1 and 200 then raise exception 'invalid idempotency key'; end if;
  if normalized_guardian_name = '' or normalized_guardian_phone = '' or normalized_student_name = '' then
    raise exception 'invalid intake payload';
  end if;
  if target_cohort_id is null or target_fee_plan_id is null then raise exception 'invalid intake payload'; end if;

  request_fingerprint := public.operation_payload_fingerprint(jsonb_build_object(
    'operation', 'create_guardian_student_enrollment_package',
    'organization_id', target_organization_id,
    'guardian_name', normalized_guardian_name,
    'guardian_phone', normalized_guardian_phone,
    'student_name', normalized_student_name,
    'school_name', normalized_school_name,
    'cohort_id', target_cohort_id,
    'fee_plan_id', target_fee_plan_id
  ));

  perform pg_advisory_xact_lock(hashtextextended(
    'intake-package:' || target_organization_id::text || ':' || normalized_key,
    0
  ));

  select sp.id, sp.student_id, sp.request_fingerprint, sp.request_fingerprint_version
    into v_package_id, v_student_id, existing_fingerprint, existing_fingerprint_version
  from public.student_packages sp
  where sp.organization_id = target_organization_id
    and sp.idempotency_key = normalized_key
  for update;

  if v_package_id is not null then
    if existing_fingerprint is null or existing_fingerprint_version is distinct from 1 then
      raise exception 'legacy idempotency key conflict';
    end if;
    if existing_fingerprint <> request_fingerprint then
      raise exception 'idempotency key payload mismatch';
    end if;

    if v_guardian_id is null then
      select psl.parent_profile_id into v_guardian_id
      from public.parent_student_links psl
      where psl.organization_id = target_organization_id
        and psl.student_id = v_student_id
      order by psl.created_at, psl.id
      limit 1;
    end if;
    select c.id into v_charge_id
    from public.charges c
    where c.organization_id = target_organization_id
      and c.idempotency_key = 'charge:' || normalized_key;
    return jsonb_build_object(
      'ok', true,
      'guardian_id', v_guardian_id,
      'student_id', v_student_id,
      'package_id', v_package_id,
      'charge_id', v_charge_id,
      'status', 'existing'
    );
  end if;

  if not exists (
    select 1 from public.exam_cohorts ec
    where ec.id = target_cohort_id
      and ec.organization_id = target_organization_id
      and ec.status = 'active'
  ) then raise exception 'cohort not found'; end if;
  select * into plan_row
  from public.fee_plans fp
  where fp.id = target_fee_plan_id
    and fp.organization_id = target_organization_id
    and fp.is_active;
  if plan_row.id is null then raise exception 'fee plan not found'; end if;

  insert into public.parent_profiles (organization_id, full_name, phone)
  values (target_organization_id, normalized_guardian_name, normalized_guardian_phone)
  returning id into v_guardian_id;
  insert into public.children (organization_id, parent_id, child_name, school_name)
  values (target_organization_id, v_guardian_id, normalized_student_name, normalized_school_name)
  returning id into v_child_id;
  insert into public.students (organization_id, child_id, display_name, school_name)
  values (target_organization_id, v_child_id, normalized_student_name, normalized_school_name)
  returning id into v_student_id;
  insert into public.parent_student_links (organization_id, parent_profile_id, student_id)
  values (target_organization_id, v_guardian_id, v_student_id);
  insert into public.cohort_students (organization_id, cohort_id, student_id, status)
  values (target_organization_id, target_cohort_id, v_student_id, 'active');
  insert into public.student_packages (
    organization_id, student_id, fee_plan_id, status, idempotency_key,
    request_fingerprint, request_fingerprint_version
  ) values (
    target_organization_id, v_student_id, target_fee_plan_id, 'active',
    normalized_key, request_fingerprint, 1
  ) returning id into v_package_id;
  insert into public.credit_ledger (
    organization_id, student_package_id, student_id, delta_units, entry_type,
    source_type, source_id, idempotency_key, created_by
  ) values (
    target_organization_id, v_package_id, v_student_id, plan_row.credit_units,
    'purchase', 'student_packages', v_package_id,
    'package:' || normalized_key, auth.uid()
  );
  insert into public.charges (
    organization_id, student_id, student_package_id, description, amount_minor,
    currency_code, status, due_on, idempotency_key
  ) values (
    target_organization_id, v_student_id, v_package_id, plan_row.name,
    plan_row.amount_minor, plan_row.currency_code, 'open', current_date,
    'charge:' || normalized_key
  ) returning id into v_charge_id;
  return jsonb_build_object(
    'ok', true,
    'guardian_id', v_guardian_id,
    'student_id', v_student_id,
    'package_id', v_package_id,
    'charge_id', v_charge_id,
    'status', 'created'
  );
end
$$;

-- No authenticated direct DML or unversioned RPC may remain as a supported
-- attendance path. Staff and teachers retain tenant-safe SELECT visibility.
drop policy if exists attendance_staff_manage on public.attendance_records;
drop policy if exists attendance_staff_read on public.attendance_records;
create policy attendance_staff_read
on public.attendance_records for select
using (public.can_manage_organization(organization_id));

revoke insert, update, delete on table public.attendance_records from public;
revoke insert, update, delete on table public.attendance_records from anon;
revoke insert, update, delete on table public.attendance_records from authenticated;
grant select on table public.attendance_records to authenticated;
grant select, insert, update, delete on table public.attendance_records to service_role;

-- Root operation identity and the payment allocation payload are writable only
-- by the migration owner / SECURITY DEFINER RPCs and trusted service-role code.
-- RLS still governs retained authenticated reads, but cannot substitute for
-- these object privileges.
revoke insert, update, delete on table public.payments, public.student_packages, public.payment_allocations from public;
revoke insert, update, delete on table public.payments, public.student_packages, public.payment_allocations from anon;
revoke insert, update, delete on table public.payments, public.student_packages, public.payment_allocations from authenticated;
grant select on table public.payments, public.student_packages, public.payment_allocations to authenticated;
grant select, insert, update, delete on table public.payments, public.student_packages, public.payment_allocations to service_role;

revoke all on function public.record_payment(uuid,uuid,uuid,bigint,text,text) from public;
revoke all on function public.record_payment(uuid,uuid,uuid,bigint,text,text) from anon;
revoke all on function public.record_payment(uuid,uuid,uuid,bigint,text,text) from authenticated;
revoke all on function public.record_payment(uuid,uuid,uuid,bigint,text,text) from service_role;
grant execute on function public.record_payment(uuid,uuid,uuid,bigint,text,text) to authenticated, service_role;

revoke all on function public.create_guardian_student_enrollment_package(uuid,text,text,text,text,uuid,uuid,text) from public;
revoke all on function public.create_guardian_student_enrollment_package(uuid,text,text,text,text,uuid,uuid,text) from anon;
revoke all on function public.create_guardian_student_enrollment_package(uuid,text,text,text,text,uuid,uuid,text) from authenticated;
revoke all on function public.create_guardian_student_enrollment_package(uuid,text,text,text,text,uuid,uuid,text) from service_role;
grant execute on function public.create_guardian_student_enrollment_package(uuid,text,text,text,text,uuid,uuid,text) to authenticated, service_role;

drop function if exists public.submit_staff_attendance(uuid,jsonb,text);

revoke all on function public.submit_staff_attendance(uuid,uuid,text,bigint,text,text) from public;
revoke all on function public.submit_staff_attendance(uuid,uuid,text,bigint,text,text) from anon;
revoke all on function public.submit_staff_attendance(uuid,uuid,text,bigint,text,text) from authenticated;
revoke all on function public.submit_staff_attendance(uuid,uuid,text,bigint,text,text) from service_role;
grant execute on function public.submit_staff_attendance(uuid,uuid,text,bigint,text,text) to authenticated;

drop function if exists public.submit_attendance(uuid,jsonb);

reset lock_timeout;
reset statement_timeout;
