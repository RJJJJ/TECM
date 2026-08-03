import { notFound } from 'next/navigation';
import { getOperationsContext, formatMacauDateTime } from '@/lib/operations/context';
import { ErrorState, EmptyState, PageHeader, Badge, Panel } from '@/components/operations-ui';
import { statusLabel } from '@/lib/operations/labels';
import { MakeupCompletionForm, MakeupScheduleForm } from '../makeup-session-forms';

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

type MakeupSession = {
  id: string;
  status: string;
  scheduled_at: string;
  completed_at: string | null;
  teacher_profiles: { display_name: string | null } | null;
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
  const [{ data: teachers }, { data: sessions, error: sessionsError }] = await Promise.all([
    supabase
    .from('teacher_profiles')
    .select('id,display_name')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .order('display_name'),
    supabase.from('makeup_sessions').select('id,status,scheduled_at,completed_at,teacher_profiles(display_name)').eq('organization_id', organizationId).eq('makeup_task_id', task.id).order('scheduled_at')
  ]);
  const makeupSessions = (sessions ?? []) as unknown as MakeupSession[];
  const canComplete = task.status === 'scheduled' && makeupSessions.length === 1 && makeupSessions[0].status === 'scheduled';

  return (
    <section className="space-y-5">
      <PageHeader title={`${task.students?.display_name ?? '學生'}的補課安排`} description={`${task.exam_cohorts?.subject ?? ''}／${task.exam_cohorts?.level ?? ''} · ${task.exam_cohorts?.name ?? ''} · 考試日期 ${task.exam_cohorts?.exam_date ?? '—'}`} />
      <div>
        <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-3"><Info label="狀態" value={statusLabel(task.status)} /><Info label="優先程度" value={statusLabel(task.priority)} /><Info label="缺席狀態" value={statusLabel(task.missed_status)} /></div>
      </div>

      <Panel title="缺席課堂內容">
        <h3 className="font-semibold text-slate-900">
          第 {task.lesson_plans?.sequence_no ?? '—'} 堂：{task.lesson_plans?.title ?? '—'}
        </h3>
        <p className="mt-2 text-sm text-slate-700">{task.lesson_plans?.teaching_content ?? '-'}</p>
        <p className="mt-3 text-sm font-medium text-slate-900">補課提示</p>
        <p className="mt-1 text-sm text-slate-700">{task.lesson_plans?.makeup_guidance ?? '-'}</p>
      </Panel>

      {sessionsError ? <ErrorState error={sessionsError} fallback="讀取補課安排失敗，請稍後再試。" /> : null}
      <MakeupScheduleForm taskId={task.id} studentId={task.student_id} teachers={(teachers ?? []) as Array<{ id: string; display_name: string | null }>} idempotencyKey={crypto.randomUUID()} />

      {makeupSessions.length > 0 ? <Panel title="補課安排">
        <div className="space-y-2 text-sm">{makeupSessions.map((session) => <div key={session.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3"><span>{session.scheduled_at} · {session.teacher_profiles?.display_name ?? '未命名導師'}</span><Badge tone={session.status === 'completed' ? 'green' : session.status === 'cancelled' ? 'rose' : 'blue'}>{statusLabel(session.status)}</Badge></div>)}</div>
      </Panel> : null}

      {canComplete ? <MakeupCompletionForm taskId={task.id} /> : task.status === 'scheduled' ? <p className="text-sm text-amber-700">只有存在一節有效的已安排補課時，才可標記完成。</p> : null}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-slate-200 p-4"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 font-semibold text-slate-900"><Badge tone={value === '已完成' ? 'green' : 'slate'}>{value}</Badge></p></div>;
}
