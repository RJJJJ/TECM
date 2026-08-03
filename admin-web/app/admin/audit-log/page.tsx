import { getOperationsContext, formatMacauDateTime } from '@/lib/operations/context';
import { DataTable, EmptyState, ErrorState, PageHeader } from '@/components/operations-ui';

const AUDIT_AREA_LABELS: Record<string, string> = {
  organizations: '機構設定',
  organization_members: '機構成員',
  campuses: '校區',
  courses: '課程',
  students: '學生',
  parent_profiles: '家長',
  parent_student_links: '家長與學生關係',
  exam_cohorts: '班別',
  cohort_students: '班別學生',
  lesson_plans: '教案',
  lesson_sessions: '課堂',
  attendance_records: '點名',
  leave_requests: '請假',
  makeup_tasks: '補課事項',
  makeup_sessions: '補課課堂',
  fee_plans: '套票方案',
  student_packages: '學生套票',
  charges: '收費',
  payments: '付款',
  bookings: '預約',
  follow_up_tasks: '跟進事項',
  notifications: '通知',
  news_items: '最新消息',
  faq_topics: '常見問題分類',
  faq_items: '常見問題'
};

function auditAreaLabel(value: string | null) {
  return (value && AUDIT_AREA_LABELS[value]) || '其他營運資料';
}

function auditActionLabel(value: string | null) {
  switch (value?.toLowerCase()) {
    case 'insert':
    case 'create':
      return '建立';
    case 'update':
    case 'edit':
      return '更新';
    case 'delete':
      return '刪除';
    default:
      return '營運變更';
  }
}

export default async function AuditLogPage() {
  const { supabase, organizationId } = await getOperationsContext();
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id,action,table_name,occurred_at')
    .eq('organization_id', organizationId)
    .order('occurred_at', { ascending: false })
    .limit(200);

  return (
    <>
      <PageHeader title="營運紀錄" description="查看本機構的建立、更新及刪除紀錄。" />
      {error ? (
        <ErrorState error={error} fallback="讀取營運紀錄失敗，請稍後再試。" />
      ) : !data?.length ? (
        <EmptyState>目前沒有營運紀錄。</EmptyState>
      ) : (
        <DataTable headers={['時間', '操作', '資料範圍']}>
          {data.map((item: { id: string; action: string | null; table_name: string | null; occurred_at: string }) => (
            <tr key={item.id}>
              <td className="whitespace-nowrap px-4 py-3">{formatMacauDateTime(item.occurred_at)}</td>
              <td className="px-4 py-3 font-medium">{auditActionLabel(item.action)}</td>
              <td className="px-4 py-3">{auditAreaLabel(item.table_name)}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
