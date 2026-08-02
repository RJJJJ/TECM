import { getOperationsContext, formatMacauDateTime } from '@/lib/operations/context';
import { ErrorState, EmptyState, PageHeader, Badge, DataTable } from '@/components/operations-ui';

type MakeupSession = { id: string; scheduled_at: string; completed_at: string | null; status: string; students: { display_name: string | null } | null; teacher_profiles: { display_name: string | null } | null; makeup_tasks: { exam_cohorts: { name: string | null; subject: string | null; level: string | null } | null; lesson_plans: { sequence_no: number | null; title: string | null } | null } | null };

export default async function MakeupSchedulePage() {
  const { supabase, organizationId } = await getOperationsContext();
  const { data, error } = await supabase.from('makeup_sessions').select('id,scheduled_at,completed_at,status,students(display_name),teacher_profiles(display_name),makeup_tasks(exam_cohorts(name,subject,level),lesson_plans(sequence_no,title))').eq('organization_id', organizationId).order('scheduled_at', { ascending: true });
  const sessions = (data ?? []) as unknown as MakeupSession[];
  return <section className="space-y-5"><PageHeader title="補課時間表" description="查看已安排的補課時段及負責導師。" />{error ? <ErrorState error={error} fallback="讀取補課時間表失敗，請稍後再試。" /> : sessions.length === 0 ? <EmptyState>尚未安排補課。</EmptyState> : <DataTable headers={['時間', '學生', '班別／課堂', '導師', '狀態']}>
      {sessions.map(session => <tr key={session.id}><td className="px-4 py-3">{formatMacauDateTime(session.scheduled_at)}</td><td className="px-4 py-3">{session.students?.display_name ?? '—'}</td><td className="px-4 py-3"><p>{session.makeup_tasks?.exam_cohorts?.name ?? '—'}</p><p className="text-xs text-slate-500">第 {session.makeup_tasks?.lesson_plans?.sequence_no ?? '—'} 堂 · {session.makeup_tasks?.lesson_plans?.title ?? '—'}</p></td><td className="px-4 py-3">{session.teacher_profiles?.display_name ?? '待分配'}</td><td className="px-4 py-3"><Badge tone={session.status === 'completed' ? 'green' : session.status === 'cancelled' ? 'rose' : 'blue'}>{session.status}</Badge></td></tr>)}
  </DataTable>}</section>;
}
