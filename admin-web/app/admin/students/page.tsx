import { getOperationsContext } from '@/lib/operations/context';
import { DataTable, EmptyState, ErrorState, PageHeader, Panel } from '@/components/operations-ui';
import { IntakeForm } from '@/components/operation-forms';
import { statusLabel } from '@/lib/operations/labels';

export default async function StudentsPage() {
  const { supabase, organizationId } = await getOperationsContext();
  const [students, classes, plans] = await Promise.all([
    supabase.from('students').select('id,display_name,school_name,status,created_at').eq('organization_id', organizationId).order('display_name'),
    supabase.from('exam_cohorts').select('id,name').eq('organization_id', organizationId).eq('status', 'active'),
    supabase.from('fee_plans').select('id,name').eq('organization_id', organizationId).eq('is_active', true)
  ]);
  const setupError = classes.error || plans.error;
  return <>
    <PageHeader title="學生" description="建立學生檔案、連結家長，並可同時完成報班及套票開立。" />
    <Panel title="新增學生與家長"><IntakeForm classes={(classes.data ?? []).map((item) => ({ id: String(item.id), label: String(item.name) }))} plans={(plans.data ?? []).map((item) => ({ id: String(item.id), label: String(item.name) }))} /></Panel>
    {setupError ? <div className="mt-5"><ErrorState error={setupError} fallback="讀取報班或套票選項失敗，請稍後再試。" /></div> : null}
    <div className="mt-5">{students.error ? <ErrorState error={students.error} fallback="讀取學生失敗，請稍後再試。" /> : !students.data?.length ? <EmptyState>尚未有學生資料。</EmptyState> : <DataTable headers={['學生', '學校', '狀態', '建立日期']}>
      {students.data.map((student) => <tr key={student.id}><td className="px-4 py-3 font-medium">{student.display_name}</td><td className="px-4 py-3">{student.school_name || '—'}</td><td className="px-4 py-3">{statusLabel(student.status)}</td><td className="px-4 py-3">{String(student.created_at).slice(0, 10)}</td></tr>)}
    </DataTable>}</div>
  </>;
}
