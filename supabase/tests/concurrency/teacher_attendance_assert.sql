\set ON_ERROR_STOP on

do $$
declare
  first_audit_count integer;
  second_audit_count integer;
begin
  if (select count(*) from public.attendance_records
      where session_id = '1d000000-0000-4000-8000-000000000019'
        and student_id = '15000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'teacher attendance race did not leave exactly one row';
  end if;
  if (select status from public.attendance_records
      where session_id = '1d000000-0000-4000-8000-000000000019'
        and student_id = '15000000-0000-4000-8000-000000000001') not in ('absent', 'excused') then
    raise exception 'teacher attendance race stored an unexpected status';
  end if;
  select count(*) filter (where new_data->'attendance_history'->>'request_id' = 'teacher-attendance-race-first'),
         count(*) filter (where new_data->'attendance_history'->>'request_id' = 'teacher-attendance-race-second')
    into first_audit_count, second_audit_count
  from public.audit_logs
  where table_name = 'attendance_records'
    and new_data->'attendance_history'->>'session_id' = '1d000000-0000-4000-8000-000000000019'
    and new_data->'attendance_history'->>'student_id' = '15000000-0000-4000-8000-000000000001'
    and action = 'INSERT';

  if not (
    (first_audit_count = 1 and second_audit_count = 0)
    or (first_audit_count = 0 and second_audit_count = 1)
  ) then
    raise exception 'teacher attendance race did not create exactly one winner audit in its request namespace';
  end if;
end
$$;

select 'teacher attendance concurrency: one winner, one stale rejection, one scoped audit row' as passed;
