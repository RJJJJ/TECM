import { getOperationsContext, formatMacauDateTime } from '@/lib/operations/context';
import { Badge, DataTable, EmptyState, ErrorState, PageHeader, Panel } from '@/components/operations-ui';
import { statusLabel } from '@/lib/operations/labels';
import { PaymentForm } from '@/components/operation-forms';

export default async function PaymentsPage() {
  const { supabase, organizationId } = await getOperationsContext();
  const [charges, payments, guardians] = await Promise.all([
    supabase.from('charges').select('id,description,amount_minor,status,due_on,students(display_name),payment_allocations(amount_minor)').eq('organization_id', organizationId).order('created_at', { ascending: false }),
    supabase.from('payments').select('id,amount_minor,method,external_reference,received_at,parent_profiles(full_name)').eq('organization_id', organizationId).order('received_at', { ascending: false }).limit(100),
    supabase.from('parent_profiles').select('id,full_name').eq('organization_id', organizationId).order('full_name')
  ]);
  const outstanding = (charges.data ?? []).map((item: any) => ({ ...item, balance: Number(item.amount_minor) - (item.payment_allocations ?? []).reduce((sum: number, row: any) => sum + Number(row.amount_minor), 0) }));
  return <>
    <PageHeader title="收費與付款" description="所有金額以最小貨幣單位儲存；付款使用冪等鍵避免重複入帳。" />
    <Panel title="記錄付款"><PaymentForm charges={outstanding.filter((item: any) => item.balance > 0).map((item: any) => ({ id: item.id, label: `${item.description} · ${item.students?.display_name || '學生'} · MOP ${(item.balance / 100).toFixed(2)}` }))} guardians={(guardians.data ?? []).map((item: any) => ({ id: item.id, label: item.full_name }))} /></Panel>
    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <Panel title="收費項目">{charges.error ? <ErrorState error={charges.error} fallback="讀取收費項目失敗，請稍後再試。" /> : !outstanding.length ? <EmptyState>尚未有收費項目。</EmptyState> : <DataTable headers={['學生', '項目', '總額', '未付', '狀態']}>
        {outstanding.map((item: any) => <tr key={item.id}><td className="px-4 py-3">{item.students?.display_name || '—'}</td><td className="px-4 py-3 font-medium">{item.description}</td><td className="px-4 py-3">MOP {(Number(item.amount_minor) / 100).toFixed(2)}</td><td className="px-4 py-3">MOP {(item.balance / 100).toFixed(2)}</td><td className="px-4 py-3"><Badge tone={item.status === 'paid' ? 'green' : 'amber'}>{statusLabel(item.status)}</Badge></td></tr>)}
      </DataTable>}</Panel>
      <Panel title="付款紀錄">{payments.error ? <ErrorState error={payments.error} fallback="讀取付款紀錄失敗，請稍後再試。" /> : !payments.data?.length ? <EmptyState>尚未有付款紀錄。</EmptyState> : <DataTable headers={['時間', '家長', '方式', '金額']}>
        {payments.data.map((item: any) => <tr key={item.id}><td className="px-4 py-3 whitespace-nowrap">{formatMacauDateTime(item.received_at)}</td><td className="px-4 py-3">{item.parent_profiles?.full_name || '—'}</td><td className="px-4 py-3">{statusLabel(item.method)}</td><td className="px-4 py-3 font-semibold">MOP {(Number(item.amount_minor) / 100).toFixed(2)}</td></tr>)}
      </DataTable>}</Panel>
    </div>
  </>;
}
