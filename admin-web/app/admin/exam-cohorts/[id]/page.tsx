import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOperationsContext } from '@/lib/operations/context';
import { ErrorState, EmptyState, PageHeader, Badge } from '@/components/operations-ui';
import CohortStudentForm from '../cohort-student-form';

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

export default async function ExamCohortDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, organizationId, role } = await getOperationsContext();
  const { data: cohortData, error: cohortError } = await supabase
    .from('exam_cohorts')
    .select('id,name,subject,level,exam_date,weekday_pattern,status,teacher_profiles(display_name)')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (cohortError) {
    return <ErrorState error={cohortError} fallback="讀取班別失敗，請稍後再試。" />;
  }
  if (!cohortData) notFound();

  const cohort = cohortData as unknown as Cohort;

  const [{ data: lessonData, error: lessonError }, { data: studentData, error: studentError }, { data: attendanceData, error: attendanceError }, { data: makeupData, error: makeupError }, { data: availableStudentData, error: availableStudentError }] = await Promise.all([
    supabase.from('lesson_plans').select('id,sequence_no,title,teaching_content,makeup_guidance').eq('organization_id', organizationId).eq('cohort_id', id).order('sequence_no'),
    supabase.from('cohort_students').select('id,status,student_id,students(display_name,school_name)').eq('organization_id', organizationId).eq('cohort_id', id).order('created_at'),
    supabase
      .from('attendance_records')
      .select('id,status,students(display_name),lesson_sessions!inner(starts_at,lesson_plans(sequence_no,title))')
      .eq('organization_id', organizationId)
      .eq('lesson_sessions.cohort_id', id)
      .order('recorded_at', { ascending: false })
      .limit(50),
    supabase.from('makeup_tasks').select('id,status,priority').eq('organization_id', organizationId).eq('cohort_id', id),
    supabase.from('students').select('id,display_name').eq('organization_id', organizationId).eq('status', 'active').order('display_name')
  ]);

  const lessons = (lessonData ?? []) as unknown as LessonPlan[];
  const students = (studentData ?? []) as unknown as StudentRow[];
  const attendances = (attendanceData ?? []) as unknown as AttendanceRow[];
  const makeupTasks = makeupData ?? [];
  const enrolledStudentIds = new Set((students as Array<StudentRow & { student_id?: string }>).map(row => row.student_id).filter(Boolean));
  const availableStudents = (availableStudentData ?? []).filter(student => !enrolledStudentIds.has(student.id));
  const pendingMakeups = makeupTasks.filter((task: any) => ['pending', 'recommended'].includes(task.status)).length;

  return (
    <section className="space-y-5">
      <PageHeader title={cohort.name} description={`${cohort.subject}／${cohort.level} · 考試日期 ${cohort.exam_date} · ${cohort.weekday_pattern === 'saturday' ? '星期六' : '星期日'} · 導師：${cohort.teacher_profiles?.display_name ?? '待分配'}`} action={<Link className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" href="/admin/exam-cohorts">返回班別列表</Link>} />
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">班別資料</h2>
            <p className="mt-1 text-sm text-slate-600">
              {cohort.subject}／{cohort.level} · 考試日期 {cohort.exam_date} · {cohort.weekday_pattern === 'saturday' ? '星期六' : '星期日'}
            </p>
            <p className="mt-1 text-sm text-slate-600">導師：{cohort.teacher_profiles?.display_name ?? '待分配'}</p>
          </div>
          <div className="flex gap-2">
            <Link className="rounded-lg border px-3 py-2 text-sm" href={`/admin/exam-cohorts/${cohort.id}/lesson-plans`}>
              編輯教案
            </Link>
            <Link className="rounded-lg border px-3 py-2 text-sm" href={`/admin/exam-cohorts/${cohort.id}/lesson-sessions`}>
              管理課堂
            </Link>
            <Link className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" href="/admin/makeup">
              查看補課
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="學生人數" value={students.length} />
        <Metric label="教案堂數" value={lessons.length} />
        <Metric label="點名紀錄" value={attendances.length} />
        <Metric label="待安排補課" value={pendingMakeups} />
      </div>

      {lessonError || studentError || attendanceError || makeupError || availableStudentError ? <ErrorState error={lessonError || studentError || attendanceError || makeupError || availableStudentError} fallback="部分班別資料未能載入，請稍後再試。" /> : null}
      {['admin', 'staff'].includes(role) ? <Panel title="將學生加入班別"><CohortStudentForm cohortId={id} students={availableStudents.map(student => ({ id: student.id, label: student.display_name }))} /></Panel> : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="教案">
          {lessons.length === 0 ? (
            <EmptyState>尚未建立教案，請先開啟「編輯教案」。</EmptyState>
          ) : (
            <div className="space-y-3">
              {lessons.map((lesson) => (
                <div key={lesson.id} className="rounded-lg border border-slate-200 p-3">
                  <p className="font-medium text-slate-900">第 {lesson.sequence_no} 堂：{lesson.title}</p>
                  <p className="mt-1 text-sm text-slate-600">{lesson.teaching_content ?? '-'}</p>
                  <p className="mt-1 text-xs text-slate-500">補課提示：{lesson.makeup_guidance ?? '-'}</p>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="報讀學生">
          {students.length === 0 ? (
            <EmptyState>尚未有學生報讀此班別。</EmptyState>
          ) : (
            <div className="space-y-2">
              {students.map((row) => (
                <div key={row.id} className="flex justify-between rounded-lg border border-slate-200 p-3 text-sm">
                  <span>{row.students?.display_name ?? '-'}</span>
                   <Badge>{row.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="點名紀錄">
        {attendances.length === 0 ? (
          <EmptyState>尚未有點名紀錄。</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {attendances.map((row) => (
                  <tr key={row.id}>
                    <td className="py-2">{row.students?.display_name ?? '-'}</td>
                    <td className="py-2">第 {row.lesson_sessions?.lesson_plans?.sequence_no ?? '-'} 堂</td>
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
