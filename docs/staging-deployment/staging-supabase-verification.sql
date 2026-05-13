-- TECM staging Supabase verification queries.
-- Non-destructive SELECT queries only. No insert/update/delete/drop.

-- 1. Table existence check
select tablename
from pg_tables
where schemaname = 'public'
order by tablename;

-- 2. RLS enabled check
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

-- 3. Trigger check
select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where trigger_schema = 'public'
order by event_object_table, trigger_name;

-- 4. Policy check
select schemaname, tablename, policyname, permissive, roles, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 5. Latest bookings check
select id, parent_id, parent_name, phone, child_name, course_title_snapshot, booking_date, start_time, end_time, status, created_at
from public.bookings
order by created_at desc
limit 10;

-- 6. Latest follow_up_tasks check
select id, booking_id, priority, channel, status, source, created_at
from public.follow_up_tasks
order by created_at desc
limit 20;

-- 7. Latest booking_parent_notifications check
select id, booking_id, notification_id, type, created_at
from public.booking_parent_notifications
order by created_at desc
limit 20;
