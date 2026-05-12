import { notFound } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
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

export default async function MakeupTaskDetailPage({ params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
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
    .eq('id', params.id)
    .maybeSingle();

  if (error) {
    return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error.message}</div>;
  }
  if (!data) notFound();

  const task = data as unknown as MakeupTask;
  const { data: teachers } = await supabase
    .from('teacher_profiles')
    .select('id,display_name')
    .eq('is_active', true)
    .order('display_name');

  async function scheduleAction(formData: FormData) {
    'use server';
    await scheduleMakeupSessionAction(task.id, task.student_id, { status: 'idle' }, formData);
  }
  const completeAction = completeMakeupTaskAction.bind(null, task.id);

  return (
    <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">MakeupTaskDetailPage</p>
        <h2 className="text-2xl font-semibold text-slate-900">{task.students?.display_name ?? 'Student'} makeup task</h2>
        <p className="mt-1 text-sm text-slate-600">
          {task.exam_cohorts?.subject} / {task.exam_cohorts?.level} · {task.exam_cohorts?.name} · Exam {task.exam_cohorts?.exam_date}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Info label="Status" value={task.status} />
        <Info label="Priority" value={task.priority} />
        <Info label="Missed status" value={task.missed_status} />
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="font-semibold text-slate-900">
          Lesson {task.lesson_plans?.sequence_no}: {task.lesson_plans?.title}
        </h3>
        <p className="mt-2 text-sm text-slate-700">{task.lesson_plans?.teaching_content ?? '-'}</p>
        <p className="mt-3 text-sm font-medium text-slate-900">Makeup guidance</p>
        <p className="mt-1 text-sm text-slate-700">{task.lesson_plans?.makeup_guidance ?? '-'}</p>
      </div>

      <form action={scheduleAction} className="grid gap-3 rounded-lg border border-slate-200 p-4 md:grid-cols-3">
        <input name="scheduled_at" type="datetime-local" className="rounded-lg border px-3 py-2 text-sm" required />
        <select name="teacher_id" className="rounded-lg border px-3 py-2 text-sm" defaultValue="">
          <option value="">No teacher assigned</option>
          {(teachers ?? []).map((teacher: any) => (
            <option key={teacher.id} value={teacher.id}>{teacher.display_name}</option>
          ))}
        </select>
        <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white" type="submit">
          Schedule makeup
        </button>
      </form>

      <form action={completeAction}>
        <button className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700" type="submit">
          Mark completed
        </button>
      </form>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-900">{value}</p>
    </div>
  );
}
