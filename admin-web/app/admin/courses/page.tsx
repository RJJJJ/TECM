import Link from 'next/link';
import { getOperationsContext } from '@/lib/operations/context';
import { userFacingError } from '@/lib/operations/errors';
import { ErrorState, EmptyState, PageHeader, Panel } from '@/components/operations-ui';
import CourseCreateForm from './course-create-form';

type CourseRow = {
  id: string;
  title: string;
  category: string | null;
  level: string | null;
  age_group: string | null;
  recommended: boolean;
  is_active: boolean;
  sort_order: number;
  updated_at: string | null;
  campuses: {
    name: string | null;
  } | null;
};

type CampusOption = {
  id: string;
  name: string;
  is_active: boolean;
};

function formatDateTime(dateValue: string | null) {
  if (!dateValue) return '-';

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return dateValue;

  return new Intl.DateTimeFormat('zh-Hant-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function boolBadge(value: boolean, trueText: string, falseText: string) {
  if (value) {
    return (
      <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
        {trueText}
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
      {falseText}
    </span>
  );
}

export default async function AdminCoursesPage() {
  const { supabase, organizationId, role } = await getOperationsContext();
  if (!['admin', 'staff'].includes(role)) throw userFacingError('只有管理員或職員可以管理課程。');

  const [{ data: courseData, error: courseError }, { data: campusData, error: campusError }] = await Promise.all([
    supabase
      .from('courses')
      .select('id, title, category, level, age_group, recommended, is_active, sort_order, updated_at, campuses(name)')
      .order('sort_order', { ascending: true })
      .eq('organization_id', organizationId)
      .order('updated_at', { ascending: false }),
    supabase.from('campuses').select('id, name, is_active').eq('organization_id', organizationId).order('name', { ascending: true })
  ]);

  const courses = (courseData ?? []) as unknown as CourseRow[];
  const campuses = (campusData ?? []) as CampusOption[];

  return (
    <div className="space-y-5">
      <PageHeader title="課程" description="建立及管理課程；如需選擇校區，請先在設定完成校區資料。" action={<Link href="/admin/settings#campus-settings" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium">管理校區</Link>} />
      <div id="create-course"><Panel title="新增課程">
        <CourseCreateForm campuses={campuses} />
      </Panel></div>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">課程列表</h2>
          <p className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">共 {courses.length} 筆</p>
        </div>

        {courseError ? <ErrorState error={courseError} fallback="讀取課程失敗，請稍後再試。" /> : null}
        {campusError ? <ErrorState error={campusError} fallback="讀取校區失敗，請稍後再試。" /> : null}

        {!courseError && courses.length === 0 && (
          <EmptyState action={<Link href="#create-course" className="font-medium text-teal-700 underline">新增第一門課</Link>}>目前尚無課程，請先新增第一門課。</EmptyState>
        )}

        {!courseError && courses.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">名稱</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">類別</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">程度</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">年齡組別</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">校區</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">推薦</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">狀態</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">排序</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">更新時間</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {courses.map((course) => (
                  <tr key={course.id}>
                    <td className="px-4 py-3 text-slate-900">
                      <p className="font-medium">{course.title}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{course.category ?? '-'}</td>
                    <td className="px-4 py-3 text-slate-700">{course.level ?? '-'}</td>
                    <td className="px-4 py-3 text-slate-700">{course.age_group ?? '-'}</td>
                    <td className="px-4 py-3 text-slate-700">{course.campuses?.name ?? '-'}</td>
                    <td className="px-4 py-3">{boolBadge(course.recommended, '是', '否')}</td>
                    <td className="px-4 py-3">{boolBadge(course.is_active, '啟用', '停用')}</td>
                    <td className="px-4 py-3 text-slate-700">{course.sort_order}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDateTime(course.updated_at)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Link
                        href={`/admin/courses/${course.id}`}
                        className="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                      >
                        編輯
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
