import { getOperationsContext } from '@/lib/operations/context';
import { DataTable, EmptyState, ErrorState, PageHeader, Panel } from '@/components/operations-ui';
import { roleLabel, statusLabel } from '@/lib/operations/labels';
import CampusCreateForm from './campus-create-form';
import { loadAdminUserDirectory } from '@/lib/admin-user-directory';

export default async function SettingsPage() {
  const { supabase, organizationId, organizationName, role } = await getOperationsContext();
  const [members, campuses] = await Promise.all([
    supabase.from('organization_members').select('id,role,status,user_id').eq('organization_id', organizationId).order('created_at'),
    supabase.from('campuses').select('id,name,address,is_active').eq('organization_id', organizationId).order('name')
  ]);
  let userDirectory = new Map<string, string>();
  try {
    userDirectory = await loadAdminUserDirectory();
  } catch {
    // Keep non-identity settings available when Auth directory lookup is unavailable.
  }

  return <>
    <PageHeader title="設定" description="機構、校區及團隊權限設定。敏感操作只應由管理員執行。" />
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="機構資料">
        <dl className="grid gap-3 text-sm">
          <div><dt className="text-slate-500">機構</dt><dd className="font-semibold">{organizationName || '目前機構'}</dd></div>
          <div><dt className="text-slate-500">你的角色</dt><dd className="font-semibold">{roleLabel(role)}</dd></div>
          <div><dt className="text-slate-500">時區</dt><dd>Asia/Macau</dd></div>
        </dl>
      </Panel>
      <div id="campus-settings"><Panel title="校區">
        {['admin', 'staff'].includes(role) ? <CampusCreateForm /> : null}
        <div className="mt-4">
          {campuses.error ? <ErrorState error={campuses.error} fallback="讀取校區失敗，請稍後再試。" /> : !campuses.data?.length ? <EmptyState>尚未設定校區。</EmptyState> : <DataTable headers={['校區', '地址', '狀態']}>
            {campuses.data.map((campus) => <tr key={campus.id}><td className="px-4 py-3 font-medium">{campus.name}</td><td className="px-4 py-3">{campus.address || '—'}</td><td className="px-4 py-3">{statusLabel(campus.is_active ? 'active' : 'inactive')}</td></tr>)}
          </DataTable>}
        </div>
      </Panel></div>
    </div>
    <div className="mt-5"><Panel title="團隊成員">
      {members.error ? <ErrorState error={members.error} fallback="讀取團隊成員失敗，請稍後再試。" /> : !members.data?.length ? <EmptyState>尚未有團隊成員。</EmptyState> : <DataTable headers={['登入電郵', '角色', '狀態']}>
        {members.data.map((member) => <tr key={member.id}><td className="px-4 py-3">{userDirectory.get(member.user_id) ?? '未取得登入電郵'}</td><td className="px-4 py-3">{roleLabel(member.role)}</td><td className="px-4 py-3">{statusLabel(member.status)}</td></tr>)}
      </DataTable>}
    </Panel></div>
  </>;
}
