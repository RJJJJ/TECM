import { getOperationsContext, formatMacauDateTime, todayMacau } from '@/lib/operations/context';
import { SessionAttendanceForm } from '@/components/operation-forms';
import { EmptyState, ErrorState, PageHeader, Panel } from '@/components/operations-ui';

export default async function AttendancePage() {
  const { supabase, organizationId, user, role } = await getOperationsContext();
  const today = todayMacau();
  const teacher = role === 'teacher'
    ? await supabase.from('teacher_profiles').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
    : null;
  let query = supabase
    .from('lesson_sessions')
    .select('id,cohort_id,starts_at,teacher_id,exam_cohorts(name)')
    .eq('organization_id', organizationId)
    .gte('starts_at', `${today}T00:00:00+08:00`)
    .lt('starts_at', `${today}T23:59:59+08:00`)
    .order('starts_at');
  if (role === 'teacher') query = query.eq('teacher_id', teacher?.data?.id ?? '00000000-0000-0000-0000-000000000000');
  const sessions = await query;
  const sessionIds = (sessions.data ?? []).map((row: any) => row.id);
  const cohortIds = (sessions.data ?? []).map((row: any) => row.cohort_id);
  const [enrollments, attendance] = await Promise.all([
    cohortIds.length
      ? supabase.from('cohort_students').select('cohort_id,student_id,students(display_name)').eq('organization_id', organizationId).eq('status', 'active').in('cohort_id', cohortIds)
      : Promise.resolve({ data: [], error: null }),
    sessionIds.length
      ? supabase.from('attendance_records').select('session_id,student_id,status').eq('organization_id', organizationId).in('session_id', sessionIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  const error = sessions.error || enrollments.error || attendance.error;

  return <>
    <PageHeader title="今日點名" description="老師只會看到自己負責的今日課堂；預設全班出席，數次點擊即可提交。重複提交不會重複扣堂。"/>
    {error ? <ErrorState error={error} fallback="讀取點名資料失敗，請稍後再試。"/> : !(sessions.data ?? []).length ? <EmptyState>今天沒有需要點名的課堂。</EmptyState> :
      <div className="grid gap-5">{(sessions.data ?? []).map((session: any) => {
        const roster = (enrollments.data ?? [])
          .filter((row: any) => row.cohort_id === session.cohort_id)
          .map((row: any) => ({
            id: row.student_id,
            label: row.students?.display_name || '未命名學生',
            status: (attendance.data ?? []).find((record: any) => record.session_id === session.id && record.student_id === row.student_id)?.status
          }));
        return <Panel key={session.id} title={`${formatMacauDateTime(session.starts_at)} · ${session.exam_cohorts?.name || '課堂'}`}>
          {roster.length ? <SessionAttendanceForm sessionId={session.id} students={roster}/> : <EmptyState>這個班別沒有在讀學生。</EmptyState>}
        </Panel>;
      })}</div>}
  </>;
}
