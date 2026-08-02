\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('43000000-0000-4000-8000-000000000001', 'release-teacher-inactive@tecm.test'),
  ('43000000-0000-4000-8000-000000000002', 'release-teacher-cross-org@tecm.test'),
  ('43000000-0000-4000-8000-000000000003', 'release-parent@tecm.test'),
  ('43000000-0000-4000-8000-000000000004', 'release-teacher-inactive-booking@tecm.test'),
  ('43000000-0000-4000-8000-000000000005', 'release-teacher-membership-only@tecm.test')
on conflict (id) do update set email = excluded.email;

insert into public.organization_members (organization_id, user_id, role, status) values
  ('10000000-0000-4000-8000-000000000000', '43000000-0000-4000-8000-000000000001', 'teacher', 'inactive'),
  ('20000000-0000-4000-8000-000000000000', '43000000-0000-4000-8000-000000000002', 'teacher', 'active'),
  ('10000000-0000-4000-8000-000000000000', '43000000-0000-4000-8000-000000000004', 'teacher', 'inactive'),
  ('20000000-0000-4000-8000-000000000000', '43000000-0000-4000-8000-000000000005', 'teacher', 'active')
on conflict (organization_id, user_id) do update set role = excluded.role, status = excluded.status;

insert into public.teacher_profiles (id, organization_id, user_id, display_name, phone, is_active)
values (
  '43000000-0000-4000-8000-000000000011',
  '10000000-0000-4000-8000-000000000000',
  '43000000-0000-4000-8000-000000000001',
  'Inactive teacher',
  null,
  false
) on conflict (id) do update set is_active = false, display_name = excluded.display_name;

insert into public.teacher_profiles (id, organization_id, user_id, display_name, is_active)
values (
  '43000000-0000-4000-8000-000000000012',
  '20000000-0000-4000-8000-000000000000',
  '43000000-0000-4000-8000-000000000002',
  'Cross org teacher',
  true
) on conflict (id) do update set organization_id = excluded.organization_id, is_active = true;

insert into public.teacher_profiles (id, organization_id, user_id, display_name, is_active)
values (
  '43000000-0000-4000-8000-000000000013',
  '10000000-0000-4000-8000-000000000000',
  '43000000-0000-4000-8000-000000000004',
  'Inactive booking teacher',
  true
) on conflict (id) do update set is_active = true;

insert into public.lesson_sessions (
  id, organization_id, cohort_id, lesson_plan_id, teacher_id, starts_at, ends_at, status
) values (
  '43000000-0000-4000-8000-000000000021',
  '10000000-0000-4000-8000-000000000000',
  '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  statement_timestamp() + interval '14 days',
  statement_timestamp() + interval '14 days 1 hour',
  'scheduled'
) on conflict (id) do update set
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  status = excluded.status;

insert into public.lesson_sessions (
  id, organization_id, cohort_id, lesson_plan_id, teacher_id, starts_at, ends_at, status
) values (
  '43000000-0000-4000-8000-000000000022',
  '10000000-0000-4000-8000-000000000000',
  '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  statement_timestamp() - interval '2 hours',
  statement_timestamp() - interval '1 hour',
  'scheduled'
) on conflict (id) do update set
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  status = excluded.status;

insert into public.leave_requests (
  id, organization_id, student_id, lesson_session_id, requested_by, reason, status, idempotency_key
) values (
  '43000000-0000-4000-8000-000000000023',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '43000000-0000-4000-8000-000000000022',
  '10000000-0000-4000-8000-000000000001',
  'Replay survives mutable validation',
  'pending',
  'release-gate-stale-leave-replay'
) on conflict (organization_id, idempotency_key) do update set
  lesson_session_id = excluded.lesson_session_id,
  requested_by = excluded.requested_by,
  reason = excluded.reason,
  status = excluded.status;

insert into public.parent_profiles (
  id, organization_id, user_id, full_name, email, account_status, linked_at
) values (
  '43000000-0000-4000-8000-000000000031',
  '10000000-0000-4000-8000-000000000000',
  '43000000-0000-4000-8000-000000000003',
  'Release Parent',
  'release-parent@tecm.test',
  'disabled',
  statement_timestamp() - interval '1 day'
) on conflict (id) do update set
  user_id = excluded.user_id,
  email = excluded.email,
  account_status = 'disabled',
  linked_at = excluded.linked_at;

insert into public.push_devices (
  id, organization_id, user_id, installation_id, device_token, environment, bundle_id, is_active,
  invalidated_at
) values (
  '43000000-0000-4000-8000-000000000032',
  '10000000-0000-4000-8000-000000000000',
  '43000000-0000-4000-8000-000000000003',
  'release-parent-installation',
  repeat('A', 64),
  'sandbox',
  'mo.edu.tecm.release',
  false,
  statement_timestamp() - interval '1 day'
) on conflict (user_id, installation_id) do update set
  is_active = false,
  invalidated_at = excluded.invalidated_at,
  device_token = excluded.device_token,
  environment = excluded.environment,
  bundle_id = excluded.bundle_id;

insert into public.makeup_tasks (
  id, organization_id, student_id, cohort_id, lesson_plan_id, original_session_id,
  attendance_record_id, missed_status, status, parent_visible_summary
) values (
  '43000000-0000-4000-8000-000000000041',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '43000000-0000-4000-8000-000000000021',
  null,
  'excused',
  'pending',
  'Pending task without a scheduled session.'
) on conflict (id) do update set status = excluded.status, attendance_record_id = null;

insert into public.makeup_tasks (
  id, organization_id, student_id, cohort_id, lesson_plan_id, original_session_id,
  attendance_record_id, missed_status, status, parent_visible_summary
) values (
  '43000000-0000-4000-8000-000000000042',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '43000000-0000-4000-8000-000000000021',
  null,
  'excused',
  'scheduled',
  'Scheduled task with a cancelled session.'
) on conflict (id) do update set status = excluded.status, attendance_record_id = null;

insert into public.makeup_sessions (
  id, organization_id, makeup_task_id, entitlement_id, student_id, teacher_id,
  scheduled_at, status, created_by, idempotency_key
) values (
  '43000000-0000-4000-8000-000000000043',
  '10000000-0000-4000-8000-000000000000',
  '43000000-0000-4000-8000-000000000042',
  null,
  '15000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  statement_timestamp() + interval '28 days',
  'cancelled',
  '10000000-0000-4000-8000-000000000001',
  'release-gate-cancelled-session'
) on conflict (id) do update set status = excluded.status;

insert into public.makeup_tasks (
  id, organization_id, student_id, cohort_id, lesson_plan_id, original_session_id,
  attendance_record_id, missed_status, status, parent_visible_summary
) values (
  '43000000-0000-4000-8000-000000000044',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '43000000-0000-4000-8000-000000000021',
  null,
  'excused',
  'scheduled',
  'Scheduled task with two scheduled sessions.'
) on conflict (id) do update set status = excluded.status, attendance_record_id = null;

insert into public.makeup_sessions (
  id, organization_id, makeup_task_id, entitlement_id, student_id, teacher_id,
  scheduled_at, status, created_by, idempotency_key
) values
(
  '43000000-0000-4000-8000-000000000045',
  '10000000-0000-4000-8000-000000000000',
  '43000000-0000-4000-8000-000000000044',
  null,
  '15000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  statement_timestamp() + interval '29 days',
  'scheduled',
  '10000000-0000-4000-8000-000000000001',
  'release-gate-multiple-session-a'
),
(
  '43000000-0000-4000-8000-000000000046',
  '10000000-0000-4000-8000-000000000000',
  '43000000-0000-4000-8000-000000000044',
  null,
  '15000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  statement_timestamp() + interval '30 days',
  'scheduled',
  '10000000-0000-4000-8000-000000000001',
  'release-gate-multiple-session-b'
)
on conflict (id) do update set status = excluded.status;

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);

select public.link_teacher_profile(
  '10000000-0000-4000-8000-000000000000',
  '43000000-0000-4000-8000-000000000001',
  'Reactivated Teacher',
  '+85360009999'
);

do $$
declare
  first_leave_id uuid;
  replay_leave_id uuid;
  stale_replay_id uuid;
  booking jsonb;
  replay_booking jsonb;
  completion jsonb;
  completion_replay jsonb;
  mismatched_booking jsonb;
  rejected boolean := false;
begin
  if not exists (
    select 1
    from public.organization_members om
    join public.teacher_profiles tp
      on tp.organization_id = om.organization_id
      and tp.user_id = om.user_id
    where om.organization_id = '10000000-0000-4000-8000-000000000000'
      and om.user_id = '43000000-0000-4000-8000-000000000001'
      and om.role = 'teacher'
      and om.status = 'active'
      and tp.display_name = 'Reactivated Teacher'
      and tp.phone = '+85360009999'
      and tp.is_active
  ) then
    raise exception 'inactive same-org teacher was not reactivated';
  end if;

  begin
    perform public.link_teacher_profile(
      '10000000-0000-4000-8000-000000000000',
      '43000000-0000-4000-8000-000000000002',
      'Cross org fail',
      null
    );
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'cross-org teacher identity was linked'; end if;

  rejected := false;
  begin
    perform public.link_teacher_profile(
      '10000000-0000-4000-8000-000000000000',
      '43000000-0000-4000-8000-000000000005',
      'Cross org membership-only fail',
      null
    );
  exception when others then rejected := true;
  end;
  if not rejected
    or exists (
      select 1 from public.organization_members
      where organization_id = '10000000-0000-4000-8000-000000000000'
        and user_id = '43000000-0000-4000-8000-000000000005'
    )
    or exists (
      select 1 from public.teacher_profiles
      where organization_id = '10000000-0000-4000-8000-000000000000'
        and user_id = '43000000-0000-4000-8000-000000000005'
    ) then
    raise exception 'cross-org membership-only identity was linked';
  end if;

  rejected := false;
  begin
    stale_replay_id := public.submit_staff_leave_request(
      '10000000-0000-4000-8000-000000000000',
      '15000000-0000-4000-8000-000000000001',
      '43000000-0000-4000-8000-000000000022',
      'Replay survives mutable validation',
      'release-gate-stale-leave-replay'
    );
  exception when others then rejected := true;
  end;
  if rejected then
    raise exception 'M17 stale leave replay was validated before idempotency lookup';
  end if;
  if stale_replay_id <> '43000000-0000-4000-8000-000000000023'::uuid then
    raise exception 'staff leave replay did not happen before mutable validation';
  end if;

  first_leave_id := public.submit_staff_leave_request(
    '10000000-0000-4000-8000-000000000000',
    '15000000-0000-4000-8000-000000000001',
    '43000000-0000-4000-8000-000000000021',
    'Release gate leave',
    'release-gate-leave'
  );

  replay_leave_id := public.submit_staff_leave_request(
    '10000000-0000-4000-8000-000000000000',
    '15000000-0000-4000-8000-000000000001',
    '43000000-0000-4000-8000-000000000021',
    'Release gate leave',
    'release-gate-leave'
  );
  if replay_leave_id <> first_leave_id then
    raise exception 'staff leave replay did not return the first request';
  end if;

  perform public.decide_leave_request(first_leave_id, 'approved');

  booking := public.book_makeup_session(
    '10000000-0000-4000-8000-000000000000',
    (select id from public.makeup_entitlements where leave_request_id = first_leave_id),
    '43000000-0000-4000-8000-000000000011',
    ((now() at time zone 'Asia/Macau')::date + 21 + time '09:30') at time zone 'Asia/Macau',
    'release-gate-makeup-booking'
  );
  if booking->>'status' <> 'created' then raise exception 'makeup booking was not created'; end if;

  replay_booking := public.book_makeup_session(
    '10000000-0000-4000-8000-000000000000',
    (select id from public.makeup_entitlements where leave_request_id = first_leave_id),
    '43000000-0000-4000-8000-000000000011',
    ((now() at time zone 'Asia/Macau')::date + 21 + time '09:30') at time zone 'Asia/Macau',
    'release-gate-makeup-booking'
  );
  if replay_booking->>'status' <> 'existing'
    or replay_booking->>'makeup_session_id' <> booking->>'makeup_session_id' then
    raise exception 'makeup booking replay did not return existing session';
  end if;

  rejected := false;
  begin
    mismatched_booking := public.book_makeup_session(
      '10000000-0000-4000-8000-000000000000',
      (select id from public.makeup_entitlements where leave_request_id = first_leave_id),
      '43000000-0000-4000-8000-000000000013',
      ((now() at time zone 'Asia/Macau')::date + 22 + time '09:30') at time zone 'Asia/Macau',
      'release-gate-makeup-booking'
    );
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'mismatched makeup booking payload was accepted'; end if;

  rejected := false;
  begin
    perform public.book_makeup_session(
      '10000000-0000-4000-8000-000000000000',
      (select id from public.makeup_entitlements where leave_request_id = first_leave_id),
      '43000000-0000-4000-8000-000000000011',
      statement_timestamp() - interval '1 minute',
      'release-gate-past-booking'
    );
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'past Macau makeup booking was accepted'; end if;

  rejected := false;
  begin
    perform public.book_makeup_session(
      '10000000-0000-4000-8000-000000000000',
      (select id from public.makeup_entitlements where leave_request_id = first_leave_id),
      '43000000-0000-4000-8000-000000000013',
      ((now() at time zone 'Asia/Macau')::date + 22 + time '09:30') at time zone 'Asia/Macau',
      'release-gate-inactive-teacher-booking'
    );
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'inactive teacher membership was accepted for booking'; end if;

  completion := public.complete_makeup_task((booking->>'makeup_task_id')::uuid);
  completion_replay := public.complete_makeup_task((booking->>'makeup_task_id')::uuid);
  if completion->>'status' <> 'completed'
    or completion_replay->>'status' <> 'existing'
    or completion_replay->>'makeup_session_id' <> completion->>'makeup_session_id' then
    raise exception 'makeup completion was not atomic and idempotent';
  end if;
  if (select count(*) from public.makeup_sessions
      where makeup_task_id = (booking->>'makeup_task_id')::uuid and status = 'completed') <> 1 then
    raise exception 'makeup completion did not complete exactly one session';
  end if;
  if (select status from public.makeup_entitlements
      where leave_request_id = first_leave_id) <> 'consumed' then
    raise exception 'makeup completion did not consume entitlement';
  end if;

  rejected := false;
  begin
    perform public.complete_makeup_task('43000000-0000-4000-8000-000000000041');
  exception when others then rejected := true;
  end;
  if not rejected
    or (select status from public.makeup_tasks
        where id = '43000000-0000-4000-8000-000000000041') <> 'pending' then
    raise exception 'pending makeup task without a session was completed';
  end if;

  rejected := false;
  begin
    perform public.complete_makeup_task('43000000-0000-4000-8000-000000000042');
  exception when others then rejected := true;
  end;
  if not rejected
    or (select status from public.makeup_tasks
        where id = '43000000-0000-4000-8000-000000000042') <> 'scheduled' then
    raise exception 'makeup task with no scheduled session was completed';
  end if;

  rejected := false;
  begin
    perform public.complete_makeup_task('43000000-0000-4000-8000-000000000044');
  exception when others then rejected := true;
  end;
  if not rejected
    or (select status from public.makeup_tasks
        where id = '43000000-0000-4000-8000-000000000044') <> 'scheduled'
    or (select count(*) from public.makeup_sessions
        where makeup_task_id = '43000000-0000-4000-8000-000000000044'
          and status = 'completed') <> 0 then
    raise exception 'makeup task with multiple scheduled sessions was completed';
  end if;
end
$$;

select public.recover_parent_account(
  '10000000-0000-4000-8000-000000000000',
  '43000000-0000-4000-8000-000000000031'
);

do $$
begin
  if (select account_status from public.parent_profiles
      where id = '43000000-0000-4000-8000-000000000031') <> 'expired' then
    raise exception 'disabled parent was not moved to controlled re-invite state';
  end if;
  if exists (
    select 1
    from public.push_devices
    where user_id = '43000000-0000-4000-8000-000000000003'
      and installation_id = 'release-parent-installation'
      and is_active
  ) then
    raise exception 'recover_parent_account reactivated a stale device';
  end if;

  if has_table_privilege('authenticated', 'public.organization_members', 'INSERT')
    or has_table_privilege('authenticated', 'public.teacher_profiles', 'UPDATE')
    or has_table_privilege('authenticated', 'public.leave_requests', 'DELETE')
    or has_table_privilege('authenticated', 'public.makeup_tasks', 'UPDATE')
    or has_table_privilege('authenticated', 'public.makeup_sessions', 'UPDATE')
    or has_table_privilege('authenticated', 'public.parent_profiles', 'UPDATE')
    or has_table_privilege('authenticated', 'public.push_devices', 'INSERT') then
    raise exception 'authenticated retained direct lifecycle DML';
  end if;

  if has_function_privilege('anon', 'public.complete_makeup_task(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.recover_parent_account(uuid,uuid)', 'EXECUTE') then
    raise exception 'anonymous role can execute release-gate RPCs';
  end if;

  if not has_function_privilege('authenticated', 'public.recover_parent_account(uuid,uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.complete_makeup_task(uuid)', 'EXECUTE') then
    raise exception 'authenticated role cannot execute required release-gate RPCs';
  end if;
end
$$;

reset role;
select 'admin operations release gate tests passed' as result;
