\set ON_ERROR_STOP on

insert into public.lesson_sessions (
  id, cohort_id, lesson_plan_id, teacher_id, starts_at, ends_at, status, organization_id
) values (
  '1d000000-0000-4000-8000-000000000006',
  '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  '2020-01-06 09:00:00+08', '2020-01-06 10:00:00+08', 'completed',
  '10000000-0000-4000-8000-000000000000'
) on conflict (id) do update
set starts_at = excluded.starts_at, ends_at = excluded.ends_at, status = excluded.status;

delete from public.attendance_records
where session_id = '1d000000-0000-4000-8000-000000000006'
  and student_id = '15000000-0000-4000-8000-000000000001';

do $$
begin
  if to_regprocedure('public.submit_attendance(uuid,jsonb)') is not null then
    raise exception '006 legacy unversioned attendance RPC remains installed';
  end if;
  if to_regprocedure('public.submit_staff_attendance(uuid,uuid,text,bigint,text,text)') is null then
    raise exception '006 canonical staff attendance RPC is missing';
  end if;
  if has_function_privilege('anon', 'public.submit_staff_attendance(uuid,uuid,text,bigint,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.submit_staff_attendance(uuid,uuid,text,bigint,text,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.submit_staff_attendance(uuid,uuid,text,bigint,text,text)', 'EXECUTE') then
    raise exception '006 canonical staff attendance RPC ACL matrix is incorrect';
  end if;
  if has_table_privilege('authenticated', 'public.attendance_records', 'INSERT')
     or has_table_privilege('authenticated', 'public.attendance_records', 'UPDATE')
     or has_table_privilege('authenticated', 'public.attendance_records', 'DELETE')
     or not has_table_privilege('authenticated', 'public.attendance_records', 'SELECT') then
    raise exception '006 authenticated attendance table privilege matrix is incorrect';
  end if;
end
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);

do $$
declare
  result jsonb;
  current_revision bigint;
begin
  result := public.submit_staff_attendance(
    '1d000000-0000-4000-8000-000000000006',
    '15000000-0000-4000-8000-000000000001',
    'present', null, '006 initial staff attendance', '006-staff-initial'
  );
  if result->>'changed' <> 'true' or (result->>'revision')::bigint <> 1 then
    raise exception '006 canonical staff create did not produce revision 1';
  end if;

  result := public.submit_staff_attendance(
    '1d000000-0000-4000-8000-000000000006',
    '15000000-0000-4000-8000-000000000001',
    'present', null, '006 initial staff attendance', '006-staff-initial'
  );
  if result->>'changed' <> 'false' or result->>'idempotent_replay' <> 'true' then
    raise exception '006 canonical staff transport replay is not idempotent';
  end if;

  select revision into current_revision
  from public.attendance_records
  where session_id = '1d000000-0000-4000-8000-000000000006'
    and student_id = '15000000-0000-4000-8000-000000000001';
  result := public.submit_staff_attendance(
    '1d000000-0000-4000-8000-000000000006',
    '15000000-0000-4000-8000-000000000001',
    'absent', current_revision, '006 deliberate historical correction', '006-staff-correction'
  );
  if result->>'changed' <> 'true' or (result->>'revision')::bigint <> current_revision + 1 then
    raise exception '006 canonical staff correction did not advance once';
  end if;
end
$$;

do $$
begin
  begin
    update public.attendance_records
    set status = 'excused'
    where session_id = '1d000000-0000-4000-8000-000000000006';
    raise exception '006 authenticated direct attendance update unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;

do $$
begin
  if (select count(*) from public.attendance_records
      where session_id = '1d000000-0000-4000-8000-000000000006'
        and student_id = '15000000-0000-4000-8000-000000000001'
        and status = 'absent' and revision = 2) <> 1 then
    raise exception '006 canonical staff final row is incorrect';
  end if;
  if (select count(*) from public.audit_logs
      where new_data->'attendance_history'->>'request_id' in ('006-staff-initial', '006-staff-correction')) <> 2 then
    raise exception '006 canonical staff audit count is incorrect';
  end if;
  if (select count(*) from public.audit_logs
      where new_data->'attendance_history'->>'request_id' = '006-staff-initial') <> 1 then
    raise exception '006 transport replay created a duplicate audit row';
  end if;
end
$$;

select '006_submit_attendance_rpc: canonical staff revision, replay, audit, ACL, and direct-DML denial' as passed;
