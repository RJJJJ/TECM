import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOperationsContext, formatMacauDateTime } from '@/lib/operations/context';
import { ErrorState, EmptyState, PageHeader, Badge, DataTable } from '@/components/operations-ui';
import { statusLabel } from '@/lib/operations/labels';
import { LessonSessionCreateForm } from './lesson-session-create-form';

type Cohort = { id: string; name: string; subject: string; level: string };
type LessonPlan = { id: string; sequence_no: number; title: string };
type Teacher = { id: string; display_name: string };
type LessonSession = { id: string; starts_at: string; ends_at: string; status: string; teacher_profiles: { display_name: string | null } | null; lesson_plans: { sequence_no: number | null; title: string | null } | null };

export default async function LessonSessionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, organizationId } = await getOperationsContext();
  const { data: cohortData, error: cohortError } = await supabase.from('exam_cohorts').select('id,name,subject,level').eq('id', id).eq('organization_id', organizationId).maybeSingle();
  if (cohortError) return <ErrorState error={cohortError} fallback="讀取班別失敗，請稍後再試。" />;
  if (!cohortData) notFound();
  const [{ data: lessonData, error: lessonError }, { data: teacherData, error: teacherError }, { data: sessionData, error: sessionError }] = await Promise.all([
    supabase.from('lesson_plans').select('id,sequence_no,title').eq('organization_id', organizationId).eq('cohort_id', id).order('sequence_no'),
    supabase.from('teacher_profiles').select('id,display_name').eq('organization_id', organizationId).eq('is_active', true).order('display_name'),
    supabase.from('lesson_sessions').select('id,starts_at,ends_at,status,teacher_profiles(display_name),lesson_plans(sequence_no,title)').eq('organization_id', organizationId).eq('cohort_id', id).order('starts_at', { ascending: true })
  ]);
  const cohort = cohortData as Cohort;
  const lessons = (lessonData ?? []) as unknown as LessonPlan[];
  const teachers = (teacherData ?? []) as unknown as Teacher[];
  const sessions = (sessionData ?? []) as unknown as LessonSession[];
  return <section className="space-y-5"><PageHeader title="管理未來課堂" description={`${cohort.name} · ${cohort.subject}／${cohort.level}。建立後，導師可在今日課堂及點名頁使用。`} action={<Link className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" href={`/admin/exam-cohorts/${cohort.id}`}>返回班別</Link>} />
    {lessonError || teacherError || sessionError ? <ErrorState error={lessonError || teacherError || sessionError} fallback="部分課堂資料未能載入，請稍後再試。" /> : null}
    <LessonSessionCreateForm cohortId={cohort.id} lessons={lessons} teachers={teachers} />
    {sessions.length === 0 ? <EmptyState>尚未建立未來課堂；請先選擇教案、導師及時間。</EmptyState> : <DataTable headers={['教案', '導師', '開始時間', '結束時間', '狀態']}>
      {sessions.map(session => <tr key={session.id}><td className="px-3 py-2">第 {session.lesson_plans?.sequence_no ?? '—'} 堂：{session.lesson_plans?.title ?? '—'}</td><td className="px-3 py-2">{session.teacher_profiles?.display_name ?? '—'}</td><td className="px-3 py-2">{formatMacauDateTime(session.starts_at)}</td><td className="px-3 py-2">{formatMacauDateTime(session.ends_at)}</td><td className="px-3 py-2"><Badge tone={session.status === 'scheduled' ? 'blue' : session.status === 'completed' ? 'green' : 'rose'}>{statusLabel(session.status)}</Badge></td></tr>)}
    </DataTable>}
  </section>;
}
