-- Exam Cohort Attendance and Makeup Recovery MVP verification SQL
-- Non-destructive checks only. Run in Supabase SQL editor against a staging/local
-- project after applying supabase_v1_schema.sql.

-- 1. Required table existence.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'exam_cohorts',
    'cohort_students',
    'lesson_plans',
    'lesson_sessions',
    'attendance_records',
    'makeup_tasks',
    'makeup_sessions',
    'makeup_recommendations'
  )
order by table_name;

-- 2. RLS enabled on MVP tables.
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'exam_cohorts',
    'cohort_students',
    'lesson_plans',
    'lesson_sessions',
    'attendance_records',
    'makeup_tasks'
  )
order by tablename;

-- 3. Makeup trigger exists on attendance_records.
select trigger_name, event_object_table, action_timing, event_manipulation
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table = 'attendance_records'
  and trigger_name ilike '%makeup%'
order by trigger_name;

-- 4. RPC functions exist.
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'get_teacher_today_sessions',
    'get_lesson_session_students',
    'submit_attendance',
    'get_parent_attendance_summary'
  )
order by routine_name;

-- 5. Latest lesson sessions with lesson plan context.
select
  ls.id,
  ec.name as cohort_name,
  lp.sequence_no,
  lp.title,
  tp.display_name as teacher_name,
  ls.starts_at,
  ls.ends_at,
  ls.status
from public.lesson_sessions ls
join public.exam_cohorts ec on ec.id = ls.cohort_id
join public.lesson_plans lp on lp.id = ls.lesson_plan_id
left join public.teacher_profiles tp on tp.id = ls.teacher_id
order by ls.starts_at desc
limit 20;

-- 6. Latest absent/excused attendance rows and generated makeup task context.
select
  ar.id as attendance_id,
  ar.status as attendance_status,
  s.display_name as student_name,
  ec.name as cohort_name,
  lp.sequence_no,
  lp.title,
  lp.teaching_content,
  lp.makeup_guidance,
  mt.id as makeup_task_id,
  mt.status as makeup_status
from public.attendance_records ar
join public.students s on s.id = ar.student_id
join public.lesson_sessions ls on ls.id = ar.session_id
join public.exam_cohorts ec on ec.id = ls.cohort_id
left join public.lesson_plans lp on lp.id = ls.lesson_plan_id
left join public.makeup_tasks mt on mt.attendance_record_id = ar.id
where ar.status in ('absent', 'excused')
order by ar.recorded_at desc
limit 20;

-- 7. Parent aggregate summary should return one row per parent/student/cohort.
select *
from public.parent_exam_attendance_summary
order by cohort_name, student_name
limit 50;

-- 8. Check for impossible attendance rows: student not active in the session cohort.
-- Expected result after the hardened RPC is zero rows for newly submitted records.
select
  ar.id as attendance_id,
  ar.student_id,
  ls.cohort_id,
  ar.recorded_at
from public.attendance_records ar
join public.lesson_sessions ls on ls.id = ar.session_id
left join public.cohort_students cs
  on cs.cohort_id = ls.cohort_id
 and cs.student_id = ar.student_id
 and cs.status = 'active'
where cs.id is null
order by ar.recorded_at desc
limit 50;
