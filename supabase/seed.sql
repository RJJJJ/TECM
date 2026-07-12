-- Deterministic two-organization fixture. Safe to rerun.
insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'admin@tecm.local'),
  ('10000000-0000-4000-8000-000000000002', 'staff-a@tecm.test'),
  ('10000000-0000-4000-8000-000000000003', 'guardian-a@tecm.test'),
  ('10000000-0000-4000-8000-000000000004', 'teacher-a@tecm.test'),
  ('10000000-0000-4000-8000-000000000005', 'teacher-b@tecm.test'),
  ('20000000-0000-4000-8000-000000000001', 'admin-b@tecm.test')
on conflict (id) do update set email = excluded.email;

update auth.users
set encrypted_password = crypt('LocalDemoOnly-1234', gen_salt('bf')),
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    aud = 'authenticated', role = 'authenticated',
    raw_app_meta_data = jsonb_build_object('provider','email','providers',jsonb_build_array('email')),
    raw_user_meta_data = '{}'::jsonb
where id in (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005'
);

-- The plain PostgreSQL verification shim has a deliberately small auth.users
-- table. When the full Supabase Auth schema is present, add the fields and
-- email identities that GoTrue requires for password login.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = 'instance_id'
  ) then
    execute $sql$
      update auth.users
      set instance_id = '00000000-0000-0000-0000-000000000000',
          confirmation_token = '',
          recovery_token = '',
          email_change_token_new = '',
          email_change = '',
          phone_change = '',
          phone_change_token = '',
          email_change_token_current = '',
          reauthentication_token = '',
          created_at = coalesce(created_at, now()),
          updated_at = coalesce(updated_at, now())
      where id in (
        '10000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000002',
        '10000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000004',
        '10000000-0000-4000-8000-000000000005',
        '20000000-0000-4000-8000-000000000001'
      )
    $sql$;
  end if;

  if to_regclass('auth.identities') is not null then
    execute $sql$
      insert into auth.identities (
        provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      )
      select
        u.id::text,
        u.id,
        jsonb_build_object('sub', u.id::text, 'email', u.email),
        'email',
        now(),
        now(),
        now()
      from auth.users u
      where u.id in (
        '10000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000002',
        '10000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000004',
        '10000000-0000-4000-8000-000000000005',
        '20000000-0000-4000-8000-000000000001'
      )
      on conflict (provider_id, provider) do update set
        identity_data = excluded.identity_data,
        updated_at = excluded.updated_at
    $sql$;
  end if;
end
$$;

insert into public.organizations (id, slug, name, timezone, currency_code) values
  ('10000000-0000-4000-8000-000000000000', 'tecm-a', 'TECM A', 'Asia/Macau', 'MOP'),
  ('20000000-0000-4000-8000-000000000000', 'tecm-b', 'TECM B', 'Asia/Macau', 'MOP')
on conflict (id) do update set name = excluded.name;

insert into public.organization_members (id, organization_id, user_id, role, status) values
  ('11000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000000','10000000-0000-4000-8000-000000000001','admin','active'),
  ('11000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000000','10000000-0000-4000-8000-000000000002','staff','active'),
  ('11000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000000','10000000-0000-4000-8000-000000000004','teacher','active'),
  ('11000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000000','10000000-0000-4000-8000-000000000005','teacher','active'),
  ('21000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000000','20000000-0000-4000-8000-000000000001','admin','active')
on conflict (organization_id, user_id) do update set role = excluded.role, status = excluded.status;

insert into public.staff_roles (id,user_id,role,is_active,organization_id) values
  ('12000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','admin',true,'10000000-0000-4000-8000-000000000000'),
  ('12000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','staff',true,'10000000-0000-4000-8000-000000000000'),
  ('22000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','admin',true,'20000000-0000-4000-8000-000000000000')
on conflict (user_id) do update set role=excluded.role,is_active=excluded.is_active,organization_id=excluded.organization_id;

insert into public.parent_profiles (id,user_id,full_name,phone,organization_id) values
('13000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','Guardian A','+85360000001','10000000-0000-4000-8000-000000000000')
on conflict (id) do update set full_name=excluded.full_name;

insert into public.children (id,parent_id,child_name,age,school_name,organization_id) values
('14000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000001','Student A',10,'TECM School','10000000-0000-4000-8000-000000000000')
on conflict (id) do update set child_name=excluded.child_name;

insert into public.students (id,child_id,display_name,school_name,status,organization_id) values
('15000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000001','Student A','TECM School','active','10000000-0000-4000-8000-000000000000')
on conflict (id) do update set display_name=excluded.display_name;

insert into public.parent_student_links (id,parent_profile_id,parent_user_id,student_id,relationship,is_primary,organization_id) values
('16000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','15000000-0000-4000-8000-000000000001','parent',true,'10000000-0000-4000-8000-000000000000')
on conflict (parent_profile_id,student_id) do update set parent_user_id=excluded.parent_user_id;

insert into public.campuses (id,name,address,is_active,organization_id) values
('17000000-0000-4000-8000-000000000001','Campus A','Macau',true,'10000000-0000-4000-8000-000000000000')
on conflict (id) do update set name=excluded.name;

insert into public.courses (id,title,category,level,campus_id,is_active,organization_id) values
('18000000-0000-4000-8000-000000000001','Python Foundations','Coding','Foundation','17000000-0000-4000-8000-000000000001',true,'10000000-0000-4000-8000-000000000000')
on conflict (id) do update set title=excluded.title;

insert into public.teacher_profiles (id,user_id,display_name,is_active,organization_id) values
('19000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','陳老師',true,'10000000-0000-4000-8000-000000000000'),
('19000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000005','李老師',true,'10000000-0000-4000-8000-000000000000')
on conflict (id) do update set display_name=excluded.display_name;

insert into public.exam_cohorts (id,name,subject,level,exam_date,weekday_pattern,course_id,campus_id,lead_teacher_id,status,organization_id) values
('1a000000-0000-4000-8000-000000000001','Python Cohort A','Python','Foundation','2027-06-01','saturday','18000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001','active','10000000-0000-4000-8000-000000000000')
on conflict (id) do update set status=excluded.status;

insert into public.cohort_students (id,cohort_id,student_id,status,organization_id) values
('1b000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001','active','10000000-0000-4000-8000-000000000000')
on conflict (cohort_id,student_id) do update set status=excluded.status;

insert into public.lesson_plans (id,cohort_id,sequence_no,title,organization_id) values
('1c000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001',1,'Lesson 1','10000000-0000-4000-8000-000000000000')
on conflict (cohort_id,sequence_no) do update set title=excluded.title;

insert into public.lesson_sessions (id,cohort_id,lesson_plan_id,teacher_id,starts_at,ends_at,status,organization_id) values
('1d000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','1c000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001','2027-01-09 09:00:00+08','2027-01-09 10:00:00+08','scheduled','10000000-0000-4000-8000-000000000000')
on conflict (id) do nothing;

insert into public.fee_plans (id,organization_id,name,course_id,credit_units,amount_minor,currency_code) values
('1e000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000000','Ten Lessons','18000000-0000-4000-8000-000000000001',10,250000,'MOP')
on conflict (organization_id,name) do update set amount_minor=excluded.amount_minor;

insert into public.student_packages (id,organization_id,student_id,fee_plan_id,status,starts_on) values
('1f000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000000','15000000-0000-4000-8000-000000000001','1e000000-0000-4000-8000-000000000001','active','2027-01-01')
on conflict (id) do update set status=excluded.status;

insert into public.credit_ledger (id,organization_id,student_package_id,student_id,delta_units,entry_type,source_type,idempotency_key,note) values
('1f100000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000000','1f000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001',10,'purchase','seed','seed:package-a','Initial package grant')
on conflict (organization_id,idempotency_key) do nothing;

-- Demo-complete education centre fixture: 2 teachers, 3 classes, 10 students,
-- two lessons today, low credit, debt, payment, pending and completed makeup.
update public.organizations set name='澳門 TECM 教育中心' where id='10000000-0000-4000-8000-000000000000';

insert into public.courses (id,title,category,level,campus_id,is_active,organization_id) values
('18000000-0000-4000-8000-000000000002','Scratch 創意編程','編程','入門','17000000-0000-4000-8000-000000000001',true,'10000000-0000-4000-8000-000000000000'),
('18000000-0000-4000-8000-000000000003','C++ 算法班','編程','進階','17000000-0000-4000-8000-000000000001',true,'10000000-0000-4000-8000-000000000000')
on conflict (id) do update set title=excluded.title;

update public.exam_cohorts set name='Python 基礎班' where id='1a000000-0000-4000-8000-000000000001';
insert into public.exam_cohorts (id,name,subject,level,exam_date,weekday_pattern,course_id,campus_id,lead_teacher_id,status,organization_id) values
('1a000000-0000-4000-8000-000000000002','Scratch 創意班','Scratch','入門','2027-06-01','sunday','18000000-0000-4000-8000-000000000002','17000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000002','active','10000000-0000-4000-8000-000000000000'),
('1a000000-0000-4000-8000-000000000003','C++ 進階班','C++','進階','2027-06-01','saturday','18000000-0000-4000-8000-000000000003','17000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001','active','10000000-0000-4000-8000-000000000000')
on conflict (id) do update set name=excluded.name,status=excluded.status;

insert into public.lesson_plans (id,cohort_id,sequence_no,title,organization_id) values
('1c000000-0000-4000-8000-000000000002','1a000000-0000-4000-8000-000000000002',1,'Scratch 動畫與事件','10000000-0000-4000-8000-000000000000'),
('1c000000-0000-4000-8000-000000000003','1a000000-0000-4000-8000-000000000003',1,'C++ 迴圈與陣列','10000000-0000-4000-8000-000000000000')
on conflict (cohort_id,sequence_no) do update set title=excluded.title;

update public.lesson_sessions
set starts_at=(((now() at time zone 'Asia/Macau')::date + time '09:00') at time zone 'Asia/Macau'),
    ends_at=(((now() at time zone 'Asia/Macau')::date + time '10:00') at time zone 'Asia/Macau')
where id='1d000000-0000-4000-8000-000000000001';
insert into public.lesson_sessions (id,cohort_id,lesson_plan_id,teacher_id,starts_at,ends_at,status,organization_id) values
('1d000000-0000-4000-8000-000000000002','1a000000-0000-4000-8000-000000000002','1c000000-0000-4000-8000-000000000002','19000000-0000-4000-8000-000000000002',(((now() at time zone 'Asia/Macau')::date + time '15:00') at time zone 'Asia/Macau'),(((now() at time zone 'Asia/Macau')::date + time '16:00') at time zone 'Asia/Macau'),'scheduled','10000000-0000-4000-8000-000000000000'),
('1d000000-0000-4000-8000-000000000003','1a000000-0000-4000-8000-000000000003','1c000000-0000-4000-8000-000000000003','19000000-0000-4000-8000-000000000001',((((now() at time zone 'Asia/Macau')::date + 1) + time '11:00') at time zone 'Asia/Macau'),((((now() at time zone 'Asia/Macau')::date + 1) + time '12:00') at time zone 'Asia/Macau'),'scheduled','10000000-0000-4000-8000-000000000000')
on conflict (id) do update set starts_at=excluded.starts_at,ends_at=excluded.ends_at;

insert into public.children (id,parent_id,child_name,age,school_name,organization_id)
select ('14000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       '13000000-0000-4000-8000-000000000001', '示範學生 '||n, 8+n, '澳門示範學校', '10000000-0000-4000-8000-000000000000'
from generate_series(2,10) n
on conflict (id) do update set child_name=excluded.child_name;

insert into public.students (id,child_id,display_name,school_name,status,organization_id)
select ('15000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       ('14000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       '示範學生 '||n, '澳門示範學校', 'active', '10000000-0000-4000-8000-000000000000'
from generate_series(2,10) n
on conflict (id) do update set display_name=excluded.display_name,status=excluded.status;

insert into public.parent_student_links (id,parent_profile_id,parent_user_id,student_id,relationship,is_primary,organization_id)
select ('16000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       '13000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',
       ('15000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'parent',true,'10000000-0000-4000-8000-000000000000'
from generate_series(2,10) n
on conflict (parent_profile_id,student_id) do update set parent_user_id=excluded.parent_user_id;

insert into public.cohort_students (id,cohort_id,student_id,status,organization_id)
select ('1b000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       (case when n<=4 then '1a000000-0000-4000-8000-000000000001' when n<=7 then '1a000000-0000-4000-8000-000000000002' else '1a000000-0000-4000-8000-000000000003' end)::uuid,
       ('15000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'active','10000000-0000-4000-8000-000000000000'
from generate_series(2,10) n
on conflict (cohort_id,student_id) do update set status=excluded.status;

insert into public.student_packages (id,organization_id,student_id,fee_plan_id,status,starts_on,idempotency_key)
select ('1f000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000000',
       ('15000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'1e000000-0000-4000-8000-000000000001','active',current_date,'seed-package-'||n
from generate_series(2,10) n
on conflict (id) do update set status=excluded.status;

insert into public.credit_ledger (id,organization_id,student_package_id,student_id,delta_units,entry_type,source_type,idempotency_key,note)
select ('1f100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000000',
       ('1f000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       ('15000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       case when n=2 then 2 else 10 end,'purchase','seed','seed:package-'||n,case when n=2 then '低堂數示範' else '示範套票' end
from generate_series(2,10) n
on conflict (organization_id,idempotency_key) do nothing;

insert into public.leave_requests (id,organization_id,student_id,lesson_session_id,requested_by,reason,status,reviewed_by,decided_at,idempotency_key,created_at) values
('32000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000000','15000000-0000-4000-8000-000000000003','1d000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','家庭安排','approved','10000000-0000-4000-8000-000000000001',now(),'seed-leave-pending-makeup',now()-interval '10 days'),
('32000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000000','15000000-0000-4000-8000-000000000004','1d000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','校內活動','approved','10000000-0000-4000-8000-000000000001',now(),'seed-leave-completed-makeup',now()-interval '20 days')
on conflict (organization_id,idempotency_key) do update set status=excluded.status;

insert into public.makeup_entitlements (id,organization_id,student_id,leave_request_id,units_granted,units_remaining,status,expires_at,idempotency_key,created_at) values
('33000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000000','15000000-0000-4000-8000-000000000003','32000000-0000-4000-8000-000000000010',1,1,'available',now()+interval '30 days','seed-entitlement-pending',now()-interval '10 days'),
('33000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000000','15000000-0000-4000-8000-000000000004','32000000-0000-4000-8000-000000000011',1,0,'consumed',now()+interval '30 days','seed-entitlement-completed',now()-interval '20 days')
on conflict (organization_id,idempotency_key) do update set status=excluded.status,units_remaining=excluded.units_remaining;

insert into public.makeup_tasks (id,organization_id,student_id,cohort_id,lesson_plan_id,original_session_id,entitlement_id,missed_status,status,parent_visible_summary) values
('34000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000000','15000000-0000-4000-8000-000000000004','1a000000-0000-4000-8000-000000000001','1c000000-0000-4000-8000-000000000001','1d000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000011','excused','completed','已完成補課：1 堂')
on conflict (id) do update set status=excluded.status;

insert into public.makeup_sessions (id,organization_id,makeup_task_id,entitlement_id,student_id,teacher_id,scheduled_at,completed_at,status,created_by,idempotency_key) values
('35000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000000','34000000-0000-4000-8000-000000000011','33000000-0000-4000-8000-000000000011','15000000-0000-4000-8000-000000000004','19000000-0000-4000-8000-000000000002',now()-interval '2 days',now()-interval '2 days' + interval '1 hour','completed','10000000-0000-4000-8000-000000000001','seed-makeup-completed')
on conflict (id) do update set status=excluded.status,completed_at=excluded.completed_at;

insert into public.charges (id,organization_id,student_id,student_package_id,description,amount_minor,currency_code,status,due_on,idempotency_key) values
('1f200000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000000','15000000-0000-4000-8000-000000000005','1f000000-0000-4000-8000-000000000005','示範已付款套票',100000,'MOP','paid',current_date,'charge:seed-paid')
on conflict (organization_id,idempotency_key) do update set status=excluded.status;
insert into public.payments (id,organization_id,guardian_id,amount_minor,currency_code,method,status,received_at,idempotency_key,created_by) values
('36000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000000','13000000-0000-4000-8000-000000000001',100000,'MOP','cash','received',now(),'payment:seed-paid','10000000-0000-4000-8000-000000000001')
on conflict (organization_id,idempotency_key) do nothing;
insert into public.payment_allocations (id,organization_id,payment_id,charge_id,amount_minor) values
('37000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000000','36000000-0000-4000-8000-000000000005','1f200000-0000-4000-8000-000000000005',100000)
on conflict (payment_id,charge_id) do nothing;

insert into public.bookings (id,organization_id,parent_id,child_id,parent_name,phone,child_name,child_age,school_name,course_id,course_title_snapshot,campus_id,booking_date,start_time,end_time,note,status) values
('38000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000000',null,null,'查詢家長','66880000','新查詢學生',9,'澳門示範學校','18000000-0000-4000-8000-000000000002','Scratch 創意編程','17000000-0000-4000-8000-000000000001',current_date + 2,'17:00','18:00','待確認試堂','pending')
on conflict (id) do update set status=excluded.status;

insert into public.charges (id,organization_id,student_id,student_package_id,description,amount_minor,currency_code,status,due_on,idempotency_key) values
('1f200000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000000','15000000-0000-4000-8000-000000000001','1f000000-0000-4000-8000-000000000001','Ten Lessons',250000,'MOP','open','2026-01-01','charge:seed-package-a')
on conflict (organization_id,idempotency_key) do nothing;
