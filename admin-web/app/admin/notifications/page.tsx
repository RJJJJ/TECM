import { Badge, DataTable, EmptyState, ErrorState, Metric, PageHeader, Panel } from '@/components/operations-ui';
import { formatMacauDateTime, getOperationsContext } from '@/lib/operations/context';
import { userFacingError } from '@/lib/operations/errors';
import { publishAnnouncementAction, saveNotificationTemplateAction } from './actions';

const deliveryLabel: Record<string, string> = {
  pending: '等候處理', claimed: '處理中', retry: '重試中', delivered: '已送達',
  would_send: '測試模式', dead_letter: '無法送達'
};

export default async function NotificationsPage() {
  const { supabase, organizationId, role } = await getOperationsContext();
  if (!['admin', 'staff'].includes(role)) throw userFacingError('未獲授權管理通知。');
  const [announcements, deliveries, recipients, templates] = await Promise.all([
    supabase.from('notification_announcements').select('id,title,category,status,recipient_count,sent_at,created_at').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(30),
    supabase.from('notification_outbox').select('status').eq('organization_id', organizationId),
    supabase.from('parent_profiles').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('account_status', 'active'),
    supabase.from('notification_templates').select('id,template_key,name,category,title').eq('organization_id', organizationId).order('name')
  ]);
  const counts = (deliveries.data ?? []).reduce<Record<string, number>>((summary, row) => {
    summary[row.status] = (summary[row.status] ?? 0) + 1;
    return summary;
  }, {});

  return <>
    <PageHeader title="家長通知" description="預覽收件人、發送機構公告，並查看 APNs 投遞摘要；裝置憑證不會顯示於後台。" />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="目前可收件家長" value={recipients.count ?? 0} hint="只包括已啟用帳戶" />
      <Metric label="已送達" value={counts.delivered ?? 0} />
      <Metric label="處理／重試中" value={(counts.claimed ?? 0) + (counts.retry ?? 0) + (counts.pending ?? 0)} />
      <Metric label="無法送達" value={counts.dead_letter ?? 0} hint={`測試模式 ${counts.would_send ?? 0}`} />
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.7fr)]">
      <Panel title="撰寫通知">
        <form action={publishAnnouncementAction} className="grid gap-4">
          <label className="grid gap-1 text-sm font-medium">標題<input name="title" required maxLength={120} className="rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="grid gap-1 text-sm font-medium">內容<textarea name="body" required maxLength={2000} rows={6} className="rounded-lg border border-slate-300 px-3 py-2" /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium">類別<select name="category" className="rounded-lg border border-slate-300 px-3 py-2"><option value="announcement">機構公告</option><option value="class_reminder">課堂提醒</option><option value="payments">付款通知</option><option value="marketing">推廣訊息</option></select></label>
            <label className="grid gap-1 text-sm font-medium">App 連結<select name="deep_link" className="rounded-lg border border-slate-300 px-3 py-2"><option value="">通知中心</option><option value="tecm://schedule">課堂時間表</option><option value="tecm://payments">付款</option><option value="tecm://notifications">通知中心</option></select></label>
          </div>
          <p className="text-xs text-slate-500">預覽：將為 {recipients.count ?? 0} 位已啟用家長建立通知；每個活躍裝置各有一筆投遞工作，並套用個人通知偏好及靜音時段。</p>
          <button className="justify-self-start rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800">立即發送</button>
        </form>
      </Panel>
      <Panel title="投遞狀態">
        <div className="grid grid-cols-2 gap-3 text-sm">{Object.entries(deliveryLabel).map(([key, label]) => <div key={key} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"><span>{label}</span><strong>{counts[key] ?? 0}</strong></div>)}</div>
      </Panel>
    </div>
    <div className="mt-5"><Panel title="最近發送">
      {announcements.error ? <ErrorState error={announcements.error} fallback="讀取通知紀錄失敗，請稍後再試。" /> : !announcements.data?.length ? <EmptyState>尚未發送通知。</EmptyState> : <DataTable headers={['標題', '類別', '收件人', '狀態', '發送時間']}>
        {announcements.data.map((item) => <tr key={item.id}><td className="px-4 py-3 font-medium">{item.title}</td><td className="px-4 py-3">{item.category}</td><td className="px-4 py-3">{item.recipient_count}</td><td className="px-4 py-3"><Badge tone={item.status === 'sent' ? 'green' : 'slate'}>{item.status === 'sent' ? '已發送' : item.status}</Badge></td><td className="px-4 py-3">{formatMacauDateTime(item.sent_at ?? item.created_at)}</td></tr>)}
      </DataTable>}
    </Panel></div>
    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <Panel title="通知範本">
        {templates.error ? <ErrorState error={templates.error} fallback="讀取通知範本失敗，請稍後再試。" /> : !templates.data?.length ? <EmptyState>尚未建立範本。</EmptyState> : <DataTable headers={['名稱', '識別碼', '類別', '標題']}>
          {templates.data.map((template) => <tr key={template.id}><td className="px-4 py-3 font-medium">{template.name}</td><td className="px-4 py-3 font-mono text-xs">{template.template_key}</td><td className="px-4 py-3">{template.category}</td><td className="px-4 py-3">{template.title}</td></tr>)}
        </DataTable>}
      </Panel>
      <Panel title="建立／更新範本"><form action={saveNotificationTemplateAction} className="grid gap-3">
        <input name="template_key" required pattern="[a-z0-9][a-z0-9_-]{1,63}" placeholder="識別碼，例如 class_reminder" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input name="name" required maxLength={100} placeholder="範本名稱" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input name="title" required maxLength={120} placeholder="通知標題" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <textarea name="body" required maxLength={2000} rows={4} placeholder="通知內容" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <select name="category" className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="announcement">機構公告</option><option value="class_reminder">課堂提醒</option><option value="payments">付款通知</option><option value="marketing">推廣訊息</option></select>
        <select name="deep_link" className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">無指定連結</option><option value="tecm://schedule">課堂時間表</option><option value="tecm://payments">付款</option><option value="tecm://notifications">通知中心</option></select>
        <button className="justify-self-start rounded-lg border border-teal-700 px-4 py-2 text-sm font-semibold text-teal-800">儲存範本</button>
      </form></Panel>
    </div>
  </>;
}
