\set ON_ERROR_STOP on

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);

do $$
declare
  existing_result jsonb;
  absent_result jsonb;
begin
  existing_result := public.submit_teacher_attendance(
    '1d000000-0000-4000-8000-000000000025',
    '15000000-0000-4000-8000-000000000001',
    'absent', 1, 'operator retry after contention',
    'teacher-attendance-contention-existing-retry'
  );
  if existing_result->>'changed' <> 'true'
     or (existing_result->>'revision')::bigint <> 2 then
    raise exception 'existing-row retry did not follow the revision contract';
  end if;

  absent_result := public.submit_teacher_attendance(
    '1d000000-0000-4000-8000-000000000026',
    '15000000-0000-4000-8000-000000000001',
    'excused', null, 'operator retry after contention',
    'teacher-attendance-contention-absent-retry'
  );
  if absent_result->>'changed' <> 'true'
     or (absent_result->>'revision')::bigint <> 1 then
    raise exception 'absent-row retry did not follow the null-revision contract';
  end if;
end
$$;

reset role;

do $$
begin
  if (select count(*) from public.audit_logs
      where new_data->'attendance_history'->>'request_id' =
        'teacher-attendance-contention-existing-retry') <> 1
     or (select count(*) from public.audit_logs
         where new_data->'attendance_history'->>'request_id' =
           'teacher-attendance-contention-absent-retry') <> 1 then
    raise exception 'post-contention retries did not create exactly one audit each';
  end if;
  if exists (
    select 1 from public.audit_logs
    where new_data->'attendance_history'->>'request_id' in (
      'teacher-attendance-contention-existing-rejected',
      'teacher-attendance-contention-absent-rejected'
    )
  ) then
    raise exception 'rejected contention request produced audit residue';
  end if;
end
$$;

insert into public.__test_teacher_attendance_contention_context (
  race, session_id, student_id, attendance_id, initial_status, initial_revision
)
select 'teacher-attendance-contention-absent-created', session_id, student_id, id, status, revision
from public.attendance_records
where session_id = '1d000000-0000-4000-8000-000000000026'
  and student_id = '15000000-0000-4000-8000-000000000001';

alter table public.credit_ledger disable trigger trg_credit_ledger_append_only;
delete from public.credit_ledger
where source_type = 'attendance_records'
  and source_id in (
    select attendance_id
    from public.__test_teacher_attendance_contention_context
    where attendance_id is not null
  );
alter table public.credit_ledger enable trigger trg_credit_ledger_append_only;

delete from public.attendance_records
where session_id in (
  '1d000000-0000-4000-8000-000000000025',
  '1d000000-0000-4000-8000-000000000026'
);
alter table public.audit_logs disable trigger trg_audit_logs_append_only;
delete from public.audit_logs
where record_id in (
  select attendance_id::text
  from public.__test_teacher_attendance_contention_context
  where attendance_id is not null
)
or (
  table_name = 'attendance_records'
  and coalesce(
    new_data->'attendance_history'->>'session_id',
    old_data->'attendance_history'->>'session_id'
  ) in (
    '1d000000-0000-4000-8000-000000000025',
    '1d000000-0000-4000-8000-000000000026'
  )
)
or (
  table_name = 'credit_ledger'
  and coalesce(new_data->>'source_type', old_data->>'source_type') = 'attendance_records'
  and coalesce(new_data->>'source_id', old_data->>'source_id') in (
    select attendance_id::text
    from public.__test_teacher_attendance_contention_context
    where attendance_id is not null
  )
)
or (
  table_name = 'makeup_tasks'
  and coalesce(
    new_data->>'attendance_record_id',
    old_data->>'attendance_record_id'
  ) in (
    select attendance_id::text
    from public.__test_teacher_attendance_contention_context
    where attendance_id is not null
  )
);
alter table public.audit_logs enable trigger trg_audit_logs_append_only;
delete from public.lesson_sessions
where id in (
  '1d000000-0000-4000-8000-000000000025',
  '1d000000-0000-4000-8000-000000000026'
);

do $$
declare
  baseline_counts jsonb;
  current_counts jsonb;
  count_differences jsonb;
  related_audit_rows jsonb;
begin
  select business_counts into baseline_counts
  from public.__test_teacher_attendance_contention_snapshot
  where label = 'pre-fixture';
  current_counts := public.__test_teacher_attendance_business_counts();

  if current_counts <> baseline_counts then
    select jsonb_object_agg(key, jsonb_build_object(
      'before', baseline_counts->key,
      'after', current_counts->key
    ))
    into count_differences
    from jsonb_object_keys(baseline_counts || current_counts) as key
    where baseline_counts->key is distinct from current_counts->key;

    select jsonb_agg(jsonb_build_object(
      'table_name', table_name,
      'action', action,
      'record_id', record_id,
      'source_type', coalesce(new_data->>'source_type', old_data->>'source_type'),
      'source_id', coalesce(new_data->>'source_id', old_data->>'source_id'),
      'request_id', coalesce(
        new_data->'attendance_history'->>'request_id',
        old_data->'attendance_history'->>'request_id'
      )
    ) order by occurred_at)
    into related_audit_rows
    from public.audit_logs
    where record_id in (
      select attendance_id::text
      from public.__test_teacher_attendance_contention_context
      where attendance_id is not null
    )
    or coalesce(new_data->>'source_id', old_data->>'source_id') in (
      select attendance_id::text
      from public.__test_teacher_attendance_contention_context
      where attendance_id is not null
    )
    or coalesce(
      new_data->'attendance_history'->>'session_id',
      old_data->'attendance_history'->>'session_id'
    ) in (
      '1d000000-0000-4000-8000-000000000025',
      '1d000000-0000-4000-8000-000000000026'
    );

    raise exception 'teacher attendance contention fixture cleanup left business residue: %, related audit rows: %',
      count_differences, related_audit_rows;
  end if;
end
$$;

delete from public.__test_race_barrier
where race in ('teacher-attendance-contention-existing', 'teacher-attendance-contention-absent');
drop function public.__test_teacher_attendance_business_counts();
drop table public.__test_teacher_attendance_contention_result;
drop table public.__test_teacher_attendance_contention_context;
drop table public.__test_teacher_attendance_contention_snapshot;

select 'teacher attendance contention: deliberate retries passed and synthetic state cleanup PASS' as passed;
