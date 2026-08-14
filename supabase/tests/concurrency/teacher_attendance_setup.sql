\set ON_ERROR_STOP on

insert into public.lesson_sessions (
  id, cohort_id, lesson_plan_id, teacher_id, starts_at, ends_at, status, organization_id
) values (
  '1d000000-0000-4000-8000-000000000019',
  '1a000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001',
  now() - interval '2 hours', now() - interval '1 hour', 'completed',
  '10000000-0000-4000-8000-000000000000'
) on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at, status = excluded.status;

delete from public.attendance_records
where session_id = '1d000000-0000-4000-8000-000000000019'
  and student_id = '15000000-0000-4000-8000-000000000001';
