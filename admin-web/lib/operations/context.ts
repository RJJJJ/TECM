import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyActiveStaffAccess } from '@/lib/auth/staff-access';

export async function getOperationsContext() {
  const supabase = await createServerSupabaseClient();
  const access = await verifyActiveStaffAccess(supabase);
  if (!access.allowed || !access.user) throw new Error('未獲授權使用營運後台。');
  const { data, error } = await supabase.from('organization_members').select('organization_id,role,organizations(name)').eq('user_id', access.user.id).eq('status', 'active').limit(1).maybeSingle();
  if (error || !data) throw new Error(error?.message || '找不到所屬機構。');
  const organization = data.organizations as unknown as { name?: string } | null;
  return { supabase, user: access.user, organizationId: String(data.organization_id), role: String(data.role), organizationName: organization?.name ?? null };
}

export function formatMacauDateTime(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-Hant-MO', { timeZone: 'Asia/Macau', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function todayMacau() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Macau', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
