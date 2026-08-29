\set ON_ERROR_STOP on

insert into public.courses (id,organization_id,title,category,level,is_active) values
('61000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000000','Python 二級','Python','二級',true),
('61000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000000','Scratch 一級','Scratch','一級',true),
('61000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000000','停用課程','Python','停用',false),
('62000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000000','其他機構課程','Python','一級',true)
on conflict (id) do update set is_active=excluded.is_active;

insert into public.exam_cohorts (id,organization_id,name,subject,level,exam_date,weekday_pattern,course_id,status) values
('61000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000000','Python 二級星期六班','Python','二級',current_date+100,'saturday','61000000-0000-4000-8000-000000000001','active'),
('61000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000000','Python 二級星期日班','Python','二級',current_date+100,'sunday','61000000-0000-4000-8000-000000000001','active'),
('61000000-0000-4000-8000-000000000013','10000000-0000-4000-8000-000000000000','Python 二級夜班','Python','二級',current_date+100,'saturday','61000000-0000-4000-8000-000000000001','active'),
('61000000-0000-4000-8000-000000000014','10000000-0000-4000-8000-000000000000','Python 二級失敗測試班','Python','二級',current_date+100,'sunday','61000000-0000-4000-8000-000000000001','active'),
('61000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000000','Scratch 一級星期六班','Scratch','一級',current_date+100,'saturday','61000000-0000-4000-8000-000000000002','active'),
('61000000-0000-4000-8000-000000000031','10000000-0000-4000-8000-000000000000','RRJ python2 legacy','Python','二級',current_date+100,'saturday',null,'active'),
('61000000-0000-4000-8000-000000000032','10000000-0000-4000-8000-000000000000','待連結停用課程','Python','二級',current_date+100,'sunday',null,'active')
on conflict (id) do nothing;

insert into public.students (id,organization_id,display_name,status) values
('61000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000000','多課程學生','active'),
('61000000-0000-4000-8000-000000000102','10000000-0000-4000-8000-000000000000','RRJ s','active'),
('62000000-0000-4000-8000-000000000101','20000000-0000-4000-8000-000000000000','其他機構學生','active')
on conflict (id) do update set status='active';

-- Preserve a legacy active NULL-course row; the migration never rewrites it.
alter table public.cohort_students disable trigger trg_guard_active_course_membership;
insert into public.cohort_students (id,organization_id,cohort_id,student_id,status)
values ('61000000-0000-4000-8000-000000000201','10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000031','61000000-0000-4000-8000-000000000102','active');
alter table public.cohort_students enable trigger trg_guard_active_course_membership;

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);

-- Protected Course linkage fields are not directly writable by authenticated
-- managers. Rejected statements leave the legacy row, membership, and audit
-- history unchanged.
do $$
declare
  rejected boolean;
  audit_before bigint;
begin
  select count(*) into audit_before
  from public.audit_logs
  where table_name = 'exam_cohorts'
    and record_id = '61000000-0000-4000-8000-000000000031';

  rejected := false;
  begin
    update public.exam_cohorts
    set course_id = '61000000-0000-4000-8000-000000000001'
    where id = '61000000-0000-4000-8000-000000000031';
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'direct legacy course linkage was accepted'; end if;
  if exists (
    select 1 from public.exam_cohorts
    where id = '61000000-0000-4000-8000-000000000031'
      and (course_id is not null or subject <> 'Python' or level <> '二級')
  ) then raise exception 'rejected direct course linkage left partial cohort fields'; end if;
  if not exists (
    select 1 from public.cohort_students
    where id = '61000000-0000-4000-8000-000000000201'
      and is_active_membership
  ) then raise exception 'rejected direct course linkage changed active history'; end if;
  if (select count(*) from public.audit_logs
      where table_name = 'exam_cohorts'
        and record_id = '61000000-0000-4000-8000-000000000031') <> audit_before
  then raise exception 'rejected direct course linkage wrote audit history'; end if;

  rejected := false;
  begin
    update public.exam_cohorts
    set course_id = '61000000-0000-4000-8000-000000000002',
        subject = 'Scratch', level = '一級'
    where id = '61000000-0000-4000-8000-000000000011';
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'direct linked course replacement was accepted'; end if;

  rejected := false;
  begin
    update public.exam_cohorts
    set subject = 'Scratch', level = '一級'
    where id = '61000000-0000-4000-8000-000000000011';
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'direct linked course field drift was accepted'; end if;

  rejected := false;
  begin
    update public.exam_cohorts
    set course_id = '62000000-0000-4000-8000-000000000001'
    where id = '61000000-0000-4000-8000-000000000032';
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'direct cross-tenant course linkage was accepted'; end if;

  rejected := false;
  begin
    update public.exam_cohorts
    set course_id = '61000000-0000-4000-8000-000000000003'
    where id = '61000000-0000-4000-8000-000000000032';
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'direct inactive course linkage was accepted'; end if;

  update public.exam_cohorts
  set name = name || ' safe-edit'
  where id = '61000000-0000-4000-8000-000000000032';
  if not exists (
    select 1 from public.exam_cohorts
    where id = '61000000-0000-4000-8000-000000000032'
      and name like '% safe-edit'
  ) then raise exception 'allowed cohort management update was blocked'; end if;
end $$;

do $$
declare a jsonb; b jsonb; replay jsonb; rejected boolean;
begin
  a := public.enroll_student_in_cohort('10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000011','61000000-0000-4000-8000-000000000101');
  b := public.enroll_student_in_cohort('10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000021','61000000-0000-4000-8000-000000000101');
  if a->>'status' <> 'created' or b->>'status' <> 'created' then raise exception 'different-course enrollment failed'; end if;
  replay := public.enroll_student_in_cohort('10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000011','61000000-0000-4000-8000-000000000101');
  if replay->>'status' <> 'existing' or replay->>'enrollment_id' <> a->>'enrollment_id' then raise exception 'same-cohort replay was not idempotent'; end if;

  rejected := false;
  begin perform public.enroll_student_in_cohort('10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000012','61000000-0000-4000-8000-000000000101'); exception when others then rejected := sqlerrm like '%active membership in this course%'; end;
  if not rejected then raise exception 'same-course second cohort enrollment was accepted'; end if;

  rejected := false;
  begin perform public.enroll_student_in_cohort('10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000012','62000000-0000-4000-8000-000000000101'); exception when others then rejected := true; end;
  if not rejected then raise exception 'cross-tenant enrollment was accepted'; end if;

  rejected := false;
  begin perform public.enroll_student_in_cohort('10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000012','61000000-0000-4000-8000-000000000102'); exception when others then rejected := sqlerrm like '%course is not linked%'; end;
  if not rejected then raise exception 'legacy NULL-course UAT did not return course-link business failure'; end if;
end $$;

reset role;
update public.cohort_students set status='withdrawn',left_at=current_date where cohort_id='61000000-0000-4000-8000-000000000011' and student_id='61000000-0000-4000-8000-000000000101';
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $$ declare result jsonb; rejected boolean := false; begin
  result := public.enroll_student_in_cohort('10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000011','61000000-0000-4000-8000-000000000101');
  if result->>'status' <> 'reactivated'
     or not exists(select 1 from public.cohort_students where cohort_id='61000000-0000-4000-8000-000000000011' and student_id='61000000-0000-4000-8000-000000000101' and is_active_membership and left_at is null)
  then raise exception 'withdrawn membership was not restored'; end if;
  perform public.transfer_student_between_cohorts('10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000101','61000000-0000-4000-8000-000000000011','61000000-0000-4000-8000-000000000012',true);
  if not exists(select 1 from public.cohort_students where cohort_id='61000000-0000-4000-8000-000000000011' and student_id='61000000-0000-4000-8000-000000000101' and status='withdrawn' and left_at is not null)
     or not exists(select 1 from public.cohort_students where cohort_id='61000000-0000-4000-8000-000000000012' and student_id='61000000-0000-4000-8000-000000000101' and is_active_membership) then raise exception 'atomic transfer state is incorrect'; end if;
end $$;
reset role;

-- A completed historical row may be restored only through the controlled RPC.
insert into public.cohort_students (organization_id,cohort_id,student_id,status,left_at)
values ('10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000013','61000000-0000-4000-8000-000000000101','completed',current_date);
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $$ begin
  perform public.transfer_student_between_cohorts('10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000101','61000000-0000-4000-8000-000000000012','61000000-0000-4000-8000-000000000013',true);
  if not exists(select 1 from public.cohort_students where cohort_id='61000000-0000-4000-8000-000000000013' and student_id='61000000-0000-4000-8000-000000000101' and is_active_membership and left_at is null) then raise exception 'completed target enrollment was not restored'; end if;
end $$;

reset role;
create or replace function public.__test_reject_transfer_target() returns trigger language plpgsql as $$ begin
  if new.cohort_id = '61000000-0000-4000-8000-000000000014' and new.status = 'active' then raise exception 'forced target failure'; end if;
  return new;
end $$;
create trigger __test_reject_transfer_target before insert or update on public.cohort_students for each row execute function public.__test_reject_transfer_target();
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $$ declare rejected boolean := false; begin
  begin perform public.transfer_student_between_cohorts('10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000101','61000000-0000-4000-8000-000000000013','61000000-0000-4000-8000-000000000014',true); exception when others then rejected := sqlerrm like '%forced target failure%'; end;
  if not rejected then raise exception 'forced transfer failure was swallowed'; end if;
  if not exists(select 1 from public.cohort_students where cohort_id='61000000-0000-4000-8000-000000000013' and student_id='61000000-0000-4000-8000-000000000101' and is_active_membership)
     or exists(select 1 from public.cohort_students where cohort_id='61000000-0000-4000-8000-000000000014' and student_id='61000000-0000-4000-8000-000000000101' and is_active_membership) then raise exception 'failed transfer did not roll back completely'; end if;
end $$;
reset role;
drop trigger __test_reject_transfer_target on public.cohort_students;
drop function public.__test_reject_transfer_target();
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);

do $$ declare rejected boolean := false; begin
  begin insert into public.cohort_students(organization_id,cohort_id,student_id,status) values ('10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000013','61000000-0000-4000-8000-000000000102','active'); exception when others then rejected := true; end;
  if not rejected then raise exception 'authenticated direct enrollment DML bypassed canonical RPC'; end if;
end $$;

do $$ declare rejected boolean := false; linked jsonb; replay jsonb; begin
  begin perform public.link_cohort_to_course('10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000031','62000000-0000-4000-8000-000000000001',true); exception when others then rejected := true; end;
  if not rejected then raise exception 'cross-tenant course link was accepted'; end if;
  rejected := false;
  begin perform public.link_cohort_to_course('10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000032','61000000-0000-4000-8000-000000000003',true); exception when others then rejected := true; end;
  if not rejected then raise exception 'inactive course link was accepted'; end if;
  linked := public.link_cohort_to_course('10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000031','61000000-0000-4000-8000-000000000002',true);
  replay := public.link_cohort_to_course('10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000031','61000000-0000-4000-8000-000000000002',true);
  if linked->>'status' <> 'linked' or replay->>'status' <> 'existing' then
    raise exception 'canonical course link was not successful and idempotent';
  end if;
  if not exists (
    select 1 from public.exam_cohorts
    where id = '61000000-0000-4000-8000-000000000031'
      and course_id = '61000000-0000-4000-8000-000000000002'
      and subject = 'Scratch' and level = '一級'
  ) then raise exception 'canonical course link did not synchronize course fields'; end if;
end $$;
reset role;

-- Even privileged direct writers must not be able to create an active
-- same-Course conflict from a legacy NULL-course cohort. The trigger is the
-- invariant boundary for owner/service paths, while authenticated callers are
-- additionally constrained to the canonical RPC by column grants.
alter table public.cohort_students disable trigger trg_guard_active_course_membership;
insert into public.cohort_students (id,organization_id,cohort_id,student_id,status)
values ('61000000-0000-4000-8000-000000000202','10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000032','61000000-0000-4000-8000-000000000101','active');
alter table public.cohort_students enable trigger trg_guard_active_course_membership;

do $$ declare rejected boolean := false; begin
  begin
    update public.exam_cohorts
    set course_id = '61000000-0000-4000-8000-000000000001'
    where id = '61000000-0000-4000-8000-000000000032';
  exception when others then
    rejected := sqlerrm like '%course link conflicts with active student enrollment%';
  end;
  if not rejected then raise exception 'owner direct course linkage broke active-Course invariant'; end if;
end $$;

set role service_role;
do $$ declare rejected boolean := false; begin
  begin
    update public.exam_cohorts
    set course_id = '61000000-0000-4000-8000-000000000001'
    where id = '61000000-0000-4000-8000-000000000032';
  exception when others then
    rejected := sqlerrm like '%course link conflicts with active student enrollment%';
  end;
  if not rejected then raise exception 'service-role direct course linkage broke active-Course invariant'; end if;
end $$;
reset role;

do $$ begin
  if not exists (
    select 1 from public.exam_cohorts
    where id = '61000000-0000-4000-8000-000000000032'
      and course_id is null and subject = 'Python'
  ) or not exists (
    select 1 from public.cohort_students
    where id = '61000000-0000-4000-8000-000000000202'
      and is_active_membership
  ) then
    raise exception 'rejected privileged course linkage left partial state';
  end if;
end $$;

do $$ begin
  if exists(select 1 from pg_indexes where schemaname='public' and indexname='unique_active_exam_membership') then raise exception 'global student-only active index still exists'; end if;
  if (select count(*) from public.cohort_students cs join public.exam_cohorts ec on ec.id=cs.cohort_id where cs.student_id='61000000-0000-4000-8000-000000000101' and cs.is_active_membership and ec.course_id in ('61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002')) <> 2 then raise exception 'multi-course active memberships were not preserved'; end if;
  if not exists(select 1 from public.audit_logs where table_name='cohort_students' and action in ('INSERT','UPDATE') and record_id is not null) then raise exception 'enrollment audit is missing'; end if;
  if not exists(select 1 from public.audit_logs where table_name='exam_cohorts' and action='UPDATE' and record_id='61000000-0000-4000-8000-000000000031') then raise exception 'course-link audit is missing'; end if;
  if exists(select 1 from public.audit_logs where coalesce(old_data,'{}') ?| array['password','token','access_token','refresh_token'] or coalesce(new_data,'{}') ?| array['password','token','access_token','refresh_token']) then raise exception 'audit contains credential fields'; end if;
  if position('student-enrollment:' in pg_get_functiondef('public.transfer_student_between_cohorts(uuid,uuid,uuid,uuid,boolean)'::regprocedure)) = 0
     or position('pg_advisory_xact_lock' in pg_get_functiondef('public.transfer_student_between_cohorts(uuid,uuid,uuid,uuid,boolean)'::regprocedure)) = 0 then
    raise exception 'transfer advisory lock missing';
  end if;
  if position('course-enrollment:' in pg_get_functiondef('public.guard_exam_cohort_course_fields()'::regprocedure)) = 0
     or position('pg_advisory_xact_lock' in pg_get_functiondef('public.guard_exam_cohort_course_fields()'::regprocedure)) = 0 then
    raise exception 'cohort Course trigger lock missing';
  end if;
  if exists (
       select 1
       from pg_proc p
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
       where p.oid = 'public.guard_active_course_membership()'::regprocedure
         and privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
     ) or has_function_privilege('authenticated', 'public.guard_active_course_membership()', 'EXECUTE') then
    raise exception 'guard_active_course_membership retains direct execute privilege';
  end if;
  if exists (
       select 1
       from pg_proc p
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
       where p.oid = 'public.guard_exam_cohort_course_fields()'::regprocedure
         and privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
     ) or has_function_privilege('authenticated', 'public.guard_exam_cohort_course_fields()', 'EXECUTE') then
    raise exception 'cohort Course trigger helper retains direct execute privilege';
  end if;
  if exists (
       select 1
       from pg_proc p
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
       where p.oid in (
         'public.enroll_student_in_cohort(uuid,uuid,uuid)'::regprocedure,
         'public.transfer_student_between_cohorts(uuid,uuid,uuid,uuid,boolean)'::regprocedure,
         'public.link_cohort_to_course(uuid,uuid,uuid,boolean)'::regprocedure
       ) and privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
     )
     or not has_function_privilege('authenticated', 'public.enroll_student_in_cohort(uuid,uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.transfer_student_between_cohorts(uuid,uuid,uuid,uuid,boolean)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.link_cohort_to_course(uuid,uuid,uuid,boolean)', 'EXECUTE') then
    raise exception 'canonical Course enrollment RPC grants are incorrect';
  end if;
  if has_table_privilege('authenticated', 'public.cohort_students', 'INSERT')
     or has_table_privilege('authenticated', 'public.cohort_students', 'UPDATE')
     or has_table_privilege('authenticated', 'public.cohort_students', 'DELETE') then
    raise exception 'authenticated enrollment table DML remains granted';
  end if;
  if has_table_privilege('authenticated', 'public.exam_cohorts', 'UPDATE')
     or has_column_privilege('authenticated', 'public.exam_cohorts', 'course_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.exam_cohorts', 'subject', 'UPDATE')
     or has_column_privilege('authenticated', 'public.exam_cohorts', 'level', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.exam_cohorts', 'name', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.exam_cohorts', 'status', 'UPDATE') then
    raise exception 'authenticated Cohort update column grants are incorrect';
  end if;
end $$;

select 'Course cohort enrollment model tests passed' as result;
