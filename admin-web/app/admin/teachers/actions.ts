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

    const { data: existing, error: existingError } = await service.from('teacher_profiles').select('id,organization_id').eq('user_id', authUser.id).maybeSingle();
    if (existingError) throw existingError;
    if (existing?.organization_id && existing.organization_id !== context.organizationId) throw userFacingError('此登入身份已屬於其他機構，不能跨機構連結。');
    if (existing) throw userFacingError('此登入身份已是導師，請直接在班別中指派。');

    const { error: memberError } = await context.supabase.from('organization_members').insert({ organization_id: context.organizationId, user_id: authUser.id, role: 'teacher', status: 'active' });
    if (memberError) throw memberError;
    const { error: teacherError } = await context.supabase.from('teacher_profiles').insert({ organization_id: context.organizationId, user_id: authUser.id, display_name: displayName, phone: value(form, 'phone') || null, is_active: true });
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
