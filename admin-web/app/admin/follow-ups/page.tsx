import Link from 'next/link';
import { getOperationsContext } from '@/lib/operations/context';
import { ErrorState } from '@/components/operations-ui';
import FollowUpCopyButton from '../follow-up-copy-button';
import { dismissFollowUpTaskAction, markFollowUpTaskDoneAction } from './actions';
import {
  type FollowUpChannel,
  type FollowUpPriority,
  type FollowUpStatus,
  type FollowUpTask,
  followUpChannelLabel,
  followUpPriorityBadgeClass,
  followUpPriorityLabel,
  followUpStatusBadgeClass,
  followUpStatusLabel
} from '@/lib/types/follow-up';

type SearchParams = {
  status?: string | string[];
  priority?: string | string[];
  channel?: string | string[];
  keyword?: string | string[];
  date?: string | string[];
};

type SummaryCard = {
  label: string;
  value: number | null;
  tone: string;
};

type FollowUpRow = FollowUpTask & {
  task_type: string | null;
  subject_student_id: string | null;
  due_at: string | null;
  students: { display_name: string | null } | null;
};

const TASK_TYPE_LABELS: Record<string, string> = {
  morning_summary: '早上營運摘要',
  evening_summary: '晚上點名摘要',
  low_credit: '低堂數／續費',
  overdue_payment: '逾期欠費',
  unassigned_makeup: '未安排補課',
  weekly_report: '每週營運報告'
};

const STATUS_OPTIONS: Array<{ label: string; value: 'all' | FollowUpStatus }> = [
  { label: '全部', value: 'all' },
  { label: '待跟進', value: 'open' },
  { label: '已完成', value: 'done' },
  { label: '已忽略', value: 'dismissed' }
];

const PRIORITY_OPTIONS: Array<{ label: string; value: 'all' | FollowUpPriority }> = [
  { label: '全部', value: 'all' },
  { label: '高', value: 'high' },
  { label: '中', value: 'medium' },
  { label: '低', value: 'low' }
];

const CHANNEL_OPTIONS: Array<{ label: string; value: 'all' | FollowUpChannel }> = [
  { label: '全部', value: 'all' },
  { label: 'WeChat 人工跟進', value: 'wechat_manual' },
  { label: 'WhatsApp 人工跟進', value: 'whatsapp_manual' },
  { label: '電話跟進', value: 'phone_manual' },
  { label: 'App 內通知', value: 'in_app' }
];

function pickSingle(value?: string | string[]) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function formatDate(dateValue: string | null) {
  if (!dateValue) return '-';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return dateValue;
  return new Intl.DateTimeFormat('zh-Hant-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function formatTime(timeValue: string | null) {
  if (!timeValue) return '-';
  return timeValue.slice(0, 5);
}

function formatDateTime(dateValue: string | null) {
  if (!dateValue) return '-';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return dateValue;
  return new Intl.DateTimeFormat('zh-Hant-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function isFollowUpStatus(value: string): value is FollowUpStatus {
  return value === 'open' || value === 'done' || value === 'dismissed';
}

function isFollowUpPriority(value: string): value is FollowUpPriority {
  return value === 'high' || value === 'medium' || value === 'low';
}

function isFollowUpChannel(value: string): value is FollowUpChannel {
  return value === 'wechat_manual' || value === 'whatsapp_manual' || value === 'phone_manual' || value === 'in_app';
}

function priorityOrder(priority: FollowUpPriority) {
  return priority === 'high' ? 0 : priority === 'medium' ? 1 : 2;
}

function todayDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Macau',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

export default async function AdminFollowUpsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const { supabase, organizationId } = await getOperationsContext();

  const selectedStatusRaw = pickSingle(resolvedSearchParams?.status) ?? 'open';
  const selectedPriorityRaw = pickSingle(resolvedSearchParams?.priority) ?? 'all';
  const selectedChannelRaw = pickSingle(resolvedSearchParams?.channel) ?? 'all';
  const selectedKeyword = (pickSingle(resolvedSearchParams?.keyword) ?? '').trim();
  const selectedDate = pickSingle(resolvedSearchParams?.date) ?? '';

  const selectedStatus = selectedStatusRaw === 'all' || isFollowUpStatus(selectedStatusRaw) ? selectedStatusRaw : 'open';
  const selectedPriority = selectedPriorityRaw === 'all' || isFollowUpPriority(selectedPriorityRaw) ? selectedPriorityRaw : 'all';
  const selectedChannel = selectedChannelRaw === 'all' || isFollowUpChannel(selectedChannelRaw) ? selectedChannelRaw : 'all';

  let query = supabase
    .from('follow_up_tasks')
    .select(
      `
      id,
      organization_id,
      booking_id,
      task_type,
      subject_student_id,
      due_at,
      students!follow_up_tasks_subject_student_id_fkey(display_name),
      parent_name,
      phone,
      child_name,
      course_title_snapshot,
      campus_name,
      booking_date,
      start_time,
      end_time,
      channel,
      priority,
      intent_summary,
      suggested_message,
      suggested_next_steps,
      internal_note,
      source,
      status,
      completed_at,
      dismissed_at,
      created_at,
      updated_at
    `
    )
    .eq('organization_id', organizationId);

  if (selectedStatus !== 'all') query = query.eq('status', selectedStatus);
  if (selectedPriority !== 'all') query = query.eq('priority', selectedPriority);
  if (selectedChannel !== 'all') query = query.eq('channel', selectedChannel);
  if (selectedDate) query = query.eq('booking_date', selectedDate);
  if (selectedKeyword) {
    const escapedKeyword = selectedKeyword.replace(/[%_]/g, (char) => `\\${char}`);
    query = query.or(
      `parent_name.ilike.%${escapedKeyword}%,phone.ilike.%${escapedKeyword}%,child_name.ilike.%${escapedKeyword}%,course_title_snapshot.ilike.%${escapedKeyword}%,intent_summary.ilike.%${escapedKeyword}%,suggested_message.ilike.%${escapedKeyword}%,task_type.ilike.%${escapedKeyword}%`
    );
  }

  const { data, error } = await query.order('created_at', { ascending: false });
  const tasks = ((data ?? []) as unknown as FollowUpRow[]).sort((a, b) => {
    const priorityDiff = priorityOrder(a.priority) - priorityOrder(b.priority);
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const today = todayDateString();
  const [openCountResult, highOpenResult, todayResult, doneResult] = await Promise.all([
    supabase.from('follow_up_tasks').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'open'),
    supabase.from('follow_up_tasks').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'open').eq('priority', 'high'),
    supabase.from('follow_up_tasks').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'open').eq('booking_date', today),
    supabase.from('follow_up_tasks').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'done')
  ]);

  const summaryCards: SummaryCard[] = [
    { label: '待跟進總數', value: openCountResult.error ? null : openCountResult.count ?? 0, tone: 'border-blue-200 bg-blue-50 text-blue-800' },
    { label: '高優先級待跟進', value: highOpenResult.error ? null : highOpenResult.count ?? 0, tone: 'border-rose-200 bg-rose-50 text-rose-800' },
    { label: '今日預約相關跟進', value: todayResult.error ? null : todayResult.count ?? 0, tone: 'border-amber-200 bg-amber-50 text-amber-800' },
    { label: '已完成跟進', value: doneResult.error ? null : doneResult.count ?? 0, tone: 'border-emerald-200 bg-emerald-50 text-emerald-800' }
  ];

  return (
    <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">跟進任務</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            集中管理招生、低堂數、欠費及補課跟進；職員核對繁體中文草稿後，才人工聯絡家長。
          </p>
        </div>
        <p className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">
          {tasks.length} 個結果
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {summaryCards.map((card) => (
          <div key={card.label} className={`rounded-xl border p-4 ${card.tone}`}>
            <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{card.label}</p>
            <p className="mt-2 text-2xl font-bold">{card.value === null ? '-' : card.value}</p>
          </div>
        ))}
      </div>

      <form method="get" className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-6">
        <div>
          <label htmlFor="status" className="mb-1 block text-xs font-medium text-slate-600">狀態</label>
          <select id="status" name="status" defaultValue={selectedStatus} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-slate-300 focus:ring">
            {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="priority" className="mb-1 block text-xs font-medium text-slate-600">優先級</label>
          <select id="priority" name="priority" defaultValue={selectedPriority} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-slate-300 focus:ring">
            {PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="channel" className="mb-1 block text-xs font-medium text-slate-600">聯絡方式</label>
          <select id="channel" name="channel" defaultValue={selectedChannel} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-slate-300 focus:ring">
            {CHANNEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="date" className="mb-1 block text-xs font-medium text-slate-600">預約日期</label>
          <input id="date" name="date" type="date" defaultValue={selectedDate} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-slate-300 focus:ring" />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="keyword" className="mb-1 block text-xs font-medium text-slate-600">關鍵字</label>
          <input id="keyword" name="keyword" type="search" placeholder="家長／學生／電話／課程" defaultValue={selectedKeyword} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-slate-300 focus:ring" />
        </div>
        <div className="flex items-end gap-2 md:col-span-6">
          <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700">篩選</button>
          <Link href="/admin/follow-ups" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100">清除</Link>
        </div>
      </form>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
          <p className="font-semibold">讀取跟進任務失敗</p>
          <ErrorState error={error} fallback="讀取跟進任務失敗，請稍後再試。" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-10 text-center">
          <p className="text-sm font-medium text-slate-700">目前沒有符合條件的跟進任務</p>
          <p className="mt-1 text-xs text-slate-500">新的預約建立後會在需要時產生跟進事項。</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <article key={task.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={followUpPriorityBadgeClass(task.priority)}>優先：{followUpPriorityLabel(task.priority)}</span>
                <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">{followUpChannelLabel(task.channel)}</span>
                <span className={followUpStatusBadgeClass(task.status)}>{followUpStatusLabel(task.status)}</span>
                {task.task_type ? <span className="inline-flex rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700">{TASK_TYPE_LABELS[task.task_type] ?? task.task_type}</span> : null}
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
                <div>
                  <p className="text-xs text-slate-500">家長 / 電話</p>
                  <p className="mt-1 font-medium text-slate-800">{task.parent_name || '-'}</p>
                  <p className="mt-1 text-xs text-slate-500">{task.phone || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">學生 / 課程</p>
                  <p className="mt-1 font-medium text-slate-800">{task.child_name || task.students?.display_name || '-'}</p>
                  <p className="mt-1 text-xs text-slate-500">{task.course_title_snapshot || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">校區 / 預約時間</p>
                  <p className="mt-1 font-medium text-slate-800">{task.campus_name || '-'}</p>
                  <p className="mt-1 text-xs text-slate-500">{formatDate(task.booking_date)} {formatTime(task.start_time)} - {formatTime(task.end_time)}</p>
                </div>
              </div>

              {task.intent_summary ? <p className="mt-3 text-sm text-slate-700">{task.intent_summary}</p> : null}

              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">建議話術</p>
                  <FollowUpCopyButton message={task.suggested_message} />
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{task.suggested_message}</p>
              </div>

              {task.suggested_next_steps.length > 0 ? (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {task.suggested_next_steps.map((step) => <li key={step}>{step}</li>)}
                </ul>
              ) : null}

              {task.internal_note ? <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">內部備註：{task.internal_note}</p> : null}

              <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-500 md:grid-cols-3">
                <p>建立：{formatDateTime(task.created_at)}</p>
                <p>完成：{formatDateTime(task.completed_at)}</p>
                <p>忽略：{formatDateTime(task.dismissed_at)}</p>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {task.status === 'open' ? (
                  <>
                    <form action={markFollowUpTaskDoneAction.bind(null, task.id, task.booking_id)} className="flex flex-wrap gap-2">
                      <input name="outcome" aria-label="聯絡結果" placeholder="聯絡結果（選填）" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs" />
                      <button type="submit" className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700">標記已完成</button>
                    </form>
                    <form action={dismissFollowUpTaskAction.bind(null, task.id, task.booking_id)}>
                      <button type="submit" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100">忽略</button>
                    </form>
                  </>
                ) : null}
                {task.booking_id ? <Link href={`/admin/bookings/${task.booking_id}`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100">查看招生查詢</Link> : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
