\set ON_ERROR_STOP on

delete from public.makeup_sessions
where idempotency_key in (
  'partial-recovery-pending-booking',
  'partial-recovery-recommended-booking',
  'partial-recovery-reserved-booking',
  'partial-recovery-existing-booking',
  'partial-recovery-org-mismatch-session'
)
or makeup_task_id in (
  '45000000-0000-4000-8000-000000000101',
  '45000000-0000-4000-8000-000000000201',
  '45000000-0000-4000-8000-000000000301',
  '45000000-0000-4000-8000-000000000401',
  '45000000-0000-4000-8000-000000000402',
  '45000000-0000-4000-8000-000000000403',
  '45000000-0000-4000-8000-000000000501',
  '45000000-0000-4000-8000-000000000601'
);
delete from public.makeup_tasks
where id in (
  '45000000-0000-4000-8000-000000000101',
  '45000000-0000-4000-8000-000000000201',
  '45000000-0000-4000-8000-000000000301',
  '45000000-0000-4000-8000-000000000401',
  '45000000-0000-4000-8000-000000000402',
  '45000000-0000-4000-8000-000000000403',
  '45000000-0000-4000-8000-000000000501',
  '45000000-0000-4000-8000-000000000601'
);
delete from public.communication_logs
where organization_id = '10000000-0000-4000-8000-000000000000'
  and idempotency_key in (
    'makeup-booked:45000000-0000-4000-8000-000000000101',
    'makeup-booked:45000000-0000-4000-8000-000000000201',
    'makeup-booked:45000000-0000-4000-8000-000000000301',
    'makeup-booked:45000000-0000-4000-8000-000000000401',
    'makeup-booked:45000000-0000-4000-8000-000000000402',
    'makeup-booked:45000000-0000-4000-8000-000000000403'
  );
delete from public.makeup_entitlements
where id in (
  '45000000-0000-4000-8000-000000000101',
  '45000000-0000-4000-8000-000000000201',
  '45000000-0000-4000-8000-000000000301',
  '45000000-0000-4000-8000-000000000401',
  '45000000-0000-4000-8000-000000000402',
  '45000000-0000-4000-8000-000000000403',
  '45000000-0000-4000-8000-000000000501',
  '45000000-0000-4000-8000-000000000601'
);
delete from public.leave_requests
where id in (
  '45000000-0000-4000-8000-000000000100',
  '45000000-0000-4000-8000-000000000200',
  '45000000-0000-4000-8000-000000000300',
  '45000000-0000-4000-8000-000000000400',
  '45000000-0000-4000-8000-000000000410',
  '45000000-0000-4000-8000-000000000420',
  '45000000-0000-4000-8000-000000000500',
  '45000000-0000-4000-8000-000000000600'
);

insert into public.leave_requests (
  id, organization_id, student_id, lesson_session_id, requested_by, reason, status, reviewed_by,
  decided_at, idempotency_key
) values
(
  '45000000-0000-4000-8000-000000000100',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  'Partial recovery pending',
  'approved',
  '10000000-0000-4000-8000-000000000001',
  statement_timestamp(),
  'partial-recovery-pending-leave'
),
(
  '45000000-0000-4000-8000-000000000200',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  'Partial recovery recommended',
  'approved',
  '10000000-0000-4000-8000-000000000001',
  statement_timestamp(),
  'partial-recovery-recommended-leave'
),
(
  '45000000-0000-4000-8000-000000000300',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  'Partial recovery reserved',
  'approved',
  '10000000-0000-4000-8000-000000000001',
  statement_timestamp(),
  'partial-recovery-reserved-leave'
),
(
  '45000000-0000-4000-8000-000000000400',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  'Partial recovery terminal',
  'approved',
  '10000000-0000-4000-8000-000000000001',
  statement_timestamp(),
  'partial-recovery-terminal-completed-leave'
),
(
  '45000000-0000-4000-8000-000000000410',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  'Partial recovery terminal waived',
  'approved',
  '10000000-0000-4000-8000-000000000001',
  statement_timestamp(),
  'partial-recovery-terminal-waived-leave'
),
(
  '45000000-0000-4000-8000-000000000420',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  'Partial recovery terminal cancelled',
  'approved',
  '10000000-0000-4000-8000-000000000001',
  statement_timestamp(),
  'partial-recovery-terminal-cancelled-leave'
),
(
  '45000000-0000-4000-8000-000000000600',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  'Partial recovery ID mismatch',
  'approved',
  '10000000-0000-4000-8000-000000000001',
  statement_timestamp(),
  'partial-recovery-id-mismatch-leave'
),
(
  '45000000-0000-4000-8000-000000000500',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  'Partial recovery existing session',
  'approved',
  '10000000-0000-4000-8000-000000000001',
  statement_timestamp(),
  'partial-recovery-existing-leave'
) on conflict (organization_id, idempotency_key) do update set status = excluded.status;

insert into public.makeup_entitlements (
  id, organization_id, student_id, leave_request_id, units_granted, units_remaining, status,
  expires_at, idempotency_key
) values
(
  '45000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '45000000-0000-4000-8000-000000000100',
  1, 1, 'available', statement_timestamp() + interval '30 days',
  'partial-recovery-pending-entitlement'
),
(
  '45000000-0000-4000-8000-000000000201',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '45000000-0000-4000-8000-000000000200',
  1, 1, 'available', statement_timestamp() + interval '30 days',
  'partial-recovery-recommended-entitlement'
),
(
  '45000000-0000-4000-8000-000000000301',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '45000000-0000-4000-8000-000000000300',
  1, 1, 'reserved', statement_timestamp() + interval '30 days',
  'partial-recovery-reserved-entitlement'
),
(
  '45000000-0000-4000-8000-000000000401',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '45000000-0000-4000-8000-000000000400',
  1, 1, 'available', statement_timestamp() + interval '30 days',
  'partial-recovery-completed-entitlement'
),
(
  '45000000-0000-4000-8000-000000000402',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '45000000-0000-4000-8000-000000000410',
  1, 1, 'available', statement_timestamp() + interval '30 days',
  'partial-recovery-waived-entitlement'
),
(
  '45000000-0000-4000-8000-000000000403',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '45000000-0000-4000-8000-000000000420',
  1, 1, 'available', statement_timestamp() + interval '30 days',
  'partial-recovery-cancelled-entitlement'
),
(
  '45000000-0000-4000-8000-000000000501',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '45000000-0000-4000-8000-000000000500',
  1, 1, 'reserved', statement_timestamp() + interval '30 days',
  'partial-recovery-existing-entitlement'
),
(
  '45000000-0000-4000-8000-000000000601',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '45000000-0000-4000-8000-000000000600',
  1, 1, 'reserved', statement_timestamp() + interval '30 days',
  'partial-recovery-id-mismatch-entitlement'
) on conflict (organization_id, idempotency_key) do update set
  units_remaining = excluded.units_remaining,
  status = excluded.status,
  expires_at = excluded.expires_at;

insert into public.makeup_tasks (
  id, organization_id, student_id, cohort_id, lesson_plan_id, original_session_id,
  entitlement_id, missed_status, status, parent_visible_summary
) values
(
  '45000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '45000000-0000-4000-8000-000000000101',
  'excused', 'pending', 'Pending orphaned task.'
),
(
  '45000000-0000-4000-8000-000000000201',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '45000000-0000-4000-8000-000000000201',
  'excused', 'recommended', 'Recommended orphaned task.'
),
(
  '45000000-0000-4000-8000-000000000301',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '45000000-0000-4000-8000-000000000301',
  'excused', 'scheduled', 'Reserved orphaned task.'
),
(
  '45000000-0000-4000-8000-000000000401',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '45000000-0000-4000-8000-000000000401',
  'excused', 'completed', 'Terminal completed task.'
),
(
  '45000000-0000-4000-8000-000000000402',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '45000000-0000-4000-8000-000000000402',
  'excused', 'waived', 'Terminal waived task.'
),
(
  '45000000-0000-4000-8000-000000000403',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '45000000-0000-4000-8000-000000000403',
  'excused', 'cancelled', 'Terminal cancelled task.'
),
(
  '45000000-0000-4000-8000-000000000501',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '45000000-0000-4000-8000-000000000501',
  'excused', 'scheduled', 'Scheduled task with existing idempotent session.'
),
(
  '45000000-0000-4000-8000-000000000601',
  '10000000-0000-4000-8000-000000000000',
  '15000000-0000-4000-8000-000000000001',
  '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000003',
  '45000000-0000-4000-8000-000000000601',
  'excused', 'scheduled', 'Task with cross-org entitlement pointer.'
);

insert into public.makeup_sessions (
  id, organization_id, makeup_task_id, entitlement_id, student_id, teacher_id,
  scheduled_at, status, created_by, idempotency_key
) values
(
  '45000000-0000-4000-8000-000000000502',
  '10000000-0000-4000-8000-000000000000',
  '45000000-0000-4000-8000-000000000501',
  '45000000-0000-4000-8000-000000000501',
  '15000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  ((now() at time zone 'Asia/Macau')::date + 35 + time '09:00') at time zone 'Asia/Macau',
  'scheduled',
  '10000000-0000-4000-8000-000000000001',
  'partial-recovery-existing-booking'
),
(
  '45000000-0000-4000-8000-000000000602',
  '10000000-0000-4000-8000-000000000000',
  '45000000-0000-4000-8000-000000000601',
  '45000000-0000-4000-8000-000000000501',
  '15000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  ((now() at time zone 'Asia/Macau')::date + 36 + time '09:00') at time zone 'Asia/Macau',
  'scheduled',
  '10000000-0000-4000-8000-000000000001',
  'partial-recovery-org-mismatch-session'
);

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);

do $$
declare
  pending_booking jsonb;
  pending_replay jsonb;
  recommended_booking jsonb;
  reserved_booking jsonb;
  existing_booking jsonb;
  completion jsonb;
  completion_replay jsonb;
  rejected boolean;
  terminal record;
begin
  pending_booking := public.book_makeup_session(
    '10000000-0000-4000-8000-000000000000',
    '45000000-0000-4000-8000-000000000101',
    '19000000-0000-4000-8000-000000000001',
    ((now() at time zone 'Asia/Macau')::date + 32 + time '09:00') at time zone 'Asia/Macau',
    'partial-recovery-pending-booking'
  );
  pending_replay := public.book_makeup_session(
    '10000000-0000-4000-8000-000000000000',
    '45000000-0000-4000-8000-000000000101',
    '19000000-0000-4000-8000-000000000001',
    ((now() at time zone 'Asia/Macau')::date + 32 + time '09:00') at time zone 'Asia/Macau',
    'partial-recovery-pending-booking'
  );
  if pending_booking->>'status' <> 'created'
    or pending_replay->>'status' <> 'existing'
    or pending_booking->>'makeup_task_id' <> '45000000-0000-4000-8000-000000000101'
    or pending_replay->>'makeup_session_id' <> pending_booking->>'makeup_session_id'
    or (select count(*) from public.makeup_sessions
        where makeup_task_id = '45000000-0000-4000-8000-000000000101') <> 1 then
    raise exception 'pending orphan recovery was not exactly-once';
  end if;

  recommended_booking := public.book_makeup_session(
    '10000000-0000-4000-8000-000000000000',
    '45000000-0000-4000-8000-000000000201',
    '19000000-0000-4000-8000-000000000001',
    ((now() at time zone 'Asia/Macau')::date + 33 + time '09:00') at time zone 'Asia/Macau',
    'partial-recovery-recommended-booking'
  );
  if recommended_booking->>'status' <> 'created'
    or recommended_booking->>'makeup_task_id' <> '45000000-0000-4000-8000-000000000201'
    or (select status from public.makeup_tasks
        where id = '45000000-0000-4000-8000-000000000201') <> 'scheduled' then
    raise exception 'recommended orphan recovery was not scheduled';
  end if;

  reserved_booking := public.book_makeup_session(
    '10000000-0000-4000-8000-000000000000',
    '45000000-0000-4000-8000-000000000301',
    '19000000-0000-4000-8000-000000000001',
    ((now() at time zone 'Asia/Macau')::date + 34 + time '09:00') at time zone 'Asia/Macau',
    'partial-recovery-reserved-booking'
  );
  if reserved_booking->>'status' <> 'created'
    or reserved_booking->>'makeup_task_id' <> '45000000-0000-4000-8000-000000000301' then
    raise exception 'reserved orphaned task was not recovered during booking';
  end if;

  for terminal in
    select * from (values
      ('45000000-0000-4000-8000-000000000401'::uuid, 'partial-recovery-terminal-completed'),
      ('45000000-0000-4000-8000-000000000402'::uuid, 'partial-recovery-terminal-waived'),
      ('45000000-0000-4000-8000-000000000403'::uuid, 'partial-recovery-terminal-cancelled')
    ) as t(entitlement_id, idem)
  loop
    rejected := false;
    begin
      perform public.book_makeup_session(
        '10000000-0000-4000-8000-000000000000',
        terminal.entitlement_id,
        '19000000-0000-4000-8000-000000000001',
        ((now() at time zone 'Asia/Macau')::date + 37 + time '09:00') at time zone 'Asia/Macau',
        terminal.idem
      );
    exception when others then rejected := true;
    end;
    if not rejected then raise exception 'terminal task accepted booking: %', terminal.entitlement_id; end if;
  end loop;
  if exists (
    select 1
    from public.makeup_sessions
    where makeup_task_id in (
      '45000000-0000-4000-8000-000000000401',
      '45000000-0000-4000-8000-000000000402',
      '45000000-0000-4000-8000-000000000403'
    )
  ) or exists (
    select 1
    from public.communication_logs
    where idempotency_key in (
      'makeup-booked:45000000-0000-4000-8000-000000000401',
      'makeup-booked:45000000-0000-4000-8000-000000000402',
      'makeup-booked:45000000-0000-4000-8000-000000000403'
    )
  ) then
    raise exception 'terminal booking rejection left a session or communication side effect';
  end if;

  existing_booking := public.book_makeup_session(
    '10000000-0000-4000-8000-000000000000',
    '45000000-0000-4000-8000-000000000501',
    '19000000-0000-4000-8000-000000000001',
    ((now() at time zone 'Asia/Macau')::date + 35 + time '09:00') at time zone 'Asia/Macau',
    'partial-recovery-existing-booking'
  );
  if existing_booking->>'status' <> 'existing'
    or existing_booking->>'makeup_session_id' <> '45000000-0000-4000-8000-000000000502' then
    raise exception 'scheduled idempotent booking did not return existing session';
  end if;

  rejected := false;
  begin
    perform public.book_makeup_session(
      '10000000-0000-4000-8000-000000000000',
      '45000000-0000-4000-8000-000000000501',
      '19000000-0000-4000-8000-000000000002',
      ((now() at time zone 'Asia/Macau')::date + 35 + time '09:00') at time zone 'Asia/Macau',
      'partial-recovery-existing-booking'
    );
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'scheduled idempotency mismatch was accepted'; end if;

  completion := public.complete_makeup_task('45000000-0000-4000-8000-000000000101');
  completion_replay := public.complete_makeup_task('45000000-0000-4000-8000-000000000101');
  if completion->>'status' <> 'completed'
    or completion_replay->>'status' <> 'existing'
    or (select status from public.makeup_entitlements
        where id = '45000000-0000-4000-8000-000000000101') <> 'consumed' then
    raise exception 'canonical completion did not complete idempotently';
  end if;

  rejected := false;
  begin
    perform public.complete_makeup_task('45000000-0000-4000-8000-000000000601');
  exception when others then rejected := true;
  end;
  if not rejected
    or (select status from public.makeup_tasks
        where id = '45000000-0000-4000-8000-000000000601') <> 'scheduled'
    or (select status from public.makeup_sessions
        where id = '45000000-0000-4000-8000-000000000602') <> 'scheduled' then
    raise exception 'completion did not reject and preserve session entitlement mismatch';
  end if;
end
$$;

reset role;
select 'makeup partial state recovery tests passed' as result;
