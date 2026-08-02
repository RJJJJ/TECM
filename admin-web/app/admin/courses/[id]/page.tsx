import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOperationsContext } from '@/lib/operations/context';
import { ErrorState } from '@/components/operations-ui';
import CourseEditForm from './course-edit-form';
import CourseTagsManager from './course-tags-manager';

type CourseDetail = {
  id: string;
  title: string;
  category: string | null;
  level: string | null;
  age_group: string | null;
  summary: string | null;
  schedule_text: string | null;
  campus_id: string | null;
  recommended: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
  campuses: {
    name: string | null;
  } | null;
};

type CourseTag = {
  id: string;
  course_id: string;
  tag: string;
  created_at: string | null;
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

export default async function CourseDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, organizationId } = await getOperationsContext();

  const [{ data: courseData, error: courseError }, { data: tagsData, error: tagsError }, { data: campusData }] =
    await Promise.all([
      supabase
        .from('courses')
        .select(
          'id, title, category, level, age_group, summary, schedule_text, campus_id, recommended, is_active, sort_order, created_at, updated_at, campuses(name)'
        )
        .eq('id', id)
        .eq('organization_id', organizationId)
        .maybeSingle(),
      supabase.from('course_tags').select('id, course_id, tag, created_at').eq('organization_id', organizationId).eq('course_id', id).order('created_at'),
      supabase.from('campuses').select('id, name, is_active').eq('organization_id', organizationId).order('name', { ascending: true })
    ]);

  if (courseError) {
    return <ErrorState error={courseError} fallback="讀取課程失敗，請稍後再試。" />;
  }

  if (!courseData) {
    notFound();
  }

  const course = courseData as unknown as CourseDetail;
  const tags = (tagsData ?? []) as CourseTag[];
  const campuses = (campusData ?? []) as CampusOption[];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">課程詳情</h2>
          <p className="mt-1 text-sm text-slate-600">課程編號：{course.id}</p>
        </div>
        <Link
          href="/admin/courses"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          返回列表
        </Link>
      </div>

      {tagsError && (
        <ErrorState error={tagsError} fallback="讀取課程標籤失敗，請稍後再試。" />
      )}

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">課程摘要</h3>
        <dl className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-4 text-sm md:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">建立時間</dt>
            <dd className="mt-1 text-slate-800">{formatDateTime(course.created_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">更新時間</dt>
            <dd className="mt-1 text-slate-800">{formatDateTime(course.updated_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">校區</dt>
            <dd className="mt-1 text-slate-800">{course.campuses?.name ?? '-'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">啟用／推薦</dt>
            <dd className="mt-1 text-slate-800">
              {course.is_active ? '啟用' : '停用'}／{course.recommended ? '是' : '否'}
            </dd>
          </div>
        </dl>
      </section>

      <CourseEditForm course={course} campuses={campuses} />
      <CourseTagsManager courseId={course.id} tags={tags} />
    </div>
  );
}
