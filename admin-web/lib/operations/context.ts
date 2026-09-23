import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyActiveStaffAccess } from '@/lib/auth/staff-access';
import { userFacingError } from './errors';

export async function getOperationsContext() {
  const supabase = await createServerSupabaseClient();
  const access = await verifyActiveStaffAccess(supabase);
  if (!access.allowed || !access.user) throw userFacingError('未獲授權使用營運後台，請重新登入。');
  if (access.memberships.length === 0) throw userFacingError('找不到有效的機構授權，請聯絡系統管理員。');
  if (access.memberships.length > 1) {
    throw userFacingError('你的帳戶屬於多個機構，目前後台未支援自動選擇，請聯絡系統管理員設定機構後再試。');
  }

  const membership = access.memberships[0];
  return {
    supabase,
    user: access.user,
    organizationId: membership.organization_id,
    role: membership.role,
    organizationName: membership.organizations?.name ?? null
  };
}

export function formatMacauDateTime(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-Hant-MO', { timeZone: 'Asia/Macau', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function todayMacau() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Macau', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
