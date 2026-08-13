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

do $$ declare rejected boolean := false; begin
  begin perform public.link_cohort_to_course('10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000031','62000000-0000-4000-8000-000000000001',true); exception when others then rejected := true; end;
  if not rejected then raise exception 'cross-tenant course link was accepted'; end if;
  rejected := false;
  begin perform public.link_cohort_to_course('10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000032','61000000-0000-4000-8000-000000000003',true); exception when others then rejected := true; end;
  if not rejected then raise exception 'inactive course link was accepted'; end if;
  perform public.link_cohort_to_course('10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000031','61000000-0000-4000-8000-000000000002',true);
end $$;
reset role;

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
end $$;

select 'Course cohort enrollment model tests passed' as result;
