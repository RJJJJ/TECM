\set ON_ERROR_STOP on

insert into public.lesson_sessions (
  id, cohort_id, lesson_plan_id, teacher_id, starts_at, ends_at, status, organization_id
) values
  ('1d000000-0000-4000-8000-000000000027','1a000000-0000-4000-8000-000000000001','1c000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001','2020-01-27 09:00:00+08','2020-01-27 10:00:00+08','completed','10000000-0000-4000-8000-000000000000'),
  ('1d000000-0000-4000-8000-000000000028','1a000000-0000-4000-8000-000000000001','1c000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001',now() + interval '2 days',now() + interval '2 days 1 hour','scheduled','10000000-0000-4000-8000-000000000000'),
  ('1d000000-0000-4000-8000-000000000029','1a000000-0000-4000-8000-000000000001','1c000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001',now() - interval '2 hours',now() - interval '1 hour','cancelled','10000000-0000-4000-8000-000000000000'),
  ('1d000000-0000-4000-8000-000000000030','1a000000-0000-4000-8000-000000000001','1c000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001','2020-01-30 09:00:00+08','2020-01-30 10:00:00+08','completed','10000000-0000-4000-8000-000000000000')
on conflict (id) do update set starts_at=excluded.starts_at, ends_at=excluded.ends_at, status=excluded.status;

delete from public.attendance_records
where session_id in (
  '1d000000-0000-4000-8000-000000000027',
  '1d000000-0000-4000-8000-000000000028',
  '1d000000-0000-4000-8000-000000000029',
  '1d000000-0000-4000-8000-000000000030'
);

insert into public.attendance_records (
  id, organization_id, session_id, student_id, status, recorded_by, recorded_at
) values (
  '31000000-0000-4000-8000-000000000030',
  '10000000-0000-4000-8000-000000000000',
  '1d000000-0000-4000-8000-000000000030',
  '15000000-0000-4000-8000-000000000001',
  'excused','10000000-0000-4000-8000-000000000001','2020-01-30 10:00:00+08'
);
insert into public.leave_requests (
  id, organization_id, student_id, lesson_session_id, reason, status, idempotency_key
) values (
  '32000000-0000-4000-8000-000000000030',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000030',
  '020 finalized leave','approved','020-finalized-leave'
) on conflict (id) do update set status='approved';

insert into public.charges (
  id, organization_id, student_id, description, amount_minor, currency_code,
  status, due_on, idempotency_key
) values (
  '41000000-0000-4000-8000-000000000020',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '020 idempotency charge', 1000000, 'MOP', 'open', current_date,
  '020-idempotency-charge'
) on conflict (id) do update set amount_minor=excluded.amount_minor, status='open';

create temporary table batch1_effect_baseline as
select
  (select count(*) from public.notifications) as notifications_count,
  (select count(*) from public.notification_outbox) as outbox_count;

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);

do $$
declare
  result jsonb;
  current_revision bigint;
begin
  begin
    perform public.submit_staff_attendance(
      '1d000000-0000-4000-8000-000000000027','15000000-0000-4000-8000-000000000001',
      'present',null,'','020-missing-reason'
    );
    raise exception '020 historical staff mutation without reason unexpectedly succeeded';
  exception when others then
    if sqlerrm = '020 historical staff mutation without reason unexpectedly succeeded' then raise; end if;
    if sqlerrm <> 'attendance correction reason is required' then
      raise exception '020 missing-reason classification changed';
    end if;
  end;

  result := public.submit_staff_attendance(
    '1d000000-0000-4000-8000-000000000027','15000000-0000-4000-8000-000000000001',
    'present',null,'020 safe create','020-staff-create'
  );
  if result->>'changed' <> 'true' or (result->>'revision')::bigint <> 1 then
    raise exception '020 initially absent staff create failed';
  end if;
  begin
    perform public.submit_staff_attendance(
      '1d000000-0000-4000-8000-000000000027','15000000-0000-4000-8000-000000000001',
      'absent',null,'020 stale null','020-staff-stale-null'
    );
    raise exception '020 absent/null stale write unexpectedly succeeded';
  exception when others then
    if sqlerrm = '020 absent/null stale write unexpectedly succeeded' then raise; end if;
    if sqlerrm <> 'attendance has changed; reload before submitting' then raise exception '020 null stale classification changed'; end if;
  end;
  select revision into current_revision from public.attendance_records
  where session_id='1d000000-0000-4000-8000-000000000027'
    and student_id='15000000-0000-4000-8000-000000000001';
  result := public.submit_staff_attendance(
    '1d000000-0000-4000-8000-000000000027','15000000-0000-4000-8000-000000000001',
    'absent',current_revision,'020 refreshed correction','020-staff-refresh'
  );
  if result->>'changed' <> 'true' or (result->>'revision')::bigint <> current_revision + 1 then
    raise exception '020 refreshed staff correction failed';
  end if;

  begin
    perform public.submit_staff_attendance(
      '1d000000-0000-4000-8000-000000000028','15000000-0000-4000-8000-000000000001',
      'present',null,'','020-future'
    );
    raise exception '020 future staff mutation unexpectedly succeeded';
  exception when others then
    if sqlerrm = '020 future staff mutation unexpectedly succeeded' then raise; end if;
    if sqlerrm <> 'future session attendance is not allowed' then raise exception '020 future classification changed'; end if;
  end;
  begin
    perform public.submit_staff_attendance(
      '1d000000-0000-4000-8000-000000000029','15000000-0000-4000-8000-000000000001',
      'present',null,'','020-cancelled'
    );
    raise exception '020 cancelled staff mutation unexpectedly succeeded';
  exception when others then
    if sqlerrm = '020 cancelled staff mutation unexpectedly succeeded' then raise; end if;
    if sqlerrm <> 'attendance cannot be submitted for a cancelled session' then raise exception '020 cancelled classification changed'; end if;
  end;
  select revision into current_revision from public.attendance_records
  where session_id='1d000000-0000-4000-8000-000000000030'
    and student_id='15000000-0000-4000-8000-000000000001';
  begin
    perform public.submit_staff_attendance(
      '1d000000-0000-4000-8000-000000000030','15000000-0000-4000-8000-000000000001',
      'absent',current_revision,'020 finalized denial','020-finalized'
    );
    raise exception '020 finalized leave staff mutation unexpectedly succeeded';
  exception when others then
    if sqlerrm = '020 finalized leave staff mutation unexpectedly succeeded' then raise; end if;
    if sqlerrm <> 'attendance is linked to finalized leave or makeup records' then raise exception '020 finalized classification changed'; end if;
  end;
end
$$;

-- Wrong-tenant and unauthorized-role callers cannot use the security-definer RPC.
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',false);
do $$ begin
  begin
    perform public.submit_staff_attendance(
      '1d000000-0000-4000-8000-000000000027','15000000-0000-4000-8000-000000000001',
      'present',2,'wrong tenant','020-wrong-tenant');
    raise exception '020 wrong-tenant staff mutation unexpectedly succeeded';
  exception when others then
    if sqlerrm = '020 wrong-tenant staff mutation unexpectedly succeeded' then raise; end if;
  end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
do $$ begin
  begin
    perform public.submit_staff_attendance(
      '1d000000-0000-4000-8000-000000000027','15000000-0000-4000-8000-000000000001',
      'present',2,'teacher cannot staff-write','020-unauthorized-role');
    raise exception '020 teacher used staff RPC unexpectedly';
  exception when others then
    if sqlerrm = '020 teacher used staff RPC unexpectedly' then raise; end if;
  end;
end $$;
reset role;

update public.organization_members set status='inactive'
where organization_id='10000000-0000-4000-8000-000000000000'
  and user_id='10000000-0000-4000-8000-000000000002';
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
do $$ begin
  begin
    perform public.submit_staff_attendance(
      '1d000000-0000-4000-8000-000000000027','15000000-0000-4000-8000-000000000001',
      'present',2,'inactive cannot write','020-inactive');
    raise exception '020 inactive staff mutation unexpectedly succeeded';
  exception when others then
    if sqlerrm = '020 inactive staff mutation unexpectedly succeeded' then raise; end if;
  end;
end $$;
reset role;
update public.organization_members set status='active'
where organization_id='10000000-0000-4000-8000-000000000000'
  and user_id='10000000-0000-4000-8000-000000000002';

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);

do $$
declare
  first_id uuid;
  replay_id uuid;
  audit_before bigint;
begin
  first_id := public.record_payment(
    '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
    '41000000-0000-4000-8000-000000000020',100000,' CASH ','020-payment-same'
  );
  replay_id := public.record_payment(
    '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
    '41000000-0000-4000-8000-000000000020',100000,'cash','020-payment-same'
  );
  if first_id <> replay_id then raise exception '020 identical payment replay returned another result'; end if;
  select count(*) into audit_before from public.audit_logs;
  begin
    perform public.record_payment(
      '10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',
      '41000000-0000-4000-8000-000000000020',100001,'cash','020-payment-same'
    );
    raise exception '020 changed payment payload unexpectedly succeeded';
  exception when others then
    if sqlerrm = '020 changed payment payload unexpectedly succeeded' then raise; end if;
    if sqlerrm <> 'idempotency key payload mismatch' then raise exception '020 payment mismatch classification changed'; end if;
  end;
  if (select count(*) from public.audit_logs) <> audit_before then raise exception '020 payment mismatch created audit residue'; end if;
  if (select count(*) from public.payments where organization_id='10000000-0000-4000-8000-000000000000' and idempotency_key='020-payment-same') <> 1
     or (select count(*) from public.payment_allocations pa join public.payments p on p.id=pa.payment_id where p.idempotency_key='020-payment-same') <> 1 then
    raise exception '020 payment replay/mismatch business count is incorrect';
  end if;
end
$$;

do $$
declare
  first_result jsonb;
  replay_result jsonb;
  audit_before bigint;
begin
  first_result := public.create_guardian_student_enrollment_package(
    '10000000-0000-4000-8000-000000000000',' 020 Guardian ',' +85362000020 ',
    ' 020 Student ',' 020 School ','1a000000-0000-4000-8000-000000000001',
    '1e000000-0000-4000-8000-000000000001','020-intake-same'
  );
  replay_result := public.create_guardian_student_enrollment_package(
    '10000000-0000-4000-8000-000000000000','020 Guardian','+85362000020',
    '020 Student','020 School','1a000000-0000-4000-8000-000000000001',
    '1e000000-0000-4000-8000-000000000001','020-intake-same'
  );
  if first_result->>'student_id' is distinct from replay_result->>'student_id'
     or replay_result->>'status' <> 'existing' then
    raise exception '020 identical intake replay returned another result';
  end if;
  select count(*) into audit_before from public.audit_logs;
  begin
    perform public.create_guardian_student_enrollment_package(
      '10000000-0000-4000-8000-000000000000','020 Guardian','+85362000020',
      '020 Changed Student','020 School','1a000000-0000-4000-8000-000000000001',
      '1e000000-0000-4000-8000-000000000001','020-intake-same'
    );
    raise exception '020 changed intake payload unexpectedly succeeded';
  exception when others then
    if sqlerrm = '020 changed intake payload unexpectedly succeeded' then raise; end if;
    if sqlerrm <> 'idempotency key payload mismatch' then raise exception '020 intake mismatch classification changed'; end if;
  end;
  if (select count(*) from public.audit_logs) <> audit_before then raise exception '020 intake mismatch created audit residue'; end if;
end
$$;

reset role;

do $$
begin
  if (select count(*) from public.student_packages where organization_id='10000000-0000-4000-8000-000000000000' and idempotency_key='020-intake-same') <> 1
     or (select count(*) from public.credit_ledger where organization_id='10000000-0000-4000-8000-000000000000' and idempotency_key='package:020-intake-same') <> 1
     or (select count(*) from public.charges where organization_id='10000000-0000-4000-8000-000000000000' and idempotency_key='charge:020-intake-same') <> 1
     or (select count(*) from public.students where organization_id='10000000-0000-4000-8000-000000000000' and display_name='020 Changed Student') <> 0 then
    raise exception '020 intake replay/mismatch business count is incorrect';
  end if;
  if (select count(*) from public.audit_logs where new_data->'attendance_history'->>'request_id' in (
      '020-missing-reason','020-staff-stale-null','020-future','020-cancelled','020-finalized',
      '020-wrong-tenant','020-unauthorized-role','020-inactive')) <> 0 then
    raise exception '020 rejected staff mutation created an audit row';
  end if;
  if (select count(*) from public.notifications) <> (select notifications_count from batch1_effect_baseline)
     or (select count(*) from public.notification_outbox) <> (select outbox_count from batch1_effect_baseline) then
    raise exception '020 rejected attendance scenarios created notification effects';
  end if;
end
$$;

select '020_batch1_release_blockers: staff lifecycle/auth/revision/no-side-effect and payment/intake payload binding' as passed;
