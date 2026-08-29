import Link from 'next/link';
import { SessionAttendanceForm } from '@/components/operation-forms';
import { TeacherAttendanceForm } from '@/components/teacher-attendance-form';
import { EmptyState, ErrorState, PageHeader, Panel } from '@/components/operations-ui';
import { formatMacauDateTime, getOperationsContext, todayMacau } from '@/lib/operations/context';

type Search = { range?: string; from?: string; to?: string; cohort?: string; student?: string };
type TeacherSession = {
  session_id: string;
  cohort_id: string;
  course_title: string | null;
  cohort_name: string;
  starts_at: string;
  ends_at: string;
  session_status: string;
  attended_count: number;
  roster_count: number;
};
type RosterStudent = { student_id: string; display_name: string; attendance_status: 'present' | 'absent' | 'excused' | null };
type Attendance = { student_id: string; revision: number };

const macauDate = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Macau', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const statusLabel = (status: string) => ({ scheduled: '已排課', completed: '已完成', cancelled: '已取消' }[status] ?? '課堂狀態');
const validDate = (value: string | undefined) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;

function filterHref(range: string, search: Search) {
  const params = new URLSearchParams();
  params.set('range', range);
  if (search.from) params.set('from', search.from);
  if (search.to) params.set('to', search.to);
  if (search.cohort) params.set('cohort', search.cohort);
  if (search.student) params.set('student', search.student);
  return `/admin/attendance?${params.toString()}`;
}

function TeacherPage({ sessions, rosters, attendance, search }: {
  sessions: TeacherSession[];
  rosters: Record<string, RosterStudent[]>;
  attendance: Record<string, Attendance[]>;
  search: Search;
}) {
  const today = todayMacau();
  const range = search.range ?? 'today';
  const from = validDate(search.from);
  const to = validDate(search.to);
  const query = (search.student ?? '').trim().toLocaleLowerCase('zh-Hant');
  const now = Date.now();
  const recentStart = new Date(now - 6 * 24 * 60 * 60 * 1000);
  const cohortOptions = Array.from(new Map(sessions.map((session) => [session.cohort_id, session.cohort_name])).entries());
  const visible = sessions.filter((session) => {
    const date = macauDate(session.starts_at);
    if (search.cohort && session.cohort_id !== search.cohort) return false;
    if (from && date < from) return false;
    if (to && date > to) return false;
    if (range === 'today' && date !== today) return false;
    if (range === 'recent' && new Date(session.starts_at) < recentStart) return false;
    if (range === 'upcoming' && new Date(session.starts_at).getTime() < now) return false;
    if (query && !(rosters[session.session_id] ?? []).some((student) => student.display_name.toLocaleLowerCase('zh-Hant').includes(query))) return false;
    return true;
  });
  const emptyMessage = range === 'today'
    ? '今天沒有課堂。'
    : search.cohort || from || to || query ? '所選條件下沒有課堂。' : '尚未被分配課堂。';

  return <>
    <PageHeader title="課堂與點名" description="查看已獲授權的過去、今日及未來課堂；已結束課堂的實際修正必須填寫原因。所有時間均為澳門時間。"/>
    <div className="mb-5 flex flex-wrap gap-2" aria-label="課堂篩選">
      {[['today', '今天'], ['recent', '最近 7 日'], ['upcoming', '即將開始'], ['all', '全部課堂']].map(([key, label]) => <Link key={key} href={filterHref(key, search)} className={`rounded-lg px-3 py-2 text-sm font-medium ${range === key ? 'bg-teal-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-teal-50'}`}>{label}</Link>)}
    </div>
    <form className="mb-6 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5" method="get">
      <input type="hidden" name="range" value={range}/>
      <label className="text-sm font-medium text-slate-700">開始日期<input className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" type="date" name="from" defaultValue={from ?? ''}/></label>
      <label className="text-sm font-medium text-slate-700">結束日期<input className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" type="date" name="to" defaultValue={to ?? ''}/></label>
      <label className="text-sm font-medium text-slate-700">班別<select className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" name="cohort" defaultValue={search.cohort ?? ''}><option value="">全部班別</option>{cohortOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="text-sm font-medium text-slate-700">學生姓名<input className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" name="student" defaultValue={search.student ?? ''} placeholder="搜尋學生姓名"/></label>
      <div className="flex items-end gap-2"><button className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800" type="submit">套用篩選</button><Link className="rounded-lg px-3 py-2 text-sm font-medium text-teal-700 underline" href="/admin/attendance">清除</Link></div>
    </form>
    {visible.length === 0 ? <EmptyState>{emptyMessage}</EmptyState> : <div className="grid gap-5">{visible.map((session) => {
      const isFuture = new Date(session.starts_at).getTime() > now;
      const requiresReason = new Date(session.ends_at).getTime() < now;
      const roster = (rosters[session.session_id] ?? []).filter((student) => !query || student.display_name.toLocaleLowerCase('zh-Hant').includes(query));
      const revisions = new Map((attendance[session.session_id] ?? []).map((record) => [record.student_id, record.revision]));
      return <Panel key={session.session_id} title={`${formatMacauDateTime(session.starts_at)} · ${session.course_title || session.cohort_name}`}>
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600"><span>班別：{session.cohort_name}</span><span>狀態：{statusLabel(session.session_status)}</span><span>已點名 {session.attended_count}／未點名 {Math.max(0, session.roster_count - session.attended_count)}</span></div>
        {isFuture ? <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">課堂尚未開始，可以查看名單，但不能提前點名。</p> : null}
        {requiresReason ? <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">修正已結束課堂的點名時，請填寫非空白的修改原因。</p> : null}
        {roster.length === 0 ? <EmptyState>沒有符合條件的學生。</EmptyState> : <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">{roster.map((student) => <TeacherAttendanceForm key={student.student_id} sessionId={session.session_id} student={{ id: student.student_id, label: student.display_name, status: student.attendance_status, revision: revisions.get(student.student_id) ?? null }} requiresReason={requiresReason} disabled={isFuture || session.session_status === 'cancelled'}/>)}</div>}
      </Panel>;
    })}</div>}
  </>;
}

async function StaffPage() {
  const { supabase, organizationId } = await getOperationsContext();
  const today = todayMacau();
  const sessions = await supabase.from('lesson_sessions').select('id,cohort_id,starts_at,exam_cohorts(name)').eq('organization_id', organizationId).gte('starts_at', `${today}T00:00:00+08:00`).lt('starts_at', `${today}T23:59:59+08:00`).order('starts_at');
  const sessionIds = (sessions.data ?? []).map((row: any) => row.id);
  const cohortIds = (sessions.data ?? []).map((row: any) => row.cohort_id);
  const [enrollments, records] = await Promise.all([
    cohortIds.length ? supabase.from('cohort_students').select('cohort_id,student_id,students(display_name)').eq('organization_id', organizationId).eq('status', 'active').in('cohort_id', cohortIds) : Promise.resolve({ data: [], error: null }),
    sessionIds.length ? supabase.from('attendance_records').select('session_id,student_id,status').eq('organization_id', organizationId).in('session_id', sessionIds) : Promise.resolve({ data: [], error: null })
  ]);
  const error = sessions.error || enrollments.error || records.error;
  return <>
    <PageHeader title="今日點名" description="管理員及職員可維持既有的今日課堂點名流程。"/>
    {error ? <ErrorState error={error} fallback="暫時無法載入點名資料。"/> : !(sessions.data ?? []).length ? <EmptyState>今天沒有課堂。</EmptyState> : <div className="grid gap-5">{(sessions.data ?? []).map((session: any) => {
      const roster = (enrollments.data ?? []).filter((row: any) => row.cohort_id === session.cohort_id).map((row: any) => ({ id: row.student_id, label: row.students?.display_name || '未命名學生', status: (records.data ?? []).find((record: any) => record.session_id === session.id && record.student_id === row.student_id)?.status }));
      return <Panel key={session.id} title={`${formatMacauDateTime(session.starts_at)} · ${session.exam_cohorts?.name || '班別'}`}>{roster.length ? <SessionAttendanceForm sessionId={session.id} students={roster}/> : <EmptyState>此班別沒有有效學生。</EmptyState>}</Panel>;
    })}</div>}
  </>;
}

export default async function AttendancePage({ searchParams }: { searchParams: Promise<Search> }) {
  const context = await getOperationsContext();
  if (context.role !== 'teacher') return <StaffPage/>;
  const search = await searchParams;
  const { data: sessionData, error } = await context.supabase.rpc('get_teacher_attendance_sessions');
  if (error) return <><PageHeader title="課堂與點名" description="載入已獲授權課堂時發生問題。"/><ErrorState error={error} fallback="暫時無法載入課堂資料。"/></>;
  const sessions = (sessionData ?? []) as TeacherSession[];
  const rosterEntries = await Promise.all(sessions.map(async (session) => {
    const [roster, records] = await Promise.all([
      context.supabase.rpc('get_lesson_session_students', { target_session_id: session.session_id }),
      context.supabase.from('attendance_records').select('student_id,revision').eq('session_id', session.session_id)
    ]);
    return [session.session_id, (roster.data ?? []) as RosterStudent[], (records.data ?? []) as Attendance[]] as const;
  }));
  const rosters = Object.fromEntries(rosterEntries.map(([id, roster]) => [id, roster]));
  const attendance = Object.fromEntries(rosterEntries.map(([id, , records]) => [id, records]));
  return <TeacherPage sessions={sessions} rosters={rosters} attendance={attendance} search={search}/>;
}
