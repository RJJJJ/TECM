\set ON_ERROR_STOP on

do $$
declare
  first_audit_count integer;
  second_audit_count integer;
  final_status text;
begin
  if (select count(*) from public.attendance_records
      where session_id = '1d000000-0000-4000-8000-000000000023'
        and student_id = '15000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'existing teacher attendance race did not leave exactly one row';
  end if;
  select status into final_status
  from public.attendance_records
  where session_id = '1d000000-0000-4000-8000-000000000023'
    and student_id = '15000000-0000-4000-8000-000000000001';
  if final_status not in ('absent', 'excused') then
    raise exception 'existing teacher attendance race stored an unexpected status';
  end if;
  if (select revision from public.attendance_records
      where session_id = '1d000000-0000-4000-8000-000000000023'
        and student_id = '15000000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'existing teacher attendance race did not advance exactly once';
  end if;

  select count(*) filter (where new_data->'attendance_history'->>'request_id' = 'teacher-attendance-existing-first'),
         count(*) filter (where new_data->'attendance_history'->>'request_id' = 'teacher-attendance-existing-second')
    into first_audit_count, second_audit_count
  from public.audit_logs
  where table_name = 'attendance_records'
    and action = 'UPDATE'
    and new_data->'attendance_history'->>'session_id' = '1d000000-0000-4000-8000-000000000023'
    and new_data->'attendance_history'->>'student_id' = '15000000-0000-4000-8000-000000000001';

  if not (
    (first_audit_count = 1 and second_audit_count = 0 and final_status = 'absent')
    or (first_audit_count = 0 and second_audit_count = 1 and final_status = 'excused')
  ) then
    raise exception 'existing teacher attendance race winner/loser audit or value mismatch';
  end if;
  if (select count(*) from public.notifications) <>
       (select notification_count from public.__test_teacher_attendance_side_effect_baseline where race = 'teacher-attendance-existing')
     or (select count(*) from public.notification_outbox) <>
       (select outbox_count from public.__test_teacher_attendance_side_effect_baseline where race = 'teacher-attendance-existing') then
    raise exception 'existing teacher attendance race created an unexpected notification outbox side effect';
  end if;
end
$$;

select 'existing teacher attendance concurrency: one winner, one stale rejection, revision 2, one audit, no outbox' as passed;
