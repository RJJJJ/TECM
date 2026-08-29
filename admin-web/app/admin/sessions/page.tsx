import Link from 'next/link';
import { getOperationsContext, formatMacauDateTime, todayMacau } from '@/lib/operations/context';
import { Badge, DataTable, EmptyState, ErrorState, PageHeader } from '@/components/operations-ui';
import { statusLabel } from '@/lib/operations/labels';

export default async function SessionsPage() {
  const { supabase, organizationId, role, user } = await getOperationsContext();
  const today = todayMacau();
  const teacher = role === 'teacher'
    ? await supabase.from('teacher_profiles').select('id').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
    : null;
  let query = supabase.from('lesson_sessions')
    .select('id,starts_at,ends_at,status,exam_cohorts(name),teacher_profiles(display_name),attendance_records(id)')
    .eq('organization_id', organizationId)
    .gte('starts_at', `${today}T00:00:00+08:00`)
    .lt('starts_at', `${today}T23:59:59+08:00`)
    .order('starts_at');
  if (role === 'teacher') query = query.eq('teacher_id', teacher?.data?.id ?? '00000000-0000-0000-0000-000000000000');
  const { data, error } = await query;

  return <>
    <PageHeader title="今日課堂" description={`澳門時間 ${today} 的課堂安排與點名進度。老師只會看到自己負責的課堂。`}/>
    {error ? <ErrorState error={error} fallback="讀取課堂安排失敗，請稍後再試。"/> : !data?.length ? <EmptyState>今天沒有已安排課堂。</EmptyState> :
      <DataTable headers={['時間', '班別', '導師', '點名人數', '狀態', '操作']}>{data.map((row: any) => <tr key={row.id}>
        <td className="whitespace-nowrap px-4 py-3">{formatMacauDateTime(row.starts_at)}</td>
        <td className="px-4 py-3 font-medium">{row.exam_cohorts?.name || '—'}</td>
        <td className="px-4 py-3">{row.teacher_profiles?.display_name || '—'}</td>
        <td className="px-4 py-3">{row.attendance_records?.length ?? 0}</td>
        <td className="px-4 py-3"><Badge tone={row.status === 'completed' ? 'green' : 'blue'}>{statusLabel(row.status)}</Badge></td>
        <td className="px-4 py-3"><Link href="/admin/attendance" className="font-medium text-teal-700 underline">開啟點名</Link></td>
      </tr>)}</DataTable>}
  </>;
}
