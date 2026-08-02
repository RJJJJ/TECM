import { getOperationsContext, formatMacauDateTime } from '@/lib/operations/context';
import { LeaveForm, MakeupForm } from '@/components/operation-forms';
import { decideLeaveRequestAction } from '@/lib/operations/actions';
import { Badge, DataTable, EmptyState, ErrorState, PageHeader, Panel } from '@/components/operations-ui';
import FollowUpCopyButton from '../follow-up-copy-button';

export default async function LeaveMakeupPage() {
  const { supabase, organizationId } = await getOperationsContext();
  const [students, sessions, leaves, entitlements, makeups, teachers, messages] = await Promise.all([
    supabase.from('students').select('id,display_name').eq('organization_id', organizationId).eq('status', 'active').order('display_name'),
    supabase.from('lesson_sessions').select('id,starts_at,exam_cohorts(name)').eq('organization_id', organizationId).gte('starts_at', new Date().toISOString()).order('starts_at').limit(100),
    supabase.from('leave_requests').select('id,status,reason,created_at,students(display_name),lesson_sessions(starts_at)').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(50),
    supabase.from('makeup_entitlements').select('id,status,expires_at,units_remaining,students(display_name)').eq('organization_id', organizationId).eq('status', 'available').order('expires_at'),
    supabase.from('makeup_sessions').select('id,status,scheduled_at,students(display_name),teacher_profiles(display_name)').eq('organization_id', organizationId).order('scheduled_at', { ascending: false }).limit(50),
    supabase.from('teacher_profiles').select('id,display_name').eq('organization_id', organizationId).eq('is_active', true).order('display_name'),
    supabase.from('communication_logs').select('id,body,template_key,status,created_at,students(display_name)').eq('organization_id', organizationId).eq('status', 'queued').in('template_key', ['leave_approved', 'makeup_booked']).order('created_at', { ascending: false }).limit(30)
  ]);
  const sessionOptions = (sessions.data ?? []).map((row: any) => ({ id: row.id, label: `${formatMacauDateTime(row.starts_at)} · ${row.exam_cohorts?.name || '課堂'}` }));

  return <>
    <PageHeader title="請假與補課" description="處理請假、補課資格及補課安排，保留完整狀態紀錄。所有家長訊息只產生草稿供人工發送。"/>
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="新增請假"><LeaveForm students={(students.data ?? []).map(row => ({ id: row.id, label: row.display_name }))} sessions={sessionOptions}/></Panel>
      <Panel title="安排補課"><MakeupForm entitlements={(entitlements.data ?? []).map((row: any) => ({ id: row.id, label: `${row.students?.display_name || '學生'} · ${row.units_remaining} 節` }))} teachers={(teachers.data ?? []).map(row => ({ id: row.id, label: row.display_name }))}/></Panel>
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <Panel title="請假紀錄">
        {leaves.error ? <ErrorState error={leaves.error} fallback="讀取請假申請失敗，請稍後再試。"/> : !leaves.data?.length ? <EmptyState>尚未有請假申請。</EmptyState> :
          <DataTable headers={['學生', '課堂', '原因', '狀態／操作']}>{leaves.data.map((row: any) => <tr key={row.id}>
            <td className="px-4 py-3">{row.students?.display_name || '—'}</td>
            <td className="px-4 py-3">{formatMacauDateTime(row.lesson_sessions?.starts_at)}</td>
            <td className="px-4 py-3">{row.reason}</td>
            <td className="px-4 py-3"><div className="space-y-2"><Badge tone={row.status === 'approved' ? 'green' : 'amber'}>{row.status}</Badge>
              {row.status === 'pending' ? <form action={decideLeaveRequestAction} className="flex flex-wrap gap-1">
                <input type="hidden" name="leave_request_id" value={row.id}/>
                <button name="decision" value="approved" className="rounded bg-emerald-700 px-2 py-1 text-xs text-white">批准及建立補課額</button>
                <button name="decision" value="rejected" className="rounded border px-2 py-1 text-xs">拒絕</button>
              </form> : null}
            </div></td>
          </tr>)}</DataTable>}
      </Panel>
      <Panel title="補課安排">
        {makeups.error ? <ErrorState error={makeups.error} fallback="讀取補課安排失敗，請稍後再試。"/> : !makeups.data?.length ? <EmptyState>尚未有補課安排。</EmptyState> :
          <DataTable headers={['學生', '補課時間', '導師', '狀態']}>{makeups.data.map((row: any) => <tr key={row.id}>
            <td className="px-4 py-3">{row.students?.display_name || '—'}</td>
            <td className="px-4 py-3">{formatMacauDateTime(row.scheduled_at)}</td>
            <td className="px-4 py-3">{row.teacher_profiles?.display_name || '待分配'}</td>
            <td className="px-4 py-3"><Badge tone="blue">{row.status}</Badge></td>
          </tr>)}</DataTable>}
      </Panel>
    </div>
    <div className="mt-5"><Panel title="待人工發送家長通知">
      {messages.error ? <ErrorState error={messages.error} fallback="讀取家長通知草稿失敗，請稍後再試。"/> : !messages.data?.length ? <EmptyState>暫時沒有待發送的請假／補課通知。</EmptyState> :
        <div className="grid gap-3">{messages.data.map((row: any) => <article key={row.id} className="rounded-xl border bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{row.students?.display_name || '學生'} · {row.template_key === 'leave_approved' ? '請假批核' : '補課安排'}</p><FollowUpCopyButton message={row.body || ''}/></div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{row.body}</p>
        </article>)}</div>}
    </Panel></div>
  </>;
}
