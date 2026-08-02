import Link from 'next/link';
import { getOperationsContext } from '@/lib/operations/context';
import { ErrorState, EmptyState, PageHeader, Badge, DataTable } from '@/components/operations-ui';

type SearchParams = { subject?: string; status?: string; priority?: string };
type MakeupTaskRow = { id: string; status: string; priority: string; missed_status: string; students: { display_name: string | null; school_name: string | null } | null; exam_cohorts: { name: string | null; subject: string | null; level: string | null; exam_date: string | null } | null; lesson_plans: { sequence_no: number | null; title: string | null; teaching_content: string | null } | null };

export default async function MakeupStudentListPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const { supabase, organizationId } = await getOperationsContext();
  const selectedStatus = resolvedSearchParams?.status ?? 'open';
  const selectedSubject = resolvedSearchParams?.subject ?? 'all';
  const selectedPriority = resolvedSearchParams?.priority ?? 'all';
  let query = supabase.from('makeup_tasks').select('id,status,priority,missed_status,students(display_name,school_name),exam_cohorts(name,subject,level,exam_date),lesson_plans(sequence_no,title,teaching_content)').eq('organization_id', organizationId).order('created_at', { ascending: false });
  if (selectedStatus === 'open') query = query.in('status', ['pending', 'recommended', 'scheduled']); else if (selectedStatus !== 'all') query = query.eq('status', selectedStatus);
  if (selectedPriority !== 'all') query = query.eq('priority', selectedPriority);
  const { data, error } = await query;
  let tasks = (data ?? []) as unknown as MakeupTaskRow[];
  if (selectedSubject !== 'all') tasks = tasks.filter(task => task.exam_cohorts?.subject === selectedSubject);
  return <section className="space-y-5"><PageHeader title="補課安排" description="按科目、狀態及優先程度查看需要安排的補課。" action={<Link className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" href="/admin/makeup/schedule">查看補課時間表</Link>} />
    <form method="get" className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-4"><select aria-label="科目" name="subject" defaultValue={selectedSubject} className="rounded-lg border px-3 py-2 text-sm"><option value="all">所有科目</option><option value="Python">Python</option><option value="Scratch">Scratch</option><option value="C++">C++</option></select><select aria-label="狀態" name="status" defaultValue={selectedStatus} className="rounded-lg border px-3 py-2 text-sm"><option value="open">待處理</option><option value="all">所有狀態</option><option value="pending">待處理</option><option value="recommended">建議安排</option><option value="scheduled">已排課</option><option value="completed">已完成</option></select><select aria-label="優先程度" name="priority" defaultValue={selectedPriority} className="rounded-lg border px-3 py-2 text-sm"><option value="all">所有優先程度</option><option value="normal">一般</option><option value="high">高</option><option value="urgent">緊急</option></select><button className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white" type="submit">篩選</button></form>
    {error ? <ErrorState error={error} fallback="讀取補課安排失敗，請稍後再試。" /> : tasks.length === 0 ? <EmptyState>目前沒有符合條件的補課安排。</EmptyState> : <DataTable headers={['學生', '班別', '缺席課堂', '優先程度', '狀態', '操作']}>
      {tasks.map(task => <tr key={task.id} className="align-top"><td className="px-4 py-3"><p className="font-medium text-slate-900">{task.students?.display_name ?? '—'}</p><p className="text-xs text-slate-500">{task.students?.school_name ?? ''}</p></td><td className="px-4 py-3"><p>{task.exam_cohorts?.name ?? '—'}</p><p className="text-xs text-slate-500">{task.exam_cohorts?.subject}／{task.exam_cohorts?.level} · {task.exam_cohorts?.exam_date}</p></td><td className="px-4 py-3">第 {task.lesson_plans?.sequence_no ?? '—'} 堂：{task.lesson_plans?.title ?? '—'}</td><td className="px-4 py-3"><Badge tone={task.priority === 'urgent' ? 'rose' : task.priority === 'high' ? 'amber' : 'slate'}>{task.priority}</Badge></td><td className="px-4 py-3"><Badge tone={task.status === 'completed' ? 'green' : 'blue'}>{task.status}</Badge></td><td className="px-4 py-3"><Link className="font-medium text-teal-700 underline" href={`/admin/makeup/${task.id}`}>開啟詳情</Link></td></tr>)}
    </DataTable>}
  </section>;
}
