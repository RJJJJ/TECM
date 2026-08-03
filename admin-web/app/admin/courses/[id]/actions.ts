'use server';

import { revalidatePath } from 'next/cache';
import { getOperationsContext } from '@/lib/operations/context';
import { safeOperationMessage, UserFacingOperationError, userFacingError } from '@/lib/operations/errors';

export type UpdateCourseFormState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
};

export type CourseTagFormState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
};

function normalizeOptionalText(value: FormDataEntryValue | null) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

async function verifyCourseExists(courseId: string) {
  const context = await getOperationsContext();
  if (!['admin', 'staff'].includes(context.role)) return { context, ok: false as const, message: '只有管理員或職員可以管理課程。' };
  const { data: course, error } = await context.supabase.from('courses').select('id').eq('id', courseId).eq('organization_id', context.organizationId).maybeSingle();
  if (error || !course) {
    return {
      context,
      ok: false as const,
      message: '課程已不存在或不屬於目前機構，請返回列表重新選擇。'
    };
  }

  return { context, ok: true as const };
}

export async function updateCourseAction(
  courseId: string,
  _prevState: UpdateCourseFormState,
  formData: FormData
): Promise<UpdateCourseFormState> {
  const title = String(formData.get('title') ?? '').trim();
  const category = normalizeOptionalText(formData.get('category'));
  const level = normalizeOptionalText(formData.get('level'));
  const ageGroup = normalizeOptionalText(formData.get('age_group'));
  const summary = normalizeOptionalText(formData.get('summary'));
  const scheduleText = normalizeOptionalText(formData.get('schedule_text'));
  const campusIdRaw = String(formData.get('campus_id') ?? '').trim();
  const recommended = String(formData.get('recommended') ?? 'false') === 'true';
  const isActive = String(formData.get('is_active') ?? 'true') === 'true';
  const sortOrderRaw = String(formData.get('sort_order') ?? '').trim();

  if (!title) {
    return { status: 'error', message: '課程名稱為必填。' };
  }

  const sortOrder = Number(sortOrderRaw || '0');
  if (!Number.isFinite(sortOrder)) {
    return { status: 'error', message: '排序必須是數字。' };
  }

  let verified: Awaited<ReturnType<typeof verifyCourseExists>>;
  try { verified = await verifyCourseExists(courseId); } catch (error) { return { status: 'error', message: safeOperationMessage(error, '更新課程失敗，請稍後再試。', 'update-course') }; }
  if (!verified.ok) return { status: 'error', message: verified.message };

  let campusId: string | null = null;
  if (campusIdRaw) {
    const { data: campus, error: campusError } = await verified.context.supabase
      .from('campuses')
      .select('id')
      .eq('id', campusIdRaw)
      .eq('organization_id', verified.context.organizationId)
      .maybeSingle();

    if (campusError || !campus) {
      return { status: 'error', message: '校區不存在，請重新選擇。' };
    }

    campusId = campus.id;
  }

  const { data, error } = await verified.context.supabase
    .from('courses')
    .update({
      title,
      category,
      level,
      age_group: ageGroup,
      summary,
      schedule_text: scheduleText,
      campus_id: campusId,
      recommended,
      is_active: isActive,
      sort_order: sortOrder
    })
    .eq('id', courseId)
    .eq('organization_id', verified.context.organizationId)
    .select('id')
    .single();

  if (error || !data) return { status: 'error', message: safeOperationMessage(error, '更新課程失敗，請稍後再試。', 'update-course') };

  revalidatePath('/admin/courses');
  revalidatePath(`/admin/courses/${courseId}`);

  return {
    status: 'success',
    message: '課程已更新。'
  };
}

export async function addCourseTagAction(
  courseId: string,
  _prevState: CourseTagFormState,
  formData: FormData
): Promise<CourseTagFormState> {
  const tag = String(formData.get('tag') ?? '').trim();

  if (!tag) {
    return { status: 'error', message: '標籤不可空白。' };
  }

  let verified: Awaited<ReturnType<typeof verifyCourseExists>>;
  try { verified = await verifyCourseExists(courseId); } catch (error) { return { status: 'error', message: safeOperationMessage(error, '新增課程標籤失敗，請稍後再試。', 'add-course-tag') }; }
  if (!verified.ok) return { status: 'error', message: verified.message };

  const { data: existing, error: existingError } = await verified.context.supabase
      .from('course_tags')
      .select('id')
      .eq('course_id', courseId)
      .eq('organization_id', verified.context.organizationId)
    .ilike('tag', tag)
    .maybeSingle();

  if (existingError) {
    return { status: 'error', message: safeOperationMessage(existingError, '讀取課程標籤失敗，請稍後再試。', 'add-course-tag') };
  }

  if (existing) {
    return { status: 'error', message: '標籤已存在，不可重複新增。' };
  }

  const { error } = await verified.context.supabase.from('course_tags').insert({
    organization_id: verified.context.organizationId,
    course_id: courseId,
    tag
  });

  if (error) {
    return { status: 'error', message: safeOperationMessage(error, '新增課程標籤失敗，請稍後再試。', 'add-course-tag') };
  }

  revalidatePath('/admin/courses');
  revalidatePath(`/admin/courses/${courseId}`);

  return {
    status: 'success',
    message: '標籤已新增。'
  };
}

export async function deleteCourseTagAction(
  courseId: string,
  tagId: string
): Promise<CourseTagFormState> {
  let verified: Awaited<ReturnType<typeof verifyCourseExists>>;
  try { verified = await verifyCourseExists(courseId); } catch (error) { return { status: 'error', message: safeOperationMessage(error, '刪除課程標籤失敗，請稍後再試。', 'delete-course-tag') }; }
  if (!verified.ok) return { status: 'error', message: verified.message };

  const { data, error } = await verified.context.supabase.from('course_tags').delete().eq('id', tagId).eq('course_id', courseId).eq('organization_id', verified.context.organizationId).select('id').maybeSingle();

  if (error) {
    return { status: 'error', message: safeOperationMessage(error, '刪除課程標籤失敗，請稍後再試。', 'delete-course-tag') };
  }
  if (!data) return { status: 'error', message: '標籤已不存在或不屬於目前課程。' };

  revalidatePath('/admin/courses');
  revalidatePath(`/admin/courses/${courseId}`);

  return {
    status: 'success',
    message: '標籤已刪除。'
  };
}
