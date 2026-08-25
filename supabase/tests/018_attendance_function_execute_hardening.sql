\set ON_ERROR_STOP on

-- Check the exact overloads.  The regprocedure casts both prove existence and
-- prevent a same-name overload from satisfying this security contract.
do $$
declare
  target record;
  function_count integer;
  public_execute boolean;
  anon_direct_execute boolean;
  anon_execute boolean;
  authenticated_direct_execute boolean;
  authenticated_grant_option boolean;
  authenticated_execute boolean;
  service_role_direct_execute boolean;
  service_role_execute boolean;
  fixed_search_path boolean;
begin
  for target in
    select * from (values
      ('public.capture_attendance_history_audit()'::regprocedure, false),
      ('public.get_teacher_attendance_sessions()'::regprocedure, true),
      ('public.submit_teacher_attendance(uuid,uuid,text,timestamptz,text,text)'::regprocedure, true),
      ('public.submit_attendance(uuid,jsonb)'::regprocedure, true)
    ) as expected(signature, authenticated_expected)
  loop
    select count(*),
           exists (
             select 1
             from pg_proc p
             cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
             where p.oid = target.signature::oid
               and privilege.grantee = 0
               and privilege.privilege_type = 'EXECUTE'
           ),
           exists (
             select 1
             from pg_proc p
             cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
             where p.oid = target.signature::oid
               and privilege.grantee = (select oid from pg_roles where rolname = 'anon')
               and privilege.privilege_type = 'EXECUTE'
           ),
           has_function_privilege('anon', target.signature, 'EXECUTE'),
           exists (
             select 1
             from pg_proc p
             cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
             where p.oid = target.signature::oid
               and privilege.grantee = (select oid from pg_roles where rolname = 'authenticated')
               and privilege.privilege_type = 'EXECUTE'
           ),
           exists (
             select 1
             from pg_proc p
             cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
             where p.oid = target.signature::oid
               and privilege.grantee = (select oid from pg_roles where rolname = 'authenticated')
               and privilege.privilege_type = 'EXECUTE'
               and privilege.is_grantable
           ),
           has_function_privilege('authenticated', target.signature, 'EXECUTE'),
           exists (
             select 1
             from pg_proc p
             cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
             where p.oid = target.signature::oid
               and privilege.grantee = (select oid from pg_roles where rolname = 'service_role')
               and privilege.privilege_type = 'EXECUTE'
           ),
           has_function_privilege('service_role', target.signature, 'EXECUTE'),
           bool_and(p.prosecdef and p.proconfig @> array['search_path=public'])
      into function_count, public_execute, anon_direct_execute, anon_execute,
           authenticated_direct_execute, authenticated_grant_option, authenticated_execute,
           service_role_direct_execute, service_role_execute, fixed_search_path
      from pg_proc p
      where p.oid = target.signature::oid;

    if function_count <> 1 then
      raise exception '018 attendance function signature must exist exactly once: %', target.signature;
    end if;
    if public_execute then
      raise exception '018 attendance function ACL: PUBLIC EXECUTE must be false for %', target.signature;
    end if;
    if anon_direct_execute or anon_execute then
      raise exception '018 attendance function ACL: anon EXECUTE must be false for %', target.signature;
    end if;
    if authenticated_execute is distinct from target.authenticated_expected then
      raise exception '018 attendance function ACL: authenticated EXECUTE mismatch for %', target.signature;
    end if;
    if authenticated_direct_execute is distinct from target.authenticated_expected then
      raise exception '018 attendance function ACL: authenticated direct EXECUTE mismatch for %', target.signature;
    end if;
    if authenticated_grant_option then
      raise exception '018 attendance function ACL: authenticated grant option must be false for %', target.signature;
    end if;
    if service_role_direct_execute or service_role_execute then
      raise exception '018 attendance function ACL: service_role EXECUTE expanded for %', target.signature;
    end if;
    if not fixed_search_path then
      raise exception '018 attendance function ACL: SECURITY DEFINER search_path changed for %', target.signature;
    end if;
  end loop;
end
$$;

-- The repository has 46 public tables protected with FORCE RLS.  Privilege
-- hardening must not loosen either count.
do $$
declare
  rls_count integer;
  forced_count integer;
begin
  select count(*), count(*) filter (where c.relforcerowsecurity)
    into rls_count, forced_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relrowsecurity;

  if rls_count <> 46 or forced_count <> 46 then
    raise exception '018 attendance function ACL: expected 46/46 RLS/FORCE RLS, got %/%', rls_count, forced_count;
  end if;
end
$$;

-- Unauthenticated callers have no RPC entry point, including the legacy
-- staff/admin path.
set role anon;
do $$
begin
  begin
    perform public.get_teacher_attendance_sessions();
    raise exception '018 unauthenticated teacher session read unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.submit_teacher_attendance(
      '1d000000-0000-4000-8000-000000000020',
      '15000000-0000-4000-8000-000000000001',
      'present', null, 'unauthenticated', '018-anon-teacher'
    );
    raise exception '018 unauthenticated teacher attendance write unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.submit_attendance(
      '1d000000-0000-4000-8000-000000000020',
      '[]'::jsonb
    );
    raise exception '018 unauthenticated staff attendance write unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

insert into public.lesson_sessions (
  id, cohort_id, lesson_plan_id, teacher_id, starts_at, ends_at, status, organization_id
) values (
  '1d000000-0000-4000-8000-000000000020',
  '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  '2020-01-11 09:00:00+08', '2020-01-11 10:00:00+08', 'completed',
  '10000000-0000-4000-8000-000000000000'
) on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, status = excluded.status;

-- Assigned teachers retain their intended read/write route.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
do $$
declare
  result jsonb;
begin
  if not exists (
    select 1 from public.get_teacher_attendance_sessions()
    where session_id = '1d000000-0000-4000-8000-000000000020'
  ) then
    raise exception '018 assigned teacher could not read an assigned session';
  end if;

  result := public.submit_teacher_attendance(
    '1d000000-0000-4000-8000-000000000020',
    '15000000-0000-4000-8000-000000000001',
    'absent', null, '018 assigned teacher write', '018-assigned-teacher'
  );
  if result->>'changed' <> 'true' then
    raise exception '018 assigned teacher attendance write unexpectedly became a no-op';
  end if;
end
$$;

-- An authenticated teacher from another tenant cannot read or write this
-- tenant's session, even though the function is executable.
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', false);
do $$
begin
  if exists (
    select 1 from public.get_teacher_attendance_sessions()
    where session_id = '1d000000-0000-4000-8000-000000000020'
  ) then
    raise exception '018 cross-tenant teacher read unexpectedly succeeded';
  end if;
  begin
    perform public.submit_teacher_attendance(
      '1d000000-0000-4000-8000-000000000020',
      '15000000-0000-4000-8000-000000000001',
      'present', null, '018 cross-tenant', '018-cross-tenant'
    );
    raise exception '018 cross-tenant teacher write unexpectedly succeeded';
  exception when others then
    if sqlerrm = '018 cross-tenant teacher write unexpectedly succeeded' then raise; end if;
  end;
end
$$;

-- The legacy staff/admin RPC remains available to an authorized staff user.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select public.submit_attendance(
  '1d000000-0000-4000-8000-000000000020',
  '[{"student_id":"15000000-0000-4000-8000-000000000001","status":"present","internal_note":"018 staff regression"}]'::jsonb
);
reset role;

do $$
begin
  if not exists (
    select 1 from public.attendance_records
    where session_id = '1d000000-0000-4000-8000-000000000020'
      and student_id = '15000000-0000-4000-8000-000000000001'
      and status = 'present'
  ) then
    raise exception '018 staff/admin submit_attendance regression';
  end if;
end
$$;

select '018_attendance_function_execute_hardening: exact ACLs, effective privileges, RLS, and teacher/staff authorization paths' as passed;
