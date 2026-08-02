import { Badge, DataTable, EmptyState, ErrorState, PageHeader } from '@/components/operations-ui';
import { getOperationsContext } from '@/lib/operations/context';
import { userFacingError } from '@/lib/operations/errors';
import { disableGuardianAction, inviteGuardianAction } from './actions';

const sevenDays = 7 * 86400000;

export default async function GuardiansPage() {
  const { supabase, organizationId, role } = await getOperationsContext();
  if (!['admin', 'staff'].includes(role)) throw userFacingError('未獲授權管理家長帳戶。');
  const [profiles, invitations] = await Promise.all([
    supabase.from('parent_profiles').select('id,full_name,phone,email,user_id,account_status,created_at').eq('organization_id', organizationId).order('full_name'),
    supabase.from('parent_account_invitations').select('id,parent_profile_id,status,sent_at,created_at').eq('organization_id', organizationId).order('created_at', { ascending: false })
  ]);
  const latest = new Map<string, NonNullable<typeof invitations.data>[number]>();
  for (const invitation of invitations.data ?? []) if (!latest.has(invitation.parent_profile_id)) latest.set(invitation.parent_profile_id, invitation);

  return <>
    <PageHeader title="家長帳戶" description="邀請家長使用 App、重發過期邀請或停用帳戶。家長不會加入職員權限表。" />
    {profiles.error ? <ErrorState error={profiles.error} fallback="讀取家長資料失敗，請稍後再試。" /> : invitations.error ? <ErrorState error={invitations.error} fallback="讀取家長邀請狀態失敗，請稍後再試。" /> : !profiles.data?.length ? <EmptyState>尚未有家長資料。</EmptyState> : <DataTable headers={['家長', '聯絡', '帳戶狀態', '邀請／管理']}>
      {profiles.data.map((profile) => {
        const invitation = latest.get(profile.id);
        const expired = invitation?.status === 'expired' || (['pending', 'sent'].includes(invitation?.status ?? '') && Date.now() - new Date(invitation?.sent_at ?? invitation?.created_at ?? 0).getTime() > sevenDays);
        const state = profile.account_status === 'disabled' ? '已停用' : profile.account_status === 'active' ? '已啟用' : expired ? '邀請過期' : profile.account_status === 'invited' || invitation ? '已邀請' : '未邀請';
        const tone = state === '已啟用' ? 'green' : state === '已停用' ? 'rose' : state === '邀請過期' ? 'amber' : state === '已邀請' ? 'blue' : 'slate';
        return <tr key={profile.id}>
          <td className="px-4 py-3 font-medium">{profile.full_name}</td>
          <td className="px-4 py-3"><div>{profile.email || '未設定電郵'}</div><div className="text-xs text-slate-500">{profile.phone || '未設定電話'}</div></td>
          <td className="px-4 py-3"><Badge tone={tone}>{state}</Badge></td>
          <td className="px-4 py-3">
            {profile.account_status !== 'disabled' && profile.account_status !== 'active' ? <form action={inviteGuardianAction} className="flex min-w-72 flex-wrap gap-2">
              <input type="hidden" name="parent_profile_id" value={profile.id} /><input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
              <input name="email" type="email" required defaultValue={profile.email ?? ''} placeholder="parent@example.com" className="min-w-48 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <button className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white">{invitation ? '重發邀請' : '發送邀請'}</button>
            </form> : null}
            {profile.account_status !== 'disabled' ? <form action={disableGuardianAction} className="mt-2"><input type="hidden" name="parent_profile_id" value={profile.id} /><button className="text-xs font-semibold text-rose-700 hover:underline">停用帳戶及裝置</button></form> : null}
          </td>
        </tr>;
      })}
    </DataTable>}
  </>;
}
