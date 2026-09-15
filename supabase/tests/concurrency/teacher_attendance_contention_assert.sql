\set ON_ERROR_STOP on

select set_config('app.test_race', :'race_name', false);

do $$
declare
  context_row public.__test_teacher_attendance_contention_context%rowtype;
  result_row public.__test_teacher_attendance_contention_result%rowtype;
begin
  select * into context_row
  from public.__test_teacher_attendance_contention_context
  where race = current_setting('app.test_race');
  if context_row.race is null then
    raise exception 'contention context is missing';
  end if;

  select * into result_row
  from public.__test_teacher_attendance_contention_result
  where race = current_setting('app.test_race');
  if result_row.classification <> 'attendance update is already in progress'
     or result_row.elapsed_milliseconds >= 2000 then
    raise exception 'contention result is missing or not bounded';
  end if;

  if public.__test_teacher_attendance_business_counts() <>
     (select business_counts
      from public.__test_teacher_attendance_contention_snapshot
      where label = 'contention-baseline') then
    raise exception 'contention rejection changed business-table row counts';
  end if;

  if context_row.attendance_id is null then
    if exists (
      select 1 from public.attendance_records
      where session_id = context_row.session_id
        and student_id = context_row.student_id
    ) then
      raise exception 'absent-row contention created an attendance row';
    end if;
  else
    if not exists (
      select 1 from public.attendance_records
      where id = context_row.attendance_id
        and status = context_row.initial_status
        and revision = context_row.initial_revision
    ) then
      raise exception 'existing-row contention changed status or revision';
    end if;
    if (select count(*) from public.attendance_records
        where session_id = context_row.session_id
          and student_id = context_row.student_id) <> 1 then
      raise exception 'existing-row contention duplicated attendance';
    end if;
  end if;

  if exists (
    select 1 from public.audit_logs
    where table_name = 'attendance_records'
      and new_data->'attendance_history'->>'request_id' =
        case current_setting('app.test_race')
          when 'teacher-attendance-contention-existing' then 'teacher-attendance-contention-existing-rejected'
          else 'teacher-attendance-contention-absent-rejected'
        end
  ) then
    raise exception 'contention rejection created an audit row';
  end if;
end
$$;

select 'teacher attendance contention: bounded rejection, no mutation, no audit/outbox/business side effect' as passed;
