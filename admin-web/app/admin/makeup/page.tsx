import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type SearchParams = {
  subject?: string;
  status?: string;
  priority?: string;
};

type MakeupTaskRow = {
  id: string;
  status: string;
  priority: string;
  missed_status: string;
  students: { display_name: string | null; school_name: string | null } | null;
  exam_cohorts: { name: string | null; subject: string | null; level: string | null; exam_date: string | null } | null;
  lesson_plans: { sequence_no: number | null; title: string | null; teaching_content: string | null } | null;
  teacher_profiles?: { display_name: string | null } | null;
};

export default async function MakeupStudentListPage({ searchParams }: { searchParams?: SearchParams }) {
  const supabase = createServerSupabaseClient();
  const selectedStatus = searchParams?.status ?? 'open';
  const selectedSubject = searchParams?.subject ?? 'all';
  const selectedPriority = searchParams?.priority ?? 'all';

  let query = supabase
    .from('makeup_tasks')
    .select(`
      id,
      status,
      priority,
      missed_status,
      students(display_name,school_name),
      exam_cohorts(name,subject,level,exam_date),
      lesson_plans(sequence_no,title,teaching_content)
    `)
    .order('created_at', { ascending: false });

  if (selectedStatus === 'open') query = query.in('status', ['pending', 'recommended', 'scheduled']);
  else if (selectedStatus !== 'all') query = query.eq('status', selectedStatus);
  if (selectedPriority !== 'all') query = query.eq('priority', selectedPriority);

  const { data, error } = await query;
  let tasks = (data ?? []) as unknown as MakeupTaskRow[];
  if (selectedSubject !== 'all') {
    tasks = tasks.filter((task) => task.exam_cohorts?.subject === selectedSubject);
  }

  return (
    <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">MakeupStudentListPage</p>
          <h2 className="text-2xl font-semibold text-slate-900">Makeup backlog</h2>
          <p className="mt-1 text-sm text-slate-600">
            Filter by subject, class, teacher, exam date and priority; open each task to see the missed lesson content.
          </p>
        </div>
        <Link className="rounded-lg border px-3 py-2 text-sm" href="/admin/makeup/schedule">
          MakeupSchedulePage
        </Link>
      </div>

      <form method="get" className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-4">
        <select name="subject" defaultValue={selectedSubject} className="rounded-lg border px-3 py-2 text-sm">
          <option value="all">All subjects</option>
          <option value="Python">Python</option>
          <option value="Scratch">Scratch</option>
          <option value="C++">C++</option>
        </select>
        <select name="status" defaultValue={selectedStatus} className="rounded-lg border px-3 py-2 text-sm">
          <option value="open">Open</option>
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="recommended">Recommended</option>
          <option value="scheduled">Scheduled</option>
          <option value="completed">Completed</option>
        </select>
        <select name="priority" defaultValue={selectedPriority} className="rounded-lg border px-3 py-2 text-sm">
          <option value="all">All priorities</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
        <button className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white" type="submit">
          Filter
        </button>
      </form>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error.message}</div>
      ) : tasks.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-600">
          No pending makeup task.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Cohort</th>
                <th className="px-4 py-3">Missed lesson</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tasks.map((task) => (
                <tr key={task.id} className="align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{task.students?.display_name ?? '-'}</p>
                    <p className="text-xs text-slate-500">{task.students?.school_name ?? ''}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p>{task.exam_cohorts?.name ?? '-'}</p>
                    <p className="text-xs text-slate-500">
                      {task.exam_cohorts?.subject} / {task.exam_cohorts?.level} · {task.exam_cohorts?.exam_date}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <p>Lesson {task.lesson_plans?.sequence_no}: {task.lesson_plans?.title ?? '-'}</p>
                    <p className="line-clamp-2 text-xs text-slate-500">{task.lesson_plans?.teaching_content ?? '-'}</p>
                  </td>
                  <td className="px-4 py-3">{task.priority}</td>
                  <td className="px-4 py-3">{task.status}</td>
                  <td className="px-4 py-3">
                    <Link className="font-medium text-slate-700 underline" href={`/admin/makeup/${task.id}`}>
                      Detail
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
