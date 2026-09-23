\set ON_ERROR_STOP on

begin;

do $$
declare
  submit_proc oid := 'public.submit_teacher_attendance(uuid,uuid,text,bigint,text,text)'::regprocedure;
  roster_proc oid := 'public.get_teacher_attendance_roster(uuid)'::regprocedure;
begin
  if to_regprocedure('public.submit_teacher_attendance(uuid,uuid,text,timestamptz,text,text)') is not null then
    raise exception '021 legacy timestamp teacher attendance RPC remains callable';
  end if;
  if to_regprocedure('public.submit_attendance(uuid,jsonb)') is not null then
    raise exception '021 removed unversioned attendance RPC was revived';
  end if;
  if to_regprocedure('public.get_lesson_session_students(uuid)') is null then
    raise exception '021 legacy Admin student roster RPC was removed';
  end if;
  if to_regprocedure('public.get_teacher_attendance_roster(uuid)') is null then
    raise exception '021 teacher attendance roster RPC is missing';
  end if;

  if exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
    where p.oid in (submit_proc, roster_proc)
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) then
    raise exception '021 teacher attendance RPCs retain PUBLIC EXECUTE';
  end if;
  if has_function_privilege('anon', submit_proc, 'EXECUTE')
     or has_function_privilege('service_role', submit_proc, 'EXECUTE')
     or not has_function_privilege('authenticated', submit_proc, 'EXECUTE')
     or has_function_privilege('anon', roster_proc, 'EXECUTE')
     or has_function_privilege('service_role', roster_proc, 'EXECUTE')
     or not has_function_privilege('authenticated', roster_proc, 'EXECUTE') then
    raise exception '021 teacher attendance RPC ACL matrix is incorrect';
  end if;
  if not exists (
    select 1
    from pg_proc p
    where p.oid = submit_proc
      and p.prosecdef
      and p.proconfig @> array['search_path=public']
  ) or not exists (
    select 1
    from pg_proc p
    where p.oid = roster_proc
      and p.prosecdef
      and p.proconfig @> array['search_path=public']
  ) then
    raise exception '021 teacher attendance RPC security/search_path contract is incorrect';
  end if;
end
$$;

insert into auth.users (id, email)
values
  ('10000000-0000-4000-8000-000000000021', 'teacher-role-wrong-021@tecm.test'),
  ('20000000-0000-4000-8000-000000000021', 'teacher-tenant-wrong-021@tecm.test');

insert into public.organization_members (id, organization_id, user_id, role, status)
values
  ('11000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000000', '10000000-0000-4000-8000-000000000021', 'staff', 'active'),
  ('21000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000000', '20000000-0000-4000-8000-000000000021', 'teacher', 'active');

insert into public.teacher_profiles (id, organization_id, user_id, display_name, is_active)
values
  ('19000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000000', '10000000-0000-4000-8000-000000000021', '021 Wrong Role Teacher', true),
  ('29000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000000', '20000000-0000-4000-8000-000000000021', '021 Wrong Tenant Teacher', true);

insert into public.students (id, display_name, school_name, status, organization_id)
values
  ('25000000-0000-4000-8000-000000000021', '021 Valid Student', '021 School', 'active', '10000000-0000-4000-8000-000000000000'),
  ('25000000-0000-4000-8000-000000000022', '021 Existing Student', '021 School', 'active', '10000000-0000-4000-8000-000000000000'),
  ('25000000-0000-4000-8000-000000000023', '021 Missing Student', '021 School', 'active', '10000000-0000-4000-8000-000000000000'),
  ('25000000-0000-4000-8000-000000000024', '021 Inactive Member Student', '021 School', 'active', '10000000-0000-4000-8000-000000000000');

insert into public.student_packages (
  id, organization_id, student_id, fee_plan_id, status, starts_on, idempotency_key
) values
  ('1f000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000000', '25000000-0000-4000-8000-000000000021', '1e000000-0000-4000-8000-000000000001', 'active', current_date, '021-package-021'),
  ('1f000000-0000-4000-8000-000000000022', '10000000-0000-4000-8000-000000000000', '25000000-0000-4000-8000-000000000022', '1e000000-0000-4000-8000-000000000001', 'active', current_date, '021-package-022');

insert into public.credit_ledger (
  id, organization_id, student_package_id, student_id, delta_units, entry_type, source_type, idempotency_key, note
) values
  ('1f100000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000000', '1f000000-0000-4000-8000-000000000021', '25000000-0000-4000-8000-000000000021', 10, 'purchase', 'test', '021-credit-021', '021 attendance fixture credit'),
  ('1f100000-0000-4000-8000-000000000022', '10000000-0000-4000-8000-000000000000', '1f000000-0000-4000-8000-000000000022', '25000000-0000-4000-8000-000000000022', 10, 'purchase', 'test', '021-credit-022', '021 attendance fixture credit');

insert into public.cohort_students (id, organization_id, cohort_id, student_id, status)
values
  ('1b000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000000', '1a000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000021', 'active'),
  ('1b000000-0000-4000-8000-000000000022', '10000000-0000-4000-8000-000000000000', '1a000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000022', 'active'),
  ('1b000000-0000-4000-8000-000000000024', '10000000-0000-4000-8000-000000000000', '1a000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000024', 'withdrawn');

insert into public.lesson_sessions (
  id, cohort_id, lesson_plan_id, teacher_id, starts_at, ends_at, status, organization_id
) values
  (
    '1d000000-0000-4000-8000-000000000041',
    '1a000000-0000-4000-8000-000000000001',
    '1c000000-0000-4000-8000-000000000001',
    '19000000-0000-4000-8000-000000000001',
    '2020-02-01 09:00:00+08', '2020-02-01 10:00:00+08', 'completed',
    '10000000-0000-4000-8000-000000000000'
  ),
  (
    '1d000000-0000-4000-8000-000000000042',
    '1a000000-0000-4000-8000-000000000001',
    '1c000000-0000-4000-8000-000000000001',
    '19000000-0000-4000-8000-000000000021',
    '2020-02-02 09:00:00+08', '2020-02-02 10:00:00+08', 'completed',
    '10000000-0000-4000-8000-000000000000'
  );

insert into public.attendance_records (
  organization_id, session_id, student_id, status, recorded_by, recorded_at
) values (
  '10000000-0000-4000-8000-000000000000',
  '1d000000-0000-4000-8000-000000000041',
  '25000000-0000-4000-8000-000000000022',
  'present',
  '10000000-0000-4000-8000-000000000004',
  '2020-02-01 10:00:00+08'
);

create temporary table tmp_021_effect_baseline as
select
  (select count(*) from public.attendance_records) as attendance_count,
  (select count(*) from public.audit_logs) as audit_count,
  (select count(*) from public.notification_outbox) as outbox_count,
  (select count(*) from public.makeup_tasks) as makeup_task_count,
  (select count(*) from public.makeup_sessions) as makeup_session_count,
  (select count(*) from public.makeup_entitlements) as makeup_entitlement_count,
  (select count(*) from public.credit_ledger) as credit_count;

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);

do $$
declare
  roster_count bigint;
  valid_status text;
  valid_revision bigint;
  existing_status text;
  existing_revision bigint;
begin
  select count(*) into roster_count
  from public.get_teacher_attendance_roster('1d000000-0000-4000-8000-000000000041');
  if roster_count < 2 then
    raise exception '021 assigned teacher roster omitted the active test students';
  end if;

  select attendance_status, attendance_revision
    into valid_status, valid_revision
  from public.get_teacher_attendance_roster('1d000000-0000-4000-8000-000000000041')
  where student_id = '25000000-0000-4000-8000-000000000021';
  if valid_status is not null or valid_revision is not null then
    raise exception '021 initially unrecorded roster row did not return nullable status/revision';
  end if;

  select attendance_status, attendance_revision
    into existing_status, existing_revision
  from public.get_teacher_attendance_roster('1d000000-0000-4000-8000-000000000041')
  where student_id = '25000000-0000-4000-8000-000000000022';
  if existing_status is distinct from 'present' or existing_revision <> 1 then
    raise exception '021 roster did not return the paired current status/revision';
  end if;
  if exists (
    select 1
    from public.get_teacher_attendance_roster('1d000000-0000-4000-8000-000000000041')
    where student_id in (
      '25000000-0000-4000-8000-000000000023',
      '25000000-0000-4000-8000-000000000024'
    )
  ) then
    raise exception '021 roster exposed missing or inactive enrollment';
  end if;
end
$$;

-- Assignment, role, tenant, and enrollment denials must all fail before any
-- attendance or downstream side effect is created.
do $$
begin
  begin
    perform public.submit_teacher_attendance(
      '1d000000-0000-4000-8000-000000000041',
      '25000000-0000-4000-8000-000000000023',
      'present', null, '021 missing membership', '021-missing-membership'
    );
    raise exception '021 missing membership write unexpectedly succeeded';
  exception when others then
    if sqlerrm = '021 missing membership write unexpectedly succeeded' then raise; end if;
    if sqlerrm <> 'student is not active in this session cohort' then
      raise exception '021 missing membership returned an unexpected error';
    end if;
  end;

  begin
    perform public.submit_teacher_attendance(
      '1d000000-0000-4000-8000-000000000041',
      '25000000-0000-4000-8000-000000000024',
      'present', null, '021 inactive membership', '021-inactive-membership'
    );
    raise exception '021 inactive membership write unexpectedly succeeded';
  exception when others then
    if sqlerrm = '021 inactive membership write unexpectedly succeeded' then raise; end if;
    if sqlerrm <> 'student is not active in this session cohort' then
      raise exception '021 inactive membership returned an unexpected error';
    end if;
  end;

  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
  begin
    perform public.submit_teacher_attendance(
      '1d000000-0000-4000-8000-000000000041',
      '25000000-0000-4000-8000-000000000021',
      'present', null, '021 unassigned teacher', '021-unassigned-teacher'
    );
    raise exception '021 unassigned teacher write unexpectedly succeeded';
  exception when others then
    if sqlerrm = '021 unassigned teacher write unexpectedly succeeded' then raise; end if;
    if sqlerrm <> 'teacher is not assigned to this session' then
      raise exception '021 unassigned teacher returned an unexpected error';
    end if;
  end;

  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000021', true);
  begin
    perform public.submit_teacher_attendance(
      '1d000000-0000-4000-8000-000000000042',
      '25000000-0000-4000-8000-000000000021',
      'present', null, '021 wrong role', '021-wrong-role'
    );
    raise exception '021 wrong-role teacher write unexpectedly succeeded';
  exception when others then
    if sqlerrm = '021 wrong-role teacher write unexpectedly succeeded' then raise; end if;
    if sqlerrm <> 'teacher role required' then
      raise exception '021 wrong-role teacher returned an unexpected error';
    end if;
  end;

  perform set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000021', true);
  begin
    perform public.submit_teacher_attendance(
      '1d000000-0000-4000-8000-000000000041',
      '25000000-0000-4000-8000-000000000021',
      'present', null, '021 wrong tenant', '021-wrong-tenant'
    );
    raise exception '021 wrong-tenant teacher write unexpectedly succeeded';
  exception when others then
    if sqlerrm = '021 wrong-tenant teacher write unexpectedly succeeded' then raise; end if;
    if sqlerrm <> 'teacher role required' then
      raise exception '021 wrong-tenant teacher returned an unexpected error'; end if;
  end;
end
$$;

reset role;

do $$
declare
  baseline record;
begin
  select * into baseline from tmp_021_effect_baseline;
  if (select count(*) from public.attendance_records) <> baseline.attendance_count
     or (select count(*) from public.audit_logs) <> baseline.audit_count
     or (select count(*) from public.notification_outbox) <> baseline.outbox_count
     or (select count(*) from public.makeup_tasks) <> baseline.makeup_task_count
     or (select count(*) from public.makeup_sessions) <> baseline.makeup_session_count
     or (select count(*) from public.makeup_entitlements) <> baseline.makeup_entitlement_count
     or (select count(*) from public.credit_ledger) <> baseline.credit_count
     or exists (
       select 1 from public.attendance_records
       where session_id = '1d000000-0000-4000-8000-000000000041'
         and student_id in (
           '25000000-0000-4000-8000-000000000021',
           '25000000-0000-4000-8000-000000000023',
           '25000000-0000-4000-8000-000000000024'
         )
     ) then
    raise exception '021 denied teacher writes created attendance or downstream side effects';
  end if;
end
$$;

savepoint teacher_org_membership_inactive;
update public.organization_members
set status = 'inactive'
where organization_id = '10000000-0000-4000-8000-000000000000'
  and user_id = '10000000-0000-4000-8000-000000000004';
-- Exclude the fixture's own membership audit, then check RPC side effects
-- before rollback. The savepoint also restores this baseline adjustment.
update tmp_021_effect_baseline set audit_count = (select count(*) from public.audit_logs);
do $$
begin
  if (select is_active from public.teacher_profiles where id = '19000000-0000-4000-8000-000000000001') is distinct from true then
    raise exception '021 inactive organization membership fixture deactivated the teacher profile';
  end if;
end
$$;
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
do $$
begin
  if exists (select 1 from public.get_teacher_attendance_roster('1d000000-0000-4000-8000-000000000041')) then
    raise exception '021 inactive organization membership roster unexpectedly returned rows';
  end if;
  begin
    perform public.submit_teacher_attendance(
      '1d000000-0000-4000-8000-000000000041',
      '25000000-0000-4000-8000-000000000021',
      'present', null, '021 inactive organization membership', '021-inactive-organization-membership'
    );
    raise exception '021 inactive organization membership write unexpectedly succeeded';
  exception when others then
    if sqlerrm = '021 inactive organization membership write unexpectedly succeeded' then raise; end if;
    if sqlerrm <> 'teacher role required' then
      raise exception '021 inactive organization membership returned an unexpected error';
    end if;
  end;
end
$$;
reset role;
do $$
declare
  baseline record;
begin
  select * into baseline from tmp_021_effect_baseline;
  if (select count(*) from public.attendance_records) <> baseline.attendance_count
     or (select count(*) from public.audit_logs) <> baseline.audit_count
     or (select count(*) from public.notification_outbox) <> baseline.outbox_count
     or (select count(*) from public.makeup_tasks) <> baseline.makeup_task_count
     or (select count(*) from public.makeup_sessions) <> baseline.makeup_session_count
     or (select count(*) from public.makeup_entitlements) <> baseline.makeup_entitlement_count
     or (select count(*) from public.credit_ledger) <> baseline.credit_count then
    raise exception '021 inactive organization membership changed business or downstream counters';
  end if;
end
$$;

rollback to savepoint teacher_org_membership_inactive;

savepoint teacher_org_membership_deleted;
delete from public.organization_members
where organization_id = '10000000-0000-4000-8000-000000000000'
  and user_id = '10000000-0000-4000-8000-000000000004';
update tmp_021_effect_baseline set audit_count = (select count(*) from public.audit_logs);
do $$
begin
  if (select is_active from public.teacher_profiles where id = '19000000-0000-4000-8000-000000000001') is distinct from true then
    raise exception '021 deleted organization membership fixture deactivated the teacher profile';
  end if;
end
$$;
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
do $$
begin
  if exists (select 1 from public.get_teacher_attendance_roster('1d000000-0000-4000-8000-000000000041')) then
    raise exception '021 deleted organization membership roster unexpectedly returned rows';
  end if;
  begin
    perform public.submit_teacher_attendance(
      '1d000000-0000-4000-8000-000000000041',
      '25000000-0000-4000-8000-000000000021',
      'present', null, '021 deleted organization membership', '021-deleted-organization-membership'
    );
    raise exception '021 deleted organization membership write unexpectedly succeeded';
  exception when others then
    if sqlerrm = '021 deleted organization membership write unexpectedly succeeded' then raise; end if;
    if sqlerrm <> 'teacher role required' then
      raise exception '021 deleted organization membership returned an unexpected error';
    end if;
  end;
end
$$;
reset role;
do $$
declare
  baseline record;
begin
  select * into baseline from tmp_021_effect_baseline;
  if (select count(*) from public.attendance_records) <> baseline.attendance_count
     or (select count(*) from public.audit_logs) <> baseline.audit_count
     or (select count(*) from public.notification_outbox) <> baseline.outbox_count
     or (select count(*) from public.makeup_tasks) <> baseline.makeup_task_count
     or (select count(*) from public.makeup_sessions) <> baseline.makeup_session_count
     or (select count(*) from public.makeup_entitlements) <> baseline.makeup_entitlement_count
     or (select count(*) from public.credit_ledger) <> baseline.credit_count then
    raise exception '021 deleted organization membership changed business or downstream counters';
  end if;
end
$$;
rollback to savepoint teacher_org_membership_deleted;

set role authenticated;
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  if exists (select 1 from public.get_teacher_attendance_roster('1d000000-0000-4000-8000-000000000041')) then
    raise exception '021 no-auth roster read unexpectedly returned rows';
  end if;
  begin
    perform public.submit_teacher_attendance(
      '1d000000-0000-4000-8000-000000000041',
      '25000000-0000-4000-8000-000000000021',
      'present', null, '021 no auth', '021-no-auth'
    );
    raise exception '021 no-auth teacher write unexpectedly succeeded';
  exception when others then
    if sqlerrm = '021 no-auth teacher write unexpectedly succeeded' then raise; end if;
    if sqlerrm <> 'authenticated user required' then
      raise exception '021 no-auth teacher write returned an unexpected error';
    end if;
  end;
end
$$;

reset role;

do $$
declare
  baseline record;
begin
  select * into baseline from tmp_021_effect_baseline;
  if (select count(*) from public.attendance_records) <> baseline.attendance_count
     or (select count(*) from public.audit_logs) <> baseline.audit_count
     or (select count(*) from public.notification_outbox) <> baseline.outbox_count
     or (select count(*) from public.makeup_tasks) <> baseline.makeup_task_count
     or (select count(*) from public.makeup_sessions) <> baseline.makeup_session_count
     or (select count(*) from public.makeup_entitlements) <> baseline.makeup_entitlement_count
     or (select count(*) from public.credit_ledger) <> baseline.credit_count then
    raise exception '021 no-auth request created attendance or downstream side effects';
  end if;
end
$$;

set role anon;
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  begin
    perform public.get_teacher_attendance_roster('1d000000-0000-4000-8000-000000000041');
    raise exception '021 anon roster RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.submit_teacher_attendance(
      '1d000000-0000-4000-8000-000000000041',
      '25000000-0000-4000-8000-000000000021',
      'present', null, '021 anon', '021-anon'
    );
    raise exception '021 anon teacher write unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;

do $$
declare
  baseline record;
begin
  select * into baseline from tmp_021_effect_baseline;
  if (select count(*) from public.attendance_records) <> baseline.attendance_count
     or (select count(*) from public.audit_logs) <> baseline.audit_count
     or (select count(*) from public.notification_outbox) <> baseline.outbox_count
     or (select count(*) from public.makeup_tasks) <> baseline.makeup_task_count
     or (select count(*) from public.makeup_sessions) <> baseline.makeup_session_count
     or (select count(*) from public.makeup_entitlements) <> baseline.makeup_entitlement_count
     or (select count(*) from public.credit_ledger) <> baseline.credit_count then
    raise exception '021 anon requests created attendance or downstream side effects';
  end if;
end
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
do $$
begin
  if exists (select 1 from public.get_teacher_attendance_roster('1d000000-0000-4000-8000-000000000041')) then
    raise exception '021 unassigned teacher read another teacher roster';
  end if;
end
$$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
do $$
begin
  if exists (select 1 from public.get_teacher_attendance_roster('1d000000-0000-4000-8000-000000000041')) then
    raise exception '021 Admin fallback exposed teacher roster';
  end if;
  if (select count(*)
      from public.get_lesson_session_students('1d000000-0000-4000-8000-000000000041')
      where student_id in (
        '25000000-0000-4000-8000-000000000021',
        '25000000-0000-4000-8000-000000000022'
      )) <> 2 then
    raise exception '021 legacy Admin student roster RPC no longer serves current Admin consumers';
  end if;
end
$$;

select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000021', true);
do $$
begin
  if exists (select 1 from public.get_teacher_attendance_roster('1d000000-0000-4000-8000-000000000041')) then
    raise exception '021 wrong-tenant teacher read another tenant roster';
  end if;
end
$$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);

do $$
declare
  result jsonb;
begin
  result := public.submit_teacher_attendance(
    '1d000000-0000-4000-8000-000000000041',
    '25000000-0000-4000-8000-000000000021',
    'present', null, '021 initial present', '021-initial-present'
  );
  if result->>'changed' <> 'true' or (result->>'revision')::bigint <> 1 then
    raise exception '021 null-sentinel initial write did not create revision 1';
  end if;

  result := public.submit_teacher_attendance(
    '1d000000-0000-4000-8000-000000000041',
    '25000000-0000-4000-8000-000000000021',
    'absent', 1, '021 correction reason', '021-correction'
  );
  if result->>'changed' <> 'true' or (result->>'revision')::bigint <> 2 then
    raise exception '021 expected-revision correction did not advance to revision 2';
  end if;
end
$$;

reset role;

do $$
begin
  if not exists (
    select 1
    from public.attendance_records
    where session_id = '1d000000-0000-4000-8000-000000000041'
      and student_id = '25000000-0000-4000-8000-000000000021'
      and status = 'absent'
      and revision = 2
      and internal_note = '021 correction reason'
  ) then
    raise exception '021 valid correction did not persist status, revision, and reason';
  end if;
  if (select count(*) from public.audit_logs where new_data->'attendance_history'->>'request_id' in ('021-initial-present', '021-correction')) <> 2 then
    raise exception '021 valid writes did not create exactly one audit row each';
  end if;
end
$$;

create temporary table tmp_021_after_correction as
select
  (select count(*) from public.attendance_records) as attendance_count,
  (select count(*) from public.audit_logs) as audit_count,
  (select count(*) from public.notification_outbox) as outbox_count,
  (select count(*) from public.makeup_tasks) as makeup_task_count,
  (select count(*) from public.makeup_sessions) as makeup_session_count,
  (select count(*) from public.makeup_entitlements) as makeup_entitlement_count,
  (select count(*) from public.credit_ledger) as credit_count;

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);

do $$
declare
  result jsonb;
begin
  begin
    perform public.submit_teacher_attendance(
      '1d000000-0000-4000-8000-000000000041',
      '25000000-0000-4000-8000-000000000021',
      'excused', 1, '021 stale correction', '021-stale'
    );
    raise exception '021 stale expected revision unexpectedly succeeded';
  exception when others then
    if sqlerrm = '021 stale expected revision unexpectedly succeeded' then raise; end if;
    if sqlerrm <> 'attendance has changed; reload before submitting' then
      raise exception '021 stale expected revision returned an unexpected error';
    end if;
  end;

  result := public.submit_teacher_attendance(
    '1d000000-0000-4000-8000-000000000041',
    '25000000-0000-4000-8000-000000000021',
    'absent', 1, '021 correction reason', '021-correction'
  );
  if result->>'changed' <> 'false'
     or result->>'idempotent_replay' <> 'true'
     or (result->>'revision')::bigint <> 2 then
    raise exception '021 same-request retry was not an idempotent no-op';
  end if;
end
$$;

reset role;

do $$
declare
  baseline record;
begin
  select * into baseline from tmp_021_after_correction;
  if (select count(*) from public.attendance_records) <> baseline.attendance_count
     or (select count(*) from public.audit_logs) <> baseline.audit_count
     or (select count(*) from public.notification_outbox) <> baseline.outbox_count
     or (select count(*) from public.makeup_tasks) <> baseline.makeup_task_count
     or (select count(*) from public.makeup_sessions) <> baseline.makeup_session_count
     or (select count(*) from public.makeup_entitlements) <> baseline.makeup_entitlement_count
     or (select count(*) from public.credit_ledger) <> baseline.credit_count then
    raise exception '021 stale/retry paths created an unexpected side effect';
  end if;
  if (select count(*) from public.audit_logs where new_data->'attendance_history'->>'request_id' = '021-stale') <> 0
     or (select count(*) from public.audit_logs where new_data->'attendance_history'->>'request_id' = '021-correction') <> 1 then
    raise exception '021 stale/retry audit counts are incorrect';
  end if;
  if not exists (
    select 1
    from public.get_teacher_attendance_roster('1d000000-0000-4000-8000-000000000041')
    where student_id = '25000000-0000-4000-8000-000000000021'
      and attendance_status = 'absent'
      and attendance_revision = 2
  ) then
    raise exception '021 roster did not reflect the current corrected status/revision';
  end if;
end
$$;

reset role;
rollback;

select '021_teacher_attendance_membership_and_roster: revoked/missing membership denial, zero side effects, tenant/ACL, coherent roster, revision, and replay' as passed;
