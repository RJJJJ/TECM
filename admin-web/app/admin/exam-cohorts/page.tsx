import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type SearchParams = {
  subject?: string;
  level?: string;
  status?: string;
};

type ExamCohortRow = {
  id: string;
  name: string;
  subject: string;
  level: string;
  exam_date: string;
  weekday_pattern: string;
  status: string;
  teacher_profiles: { display_name: string | null } | null;
};

function badgeClass(status: string) {
  const base = 'rounded-full border px-2.5 py-1 text-xs font-semibold';
  if (status === 'active') return `${base} border-emerald-200 bg-emerald-50 text-emerald-700`;
  if (status === 'completed') return `${base} border-slate-200 bg-slate-100 text-slate-700`;
  return `${base} border-amber-200 bg-amber-50 text-amber-700`;
}

export default async function ExamCohortListPage({
  searchParams
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const supabase = await createServerSupabaseClient();
  const selectedSubject = resolvedSearchParams?.subject ?? 'all';
  const selectedStatus = resolvedSearchParams?.status ?? 'all';
  const selectedLevel = (resolvedSearchParams?.level ?? '').trim();

  let query = supabase
    .from('exam_cohorts')
    .select('id,name,subject,level,exam_date,weekday_pattern,status,teacher_profiles(display_name)')
    .order('exam_date', { ascending: true });

  if (selectedSubject !== 'all') query = query.eq('subject', selectedSubject);
  if (selectedStatus !== 'all') query = query.eq('status', selectedStatus);
  if (selectedLevel) query = query.ilike('level', `%${selectedLevel}%`);

  const { data, error } = await query;
  const cohorts = (data ?? []) as unknown as ExamCohortRow[];

  return (
    <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Exam Cohort List</h2>
          <p className="mt-1 text-sm text-slate-600">
            Manage C++ / Python / Scratch exam cohorts, teachers, lesson plans and makeup backlog.
          </p>
        </div>
        <Link className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white" href="/admin/makeup">
          Makeup backlog
        </Link>
      </div>

      <form method="get" className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-4">
        <select name="subject" defaultValue={selectedSubject} className="rounded-lg border px-3 py-2 text-sm">
          <option value="all">All subjects</option>
          <option value="Python">Python</option>
          <option value="Scratch">Scratch</option>
          <option value="C++">C++</option>
        </select>
        <input name="level" defaultValue={selectedLevel} placeholder="Level" className="rounded-lg border px-3 py-2 text-sm" />
        <select name="status" defaultValue={selectedStatus} className="rounded-lg border px-3 py-2 text-sm">
          <option value="all">All status</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white" type="submit">
          Filter
        </button>
      </form>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error.message}</div>
      ) : cohorts.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-600">
          No exam cohorts found. Apply PR1 schema before using this page.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Cohort</th>
                <th className="px-4 py-3">Subject / Level</th>
                <th className="px-4 py-3">Exam</th>
                <th className="px-4 py-3">Teacher</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cohorts.map((cohort) => (
                <tr key={cohort.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{cohort.name}</td>
                  <td className="px-4 py-3">{cohort.subject} / {cohort.level}</td>
                  <td className="px-4 py-3">{cohort.exam_date} · {cohort.weekday_pattern}</td>
                  <td className="px-4 py-3">{cohort.teacher_profiles?.display_name ?? '-'}</td>
                  <td className="px-4 py-3"><span className={badgeClass(cohort.status)}>{cohort.status}</span></td>
                  <td className="px-4 py-3">
                    <Link className="text-sm font-medium text-slate-700 underline" href={`/admin/exam-cohorts/${cohort.id}`}>
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
