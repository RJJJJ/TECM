'use server';

import { revalidatePath } from 'next/cache';
import { getOperationsContext } from '@/lib/operations/context';
import { createServiceRoleSupabaseClient } from '@/lib/supabase/service-role';

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

async function requireGuardianManager() {
  const context = await getOperationsContext();
  if (!['admin', 'staff'].includes(context.role)) throw new Error('只有管理員或職員可以管理家長帳戶。');
  return context;
}

async function findUserByEmail(email: string) {
  const service = createServiceRoleSupabaseClient();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match || data.users.length < 100) return match ?? null;
  }
  throw new Error('使用者目錄過大，未能安全完成電郵查找。');
}

export async function inviteGuardianAction(form: FormData): Promise<void> {
  const context = await requireGuardianManager();
  const parentProfileId = text(form, 'parent_profile_id');
  const email = text(form, 'email').toLowerCase();
  const idempotencyKey = text(form, 'idempotency_key');
  if (!parentProfileId || !idempotencyKey || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('請輸入有效的家長電郵。');
  }

  const service = createServiceRoleSupabaseClient();
  const { data: profile, error: profileError } = await service.from('parent_profiles')
    .select('id,organization_id,user_id,account_status').eq('id', parentProfileId)
    .eq('organization_id', context.organizationId).maybeSingle();
  if (profileError || !profile) throw new Error(profileError?.message || '找不到家長資料。');
  if (profile.account_status === 'disabled') throw new Error('已停用帳戶不可重新邀請，請先由管理員審核。');

  await service.from('parent_account_invitations').update({ status: 'expired' })
    .eq('organization_id', context.organizationId).eq('parent_profile_id', parentProfileId)
    .in('status', ['pending', 'sent']).lt('sent_at', new Date(Date.now() - 7 * 86400000).toISOString());

  let authUser = await findUserByEmail(email);
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
      last_error: error instanceof Error ? error.message.slice(0, 500) : 'Auth email failed'
    }, { onConflict: 'organization_id,idempotency_key' });
    throw error;
  }

  const { error: linkError } = await service.rpc('link_parent_auth_account', {
    p_organization_id: context.organizationId, p_parent_profile_id: parentProfileId,
    p_auth_user_id: authUser.id, p_email: email, p_idempotency_key: idempotencyKey,
    p_invited_by: context.user.id
  });
  if (linkError) throw linkError;
  revalidatePath('/admin/guardians');
}

export async function disableGuardianAction(form: FormData): Promise<void> {
  const context = await requireGuardianManager();
  const parentProfileId = text(form, 'parent_profile_id');
  if (!parentProfileId) throw new Error('缺少家長帳戶。');
  const service = createServiceRoleSupabaseClient();
  const { data, error } = await service.rpc('disable_parent_account', {
    p_organization_id: context.organizationId,
    p_parent_profile_id: parentProfileId
  });
  if (error || data !== true) throw new Error(error?.message || '無法停用家長帳戶。');
  revalidatePath('/admin/guardians');
}
