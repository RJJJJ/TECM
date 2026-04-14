import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase/server';
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
  const supabase = createServerSupabaseClient();

  const [{ data: courseData, error: courseError }, { data: campusData }] = await Promise.all([
    supabase
      .from('courses')
      .select('id, title, category, level, age_group, recommended, is_active, sort_order, updated_at, campuses(name)')
      .order('sort_order', { ascending: true })
      .order('updated_at', { ascending: false }),
    supabase.from('campuses').select('id, name, is_active').order('name', { ascending: true })
  ]);

  const courses = (courseData ?? []) as CourseRow[];
  const campuses = (campusData ?? []) as CampusOption[];

  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Course Management</h2>
          <p className="mt-1 text-sm text-slate-600">新增課程資料（courses）</p>
        </div>
        <CourseCreateForm campuses={campuses} />
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-slate-900">Course List</h3>
          <p className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">共 {courses.length} 筆</p>
        </div>

        {courseError && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            讀取課程失敗：{courseError.message}
          </p>
        )}

        {!courseError && courses.length === 0 && (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
            目前尚無課程，請先新增第一門課。
          </p>
        )}

        {!courseError && courses.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Title</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Category</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Level</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Age Group</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Campus</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Recommended</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Is Active</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Sort Order</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Updated At</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">Action</th>
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
                    <td className="px-4 py-3">{boolBadge(course.recommended, 'Yes', 'No')}</td>
                    <td className="px-4 py-3">{boolBadge(course.is_active, 'Active', 'Inactive')}</td>
                    <td className="px-4 py-3 text-slate-700">{course.sort_order}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDateTime(course.updated_at)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Link
                        href={`/admin/courses/${course.id}`}
                        className="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                      >
                        Edit
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
