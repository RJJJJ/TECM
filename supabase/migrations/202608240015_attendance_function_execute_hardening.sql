-- Forward-only hardening for attendance RPC EXECUTE privileges.
--
-- PostgreSQL grants EXECUTE to PUBLIC by default, and a direct grant to anon
-- survives a PUBLIC-only revoke.  Keep the trigger helper internal and make
-- the three intentional application entry points explicit.

revoke all on function public.capture_attendance_history_audit() from public;
revoke all on function public.capture_attendance_history_audit() from anon;
revoke all on function public.capture_attendance_history_audit() from authenticated;
revoke all on function public.capture_attendance_history_audit() from service_role;

revoke all on function public.get_teacher_attendance_sessions() from public;
revoke all on function public.get_teacher_attendance_sessions() from anon;
revoke all on function public.get_teacher_attendance_sessions() from authenticated;
revoke all on function public.get_teacher_attendance_sessions() from service_role;

revoke all on function public.submit_teacher_attendance(uuid,uuid,text,timestamptz,text,text) from public;
revoke all on function public.submit_teacher_attendance(uuid,uuid,text,timestamptz,text,text) from anon;
revoke all on function public.submit_teacher_attendance(uuid,uuid,text,timestamptz,text,text) from authenticated;
revoke all on function public.submit_teacher_attendance(uuid,uuid,text,timestamptz,text,text) from service_role;

revoke all on function public.submit_attendance(uuid,jsonb) from public;
revoke all on function public.submit_attendance(uuid,jsonb) from anon;
revoke all on function public.submit_attendance(uuid,jsonb) from authenticated;
revoke all on function public.submit_attendance(uuid,jsonb) from service_role;

-- Existing repository contract: application callers use authenticated; there
-- is no direct service_role contract for these attendance RPCs.
grant execute on function public.get_teacher_attendance_sessions() to authenticated;
grant execute on function public.submit_teacher_attendance(uuid,uuid,text,timestamptz,text,text) to authenticated;
grant execute on function public.submit_attendance(uuid,jsonb) to authenticated;
