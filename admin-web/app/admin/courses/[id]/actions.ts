'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyActiveStaffAccess } from '@/lib/auth/staff-access';

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
  const supabase = createServerSupabaseClient();
  const access = await verifyActiveStaffAccess(supabase);

  if (!access.allowed) {
    await supabase.auth.signOut();
    return {
      supabase,
      ok: false as const,
      message: '你沒有權限執行此操作。'
    };
  }

  const { data: course, error } = await supabase.from('courses').select('id').eq('id', courseId).maybeSingle();
  if (error || !course) {
    return {
      supabase,
      ok: false as const,
      message: '課程不存在，請返回列表確認。'
    };
  }

  return { supabase, ok: true as const };
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
    return { status: 'error', message: 'Title 為必填。' };
  }

  const sortOrder = Number(sortOrderRaw || '0');
  if (!Number.isFinite(sortOrder)) {
    return { status: 'error', message: 'Sort order 必須是數字。' };
  }

  const verified = await verifyCourseExists(courseId);
  if (!verified.ok) {
    return { status: 'error', message: verified.message };
  }

  let campusId: string | null = null;
  if (campusIdRaw) {
    const { data: campus, error: campusError } = await verified.supabase
      .from('campuses')
      .select('id')
      .eq('id', campusIdRaw)
      .maybeSingle();

    if (campusError || !campus) {
      return { status: 'error', message: 'Campus 不存在，請重新選擇。' };
    }

    campusId = campus.id;
  }

  const { data, error } = await verified.supabase
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
    .select('id')
    .single();

  if (error || !data) {
    return {
      status: 'error',
      message: error?.message ?? '更新課程失敗，請稍後再試。'
    };
  }

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
    return { status: 'error', message: 'Tag 不可空白。' };
  }

  const verified = await verifyCourseExists(courseId);
  if (!verified.ok) {
    return { status: 'error', message: verified.message };
  }

  const { data: existing, error: existingError } = await verified.supabase
    .from('course_tags')
    .select('id')
    .eq('course_id', courseId)
    .ilike('tag', tag)
    .maybeSingle();

  if (existingError) {
    return { status: 'error', message: existingError.message };
  }

  if (existing) {
    return { status: 'error', message: 'Tag 已存在，不可重複新增。' };
  }

  const { error } = await verified.supabase.from('course_tags').insert({
    course_id: courseId,
    tag
  });

  if (error) {
    return { status: 'error', message: error.message };
  }

  revalidatePath('/admin/courses');
  revalidatePath(`/admin/courses/${courseId}`);

  return {
    status: 'success',
    message: 'Tag 已新增。'
  };
}

export async function deleteCourseTagAction(
  courseId: string,
  tagId: string
): Promise<CourseTagFormState> {
  const verified = await verifyCourseExists(courseId);
  if (!verified.ok) {
    return { status: 'error', message: verified.message };
  }

  const { error } = await verified.supabase.from('course_tags').delete().eq('id', tagId).eq('course_id', courseId);

  if (error) {
    return { status: 'error', message: error.message };
  }

  revalidatePath('/admin/courses');
  revalidatePath(`/admin/courses/${courseId}`);

  return {
    status: 'success',
    message: 'Tag 已刪除。'
  };
}
