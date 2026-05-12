import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type Cohort = {
  id: string;
  name: string;
  subject: string;
  level: string;
  exam_date: string;
  weekday_pattern: string;
  status: string;
  teacher_profiles: { display_name: string | null } | null;
};

type LessonPlan = {
  id: string;
  sequence_no: number;
  title: string;
  teaching_content: string | null;
  makeup_guidance: string | null;
};

type StudentRow = {
  id: string;
  status: string;
  students: { display_name: string | null; school_name: string | null } | null;
};

type AttendanceRow = {
  id: string;
  status: string;
  students: { display_name: string | null } | null;
  lesson_sessions: {
    starts_at: string;
    lesson_plans: { sequence_no: number; title: string | null } | null;
  } | null;
};

export default async function ExamCohortDetailPage({ params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const { data: cohortData, error: cohortError } = await supabase
    .from('exam_cohorts')
    .select('id,name,subject,level,exam_date,weekday_pattern,status,teacher_profiles(display_name)')
    .eq('id', params.id)
    .maybeSingle();

  if (cohortError) {
    return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{cohortError.message}</div>;
  }
  if (!cohortData) notFound();

  const cohort = cohortData as unknown as Cohort;

  const [{ data: lessonData }, { data: studentData }, { data: attendanceData }, { data: makeupData }] = await Promise.all([
    supabase.from('lesson_plans').select('id,sequence_no,title,teaching_content,makeup_guidance').eq('cohort_id', params.id).order('sequence_no'),
    supabase.from('cohort_students').select('id,status,students(display_name,school_name)').eq('cohort_id', params.id).order('created_at'),
    supabase
      .from('attendance_records')
      .select('id,status,students(display_name),lesson_sessions!inner(starts_at,lesson_plans(sequence_no,title))')
      .eq('lesson_sessions.cohort_id', params.id)
      .order('recorded_at', { ascending: false })
      .limit(50),
    supabase.from('makeup_tasks').select('id,status,priority').eq('cohort_id', params.id)
  ]);

  const lessons = (lessonData ?? []) as unknown as LessonPlan[];
  const students = (studentData ?? []) as unknown as StudentRow[];
  const attendances = (attendanceData ?? []) as unknown as AttendanceRow[];
  const makeupTasks = makeupData ?? [];
  const pendingMakeups = makeupTasks.filter((task: any) => ['pending', 'recommended'].includes(task.status)).length;

  return (
    <section className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">ExamCohortDetailPage</p>
            <h2 className="text-2xl font-semibold text-slate-900">{cohort.name}</h2>
            <p className="mt-1 text-sm text-slate-600">
              {cohort.subject} / {cohort.level} · Exam {cohort.exam_date} · {cohort.weekday_pattern}
            </p>
            <p className="mt-1 text-sm text-slate-600">Teacher: {cohort.teacher_profiles?.display_name ?? '-'}</p>
          </div>
          <div className="flex gap-2">
            <Link className="rounded-lg border px-3 py-2 text-sm" href={`/admin/exam-cohorts/${cohort.id}/lesson-plans`}>
              LessonPlanEditor
            </Link>
            <Link className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" href="/admin/makeup">
              MakeupStudentListPage
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Students" value={students.length} />
        <Metric label="Lesson plans" value={lessons.length} />
        <Metric label="Attendance rows" value={attendances.length} />
        <Metric label="Pending makeup" value={pendingMakeups} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Lesson plans">
          {lessons.length === 0 ? (
            <p className="text-sm text-slate-500">No lesson plan yet.</p>
          ) : (
            <div className="space-y-3">
              {lessons.map((lesson) => (
                <div key={lesson.id} className="rounded-lg border border-slate-200 p-3">
                  <p className="font-medium text-slate-900">Lesson {lesson.sequence_no}: {lesson.title}</p>
                  <p className="mt-1 text-sm text-slate-600">{lesson.teaching_content ?? '-'}</p>
                  <p className="mt-1 text-xs text-slate-500">Makeup: {lesson.makeup_guidance ?? '-'}</p>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Students">
          {students.length === 0 ? (
            <p className="text-sm text-slate-500">No students in this cohort.</p>
          ) : (
            <div className="space-y-2">
              {students.map((row) => (
                <div key={row.id} className="flex justify-between rounded-lg border border-slate-200 p-3 text-sm">
                  <span>{row.students?.display_name ?? '-'}</span>
                  <span className="text-slate-500">{row.status}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="AttendanceOverviewPage">
        {attendances.length === 0 ? (
          <p className="text-sm text-slate-500">No attendance submitted yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {attendances.map((row) => (
                  <tr key={row.id}>
                    <td className="py-2">{row.students?.display_name ?? '-'}</td>
                    <td className="py-2">Lesson {row.lesson_sessions?.lesson_plans?.sequence_no ?? '-'}</td>
                    <td className="py-2">{row.lesson_sessions?.lesson_plans?.title ?? '-'}</td>
                    <td className="py-2 font-medium">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      <div className="mt-4">{children}</div>
    </div>
  );
}
