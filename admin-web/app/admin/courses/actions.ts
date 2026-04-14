'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyActiveStaffAccess } from '@/lib/auth/staff-access';

export type CreateCourseFormState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
};

function normalizeOptionalText(value: FormDataEntryValue | null) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export async function createCourseAction(
  _prevState: CreateCourseFormState,
  formData: FormData
): Promise<CreateCourseFormState> {
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

  const supabase = createServerSupabaseClient();
  const access = await verifyActiveStaffAccess(supabase);

  if (!access.allowed) {
    await supabase.auth.signOut();
    return {
      status: 'error',
      message: '你沒有權限新增課程。'
    };
  }

  let campusId: string | null = null;
  if (campusIdRaw) {
    const { data: campus, error: campusError } = await supabase
      .from('campuses')
      .select('id')
      .eq('id', campusIdRaw)
      .maybeSingle();

    if (campusError || !campus) {
      return {
        status: 'error',
        message: 'Campus 不存在，請重新選擇。'
      };
    }

    campusId = campus.id;
  }

  const { data, error } = await supabase
    .from('courses')
    .insert({
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
    .select('id')
    .single();

  if (error || !data) {
    return {
      status: 'error',
      message: error?.message ?? '新增課程失敗，請稍後再試。'
    };
  }

  revalidatePath('/admin/courses');

  return {
    status: 'success',
    message: '課程已新增。'
  };
}
