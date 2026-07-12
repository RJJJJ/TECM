import { getOperationsContext } from '@/lib/operations/context';
import { DataTable, EmptyState, ErrorState, PageHeader } from '@/components/operations-ui';

type Teacher = {
  id: string;
  user_id: string;
  display_name: string;
  phone: string | null;
  is_active: boolean;
};

export default async function TeachersPage() {
  const { supabase, organizationId } = await getOperationsContext();
  const { data, error } = await supabase
    .from('teacher_profiles')
    .select('id,user_id,display_name,phone,is_active')
    .eq('organization_id', organizationId)
    .order('display_name');

  const teachers = (data ?? []) as Teacher[];

  return <><PageHeader title="導師" description="查看導師帳戶及啟用狀態；導師只可存取獲指派的班別與課堂。"/>{error?<ErrorState message={error.message}/>:teachers.length===0?<EmptyState>尚未有導師資料。</EmptyState>:<DataTable headers={['姓名','電話','使用者 ID','狀態']}>{teachers.map(t=><tr key={t.id}><td className="px-4 py-3 font-medium">{t.display_name}</td><td className="px-4 py-3">{t.phone??'—'}</td><td className="px-4 py-3 font-mono text-xs">{t.user_id}</td><td className="px-4 py-3">{t.is_active?'啟用':'停用'}</td></tr>)}</DataTable>}</>;
}
