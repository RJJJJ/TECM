\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('41000000-0000-4000-8000-000000000001', 'teacher-link-new@tecm.test'),
  ('41000000-0000-4000-8000-000000000002', 'teacher-link-partial@tecm.test'),
  ('41000000-0000-4000-8000-000000000003', 'teacher-link-other-role@tecm.test'),
  ('41000000-0000-4000-8000-000000000004', 'teacher-link-other-org@tecm.test')
on conflict (id) do update set email = excluded.email;

insert into public.organization_members (organization_id, user_id, role, status) values
  ('10000000-0000-4000-8000-000000000000', '41000000-0000-4000-8000-000000000002', 'teacher', 'active'),
  ('10000000-0000-4000-8000-000000000000', '41000000-0000-4000-8000-000000000003', 'staff', 'active')
on conflict (organization_id, user_id) do update set role = excluded.role, status = excluded.status;

insert into public.teacher_profiles (organization_id, user_id, display_name, is_active)
values ('20000000-0000-4000-8000-000000000000', '41000000-0000-4000-8000-000000000004', 'Other org teacher', true)
on conflict (user_id) do update set organization_id = excluded.organization_id;

insert into public.lesson_sessions (
  id, organization_id, cohort_id, lesson_plan_id, teacher_id,
  starts_at, ends_at, status
) values (
  '42000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000000',
  '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  statement_timestamp() + interval '10 days',
  statement_timestamp() + interval '10 days 1 hour',
  'scheduled'
) on conflict (id) do update set
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  status = excluded.status;

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);

select public.link_teacher_profile(
  '10000000-0000-4000-8000-000000000000',
  '41000000-0000-4000-8000-000000000001',
  'New linked teacher',
  '+85360000000'
);

select public.link_teacher_profile(
  '10000000-0000-4000-8000-000000000000',
  '41000000-0000-4000-8000-000000000002',
  'Recovered partial teacher',
  null
);

do $$
declare rejected boolean := false;
begin
  if not exists (
    select 1 from public.organization_members om
    join public.teacher_profiles tp
      on tp.organization_id = om.organization_id and tp.user_id = om.user_id
    where om.organization_id = '10000000-0000-4000-8000-000000000000'
      and om.user_id = '41000000-0000-4000-8000-000000000001'
      and om.role = 'teacher' and om.status = 'active'
      and tp.display_name = 'New linked teacher'
  ) then raise exception 'atomic teacher link did not create both rows'; end if;

  if not exists (
    select 1 from public.teacher_profiles
    where organization_id = '10000000-0000-4000-8000-000000000000'
      and user_id = '41000000-0000-4000-8000-000000000002'
  ) then raise exception 'partial teacher membership was not recovered'; end if;

  begin
    perform public.link_teacher_profile(
      '10000000-0000-4000-8000-000000000000',
      '41000000-0000-4000-8000-000000000003', 'Must fail', null
    );
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'different organization role was overwritten'; end if;
  if (select role from public.organization_members
      where organization_id = '10000000-0000-4000-8000-000000000000'
        and user_id = '41000000-0000-4000-8000-000000000003') <> 'staff' then
    raise exception 'failed teacher link changed the existing role';
  end if;

  rejected := false;
  begin
    perform public.link_teacher_profile(
      '10000000-0000-4000-8000-000000000000',
      '41000000-0000-4000-8000-000000000004', 'Must fail', null
    );
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'cross-tenant teacher identity was linked'; end if;
  if exists (
    select 1 from public.organization_members
    where organization_id = '10000000-0000-4000-8000-000000000000'
      and user_id = '41000000-0000-4000-8000-000000000004'
  ) then raise exception 'failed cross-tenant link left a partial membership'; end if;
end
$$;

-- The seeded Student A is actively enrolled in the seeded future session.
select public.submit_staff_leave_request(
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001',
  'Integrity test',
  'staff-integrity-valid'
);

do $$
declare
  first_id uuid;
  replay_id uuid;
  rejected boolean := false;
begin
  select id into first_id from public.leave_requests
  where organization_id = '10000000-0000-4000-8000-000000000000'
    and idempotency_key = 'staff-integrity-valid';
  replay_id := public.submit_staff_leave_request(
    '10000000-0000-4000-8000-000000000000',
    '15000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    'Integrity test',
    'staff-integrity-valid'
  );
  if replay_id <> first_id then raise exception 'staff leave replay was not idempotent'; end if;

  begin
    perform public.submit_staff_leave_request(
      '10000000-0000-4000-8000-000000000000',
      '15000000-0000-4000-8000-000000000005',
      '42000000-0000-4000-8000-000000000001',
      'Unrelated student',
      'staff-integrity-unrelated'
    );
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'unrelated student received a leave request'; end if;
  if exists (select 1 from public.leave_requests where idempotency_key = 'staff-integrity-unrelated') then
    raise exception 'rejected leave request was persisted';
  end if;
end
$$;

do $$
begin
  if has_table_privilege('authenticated', 'public.leave_requests', 'INSERT')
    or has_table_privilege('authenticated', 'public.leave_requests', 'UPDATE')
    or has_table_privilege('authenticated', 'public.leave_requests', 'DELETE') then
    raise exception 'authenticated can bypass guarded leave RPCs';
  end if;
  if has_function_privilege('anon', 'public.link_teacher_profile(uuid,uuid,text,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.submit_staff_leave_request(uuid,uuid,uuid,text,text)', 'EXECUTE') then
    raise exception 'anonymous role can execute admin integrity RPCs';
  end if;
end
$$;

reset role;
select 'admin operations integrity tests passed' as result;
