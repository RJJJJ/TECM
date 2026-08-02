import { getOperationsContext, formatMacauDateTime } from '@/lib/operations/context';
import { Badge, DataTable, EmptyState, ErrorState, PageHeader, Panel } from '@/components/operations-ui';
import FeePlanCreateForm from './fee-plan-create-form';
import { statusLabel } from '@/lib/operations/labels';

export default async function PackagesPage() {
  const { supabase, organizationId, role } = await getOperationsContext();
  const [packages, ledger, courses] = await Promise.all([
    supabase.from('student_packages').select('id,status,expires_on,students(display_name),fee_plans(name,credit_units),credit_ledger(delta_units)').eq('organization_id', organizationId).order('created_at', { ascending: false }),
    supabase.from('credit_ledger').select('id,delta_units,entry_type,note,created_at,students(display_name)').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(100),
    supabase.from('courses').select('id,title').eq('organization_id', organizationId).eq('is_active', true).order('title')
  ]);
  return <>
    <PageHeader title="套票與課堂額" description="套票結餘以不可變更的課堂額流水帳為準，避免手動覆寫結餘。" />
    {['admin', 'staff'].includes(role) ? <Panel title="建立套票"><FeePlanCreateForm courses={(courses.data ?? []).map((course) => ({ id: course.id, label: course.title }))} /></Panel> : null}
    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <Panel title="學生套票">{packages.error ? <ErrorState error={packages.error} fallback="讀取學生套票失敗，請稍後再試。" /> : !packages.data?.length ? <EmptyState>尚未有學生套票。</EmptyState> : <DataTable headers={['學生', '套票', '剩餘', '到期', '狀態']}>
        {packages.data.map((item: any) => <tr key={item.id}><td className="px-4 py-3 font-medium">{item.students?.display_name || '—'}</td><td className="px-4 py-3">{item.fee_plans?.name || '—'}</td><td className="px-4 py-3">{(item.credit_ledger ?? []).reduce((sum: number, row: any) => sum + Number(row.delta_units), 0)}</td><td className="px-4 py-3">{item.expires_on || '—'}</td><td className="px-4 py-3"><Badge tone={item.status === 'active' ? 'green' : 'slate'}>{statusLabel(item.status)}</Badge></td></tr>)}
      </DataTable>}</Panel>
      <Panel title="課堂額流水帳">{ledger.error ? <ErrorState error={ledger.error} fallback="讀取課堂額流水帳失敗，請稍後再試。" /> : !ledger.data?.length ? <EmptyState>尚未有流水帳紀錄。</EmptyState> : <DataTable headers={['時間', '學生', '類型', '變動', '備註']}>
        {ledger.data.map((item: any) => <tr key={item.id}><td className="px-4 py-3 whitespace-nowrap">{formatMacauDateTime(item.created_at)}</td><td className="px-4 py-3">{item.students?.display_name || '—'}</td><td className="px-4 py-3">{statusLabel(item.entry_type)}</td><td className={`px-4 py-3 font-semibold ${Number(item.delta_units) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{Number(item.delta_units) > 0 ? '+' : ''}{item.delta_units}</td><td className="px-4 py-3">{item.note || '—'}</td></tr>)}
      </DataTable>}</Panel>
    </div>
  </>;
}
