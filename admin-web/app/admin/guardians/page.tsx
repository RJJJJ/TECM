import { Badge, DataTable, EmptyState, ErrorState, PageHeader } from '@/components/operations-ui';
import { getOperationsContext } from '@/lib/operations/context';
import { userFacingError } from '@/lib/operations/errors';
import {
  ExistingParentStudentLinkForm,
  ExistingParentStudentUnlinkForm,
  GuardianDisableForm,
  GuardianInviteForm,
  GuardianRecoverForm
} from './guardian-account-actions';

const sevenDays = 7 * 86400000;

export default async function GuardiansPage() {
  const { supabase, organizationId, role } = await getOperationsContext();
  if (!['admin', 'staff'].includes(role)) throw userFacingError('未獲授權管理家長帳戶。');
  const [profiles, invitations, links, students] = await Promise.all([
    supabase.from('parent_profiles').select('id,user_id,full_name,phone,email,account_status,created_at').eq('organization_id', organizationId).order('full_name'),
    supabase.from('parent_account_invitations').select('id,parent_profile_id,status,sent_at,created_at').eq('organization_id', organizationId).order('created_at', { ascending: false }),
    supabase.from('parent_student_links').select('id,parent_profile_id,student_id,students(display_name)').eq('organization_id', organizationId).order('created_at'),
    supabase.from('students').select('id,display_name').eq('organization_id', organizationId).eq('status', 'active').order('display_name')
  ]);
  const latest = new Map<string, NonNullable<typeof invitations.data>[number]>();
  for (const invitation of invitations.data ?? []) if (!latest.has(invitation.parent_profile_id)) latest.set(invitation.parent_profile_id, invitation);

  return <>
    <PageHeader title="家長帳戶" description="先邀請／建立新家長登入身份；帳戶啟用後，可用下方獨立流程連結另一名學生。家長不會加入職員權限表。" />
    <section className="space-y-3">
      <div><h2 className="text-lg font-semibold text-slate-900">1. 邀請／建立新家長身份</h2><p className="text-sm text-slate-600">只用於尚未有登入身份的家長；不會覆蓋其他家長或機構的身份。</p></div>
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
    </section>

    <section className="mt-8 space-y-3">
      <div><h2 className="text-lg font-semibold text-slate-900">2. 將現有家長連結另一名學生</h2><p className="text-sm text-slate-600">只顯示目前機構內已啟用的家長及學生；不會建立第二個 Auth user 或家長 profile。</p></div>
      {links.error ? <ErrorState error={links.error} fallback="讀取家長學生連結失敗，請稍後再試。" /> : students.error ? <ErrorState error={students.error} fallback="讀取學生資料失敗，請稍後再試。" /> : !(profiles.data ?? []).some(profile => profile.account_status === 'active' && profile.user_id) ? <EmptyState>目前沒有已啟用的家長帳戶。</EmptyState> : <div className="grid gap-4 lg:grid-cols-2">
        {(profiles.data ?? []).filter(profile => profile.account_status === 'active' && profile.user_id).map(profile => {
          const profileLinks = (links.data ?? []).filter(link => link.parent_profile_id === profile.id);
          const linkedIds = new Set(profileLinks.map(link => link.student_id));
          const availableStudents = (students.data ?? []).filter(student => !linkedIds.has(student.id)).map(student => ({ id: student.id, label: student.display_name }));
          return <article key={profile.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="font-semibold text-slate-900">{profile.full_name}</h3>
            <p className="mt-1 text-xs text-slate-500">已連結 {profileLinks.length} 名學生</p>
            <div className="mt-3 space-y-2" data-testid={`linked-students-${profile.id}`}>
              {profileLinks.length ? profileLinks.map((link: any) => <div key={link.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <span>{link.students?.display_name ?? '學生'}</span>
                <ExistingParentStudentUnlinkForm linkId={link.id} studentName={link.students?.display_name ?? '學生'} />
              </div>) : <p className="text-sm text-slate-600">尚未連結學生。</p>}
            </div>
            <ExistingParentStudentLinkForm profileId={profile.id} students={availableStudents} />
          </article>;
        })}
      </div>}
    </section>
  </>;
}
