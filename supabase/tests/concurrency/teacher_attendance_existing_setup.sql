\set ON_ERROR_STOP on

insert into public.lesson_sessions (
  id, cohort_id, lesson_plan_id, teacher_id, starts_at, ends_at, status, organization_id
) values (
  '1d000000-0000-4000-8000-000000000023',
  '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  now() - interval '2 hours', now() - interval '1 hour', 'completed',
  '10000000-0000-4000-8000-000000000000'
) on conflict (id) do update
set starts_at = excluded.starts_at, ends_at = excluded.ends_at, status = excluded.status;

delete from public.attendance_records
where session_id = '1d000000-0000-4000-8000-000000000023'
  and student_id = '15000000-0000-4000-8000-000000000001';

insert into public.attendance_records (
  organization_id, session_id, student_id, status, recorded_by, recorded_at
) values (
  '10000000-0000-4000-8000-000000000000',
  '1d000000-0000-4000-8000-000000000023',
  '15000000-0000-4000-8000-000000000001',
  'present', '10000000-0000-4000-8000-000000000001', statement_timestamp()
);

insert into public.__test_teacher_attendance_side_effect_baseline (race, notification_count, outbox_count)
values (
  'teacher-attendance-existing',
  (select count(*) from public.notifications),
  (select count(*) from public.notification_outbox)
)
on conflict (race) do update
set notification_count = excluded.notification_count,
    outbox_count = excluded.outbox_count;
