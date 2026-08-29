\set ON_ERROR_STOP on

-- Synthetic-only fixtures for enrollment state, parent multi-student access,
-- and tenant denial. No production or real child data is used.
insert into public.students (id, organization_id, display_name, status) values
  ('51000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000000','UAT Student New','active'),
  ('51000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000000','UAT Student Restore','active'),
  ('51000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000000','UAT Student Second','active'),
  ('52000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000000','Other Tenant Student','active')
on conflict (id) do update set status = excluded.status;

insert into public.exam_cohorts (
  id, organization_id, name, subject, level, exam_date, weekday_pattern,
  course_id, campus_id, lead_teacher_id, status
) values (
  '51000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000000','UAT Core Cohort','Python','Foundation',
  current_date + 90,'saturday','18000000-0000-4000-8000-000000000001',
  '17000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001','active'
) on conflict (id) do update set status = 'active';

insert into public.cohort_students (
  id, organization_id, cohort_id, student_id, status, left_at
) values (
  '51000000-0000-4000-8000-000000000020','10000000-0000-4000-8000-000000000000',
  '51000000-0000-4000-8000-000000000010','51000000-0000-4000-8000-000000000002',
  'withdrawn',current_date - 5
) on conflict (cohort_id,student_id) do update set status='withdrawn',left_at=current_date-5;

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);

do $$
declare
  first_result jsonb;
  replay_result jsonb;
  restored_result jsonb;
  rejected boolean := false;
begin
  first_result := public.enroll_student_in_cohort(
    '10000000-0000-4000-8000-000000000000',
    '51000000-0000-4000-8000-000000000010',
    '51000000-0000-4000-8000-000000000001'
  );
  if first_result->>'status' <> 'created' then raise exception 'new enrollment was not created'; end if;

  replay_result := public.enroll_student_in_cohort(
    '10000000-0000-4000-8000-000000000000',
    '51000000-0000-4000-8000-000000000010',
    '51000000-0000-4000-8000-000000000001'
  );
  if replay_result->>'status' <> 'existing'
    or replay_result->>'enrollment_id' <> first_result->>'enrollment_id' then
    raise exception 'duplicate enrollment was not an idempotent visible success';
  end if;

  restored_result := public.enroll_student_in_cohort(
    '10000000-0000-4000-8000-000000000000',
    '51000000-0000-4000-8000-000000000010',
    '51000000-0000-4000-8000-000000000002'
  );
  if restored_result->>'status' <> 'reactivated' then raise exception 'inactive enrollment was not reactivated'; end if;

  begin
    perform public.enroll_student_in_cohort(
      '10000000-0000-4000-8000-000000000000',
      '51000000-0000-4000-8000-000000000010',
      '52000000-0000-4000-8000-000000000001'
    );
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'cross-tenant enrollment was accepted'; end if;

  if (select count(*) from public.cohort_students
      where organization_id='10000000-0000-4000-8000-000000000000'
        and cohort_id='51000000-0000-4000-8000-000000000010'
        and student_id in ('51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002')
        and status='active' and is_active_membership and left_at is null) <> 2 then
    raise exception 'enrollment list/count state did not persist as active';
  end if;
end
$$;

do $$
declare
  first_link jsonb;
  replay_link jsonb;
  link_to_remove jsonb;
  rejected boolean := false;
  removed_link_id uuid;
begin
  first_link := public.link_existing_parent_student(
    '10000000-0000-4000-8000-000000000000',
    '13000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000001'
  );
  replay_link := public.link_existing_parent_student(
    '10000000-0000-4000-8000-000000000000',
    '13000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000001'
  );
  if first_link->>'status' <> 'created' or replay_link->>'status' <> 'existing'
    or replay_link->>'link_id' <> first_link->>'link_id' then
    raise exception 'existing parent link replay was not idempotent';
  end if;

  begin
    perform public.link_existing_parent_student(
      '10000000-0000-4000-8000-000000000000',
      '13000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001'
    );
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'cross-tenant parent-student link was accepted'; end if;

  link_to_remove := public.link_existing_parent_student(
    '10000000-0000-4000-8000-000000000000',
    '13000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000003'
  );
  removed_link_id := (link_to_remove->>'link_id')::uuid;
  rejected := false;
  begin
    perform public.unlink_existing_parent_student(
      '10000000-0000-4000-8000-000000000000', removed_link_id, false
    );
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'unconfirmed parent-student unlink was accepted'; end if;

  if not public.unlink_existing_parent_student(
    '10000000-0000-4000-8000-000000000000', removed_link_id, true
  ) then raise exception 'confirmed parent-student unlink failed'; end if;
  if not exists (
    select 1 from public.parent_profiles
    where id='13000000-0000-4000-8000-000000000001' and account_status='active'
  ) then raise exception 'unlink disabled the parent account'; end if;
end
$$;

reset role;

insert into public.lesson_plans (id,organization_id,cohort_id,sequence_no,title) values (
  '51000000-0000-4000-8000-000000000030','10000000-0000-4000-8000-000000000000',
  '51000000-0000-4000-8000-000000000010',1,'UAT Future Lesson'
) on conflict (cohort_id,sequence_no) do update set title=excluded.title;

insert into public.lesson_sessions (
  id,organization_id,cohort_id,lesson_plan_id,teacher_id,starts_at,ends_at,status
) values (
  '51000000-0000-4000-8000-000000000040','10000000-0000-4000-8000-000000000000',
  '51000000-0000-4000-8000-000000000010','51000000-0000-4000-8000-000000000030',
  '19000000-0000-4000-8000-000000000001',statement_timestamp()+interval '30 days',
  statement_timestamp()+interval '30 days 1 hour','scheduled'
) on conflict (id) do update set starts_at=excluded.starts_at,ends_at=excluded.ends_at,status='scheduled';

-- Audit is append-only and must record the confirmed relationship removal.
do $$ begin
  if not exists (
    select 1 from public.audit_logs
    where organization_id='10000000-0000-4000-8000-000000000000'
      and table_name='parent_student_links' and action='DELETE'
      and record_id='51000000-0000-4000-8000-000000000003'
  ) then
    -- The record UUID is generated, so match the removed synthetic student in old_data.
    if not exists (
      select 1 from public.audit_logs
      where organization_id='10000000-0000-4000-8000-000000000000'
        and table_name='parent_student_links' and action='DELETE'
        and old_data->>'student_id'='51000000-0000-4000-8000-000000000003'
    ) then raise exception 'parent-student unlink audit was not captured'; end if;
  end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);

do $$ begin
  if not public.is_parent_of_student('15000000-0000-4000-8000-000000000001')
    or not public.is_parent_of_student('51000000-0000-4000-8000-000000000001') then
    raise exception 'parent cannot access both linked students';
  end if;
  if (select count(*) from public.get_parent_lesson_sessions('51000000-0000-4000-8000-000000000001')
      where lesson_title='UAT Future Lesson') <> 1 then
    raise exception 'parent app query cannot see enrolled student future lesson';
  end if;
end $$;

reset role;

-- Defense-in-depth mutation fixture: even if an unsafe legacy link bypassed the
-- FK trigger, is_parent_of_student must still enforce the student tenant join.
alter table public.parent_student_links disable trigger trg_parent_student_links_tenant_fk;
insert into public.parent_student_links (
  id,organization_id,parent_profile_id,parent_user_id,student_id,relationship,is_primary
) values (
  '51000000-0000-4000-8000-000000000099','10000000-0000-4000-8000-000000000000',
  '13000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',
  '52000000-0000-4000-8000-000000000001','parent',false
);
alter table public.parent_student_links enable trigger trg_parent_student_links_tenant_fk;

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
do $$ begin
  if public.is_parent_of_student('52000000-0000-4000-8000-000000000001') then
    raise exception 'parent-student tenant condition no longer blocks unsafe legacy link';
  end if;
end $$;
reset role;

select 'UAT core workflow database tests passed' as result;
