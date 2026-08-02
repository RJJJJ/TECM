import Link from 'next/link';
import { getOperationsContext } from '@/lib/operations/context';
import { ErrorState, EmptyState, PageHeader, Panel, Badge, DataTable } from '@/components/operations-ui';
import CohortCreateForm from './cohort-create-form';
import { statusLabel } from '@/lib/operations/labels';

type SearchParams = { subject?: string; level?: string; status?: string };
type ExamCohortRow = { id: string; name: string; subject: string; level: string; exam_date: string; weekday_pattern: string; status: string; teacher_profiles: { display_name: string | null } | null };

export default async function ExamCohortListPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const { supabase, organizationId, role } = await getOperationsContext();
  const selectedSubject = resolvedSearchParams?.subject ?? 'all';
  const selectedStatus = resolvedSearchParams?.status ?? 'all';
  const selectedLevel = (resolvedSearchParams?.level ?? '').trim();
  let query = supabase.from('exam_cohorts').select('id,name,subject,level,exam_date,weekday_pattern,status,teacher_profiles(display_name)').eq('organization_id', organizationId).order('exam_date', { ascending: true });
  if (selectedSubject !== 'all') query = query.eq('subject', selectedSubject);
  if (selectedStatus !== 'all') query = query.eq('status', selectedStatus);
  if (selectedLevel) query = query.ilike('level', `%${selectedLevel}%`);
  const [{ data, error }, { data: teachers, error: teacherError }] = await Promise.all([
    query,
    supabase.from('teacher_profiles').select('id,display_name').eq('organization_id', organizationId).eq('is_active', true).order('display_name')
  ]);
  const cohorts = (data ?? []) as unknown as ExamCohortRow[];

  return <>
    <PageHeader title="班別" description="建立班別、安排導師、編寫教案及建立未來課堂。" action={<Link className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium" href="/admin/makeup">查看補課安排</Link>} />
    {['admin', 'staff'].includes(role) ? <Panel title="建立班別"><CohortCreateForm teachers={(teachers ?? []).map(teacher => ({ id: teacher.id, label: teacher.display_name }))} /></Panel> : null}
    {teacherError ? <div className="mt-5"><ErrorState error={teacherError} fallback="讀取導師失敗，請稍後再試。" /></div> : null}
    <section className="mt-5 space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <form method="get" className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-4">
        <select aria-label="科目" name="subject" defaultValue={selectedSubject} className="rounded-lg border px-3 py-2 text-sm"><option value="all">所有科目</option><option value="Python">Python</option><option value="Scratch">Scratch</option><option value="C++">C++</option></select>
        <input aria-label="程度" name="level" defaultValue={selectedLevel} placeholder="程度" className="rounded-lg border px-3 py-2 text-sm" />
        <select aria-label="狀態" name="status" defaultValue={selectedStatus} className="rounded-lg border px-3 py-2 text-sm"><option value="all">所有狀態</option><option value="draft">草稿</option><option value="active">使用中</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select>
        <button className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white" type="submit">篩選</button>
      </form>
      {error ? <ErrorState error={error} fallback="讀取班別失敗，請稍後再試。" /> : cohorts.length === 0 ? <EmptyState>尚未有符合條件的班別，請先建立班別。</EmptyState> : <DataTable headers={['班別', '科目／程度', '考試日期', '導師', '狀態', '操作']}>
        {cohorts.map(cohort => <tr key={cohort.id}><td className="px-4 py-3 font-medium text-slate-900">{cohort.name}</td><td className="px-4 py-3">{cohort.subject}／{cohort.level}</td><td className="px-4 py-3">{cohort.exam_date} · {cohort.weekday_pattern === 'saturday' ? '星期六' : '星期日'}</td><td className="px-4 py-3">{cohort.teacher_profiles?.display_name ?? '待分配'}</td><td className="px-4 py-3"><Badge tone={cohort.status === 'active' ? 'green' : cohort.status === 'cancelled' ? 'rose' : cohort.status === 'completed' ? 'slate' : 'amber'}>{statusLabel(cohort.status)}</Badge></td><td className="px-4 py-3"><Link className="text-sm font-medium text-teal-700 underline" href={`/admin/exam-cohorts/${cohort.id}`}>開啟班別</Link></td></tr>)}
      </DataTable>}
    </section>
  </>;
}
