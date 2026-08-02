'use server';

import { revalidatePath } from 'next/cache';
import { getOperationsContext } from '@/lib/operations/context';
import { safeOperationMessage, UserFacingOperationError, userFacingError } from '@/lib/operations/errors';

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

  if (!title) return { status: 'error', message: '課程名稱為必填。' };

  const sortOrder = Number(sortOrderRaw || '0');
  if (!Number.isFinite(sortOrder)) {
    return { status: 'error', message: '排序次序必須是數字。' };
  }

  try {
    const context = await getOperationsContext();
    if (!['admin', 'staff'].includes(context.role)) throw userFacingError('只有管理員或職員可以新增課程。');

    let campusId: string | null = null;
    if (campusIdRaw) {
      const { data: campus, error: campusError } = await context.supabase
        .from('campuses')
        .select('id')
        .eq('id', campusIdRaw)
        .eq('organization_id', context.organizationId)
        .maybeSingle();

      if (campusError || !campus) throw campusError ?? userFacingError('所選校區已不存在或不屬於目前機構，請重新選擇。');
      campusId = campus.id;
    }

    const { data, error } = await context.supabase
      .from('courses')
      .insert({
        organization_id: context.organizationId,
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

    if (error || !data) throw error ?? new Error('course insert returned no row');

    revalidatePath('/admin/courses');
    revalidatePath('/admin/dashboard');
    return { status: 'success', message: '課程已新增。' };
  } catch (error) {
    return { status: 'error', message: error instanceof UserFacingOperationError ? error.message : safeOperationMessage(error, '新增課程失敗，請稍後再試。', 'create-course') };
  }
}
