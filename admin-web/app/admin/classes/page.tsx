import Link from 'next/link';
import { getOperationsContext } from '@/lib/operations/context';
import { Badge, DataTable, EmptyState, ErrorState, PageHeader } from '@/components/operations-ui';
import { statusLabel } from '@/lib/operations/labels';

export default async function ClassesPage() {
  const { supabase, organizationId } = await getOperationsContext();
  const { data, error } = await supabase.from('exam_cohorts').select('id,name,subject,level,status,courses(title),teacher_profiles(display_name),cohort_students(id,status)').eq('organization_id', organizationId).order('name');
  return <>
    <PageHeader title="班別" description="管理班別、導師、課程及報讀人數。" action={<Link href="/admin/exam-cohorts" className="rounded-lg border bg-white px-4 py-2 text-sm font-medium">開啟班務工具</Link>} />
    {error ? <ErrorState error={error} fallback="讀取班別失敗，請稍後再試。" /> : !data?.length ? <EmptyState action={<Link href="/admin/exam-cohorts" className="font-medium text-teal-700 underline">建立第一個班別</Link>}>尚未建立班別。</EmptyState> : <DataTable headers={['班別', '課程／程度', '導師', '人數', '狀態']}>
      {data.map((item: any) => <tr key={item.id}><td className="px-4 py-3 font-medium">{item.name}</td><td className="px-4 py-3">{item.courses?.title || item.subject}／{item.level}</td><td className="px-4 py-3">{item.teacher_profiles?.display_name || '—'}</td><td className="px-4 py-3">{item.cohort_students?.filter((student: { status: string }) => student.status === 'active').length ?? 0}</td><td className="px-4 py-3"><Badge tone={item.status === 'active' ? 'green' : 'slate'}>{statusLabel(item.status)}</Badge></td></tr>)}
    </DataTable>}
  </>;
}
