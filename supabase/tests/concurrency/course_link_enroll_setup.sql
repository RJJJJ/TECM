\set ON_ERROR_STOP on

drop table if exists public.__test_course_link_race_outcomes;
create table public.__test_course_link_race_outcomes(
  race text primary key,
  outcome text not null
);
grant select, insert on public.__test_course_link_race_outcomes to authenticated, service_role;

insert into public.students(id,organization_id,display_name,status) values
('64000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000000','Enroll-first Course link student','active'),
('64000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000000','Link-first Course link student','active')
on conflict(id) do update set status='active';

insert into public.exam_cohorts(id,organization_id,name,subject,level,exam_date,weekday_pattern,course_id,status) values
('64000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000000','Enroll-first legacy Cohort','Python','二級',current_date+100,'saturday',null,'active'),
('64000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000000','Enroll-first target Cohort','Python','二級',current_date+100,'sunday','61000000-0000-4000-8000-000000000001','active'),
('64000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000000','Link-first legacy Cohort','Python','二級',current_date+100,'saturday',null,'active'),
('64000000-0000-4000-8000-000000000022','10000000-0000-4000-8000-000000000000','Link-first target Cohort','Python','二級',current_date+100,'sunday','61000000-0000-4000-8000-000000000001','active')
on conflict(id) do nothing;

delete from public.cohort_students
where student_id in (
  '64000000-0000-4000-8000-000000000001',
  '64000000-0000-4000-8000-000000000002'
);

-- Preserve two synthetic legacy NULL-Course memberships; production writes
-- cannot create these rows after the migration.
alter table public.cohort_students disable trigger trg_guard_active_course_membership;
insert into public.cohort_students(organization_id,cohort_id,student_id,status) values
('10000000-0000-4000-8000-000000000000','64000000-0000-4000-8000-000000000011','64000000-0000-4000-8000-000000000001','active'),
('10000000-0000-4000-8000-000000000000','64000000-0000-4000-8000-000000000021','64000000-0000-4000-8000-000000000002','active');
alter table public.cohort_students enable trigger trg_guard_active_course_membership;
