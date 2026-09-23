import { getOperationsContext } from '@/lib/operations/context';
import { DataTable, EmptyState, ErrorState, PageHeader, Panel } from '@/components/operations-ui';
import TeacherCreateForm from './teacher-create-form';
import TeacherReactivateForm from './teacher-reactivate-form';
import { statusLabel } from '@/lib/operations/labels';
import { loadAdminUserDirectory } from '@/lib/admin-user-directory';

type Teacher = {
  id: string;
  user_id: string;
  display_name: string;
  phone: string | null;
  is_active: boolean;
};

export default async function TeachersPage() {
  const { supabase, organizationId, role } = await getOperationsContext();
  const { data, error } = await supabase
    .from('teacher_profiles')
    .select('id,user_id,display_name,phone,is_active')
    .eq('organization_id', organizationId)
    .order('display_name');

  const teachers = (data ?? []) as Teacher[];
  let userDirectory = new Map<string, string>();
  let directoryUnavailable = false;
  try {
    userDirectory = await loadAdminUserDirectory();
  } catch {
    directoryUnavailable = true;
    // The table remains usable if the server-side Auth directory is briefly unavailable.
  }

  return <>
    <PageHeader title="導師" description="查看導師帳戶及啟用狀態；導師只可存取獲指派的班別與課堂。" />
    {role === 'admin' ? <Panel title="連結導師帳戶">
      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">首次新增導師需要兩個步驟</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>由獲授權的系統管理員先在 Supabase Authentication 建立或邀請導師登入帳戶。</li>
          <li>回到此頁輸入相同電郵，將登入身份連結至目前機構。</li>
        </ol>
        <p className="mt-2">此後台不會顯示、產生或保存導師密碼。</p>
      </div>
      <TeacherCreateForm />
    </Panel> : null}
    {directoryUnavailable ? <div role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-semibold">暫時無法讀取導師登入目錄。</p>
      <p className="mt-1">導師名單仍會顯示，但涉及登入身份的操作已暫停。請稍後重試。</p>
      <a className="mt-2 inline-flex rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900" href="/admin/teachers">重新載入</a>
    </div> : null}
    <div className="mt-5">{error ? <ErrorState error={error} fallback="讀取導師失敗，請稍後再試。" /> : teachers.length === 0 ? <EmptyState>尚未有導師資料。</EmptyState> : <DataTable headers={['姓名', '登入電郵', '電話', '狀態', '操作']}>
      {teachers.map((teacher) => {
        const email = userDirectory.get(teacher.user_id);
        const canReactivate = !teacher.is_active && role === 'admin' && Boolean(email);
        return <tr key={teacher.id}><td className="px-4 py-3 font-medium">{teacher.display_name}</td><td className="px-4 py-3">{email ?? (directoryUnavailable ? '暫時無法取得登入電郵' : '未取得登入電郵')}</td><td className="px-4 py-3">{teacher.phone ?? '—'}</td><td className="px-4 py-3">{statusLabel(teacher.is_active ? 'active' : 'inactive')}</td><td className="px-4 py-3">{canReactivate ? <TeacherReactivateForm email={email!} displayName={teacher.display_name} phone={teacher.phone} /> : !teacher.is_active && role === 'admin' ? <button type="button" disabled className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-400">重新啟用</button> : '—'}</td></tr>;
      })}
    </DataTable>}</div>
  </>;
}
