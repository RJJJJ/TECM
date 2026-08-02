import { getOperationsContext } from '@/lib/operations/context';
import { DataTable, EmptyState, ErrorState, PageHeader, Panel } from '@/components/operations-ui';
import TeacherCreateForm from './teacher-create-form';
import { statusLabel } from '@/lib/operations/labels';

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
    <div className="mt-5">{error ? <ErrorState error={error} fallback="讀取導師失敗，請稍後再試。" /> : teachers.length === 0 ? <EmptyState>尚未有導師資料。</EmptyState> : <DataTable headers={['姓名', '電話', '使用者 ID', '狀態']}>
      {teachers.map((teacher) => <tr key={teacher.id}><td className="px-4 py-3 font-medium">{teacher.display_name}</td><td className="px-4 py-3">{teacher.phone ?? '—'}</td><td className="px-4 py-3 font-mono text-xs">{teacher.user_id}</td><td className="px-4 py-3">{statusLabel(teacher.is_active ? 'active' : 'inactive')}</td></tr>)}
    </DataTable>}</div>
  </>;
}
