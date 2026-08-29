\set ON_ERROR_STOP on

create table if not exists public.__test_teacher_attendance_contention_snapshot (
  label text primary key,
  business_counts jsonb not null
);
create table if not exists public.__test_teacher_attendance_contention_context (
  race text primary key,
  session_id uuid not null,
  student_id uuid not null,
  attendance_id uuid,
  initial_status text,
  initial_revision bigint
);
create table if not exists public.__test_teacher_attendance_contention_result (
  race text primary key,
  classification text not null,
  elapsed_milliseconds numeric not null
);
grant select, insert, update, delete on
  public.__test_teacher_attendance_contention_snapshot,
  public.__test_teacher_attendance_contention_context,
  public.__test_teacher_attendance_contention_result
to authenticated, service_role;

create or replace function public.__test_teacher_attendance_business_counts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  table_row record;
  row_count bigint;
  result jsonb := '{}'::jsonb;
begin
  for table_row in
    select tablename
    from pg_catalog.pg_tables
    where schemaname = 'public'
      and tablename not like '\_\_test\_%' escape '\'
    order by tablename
  loop
    execute format('select count(*) from public.%I', table_row.tablename) into row_count;
    result := result || jsonb_build_object(table_row.tablename, row_count);
  end loop;
  return result;
end;
$$;
revoke all on function public.__test_teacher_attendance_business_counts() from public;
grant execute on function public.__test_teacher_attendance_business_counts() to authenticated, service_role;

alter table public.credit_ledger disable trigger trg_credit_ledger_append_only;
delete from public.credit_ledger
where source_type = 'attendance_records'
  and source_id in (
    select id from public.attendance_records
    where session_id in (
      '1d000000-0000-4000-8000-000000000025',
      '1d000000-0000-4000-8000-000000000026'
    )
  );
alter table public.credit_ledger enable trigger trg_credit_ledger_append_only;
delete from public.attendance_records
where session_id in (
  '1d000000-0000-4000-8000-000000000025',
  '1d000000-0000-4000-8000-000000000026'
);
alter table public.audit_logs disable trigger trg_audit_logs_append_only;
delete from public.audit_logs
where (
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
    select record_id
    from public.audit_logs
    where table_name = 'attendance_records'
      and coalesce(
        new_data->'attendance_history'->>'session_id',
        old_data->'attendance_history'->>'session_id'
      ) in (
        '1d000000-0000-4000-8000-000000000025',
        '1d000000-0000-4000-8000-000000000026'
      )
  )
)
or (
  table_name = 'makeup_tasks'
  and coalesce(
    new_data->>'attendance_record_id',
    old_data->>'attendance_record_id'
  ) in (
    select record_id
    from public.audit_logs
    where table_name = 'attendance_records'
      and coalesce(
        new_data->'attendance_history'->>'session_id',
        old_data->'attendance_history'->>'session_id'
      ) in (
        '1d000000-0000-4000-8000-000000000025',
        '1d000000-0000-4000-8000-000000000026'
      )
  )
);
alter table public.audit_logs enable trigger trg_audit_logs_append_only;
delete from public.lesson_sessions
where id in (
  '1d000000-0000-4000-8000-000000000025',
  '1d000000-0000-4000-8000-000000000026'
);
delete from public.__test_race_barrier
where race in ('teacher-attendance-contention-existing', 'teacher-attendance-contention-absent');
truncate public.__test_teacher_attendance_contention_context,
         public.__test_teacher_attendance_contention_result,
         public.__test_teacher_attendance_contention_snapshot;

insert into public.__test_teacher_attendance_contention_snapshot (label, business_counts)
values ('pre-fixture', public.__test_teacher_attendance_business_counts());

insert into public.lesson_sessions (
  id, cohort_id, lesson_plan_id, teacher_id, starts_at, ends_at, status, organization_id
) values
  (
    '1d000000-0000-4000-8000-000000000025',
    '1a000000-0000-4000-8000-000000000001',
    '1c000000-0000-4000-8000-000000000001',
    '19000000-0000-4000-8000-000000000001',
    now() - interval '2 hours', now() - interval '1 hour', 'completed',
    '10000000-0000-4000-8000-000000000000'
  ),
  (
    '1d000000-0000-4000-8000-000000000026',
    '1a000000-0000-4000-8000-000000000001',
    '1c000000-0000-4000-8000-000000000001',
    '19000000-0000-4000-8000-000000000001',
    now() - interval '2 hours', now() - interval '1 hour', 'completed',
    '10000000-0000-4000-8000-000000000000'
  );

with inserted as (
  insert into public.attendance_records (
    organization_id, session_id, student_id, status, recorded_by, recorded_at
  ) values (
    '10000000-0000-4000-8000-000000000000',
    '1d000000-0000-4000-8000-000000000025',
    '15000000-0000-4000-8000-000000000001',
    'present', '10000000-0000-4000-8000-000000000001', statement_timestamp()
  )
  returning id, session_id, student_id, status, revision
)
insert into public.__test_teacher_attendance_contention_context (
  race, session_id, student_id, attendance_id, initial_status, initial_revision
)
select 'teacher-attendance-contention-existing', session_id, student_id, id, status, revision
from inserted;

insert into public.__test_teacher_attendance_contention_context (
  race, session_id, student_id, attendance_id, initial_status, initial_revision
) values (
  'teacher-attendance-contention-absent',
  '1d000000-0000-4000-8000-000000000026',
  '15000000-0000-4000-8000-000000000001',
  null, null, null
);

insert into public.__test_teacher_attendance_contention_snapshot (label, business_counts)
values ('contention-baseline', public.__test_teacher_attendance_business_counts());

select 'teacher attendance contention fixture: existing and absent identities ready' as passed;
