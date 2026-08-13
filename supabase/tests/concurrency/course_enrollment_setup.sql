\set ON_ERROR_STOP on

insert into public.students(id,organization_id,display_name,status) values
('63000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000000','Concurrent enrollment student','active'),
('63000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000000','Concurrent transfer student','active')
on conflict(id) do update set status='active';

delete from public.cohort_students where student_id in (
'63000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000002');

insert into public.cohort_students(organization_id,cohort_id,student_id,status)
values('10000000-0000-4000-8000-000000000000','61000000-0000-4000-8000-000000000011','63000000-0000-4000-8000-000000000002','active');
