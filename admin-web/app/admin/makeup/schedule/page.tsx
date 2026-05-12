import { createServerSupabaseClient } from '@/lib/supabase/server';

type MakeupSession = {
  id: string;
  scheduled_at: string;
  completed_at: string | null;
  status: string;
  students: { display_name: string | null } | null;
  teacher_profiles: { display_name: string | null } | null;
  makeup_tasks: {
    exam_cohorts: { name: string | null; subject: string | null; level: string | null } | null;
    lesson_plans: { sequence_no: number | null; title: string | null } | null;
  } | null;
};

export default async function MakeupSchedulePage() {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('makeup_sessions')
    .select(`
      id,
      scheduled_at,
      completed_at,
      status,
      students(display_name),
      teacher_profiles(display_name),
      makeup_tasks(
        exam_cohorts(name,subject,level),
        lesson_plans(sequence_no,title)
      )
    `)
    .order('scheduled_at', { ascending: true });

  const sessions = (data ?? []) as unknown as MakeupSession[];

  return (
    <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">MakeupSchedulePage</p>
        <h2 className="text-2xl font-semibold text-slate-900">Makeup schedule</h2>
        <p className="mt-1 text-sm text-slate-600">Exam-week makeup sessions, especially Monday to Friday before the exam.</p>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error.message}</div>
      ) : sessions.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-600">
          No makeup sessions scheduled.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Cohort / Lesson</th>
                <th className="px-4 py-3">Teacher</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sessions.map((session) => (
                <tr key={session.id}>
                  <td className="px-4 py-3">{new Date(session.scheduled_at).toLocaleString('zh-Hant-TW')}</td>
                  <td className="px-4 py-3">{session.students?.display_name ?? '-'}</td>
                  <td className="px-4 py-3">
                    <p>{session.makeup_tasks?.exam_cohorts?.name ?? '-'}</p>
                    <p className="text-xs text-slate-500">
                      Lesson {session.makeup_tasks?.lesson_plans?.sequence_no ?? '-'} · {session.makeup_tasks?.lesson_plans?.title ?? '-'}
                    </p>
                  </td>
                  <td className="px-4 py-3">{session.teacher_profiles?.display_name ?? '-'}</td>
                  <td className="px-4 py-3">{session.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
