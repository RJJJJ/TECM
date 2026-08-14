\set ON_ERROR_STOP on

do $$
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
  if (select count(*) from public.audit_logs
      where table_name = 'attendance_records'
        and new_data->'attendance_history'->>'session_id' = '1d000000-0000-4000-8000-000000000019'
        and action = 'INSERT') <> 1 then
    raise exception 'teacher attendance race created duplicate audit rows';
  end if;
end
$$;

select 'teacher attendance concurrency: one winner, one stale rejection, one audit row' as passed;
