import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { LessonSessionCreateForm } from './lesson-session-create-form';

type Cohort = {
  id: string;
  name: string;
  subject: string;
  level: string;
};

type LessonPlan = {
  id: string;
  sequence_no: number;
  title: string;
};

type Teacher = {
  id: string;
  display_name: string;
};

type LessonSession = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  teacher_profiles: { display_name: string | null } | null;
  lesson_plans: { sequence_no: number | null; title: string | null } | null;
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Macau',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

export default async function LessonSessionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: cohortData, error: cohortError } = await supabase
    .from('exam_cohorts')
    .select('id,name,subject,level')
    .eq('id', id)
    .maybeSingle();

  if (cohortError) {
    return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{cohortError.message}</div>;
  }
  if (!cohortData) notFound();

  const [{ data: lessonData }, { data: teacherData }, { data: sessionData }] = await Promise.all([
    supabase.from('lesson_plans').select('id,sequence_no,title').eq('cohort_id', id).order('sequence_no'),
    supabase.from('teacher_profiles').select('id,display_name').eq('is_active', true).order('display_name'),
    supabase
      .from('lesson_sessions')
      .select('id,starts_at,ends_at,status,teacher_profiles(display_name),lesson_plans(sequence_no,title)')
      .eq('cohort_id', id)
      .order('starts_at', { ascending: true })
  ]);

  const cohort = cohortData as Cohort;
  const lessons = (lessonData ?? []) as unknown as LessonPlan[];
  const teachers = (teacherData ?? []) as unknown as Teacher[];
  const sessions = (sessionData ?? []) as unknown as LessonSession[];

  return (
    <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">LessonSessionsPage</p>
          <h2 className="text-2xl font-semibold text-slate-900">Lesson sessions</h2>
          <p className="mt-1 text-sm text-slate-600">
            {cohort.name} / {cohort.subject} / {cohort.level}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Create the dated class sessions that teachers will see in the iOS attendance screen.
          </p>
        </div>
        <Link className="rounded-lg border px-3 py-2 text-sm" href={`/admin/exam-cohorts/${cohort.id}`}>
          Back to cohort
        </Link>
      </div>

      <LessonSessionCreateForm cohortId={cohort.id} lessons={lessons} teachers={teachers} />

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Lesson</th>
              <th className="px-3 py-2">Teacher</th>
              <th className="px-3 py-2">Start</th>
              <th className="px-3 py-2">End</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sessions.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-slate-500" colSpan={5}>No lesson sessions yet.</td>
              </tr>
            ) : (
              sessions.map((session) => (
                <tr key={session.id}>
                  <td className="px-3 py-2">
                    Lesson {session.lesson_plans?.sequence_no ?? '-'}: {session.lesson_plans?.title ?? '-'}
                  </td>
                  <td className="px-3 py-2">{session.teacher_profiles?.display_name ?? '-'}</td>
                  <td className="px-3 py-2">{formatDateTime(session.starts_at)}</td>
                  <td className="px-3 py-2">{formatDateTime(session.ends_at)}</td>
                  <td className="px-3 py-2 font-medium">{session.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
