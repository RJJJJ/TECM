'use server';

import { revalidatePath } from 'next/cache';
import { getOperationsContext } from '@/lib/operations/context';
import { safeOperationMessage, UserFacingOperationError, userFacingError } from '@/lib/operations/errors';
import { findAuthUserByEmail, hasConflictingParentLink } from '@/lib/parent-invitation';
import { createServiceRoleSupabaseClient } from '@/lib/supabase/service-role';

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

export type GuardianActionState = { status: 'idle' | 'success' | 'error'; message?: string };
const guardianOk = (message: string): GuardianActionState => ({ status: 'success', message });
const guardianFail = (error: unknown, fallback: string, operation: string): GuardianActionState => ({
  status: 'error',
  message: error instanceof UserFacingOperationError ? error.message : safeOperationMessage(error, fallback, operation)
});

function safeActionError(error: unknown, fallback: string, operation: string) {
  return error instanceof UserFacingOperationError ? error : userFacingError(safeOperationMessage(error, fallback, operation));
}

async function requireGuardianManager() {
  const context = await getOperationsContext();
  if (!['admin', 'staff'].includes(context.role)) throw userFacingError('只有管理員或職員可以管理家長帳戶。');
  return context;
}

async function findUserByEmail(email: string) {
  const service = createServiceRoleSupabaseClient();
  return findAuthUserByEmail(email, async (page, perPage) => {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    return data.users;
  });
}

export async function inviteGuardianAction(
  _prevState: GuardianActionState,
  form: FormData
): Promise<GuardianActionState> {
  try {
    const context = await requireGuardianManager();
    const parentProfileId = text(form, 'parent_profile_id');
    const email = text(form, 'email').toLowerCase();
    const idempotencyKey = text(form, 'idempotency_key');
    if (!parentProfileId || !idempotencyKey || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw userFacingError('請輸入有效的家長電郵。');

    const service = createServiceRoleSupabaseClient();
    const { data: profile, error: profileError } = await service.from('parent_profiles')
      .select('id,organization_id,user_id,account_status').eq('id', parentProfileId)
      .eq('organization_id', context.organizationId).maybeSingle();
    if (profileError) throw profileError;
    if (!profile) throw userFacingError('找不到家長資料。');
    if (profile.account_status === 'disabled') throw userFacingError('已停用帳戶不可重新邀請，請先由管理員審核。');

    await service.from('parent_account_invitations').update({ status: 'expired' })
      .eq('organization_id', context.organizationId).eq('parent_profile_id', parentProfileId)
      .in('status', ['pending', 'sent']).lt('sent_at', new Date(Date.now() - 7 * 86400000).toISOString());

    let authUser = await findUserByEmail(email);
    let existingLinks: Array<{ id: string; organization_id: string; user_id: string | null }> = [];
    if (authUser) {
      const { data, error } = await service.from('parent_profiles').select('id,organization_id,user_id').eq('user_id', authUser.id);
      if (error) throw error;
      existingLinks = data;
    }
    if (hasConflictingParentLink(profile, authUser?.id ?? null, existingLinks)) throw userFacingError('此登入身份已連結其他家長或機構，未發送邀請。');

    const redirectTo = process.env.NEXT_PUBLIC_PARENT_AUTH_REDIRECT_URL || 'tecm://auth/callback';
    try {
      if (!authUser) {
        const { data, error } = await service.auth.admin.inviteUserByEmail(email, { redirectTo });
        if (error) throw error;
        authUser = data.user;
      } else {
        const { error } = await service.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
        if (error) throw error;
      }
    } catch (error) {
      await service.from('parent_account_invitations').upsert({
        organization_id: context.organizationId, parent_profile_id: parentProfileId, email,
        status: 'failed', idempotency_key: idempotencyKey, invited_by: context.user.id,
        last_error: 'auth_email_failed'
      }, { onConflict: 'organization_id,idempotency_key' });
      throw error;
    }

    const { error: linkError } = await service.rpc('link_parent_auth_account', {
      p_organization_id: context.organizationId, p_parent_profile_id: parentProfileId,
      p_auth_user_id: authUser.id, p_email: email, p_idempotency_key: idempotencyKey,
      p_invited_by: context.user.id
    });
    if (linkError) {
      await service.from('parent_account_invitations').upsert({
        organization_id: context.organizationId, parent_profile_id: parentProfileId, email,
        status: 'failed', idempotency_key: idempotencyKey, invited_by: context.user.id,
        last_error: 'parent_link_failed'
      }, { onConflict: 'organization_id,idempotency_key' });
      throw linkError;
    }
    revalidatePath('/admin/guardians');
    return guardianOk('家長邀請已發送。');
  } catch (error) {
    return guardianFail(safeActionError(error, '發送家長邀請失敗，請稍後再試。', 'invite-guardian'), '發送家長邀請失敗，請稍後再試。', 'invite-guardian');
  }
}

export async function disableGuardianAction(
  _prevState: GuardianActionState,
  form: FormData
): Promise<GuardianActionState> {
  try {
    const context = await requireGuardianManager();
    const parentProfileId = text(form, 'parent_profile_id');
    if (!parentProfileId) throw userFacingError('缺少家長帳戶。');
    const service = createServiceRoleSupabaseClient();
    const { data, error } = await service.rpc('disable_parent_account', {
      p_organization_id: context.organizationId,
      p_parent_profile_id: parentProfileId
    });
    if (error) throw error;
    if (data !== true) throw userFacingError('無法停用家長帳戶。');
    revalidatePath('/admin/guardians');
    return guardianOk('家長帳戶已停用。');
  } catch (error) {
    return guardianFail(safeActionError(error, '停用家長帳戶失敗，請稍後再試。', 'disable-guardian'), '停用家長帳戶失敗，請稍後再試。', 'disable-guardian');
  }
}

export async function recoverGuardianAction(
  _prevState: GuardianActionState,
  form: FormData
): Promise<GuardianActionState> {
  try {
    const context = await requireGuardianManager();
    const parentProfileId = text(form, 'parent_profile_id');
    if (!parentProfileId) throw userFacingError('缺少家長帳戶。');
    const { data, error } = await context.supabase.rpc('recover_parent_account', {
      p_organization_id: context.organizationId,
      p_parent_profile_id: parentProfileId
    });
    if (error) throw error;
    if (data !== true) throw userFacingError('無法恢復家長帳戶。');
    revalidatePath('/admin/guardians');
    return guardianOk('家長帳戶已恢復，可重新發送邀請。');
  } catch (error) {
    return guardianFail(safeActionError(error, '恢復家長帳戶失敗，請稍後再試。', 'recover-guardian'), '恢復家長帳戶失敗，請稍後再試。', 'recover-guardian');
  }
}

export async function linkExistingParentStudentAction(
  _prevState: GuardianActionState,
  form: FormData
): Promise<GuardianActionState> {
  try {
    const context = await requireGuardianManager();
    const parentProfileId = text(form, 'parent_profile_id');
    const studentId = text(form, 'student_id');
    if (!parentProfileId || !studentId) throw userFacingError('請選擇已啟用家長及要連結的學生。');

    const { data, error } = await context.supabase.rpc('link_existing_parent_student', {
      target_organization_id: context.organizationId,
      target_parent_profile_id: parentProfileId,
      target_student_id: studentId
    });
    if (error) throw error;
    revalidatePath('/admin/guardians');
    const result = data as { status?: string } | null;
    return guardianOk(result?.status === 'existing' ? '此家長已連結該學生，現有連結保持有效。' : '學生已連結至現有家長帳戶。');
  } catch (error) {
    return guardianFail(error, '連結學生失敗，請稍後再試。', 'link-existing-parent-student');
  }
}

export async function unlinkExistingParentStudentAction(
  _prevState: GuardianActionState,
  form: FormData
): Promise<GuardianActionState> {
  try {
    const context = await requireGuardianManager();
    const linkId = text(form, 'link_id');
    const confirmed = text(form, 'confirmed') === 'true';
    if (!linkId || !confirmed) throw userFacingError('移除學生連結前必須確認。');

    const { data, error } = await context.supabase.rpc('unlink_existing_parent_student', {
      target_organization_id: context.organizationId,
      target_link_id: linkId,
      target_confirmed: confirmed
    });
    if (error) throw error;
    if (data !== true) throw userFacingError('無法移除學生連結。');
    revalidatePath('/admin/guardians');
    return guardianOk('學生連結已移除；家長帳戶仍保持啟用。');
  } catch (error) {
    return guardianFail(error, '移除學生連結失敗，請稍後再試。', 'unlink-existing-parent-student');
  }
}
