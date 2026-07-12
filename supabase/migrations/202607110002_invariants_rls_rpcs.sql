create or replace function public.can_access_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members om
    where om.organization_id = target_organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
$$;

create or replace function public.can_manage_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members om
    where om.organization_id = target_organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
      and om.role in ('admin','staff')
  )
$$;

create or replace function public.is_organization_admin(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members om
    where om.organization_id = target_organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
      and om.role = 'admin'
  )
$$;

-- Add an AND-composed organization boundary without removing compatible legacy
-- persona policies. FORCE RLS also protects table-owner application roles.
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
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('drop policy if exists tenant_boundary on public.%I', table_name);
    execute format(
      'create policy tenant_boundary on public.%I as restrictive for all using (public.can_access_organization(organization_id)) with check (public.can_access_organization(organization_id))',
      table_name
    );
  end loop;
end
$$;

drop policy if exists staff_roles_admin_manage on public.staff_roles;
create policy staff_roles_admin_manage on public.staff_roles
for all
using (public.is_organization_admin(organization_id))
with check (public.is_organization_admin(organization_id));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organizations','organization_members','leave_requests','makeup_entitlements',
    'fee_plans','student_packages','credit_ledger','charges','payments',
    'payment_allocations','communication_logs','audit_logs','automation_jobs'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end
$$;

create policy organizations_member_read on public.organizations for select
using (public.can_access_organization(id));
create policy organizations_admin_update on public.organizations for update
using (public.is_organization_admin(id)) with check (public.is_organization_admin(id));

create policy organization_members_member_read on public.organization_members for select
using (public.can_access_organization(organization_id));
create policy organization_members_admin_insert on public.organization_members for insert
with check (public.is_organization_admin(organization_id));
create policy organization_members_admin_update on public.organization_members for update
using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id));
create policy organization_members_admin_delete on public.organization_members for delete
using (public.is_organization_admin(organization_id));

create or replace function public.enforce_tenant_foreign_keys()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  argument_index integer := 0;
  reference_value text;
  reference_organization_id uuid;
begin
  if mod(TG_NARGS,2) <> 0 then raise exception 'tenant FK trigger arguments must be column/table pairs'; end if;
  while argument_index < TG_NARGS loop
    reference_value := to_jsonb(new)->>TG_ARGV[argument_index];
    if reference_value is not null then
      execute format('select organization_id from public.%I where id=$1',TG_ARGV[argument_index+1])
        into reference_organization_id using reference_value::uuid;
      if reference_organization_id is null then
        raise exception using errcode='23514', message=format('%s reference %s was not found',TG_ARGV[argument_index],reference_value);
      end if;
      if reference_organization_id <> new.organization_id then
        raise exception using errcode='23514', message=format('cross-organization reference denied for %s',TG_ARGV[argument_index]);
      end if;
    end if;
    argument_index := argument_index+2;
  end loop;
  return new;
end
$$;

do $$
declare
  relation_spec record;
  trigger_arguments text;
begin
  for relation_spec in select * from (values
    ('children',array['parent_id','parent_profiles']),
    ('courses',array['campus_id','campuses']),
    ('course_tags',array['course_id','courses']),
    ('faq_items',array['topic_id','faq_topics']),
    ('bookings',array['parent_id','parent_profiles','child_id','children','course_id','courses','campus_id','campuses']),
    ('booking_status_logs',array['booking_id','bookings']),
    ('follow_up_tasks',array['booking_id','bookings','subject_student_id','students']),
    ('notifications',array['parent_id','parent_profiles']),
    ('booking_parent_notifications',array['booking_id','bookings','notification_id','notifications']),
    ('students',array['child_id','children']),
    ('parent_student_links',array['parent_profile_id','parent_profiles','student_id','students']),
    ('exam_cohorts',array['course_id','courses','campus_id','campuses','lead_teacher_id','teacher_profiles']),
    ('cohort_students',array['cohort_id','exam_cohorts','student_id','students']),
    ('lesson_plans',array['cohort_id','exam_cohorts']),
    ('lesson_sessions',array['cohort_id','exam_cohorts','lesson_plan_id','lesson_plans','teacher_id','teacher_profiles']),
    ('attendance_records',array['session_id','lesson_sessions','student_id','students']),
    ('makeup_tasks',array['student_id','students','cohort_id','exam_cohorts','lesson_plan_id','lesson_plans','original_session_id','lesson_sessions','attendance_record_id','attendance_records','entitlement_id','makeup_entitlements']),
    ('makeup_sessions',array['makeup_task_id','makeup_tasks','entitlement_id','makeup_entitlements','student_id','students','teacher_id','teacher_profiles']),
    ('makeup_recommendations',array['makeup_task_id','makeup_tasks','recommended_session_id','lesson_sessions']),
    ('leave_requests',array['student_id','students','lesson_session_id','lesson_sessions']),
    ('makeup_entitlements',array['student_id','students','leave_request_id','leave_requests','attendance_record_id','attendance_records']),
    ('fee_plans',array['course_id','courses']),
    ('student_packages',array['student_id','students','fee_plan_id','fee_plans']),
    ('credit_ledger',array['student_package_id','student_packages','student_id','students']),
    ('charges',array['student_id','students','student_package_id','student_packages']),
    ('payments',array['guardian_id','parent_profiles']),
    ('payment_allocations',array['payment_id','payments','charge_id','charges']),
    ('communication_logs',array['guardian_id','parent_profiles','student_id','students'])
  ) as specs(table_name,arguments)
  loop
    select string_agg(quote_literal(argument),',') into trigger_arguments from unnest(relation_spec.arguments) argument;
    execute format('drop trigger if exists trg_%I_tenant_fk on public.%I',relation_spec.table_name,relation_spec.table_name);
    execute format('create trigger trg_%I_tenant_fk before insert or update on public.%I for each row execute function public.enforce_tenant_foreign_keys(%s)',relation_spec.table_name,relation_spec.table_name,trigger_arguments);
  end loop;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'leave_requests','makeup_entitlements','fee_plans','student_packages',
    'credit_ledger','charges','payments','payment_allocations',
    'communication_logs','audit_logs','automation_jobs'
  ]
  loop
    execute format('create policy org_staff_read on public.%I for select using (public.can_manage_organization(organization_id))', table_name);
    execute format('create policy org_staff_insert on public.%I for insert with check (public.can_manage_organization(organization_id))', table_name);
    execute format('create policy org_staff_update on public.%I for update using (public.can_manage_organization(organization_id)) with check (public.can_manage_organization(organization_id))', table_name);
    execute format('create policy org_staff_delete on public.%I for delete using (public.can_manage_organization(organization_id))', table_name);
  end loop;
end
$$;

create or replace function public.reject_append_only_mutation()
returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end
$$;

drop trigger if exists trg_credit_ledger_append_only on public.credit_ledger;
create trigger trg_credit_ledger_append_only before update or delete on public.credit_ledger
for each row execute function public.reject_append_only_mutation();
drop trigger if exists trg_audit_logs_append_only on public.audit_logs;
create trigger trg_audit_logs_append_only before update or delete on public.audit_logs
for each row execute function public.reject_append_only_mutation();

create or replace function public.capture_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_json jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  new_json jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  org_id uuid := coalesce((new_json->>'organization_id')::uuid, (old_json->>'organization_id')::uuid);
  row_id text := coalesce(new_json->>'id', old_json->>'id');
begin
  insert into public.audit_logs (organization_id, actor_user_id, table_name, record_id, action, old_data, new_data)
  values (org_id, auth.uid(), tg_table_name, row_id, tg_op, old_json, new_json);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organization_members','cohort_students','attendance_records','leave_requests',
    'makeup_entitlements','makeup_tasks','makeup_sessions','student_packages',
    'credit_ledger','charges','payments','payment_allocations','communication_logs','follow_up_tasks'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', 'trg_' || table_name || '_audit', table_name);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.capture_audit_log()', 'trg_' || table_name || '_audit', table_name);
  end loop;
end
$$;

create or replace function public.validate_attendance_enrollment()
returns trigger language plpgsql set search_path = public as $$
declare
  session_org uuid;
  session_cohort uuid;
begin
  select organization_id, cohort_id into session_org, session_cohort
  from public.lesson_sessions where id = new.session_id;
  if session_org is null or session_org <> new.organization_id then
    raise exception 'attendance organization does not match session';
  end if;
  if not exists (
    select 1 from public.cohort_students cs
    where cs.organization_id = new.organization_id
      and cs.cohort_id = session_cohort
      and cs.student_id = new.student_id
      and cs.status = 'active'
  ) then
    raise exception 'student is not actively enrolled in session cohort';
  end if;
  return new;
end
$$;

drop trigger if exists trg_attendance_validate_enrollment on public.attendance_records;
create trigger trg_attendance_validate_enrollment before insert or update of session_id, student_id, organization_id
on public.attendance_records for each row execute function public.validate_attendance_enrollment();

create or replace function public.ensure_makeup_task_for_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.lesson_sessions%rowtype;
begin
  if new.status in ('absent', 'excused') then
    select * into session_row from public.lesson_sessions where id = new.session_id;
    insert into public.makeup_tasks (
      organization_id, student_id, cohort_id, lesson_plan_id, original_session_id,
      attendance_record_id, missed_status, status, parent_visible_summary
    ) values (
      new.organization_id, new.student_id, session_row.cohort_id, session_row.lesson_plan_id,
      new.session_id, new.id, new.status, 'pending', '需要補課：1 堂'
    ) on conflict (attendance_record_id) do update set
      missed_status = excluded.missed_status,
      status = case when public.makeup_tasks.status in ('completed','waived','cancelled')
        then public.makeup_tasks.status else 'pending' end,
      updated_at = now();
  elsif new.status = 'makeup_completed' then
    update public.makeup_tasks set status = 'completed', updated_at = now()
    where attendance_record_id = new.id;
  elsif new.status = 'present' then
    update public.makeup_tasks set status = 'cancelled', updated_at = now()
    where attendance_record_id = new.id and status in ('pending','recommended','scheduled');
  end if;
  return new;
end
$$;

create or replace function public.post_attendance_credit_deduction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  package_id uuid;
  current_delta integer;
  desired_delta integer;
  adjustment integer;
  ledger_key text;
begin
  desired_delta := case when new.status = 'present' then -1 else 0 end;
  select coalesce(sum(delta_units),0)::integer into current_delta
  from public.credit_ledger
  where organization_id=new.organization_id and source_type='attendance_records' and source_id=new.id;
  adjustment := desired_delta-current_delta;
  if adjustment=0 then return new; end if;

  select student_package_id into package_id from public.credit_ledger
  where organization_id=new.organization_id and source_type='attendance_records' and source_id=new.id
  order by created_at desc limit 1;
  if package_id is null then
    select sp.id into package_id
    from public.student_packages sp
    where sp.organization_id = new.organization_id
      and sp.student_id = new.student_id
      and sp.status = 'active'
      and (sp.expires_on is null or sp.expires_on >= current_date)
      and (select coalesce(sum(cl.delta_units), 0) from public.credit_ledger cl where cl.student_package_id = sp.id) > 0
    order by sp.expires_on nulls last, sp.created_at
    limit 1
    for update;
  else
    perform 1 from public.student_packages where id=package_id for update;
  end if;

  if package_id is null then raise exception 'student has no available lesson credit'; end if;
  if adjustment < 0 and (select coalesce(sum(delta_units),0) from public.credit_ledger where student_package_id=package_id) < abs(adjustment) then
    raise exception 'student has no available lesson credit';
  end if;
  ledger_key := case when not exists (
    select 1 from public.credit_ledger where organization_id=new.organization_id and source_type='attendance_records' and source_id=new.id
  ) then 'attendance:' || new.id::text
  else 'attendance-adjust:' || new.id::text || ':' || floor(extract(epoch from new.updated_at)*1000000)::bigint::text end;
  insert into public.credit_ledger (
    organization_id, student_package_id, student_id, delta_units, entry_type,
    source_type, source_id, idempotency_key, created_by, note
  ) values (
    new.organization_id, package_id, new.student_id, adjustment,
    case when adjustment < 0 then 'attendance_deduction' else 'reversal' end,
    'attendance_records', new.id, ledger_key, auth.uid(),
    case when adjustment < 0 then '點名扣堂' else '點名狀態更正退回堂數' end
  ) on conflict (organization_id, idempotency_key) do nothing;
  return new;
end
$$;

drop trigger if exists trg_attendance_credit_deduction on public.attendance_records;
create trigger trg_attendance_credit_deduction after insert or update of status on public.attendance_records
for each row execute function public.post_attendance_credit_deduction();

create or replace function public.decide_leave_request(target_leave_request_id uuid, target_status text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  leave_row public.leave_requests%rowtype;
  entitlement_id uuid;
begin
  if target_status not in ('approved','rejected','cancelled') then raise exception 'invalid leave decision'; end if;
  select * into leave_row from public.leave_requests where id = target_leave_request_id for update;
  if leave_row.id is null then raise exception 'leave request not found'; end if;
  if not public.can_manage_organization(leave_row.organization_id) then raise exception 'not authorized'; end if;
  if leave_row.status <> 'pending' and leave_row.status <> target_status then raise exception 'leave request already decided'; end if;

  update public.leave_requests set status = target_status, reviewed_by = auth.uid(), decided_at = now(), updated_at = now()
  where id = leave_row.id;
  if target_status = 'approved' then
    insert into public.makeup_entitlements (
      organization_id, student_id, leave_request_id, units_granted, units_remaining, status, idempotency_key
    ) values (
      leave_row.organization_id, leave_row.student_id, leave_row.id, 1, 1, 'available', 'leave:' || leave_row.id::text
    ) on conflict (organization_id, idempotency_key) do update set updated_at = public.makeup_entitlements.updated_at
    returning id into entitlement_id;
    insert into public.communication_logs (
      organization_id, student_id, channel, direction, template_key, body, status, idempotency_key
    ) values (
      leave_row.organization_id, leave_row.student_id, 'whatsapp', 'outbound', 'leave_approved',
      '你好，學生嘅請假已經批核，系統已保留 1 堂補課資格。我哋安排好補課時間後會再同你確認；此訊息請由職員核對後人工發送。',
      'queued', 'leave-approved:' || leave_row.id::text
    ) on conflict (organization_id, idempotency_key) do update
      set body=excluded.body, status='queued';
  end if;
  return entitlement_id;
end
$$;

create or replace function public.validate_payment_allocation()
returns trigger language plpgsql set search_path = public as $$
declare
  payment_row public.payments%rowtype;
  charge_row public.charges%rowtype;
  payment_used bigint;
  charge_paid bigint;
begin
  select * into payment_row from public.payments where id = new.payment_id;
  select * into charge_row from public.charges where id = new.charge_id;
  if payment_row.organization_id <> new.organization_id or charge_row.organization_id <> new.organization_id then
    raise exception 'cross-organization payment allocation';
  end if;
  if payment_row.currency_code <> charge_row.currency_code then raise exception 'currency mismatch'; end if;
  select coalesce(sum(amount_minor),0) into payment_used from public.payment_allocations where payment_id = new.payment_id and id <> new.id;
  select coalesce(sum(amount_minor),0) into charge_paid from public.payment_allocations where charge_id = new.charge_id and id <> new.id;
  if payment_used + new.amount_minor > payment_row.amount_minor then raise exception 'allocation exceeds payment'; end if;
  if charge_paid + new.amount_minor > charge_row.amount_minor then raise exception 'allocation exceeds charge'; end if;
  return new;
end
$$;

drop trigger if exists trg_payment_allocation_validate on public.payment_allocations;
create trigger trg_payment_allocation_validate before insert or update on public.payment_allocations
for each row execute function public.validate_payment_allocation();

create or replace function public.record_payment(
  target_organization_id uuid, target_guardian_id uuid, target_charge_id uuid,
  target_amount_minor bigint, target_method text, target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  payment_id uuid;
  charge_row public.charges%rowtype;
  paid bigint;
begin
  if not public.can_manage_organization(target_organization_id) then raise exception 'not authorized'; end if;
  select * into charge_row from public.charges where id = target_charge_id and organization_id = target_organization_id for update;
  if charge_row.id is null then raise exception 'charge not found'; end if;
  select id into payment_id from public.payments
    where organization_id = target_organization_id and idempotency_key = target_idempotency_key;
  if payment_id is not null then return payment_id; end if;
  insert into public.payments (organization_id, guardian_id, amount_minor, currency_code, method, idempotency_key, created_by)
  values (target_organization_id, target_guardian_id, target_amount_minor, charge_row.currency_code, target_method, target_idempotency_key, auth.uid())
  returning id into payment_id;
  insert into public.payment_allocations (organization_id, payment_id, charge_id, amount_minor)
  values (target_organization_id, payment_id, target_charge_id, target_amount_minor);
  select coalesce(sum(amount_minor),0) into paid from public.payment_allocations where charge_id = target_charge_id;
  update public.charges set status = case when paid = amount_minor then 'paid' else 'partially_paid' end, updated_at = now()
  where id = target_charge_id;
  return payment_id;
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
set search_path = public
as $$
declare
  v_guardian_id uuid;
  v_child_id uuid;
  v_student_id uuid;
  v_package_id uuid;
  v_charge_id uuid;
  plan_row public.fee_plans%rowtype;
begin
  if not public.can_manage_organization(target_organization_id) then raise exception 'not authorized'; end if;
  select sp.id, sp.student_id into v_package_id, v_student_id
  from public.student_packages sp
  where sp.organization_id = target_organization_id and sp.idempotency_key = target_idempotency_key;
  if v_package_id is not null then
    select psl.parent_profile_id into v_guardian_id from public.parent_student_links psl
    where psl.organization_id = target_organization_id and psl.student_id = v_student_id limit 1;
    select c.id into v_charge_id from public.charges c where c.organization_id=target_organization_id and c.idempotency_key='charge:' || target_idempotency_key;
    return jsonb_build_object('ok',true,'guardian_id',v_guardian_id,'student_id',v_student_id,'package_id',v_package_id,'charge_id',v_charge_id,'status','existing');
  end if;
  if not exists (select 1 from public.exam_cohorts where id=target_cohort_id and organization_id=target_organization_id) then
    raise exception 'cohort not found';
  end if;
  select * into plan_row from public.fee_plans where id=target_fee_plan_id and organization_id=target_organization_id and is_active;
  if plan_row.id is null then raise exception 'fee plan not found'; end if;

  insert into public.parent_profiles (organization_id, full_name, phone)
  values (target_organization_id, target_guardian_name, target_guardian_phone) returning id into v_guardian_id;
  insert into public.children (organization_id, parent_id, child_name, school_name)
  values (target_organization_id, v_guardian_id, target_student_name, target_school_name) returning id into v_child_id;
  insert into public.students (organization_id, child_id, display_name, school_name)
  values (target_organization_id, v_child_id, target_student_name, target_school_name) returning id into v_student_id;
  insert into public.parent_student_links (organization_id, parent_profile_id, student_id)
  values (target_organization_id, v_guardian_id, v_student_id);
  insert into public.cohort_students (organization_id, cohort_id, student_id, status)
  values (target_organization_id, target_cohort_id, v_student_id, 'active');
  insert into public.student_packages (organization_id, student_id, fee_plan_id, status, idempotency_key)
  values (target_organization_id, v_student_id, target_fee_plan_id, 'active', target_idempotency_key)
  returning id into v_package_id;
  insert into public.credit_ledger (
    organization_id, student_package_id, student_id, delta_units, entry_type,
    source_type, source_id, idempotency_key, created_by
  ) values (
    target_organization_id, v_package_id, v_student_id, plan_row.credit_units, 'purchase',
    'student_packages', v_package_id, 'package:' || target_idempotency_key, auth.uid()
  );
  insert into public.charges (
    organization_id, student_id, student_package_id, description, amount_minor,
    currency_code, status, due_on, idempotency_key
  ) values (
    target_organization_id, v_student_id, v_package_id, plan_row.name, plan_row.amount_minor,
    plan_row.currency_code, 'open', current_date, 'charge:' || target_idempotency_key
  ) returning id into v_charge_id;
  return jsonb_build_object('ok',true,'guardian_id',v_guardian_id,'student_id',v_student_id,'package_id',v_package_id,'charge_id',v_charge_id,'status','created');
end
$$;

create or replace function public.book_makeup_session(
  target_organization_id uuid,
  target_entitlement_id uuid,
  target_teacher_id uuid,
  target_scheduled_at timestamptz,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  entitlement_row public.makeup_entitlements%rowtype;
  task_id uuid;
  session_id uuid;
  v_lesson_plan_id uuid;
  v_original_session_id uuid;
begin
  if not public.can_manage_organization(target_organization_id) then raise exception 'not authorized'; end if;
  select id, makeup_task_id into session_id, task_id from public.makeup_sessions
  where organization_id=target_organization_id and idempotency_key=target_idempotency_key;
  if session_id is not null then
    return jsonb_build_object('ok',true,'makeup_task_id',task_id,'makeup_session_id',session_id,'status','existing');
  end if;
  select * into entitlement_row from public.makeup_entitlements
  where id=target_entitlement_id and organization_id=target_organization_id for update;
  if entitlement_row.id is null then raise exception 'entitlement not found'; end if;
  if entitlement_row.status <> 'available' or entitlement_row.units_remaining < 1 then raise exception 'entitlement unavailable'; end if;
  if entitlement_row.expires_at is not null and entitlement_row.expires_at <= now() then raise exception 'entitlement expired'; end if;
  if not exists (select 1 from public.teacher_profiles where id=target_teacher_id and organization_id=target_organization_id and is_active) then
    raise exception 'teacher not found or inactive';
  end if;
  if exists (select 1 from public.makeup_sessions where organization_id=target_organization_id and teacher_id=target_teacher_id and scheduled_at=target_scheduled_at and status='scheduled') then
    raise exception 'makeup slot is full';
  end if;

  if entitlement_row.leave_request_id is not null then
    select ls.lesson_plan_id, ls.id into v_lesson_plan_id, v_original_session_id
    from public.leave_requests lr join public.lesson_sessions ls on ls.id=lr.lesson_session_id
    where lr.id=entitlement_row.leave_request_id;
  else
    select ls.lesson_plan_id, ls.id into v_lesson_plan_id, v_original_session_id
    from public.attendance_records ar join public.lesson_sessions ls on ls.id=ar.session_id
    where ar.id=entitlement_row.attendance_record_id;
  end if;
  if v_lesson_plan_id is null or v_original_session_id is null then raise exception 'entitlement has no lesson context'; end if;

  insert into public.makeup_tasks (
    organization_id, student_id, cohort_id, lesson_plan_id, original_session_id,
    attendance_record_id, entitlement_id, missed_status, status, parent_visible_summary
  ) select
    target_organization_id, entitlement_row.student_id, ls.cohort_id, v_lesson_plan_id,
    v_original_session_id, entitlement_row.attendance_record_id, entitlement_row.id,
    'excused', 'scheduled', '已安排補課：1 堂'
  from public.lesson_sessions ls where ls.id=v_original_session_id
  on conflict (entitlement_id) where entitlement_id is not null do update set status='scheduled',updated_at=now()
  returning id into task_id;

  insert into public.makeup_sessions (
    organization_id, makeup_task_id, entitlement_id, student_id, teacher_id,
    scheduled_at, status, created_by, idempotency_key
  ) values (
    target_organization_id, task_id, entitlement_row.id, entitlement_row.student_id,
    target_teacher_id, target_scheduled_at, 'scheduled', auth.uid(), target_idempotency_key
  ) returning id into session_id;
  update public.makeup_entitlements set status='reserved', updated_at=now() where id=entitlement_row.id;
  insert into public.communication_logs (
    organization_id, student_id, channel, direction, template_key, body, status, idempotency_key
  ) values (
    target_organization_id, entitlement_row.student_id, 'whatsapp', 'outbound', 'makeup_booked',
    '你好，補課已安排喺 ' || to_char(target_scheduled_at at time zone 'Asia/Macau', 'YYYY-MM-DD HH24:MI') ||
      '。請確認時間係咪合適；此訊息請由職員核對後人工發送。',
    'queued', 'makeup-booked:' || entitlement_row.id::text
  ) on conflict (organization_id, idempotency_key) do update
    set body=excluded.body, status='queued';
  return jsonb_build_object('ok',true,'makeup_task_id',task_id,'makeup_session_id',session_id,'status','created');
end
$$;

create or replace function public.complete_follow_up_task(target_task_id uuid, target_outcome text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.follow_up_tasks%rowtype;
  communication_id uuid;
  mapped_channel text;
begin
  select * into task_row from public.follow_up_tasks where id=target_task_id for update;
  if task_row.id is null then raise exception 'follow-up task not found'; end if;
  if not public.can_manage_organization(task_row.organization_id) then raise exception 'not authorized'; end if;
  update public.follow_up_tasks
  set status='done', completed_at=coalesce(completed_at,now()), dismissed_at=null, updated_at=now()
  where id=task_row.id;
  mapped_channel := case task_row.channel
    when 'wechat_manual' then 'wechat'
    when 'whatsapp_manual' then 'whatsapp'
    when 'phone_manual' then 'phone'
    else 'in_app' end;
  insert into public.communication_logs (
    organization_id, student_id, channel, direction, template_key, body,
    status, idempotency_key, sent_at
  ) values (
    task_row.organization_id, task_row.subject_student_id, mapped_channel,
    'outbound', 'follow_up_manual_contact', task_row.suggested_message || E'\n聯絡結果：' ||
      coalesce(nullif(trim(target_outcome),''),'已由職員確認完成。'),
    'sent', 'follow-up-contact:' || task_row.id::text, now()
  ) on conflict (organization_id,idempotency_key) do update
    set body=excluded.body,status='sent',sent_at=excluded.sent_at
  returning id into communication_id;
  return communication_id;
end
$$;

create or replace function public.run_automation_job(
  target_organization_id uuid, target_job_type text, target_period_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job_id uuid;
  task_id uuid;
  message text;
  affected_count integer := 0;
  counts jsonb;
  item record;
  settings public.organizations%rowtype;
  open_followups integer;
  low_credit_count integer;
  overdue_count integer;
  unassigned_count integer;
  today_sessions integer;
begin
  if target_job_type not in ('morning_summary','evening_summary','low_credit','overdue_payment','unassigned_makeup','weekly_report') then
    raise exception 'unsupported automation job type';
  end if;
  select * into settings from public.organizations where id = target_organization_id and is_active;
  if settings.id is null then
    raise exception 'organization not found or inactive';
  end if;
  if not public.can_manage_organization(target_organization_id)
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'not authorized';
  end if;

  insert into public.automation_jobs (organization_id, job_type, period_key)
  values (target_organization_id, target_job_type, target_period_key)
  on conflict (organization_id, job_type, period_key) do update
  set attempt_count = public.automation_jobs.attempt_count + 1, last_run_at = now(), status = 'completed'
  returning id into job_id;

  select count(*) into open_followups from public.follow_up_tasks where organization_id=target_organization_id and status='open';
  select count(*) into low_credit_count from (
    select sp.id from public.student_packages sp left join public.credit_ledger cl on cl.student_package_id=sp.id
    where sp.organization_id=target_organization_id and sp.status='active'
    group by sp.id having coalesce(sum(cl.delta_units),0) <= settings.low_credit_threshold
  ) q;
  select count(*) into overdue_count from public.charges
    where organization_id=target_organization_id and status in ('open','partially_paid') and due_on < current_date;
  select count(*) into unassigned_count from public.makeup_entitlements
    where organization_id=target_organization_id and status='available'
      and created_at <= now() - make_interval(days => settings.unassigned_makeup_after_days);
  select count(*) into today_sessions from public.lesson_sessions
    where organization_id=target_organization_id
      and starts_at >= ((now() at time zone settings.timezone)::date::timestamp at time zone settings.timezone)
      and starts_at < (((now() at time zone settings.timezone)::date + 1)::timestamp at time zone settings.timezone);
  counts := jsonb_build_object('open_followups',open_followups,'low_credit',low_credit_count,
    'overdue_payments',overdue_count,'unassigned_makeups',unassigned_count,'today_sessions',today_sessions);

  if target_job_type = 'low_credit' then
    for item in
      select sp.id package_id, sp.student_id, coalesce(sum(cl.delta_units),0)::integer balance
      from public.student_packages sp left join public.credit_ledger cl on cl.student_package_id=sp.id
      where sp.organization_id=target_organization_id and sp.status='active'
      group by sp.id having coalesce(sum(cl.delta_units),0) <= settings.low_credit_threshold
    loop
      message := '學堂餘額偏低：剩餘 ' || item.balance || ' 堂，請由職員跟進續費。';
      insert into public.follow_up_tasks (organization_id,task_type,idempotency_key,subject_student_id,channel,priority,suggested_message,source,status,due_at)
      values (target_organization_id,target_job_type,target_period_key || ':' || item.package_id,item.student_id,'in_app','high',message,'automation','open',now())
      on conflict (organization_id,task_type,idempotency_key) where idempotency_key is not null do update set suggested_message=excluded.suggested_message,updated_at=now()
      returning id into task_id;
      affected_count := affected_count + 1;
    end loop;
  elsif target_job_type = 'overdue_payment' then
    for item in select id,student_id,amount_minor,currency_code from public.charges
      where organization_id=target_organization_id and status in ('open','partially_paid') and due_on < current_date
    loop
      message := '逾期費用待跟進：' || item.amount_minor || ' ' || item.currency_code || '（最小貨幣單位）。';
      insert into public.follow_up_tasks (organization_id,task_type,idempotency_key,subject_student_id,channel,priority,suggested_message,source,status,due_at)
      values (target_organization_id,target_job_type,target_period_key || ':' || item.id,item.student_id,'in_app','high',message,'automation','open',now())
      on conflict (organization_id,task_type,idempotency_key) where idempotency_key is not null do update set suggested_message=excluded.suggested_message,updated_at=now()
      returning id into task_id;
      affected_count := affected_count + 1;
    end loop;
  elsif target_job_type = 'unassigned_makeup' then
    for item in select id,student_id from public.makeup_entitlements
      where organization_id=target_organization_id and status='available'
        and created_at <= now() - make_interval(days => settings.unassigned_makeup_after_days)
    loop
      message := '有尚未安排的補課權益，請由職員聯絡家長並安排時段。';
      insert into public.follow_up_tasks (organization_id,task_type,idempotency_key,subject_student_id,channel,priority,suggested_message,source,status,due_at)
      values (target_organization_id,target_job_type,target_period_key || ':' || item.id,item.student_id,'in_app','high',message,'automation','open',now())
      on conflict (organization_id,task_type,idempotency_key) where idempotency_key is not null do update set suggested_message=excluded.suggested_message,updated_at=now()
      returning id into task_id;
      affected_count := affected_count + 1;
    end loop;
  else
    message := case target_job_type
      when 'morning_summary' then '早晨營運摘要'
      when 'evening_summary' then '晚間營運摘要'
      else '每週營運摘要' end || '：今日課堂 ' || today_sessions || '，低餘額 ' || low_credit_count ||
      '，逾期費用 ' || overdue_count || '，待安排補課 ' || unassigned_count || '，待跟進 ' || open_followups || '。';
    insert into public.follow_up_tasks (organization_id,task_type,idempotency_key,channel,priority,suggested_message,source,status,due_at)
    values (target_organization_id,target_job_type,target_period_key,'in_app','medium',message,'automation','open',now())
    on conflict (organization_id,task_type,idempotency_key) where idempotency_key is not null do update set suggested_message=excluded.suggested_message,updated_at=now()
    returning id into task_id;
    affected_count := 1;
  end if;

  return jsonb_build_object('ok', true, 'job_id', job_id, 'task_id', task_id, 'affected_count',affected_count,'counts',counts,
    'organization_id', target_organization_id, 'job_type', target_job_type,
    'period_key', target_period_key);
end
$$;

revoke all on function public.decide_leave_request(uuid,text) from public;
revoke all on function public.record_payment(uuid,uuid,uuid,bigint,text,text) from public;
revoke all on function public.run_automation_job(uuid,text,text) from public;
revoke all on function public.create_guardian_student_enrollment_package(uuid,text,text,text,text,uuid,uuid,text) from public;
revoke all on function public.book_makeup_session(uuid,uuid,uuid,timestamptz,text) from public;
revoke all on function public.complete_follow_up_task(uuid,text) from public;
grant execute on function public.decide_leave_request(uuid,text) to authenticated, service_role;
grant execute on function public.record_payment(uuid,uuid,uuid,bigint,text,text) to authenticated, service_role;
grant execute on function public.run_automation_job(uuid,text,text) to authenticated, service_role;
grant execute on function public.create_guardian_student_enrollment_package(uuid,text,text,text,text,uuid,uuid,text) to authenticated, service_role;
grant execute on function public.book_makeup_session(uuid,uuid,uuid,timestamptz,text) to authenticated, service_role;
grant execute on function public.complete_follow_up_task(uuid,text) to authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
