import { Badge, DataTable, EmptyState, ErrorState, PageHeader } from '@/components/operations-ui';
import { getOperationsContext } from '@/lib/operations/context';
import { userFacingError } from '@/lib/operations/errors';
import { GuardianDisableForm, GuardianInviteForm, GuardianRecoverForm } from './guardian-account-actions';

const sevenDays = 7 * 86400000;

export default async function GuardiansPage() {
  const { supabase, organizationId, role } = await getOperationsContext();
  if (!['admin', 'staff'].includes(role)) throw userFacingError('未獲授權管理家長帳戶。');
  const [profiles, invitations] = await Promise.all([
    supabase.from('parent_profiles').select('id,full_name,phone,email,account_status,created_at').eq('organization_id', organizationId).order('full_name'),
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
          <td className="px-4 py-3"><Badge tone={tone}><span>{state}</span></Badge></td>
          <td className="px-4 py-3">
            {profile.account_status !== 'disabled' && profile.account_status !== 'active' ? <GuardianInviteForm profileId={profile.id} email={profile.email ?? ''} idempotencyKey={crypto.randomUUID()} invitationLabel={invitation ? '重發邀請' : '發送邀請'} /> : null}
            {profile.account_status === 'disabled' ? <GuardianRecoverForm profileId={profile.id} /> : profile.account_status !== 'active' ? <GuardianDisableForm profileId={profile.id} /> : null}
          </td>
        </tr>;
      })}
    </DataTable>}
  </>;
}
