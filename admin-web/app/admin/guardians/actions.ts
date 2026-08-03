'use server';

import { revalidatePath } from 'next/cache';
import { getOperationsContext } from '@/lib/operations/context';
import { safeOperationMessage, UserFacingOperationError, userFacingError } from '@/lib/operations/errors';
import { findAuthUserByEmail, hasConflictingParentLink } from '@/lib/parent-invitation';
import { createServiceRoleSupabaseClient } from '@/lib/supabase/service-role';

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

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

export async function inviteGuardianAction(form: FormData): Promise<void> {
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
  } catch (error) {
    throw safeActionError(error, '發送家長邀請失敗，請稍後再試。', 'invite-guardian');
  }
}

export async function disableGuardianAction(form: FormData): Promise<void> {
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
  } catch (error) {
    throw safeActionError(error, '停用家長帳戶失敗，請稍後再試。', 'disable-guardian');
  }
}

export async function recoverGuardianAction(form: FormData): Promise<void> {
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
  } catch (error) {
    throw safeActionError(error, '恢復家長帳戶失敗，請稍後再試。', 'recover-guardian');
  }
}
