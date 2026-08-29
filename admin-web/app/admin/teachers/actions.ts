'use server';

import { revalidatePath } from 'next/cache';
import type { OperationState } from '@/lib/operations/actions';
import { getOperationsContext } from '@/lib/operations/context';
import { findAuthUserByEmail } from '@/lib/parent-invitation';
import { safeOperationMessage, UserFacingOperationError, userFacingError } from '@/lib/operations/errors';
import { createServiceRoleSupabaseClient } from '@/lib/supabase/service-role';

const value = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

export async function createTeacherAction(_: OperationState, form: FormData): Promise<OperationState> {
  try {
    const context = await getOperationsContext();
    if (context.role !== 'admin') throw userFacingError('只有機構管理員可以新增導師帳戶。');
    const email = value(form, 'email').toLowerCase();
    const displayName = value(form, 'display_name');
    if (!displayName || displayName.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw userFacingError('請輸入有效的導師姓名及登入電郵。');

    const service = createServiceRoleSupabaseClient();
    const authUser = await findAuthUserByEmail(email, async (page, perPage) => {
      const { data, error } = await service.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      return data.users;
    });
    if (!authUser) throw userFacingError('找不到此登入電郵，請先建立導師登入帳戶再連結。');

    const { error: teacherError } = await context.supabase.rpc('link_teacher_profile', {
      target_organization_id: context.organizationId,
      target_user_id: authUser.id,
      target_display_name: displayName,
      target_phone: value(form, 'phone') || null
    });
    if (teacherError) throw teacherError;

    revalidatePath('/admin/teachers');
    revalidatePath('/admin/settings');
    revalidatePath('/admin/exam-cohorts');
    revalidatePath('/admin/dashboard');
    return { status: 'success', message: '導師已連結至目前機構。' };
  } catch (error) {
    return { status: 'error', message: error instanceof UserFacingOperationError ? error.message : safeOperationMessage(error, '新增導師失敗，請稍後再試。', 'create-teacher') };
  }
}
