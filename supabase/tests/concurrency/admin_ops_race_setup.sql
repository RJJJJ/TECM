\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('44000000-0000-4000-8000-000000000001', 'race-teacher@tecm.test')
on conflict (id) do update set email = excluded.email;

delete from public.teacher_profiles
where user_id = '44000000-0000-4000-8000-000000000001';
delete from public.organization_members
where user_id = '44000000-0000-4000-8000-000000000001';

insert into public.leave_requests (
  id, organization_id, student_id, lesson_session_id, requested_by, reason, status, reviewed_by,
  decided_at, idempotency_key
) values (
  '44000000-0000-4000-8000-000000000100',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  'Race booking leave',
  'approved',
  '10000000-0000-4000-8000-000000000001',
  statement_timestamp(),
  'race-makeup-leave'
) on conflict (organization_id, idempotency_key) do update set status = excluded.status;

insert into public.makeup_entitlements (
  id, organization_id, student_id, leave_request_id, units_granted, units_remaining, status,
  expires_at, idempotency_key
) values (
  '44000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '44000000-0000-4000-8000-000000000100',
  1,
  1,
  'available',
  statement_timestamp() + interval '30 days',
  'race-makeup-entitlement'
) on conflict (organization_id, idempotency_key) do update set
  units_remaining = 1,
  status = 'available',
  expires_at = excluded.expires_at;

delete from public.makeup_sessions
where idempotency_key = 'race-makeup-booking'
   or idempotency_key = 'race-same-task-booking'
   or makeup_task_id in (
     '44000000-0000-4000-8000-000000000201',
     '44000000-0000-4000-8000-000000000301'
   );
delete from public.makeup_tasks
where entitlement_id = '44000000-0000-4000-8000-000000000101'
   or id in (
     '44000000-0000-4000-8000-000000000201',
     '44000000-0000-4000-8000-000000000301'
   );
delete from public.communication_logs
where organization_id = '10000000-0000-4000-8000-000000000000'
  and idempotency_key = 'makeup-booked:44000000-0000-4000-8000-000000000301';

insert into public.makeup_entitlements (
  id, organization_id, student_id, leave_request_id, units_granted, units_remaining, status,
  expires_at, idempotency_key
) values (
  '44000000-0000-4000-8000-000000000201',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  null,
  1,
  1,
  'reserved',
  statement_timestamp() + interval '30 days',
  'race-complete-entitlement'
) on conflict (organization_id, idempotency_key) do update set
  units_remaining = 1,
  status = 'reserved',
  expires_at = excluded.expires_at;

insert into public.makeup_tasks (
  id, organization_id, student_id, cohort_id, lesson_plan_id, original_session_id,
  entitlement_id, missed_status, status, parent_visible_summary
) values (
  '44000000-0000-4000-8000-000000000201',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '44000000-0000-4000-8000-000000000201',
  'excused',
  'scheduled',
  'Race completion fixture.'
);

insert into public.makeup_sessions (
  id, organization_id, makeup_task_id, entitlement_id, student_id, teacher_id,
  scheduled_at, status, created_by, idempotency_key
) values (
  '44000000-0000-4000-8000-000000000202',
  '10000000-0000-4000-8000-000000000000',
  '44000000-0000-4000-8000-000000000201',
  '44000000-0000-4000-8000-000000000201',
  '15000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  ((now() at time zone 'Asia/Macau')::date + 31 + time '09:00') at time zone 'Asia/Macau',
  'scheduled',
  '10000000-0000-4000-8000-000000000001',
  'race-complete-session'
);

insert into public.leave_requests (
  id, organization_id, student_id, lesson_session_id, requested_by, reason, status, reviewed_by,
  decided_at, idempotency_key
) values (
  '44000000-0000-4000-8000-000000000300',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  'Same-task race leave',
  'approved',
  '10000000-0000-4000-8000-000000000001',
  statement_timestamp(),
  'race-same-task-leave'
) on conflict (organization_id, idempotency_key) do update set status = excluded.status;

insert into public.makeup_entitlements (
  id, organization_id, student_id, leave_request_id, units_granted, units_remaining, status,
  expires_at, idempotency_key
) values (
  '44000000-0000-4000-8000-000000000301',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '44000000-0000-4000-8000-000000000300',
  1,
  1,
  'available',
  statement_timestamp() + interval '30 days',
  'race-same-task-entitlement'
) on conflict (organization_id, idempotency_key) do update set
  leave_request_id = excluded.leave_request_id,
  units_remaining = 1,
  status = 'available',
  expires_at = excluded.expires_at;

insert into public.makeup_tasks (
  id, organization_id, student_id, cohort_id, lesson_plan_id, original_session_id,
  entitlement_id, missed_status, status, parent_visible_summary
) values (
  '44000000-0000-4000-8000-000000000301',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '44000000-0000-4000-8000-000000000301',
  'excused',
  'scheduled',
  'Same-task booking/completion race fixture.'
);
