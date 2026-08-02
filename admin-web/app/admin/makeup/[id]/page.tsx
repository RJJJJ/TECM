import { notFound } from 'next/navigation';
import { getOperationsContext, formatMacauDateTime } from '@/lib/operations/context';
import { ErrorState, EmptyState, PageHeader, Badge, Panel } from '@/components/operations-ui';
import { completeMakeupTaskAction, scheduleMakeupSessionAction } from '../actions';

type MakeupTask = {
  id: string;
  student_id: string;
  status: string;
  priority: string;
  missed_status: string;
  internal_note: string | null;
  students: { display_name: string | null; school_name: string | null } | null;
  exam_cohorts: { name: string | null; subject: string | null; level: string | null; exam_date: string | null } | null;
  lesson_plans: {
    sequence_no: number | null;
    title: string | null;
    teaching_content: string | null;
    makeup_guidance: string | null;
  } | null;
};

export default async function MakeupTaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, organizationId } = await getOperationsContext();
  const { data, error } = await supabase
    .from('makeup_tasks')
    .select(`
      id,
      student_id,
      status,
      priority,
      missed_status,
      internal_note,
      students(display_name,school_name),
      exam_cohorts(name,subject,level,exam_date),
      lesson_plans(sequence_no,title,teaching_content,makeup_guidance)
    `)
    .eq('id', id)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error) {
    return <ErrorState error={error} fallback="讀取補課詳情失敗，請稍後再試。" />;
  }
  if (!data) notFound();

  const task = data as unknown as MakeupTask;
  const { data: teachers } = await supabase
    .from('teacher_profiles')
    .select('id,display_name')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .order('display_name');

  async function scheduleAction(formData: FormData) {
    'use server';
    await scheduleMakeupSessionAction(task.id, task.student_id, { status: 'idle' }, formData);
  }
  const completeAction = completeMakeupTaskAction.bind(null, task.id);

  return (
    <section className="space-y-5">
      <PageHeader title={`${task.students?.display_name ?? '學生'}的補課安排`} description={`${task.exam_cohorts?.subject ?? ''}／${task.exam_cohorts?.level ?? ''} · ${task.exam_cohorts?.name ?? ''} · 考試日期 ${task.exam_cohorts?.exam_date ?? '—'}`} />
      <div>
        <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-3"><Info label="狀態" value={task.status} /><Info label="優先程度" value={task.priority} /><Info label="缺席狀態" value={task.missed_status} /></div>
      </div>

      <Panel title="缺席課堂內容">
        <h3 className="font-semibold text-slate-900">
          第 {task.lesson_plans?.sequence_no ?? '—'} 堂：{task.lesson_plans?.title ?? '—'}
        </h3>
        <p className="mt-2 text-sm text-slate-700">{task.lesson_plans?.teaching_content ?? '-'}</p>
        <p className="mt-3 text-sm font-medium text-slate-900">補課提示</p>
        <p className="mt-1 text-sm text-slate-700">{task.lesson_plans?.makeup_guidance ?? '-'}</p>
      </Panel>

      <form action={scheduleAction} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-3">
        <input aria-label="補課時間" name="scheduled_at" type="datetime-local" className="rounded-lg border px-3 py-2 text-sm" required />
        <select aria-label="補課導師" name="teacher_id" className="rounded-lg border px-3 py-2 text-sm" defaultValue="">
          <option value="">稍後分配導師</option>
          {(teachers ?? []).map((teacher: any) => (
            <option key={teacher.id} value={teacher.id}>{teacher.display_name}</option>
          ))}
        </select>
        <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white" type="submit">
          安排補課
        </button>
      </form>

      <form action={completeAction}>
        <button className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700" type="submit">
          標記為已完成
        </button>
      </form>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-slate-200 p-4"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 font-semibold text-slate-900"><Badge tone={value === 'completed' ? 'green' : 'slate'}>{value}</Badge></p></div>;
}
