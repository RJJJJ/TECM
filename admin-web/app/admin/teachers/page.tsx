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
    {role === 'admin' ? <Panel title="連結導師帳戶"><TeacherCreateForm /></Panel> : null}
    <div className="mt-5">{error ? <ErrorState error={error} fallback="讀取導師失敗，請稍後再試。" /> : teachers.length === 0 ? <EmptyState>尚未有導師資料。</EmptyState> : <DataTable headers={['姓名', '電話', '使用者 ID', '狀態']}>
      {teachers.map((teacher) => <tr key={teacher.id}><td className="px-4 py-3 font-medium">{teacher.display_name}</td><td className="px-4 py-3">{teacher.phone ?? '—'}</td><td className="px-4 py-3 font-mono text-xs">{teacher.user_id}</td><td className="px-4 py-3">{statusLabel(teacher.is_active ? 'active' : 'inactive')}</td></tr>)}
    </DataTable>}</div>
  </>;
}
