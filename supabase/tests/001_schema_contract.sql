\set ON_ERROR_STOP on

do $$
declare missing_count integer;
begin
  select count(*) into missing_count
  from (values
    ('organizations'),('organization_members'),('parent_profiles'),('students'),
    ('teacher_profiles'),('courses'),('exam_cohorts'),('cohort_students'),
    ('lesson_sessions'),('attendance_records'),('leave_requests'),('makeup_entitlements'),
    ('makeup_sessions'),('fee_plans'),('student_packages'),('credit_ledger'),
    ('charges'),('payments'),('communication_logs'),('follow_up_tasks'),('audit_logs')
  ) required(name)
  where to_regclass('public.' || name) is null;
  if missing_count <> 0 then raise exception 'missing % required model relations', missing_count; end if;

  if (select data_type from information_schema.columns where table_schema='public' and table_name='charges' and column_name='amount_minor') <> 'bigint'
     or (select data_type from information_schema.columns where table_schema='public' and table_name='payments' and column_name='amount_minor') <> 'bigint' then
    raise exception 'money is not stored as bigint minor units';
  end if;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in (
      'organization_members','leave_requests','makeup_entitlements','fee_plans','student_packages',
      'credit_ledger','charges','payments','communication_logs','audit_logs','automation_jobs'
    ) and (not c.relrowsecurity or not c.relforcerowsecurity)
  ) then raise exception 'RLS is not enabled and forced on every new tenant table'; end if;

  if has_function_privilege('public', 'public.run_automation_job(uuid,text,text)', 'EXECUTE') then
    raise exception 'automation RPC is executable by PUBLIC';
  end if;
end
$$;

select '001_schema_contract: 21/21 models, bigint money, forced RLS, restricted RPC' as passed;
