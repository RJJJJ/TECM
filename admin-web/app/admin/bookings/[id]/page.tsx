import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import BookingUpdateForm from './booking-update-form';
import FollowUpCopyButton from '../../follow-up-copy-button';
import { dismissFollowUpTaskAction, markFollowUpTaskDoneAction } from './follow-up-actions';
import {
  type FollowUpTask,
  followUpChannelLabel,
  followUpPriorityBadgeClass,
  followUpPriorityLabel,
  followUpStatusBadgeClass,
  followUpStatusLabel
} from '@/lib/types/follow-up';

type BookingDetail = {
  id: string;
  parent_id: string | null;
  child_id: string | null;
  course_id: string | null;
  campus_id: string | null;
  parent_name: string | null;
  phone: string | null;
  child_name: string | null;
  child_age: number | null;
  school_name: string | null;
  course_title_snapshot: string | null;
  booking_date: string | null;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
  campuses: {
    name: string | null;
  } | null;
};

type BookingStatusLog = {
  id: string;
  old_status: string | null;
  new_status: string;
  changed_by: string | null;
  note: string | null;
  created_at: string;
};

function displayValue(value: string | number | null) {
  if (value === null || value === '') return '-';
  return String(value);
}

function formatDate(dateValue: string | null) {
  if (!dateValue) return '-';

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return dateValue;

  return new Intl.DateTimeFormat('zh-Hant-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
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

function formatTime(timeValue: string | null) {
  if (!timeValue) return '-';
  return timeValue.slice(0, 5);
}

function statusBadgeClass(status: string | null) {
  const base = 'inline-flex min-w-[88px] justify-center rounded-full border px-2.5 py-1 text-xs font-semibold';

  switch (status) {
    case 'pending':
      return `${base} border-amber-200 bg-amber-50 text-amber-800`;
    case 'confirmed':
      return `${base} border-blue-200 bg-blue-50 text-blue-800`;
    case 'completed':
      return `${base} border-emerald-200 bg-emerald-50 text-emerald-800`;
    case 'cancelled':
      return `${base} border-rose-200 bg-rose-50 text-rose-800`;
    default:
      return `${base} border-slate-200 bg-slate-100 text-slate-700`;
  }
}

function statusLabel(status: string | null) {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'confirmed':
      return 'Confirmed';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Unknown';
  }
}

function resolveReturnTo(rawReturnTo?: string | string[]) {
  const candidate = Array.isArray(rawReturnTo) ? rawReturnTo[0] : rawReturnTo;
  if (!candidate || !candidate.startsWith('/admin/bookings')) {
    return '/admin/bookings';
  }

  return candidate;
}

export default async function BookingDetailPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams?: { returnTo?: string | string[] };
}) {
  const supabase = createServerSupabaseClient();
  const backToListHref = resolveReturnTo(searchParams?.returnTo);

  const { data, error } = await supabase
    .from('bookings')
    .select(
      `
      id,
      parent_id,
      child_id,
      course_id,
      campus_id,
      parent_name,
      phone,
      child_name,
      child_age,
      school_name,
      course_title_snapshot,
      booking_date,
      start_time,
      end_time,
      note,
      status,
      created_at,
      updated_at,
      campuses(name)
    `
    )
    .eq('id', params.id)
    .maybeSingle();

  const { data: statusLogs, error: statusLogsError } = await supabase
    .from('booking_status_logs')
    .select(
      `
      id,
      old_status,
      new_status,
      changed_by,
      note,
      created_at
    `
    )
    .eq('booking_id', params.id)
    .order('created_at', { ascending: false });

  const { data: followUpTasksData, error: followUpTasksError } = await supabase
    .from('follow_up_tasks')
    .select(
      `
      id,
      booking_id,
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
    .eq('booking_id', params.id)
    .order('created_at', { ascending: false });

  if (error) {
    return (
      <section className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        讀取 booking 失敗：{error.message}
      </section>
    );
  }

  if (!data) {
    notFound();
  }

  const booking = data as unknown as BookingDetail;
  const bookingStatusLogs = (statusLogs ?? []) as BookingStatusLog[];
  const followUpTasks = (followUpTasksData ?? []) as FollowUpTask[];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Booking Detail</h2>
          <p className="mt-1 text-sm text-slate-600">Booking ID: {booking.id}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={statusBadgeClass(booking.status)}>{statusLabel(booking.status)}</span>
          <Link
            href={backToListHref}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            返回列表
          </Link>
        </div>
      </div>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Booking 資訊</h3>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs text-slate-500">Parent Name</p>
            <p className="mt-1 text-sm text-slate-800">{displayValue(booking.parent_name)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Phone</p>
            <p className="mt-1 text-sm text-slate-800">{displayValue(booking.phone)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Child Name</p>
            <p className="mt-1 text-sm text-slate-800">{displayValue(booking.child_name)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Child Age</p>
            <p className="mt-1 text-sm text-slate-800">{displayValue(booking.child_age)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">School</p>
            <p className="mt-1 text-sm text-slate-800">{displayValue(booking.school_name)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Course</p>
            <p className="mt-1 text-sm text-slate-800">{displayValue(booking.course_title_snapshot)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Campus</p>
            <p className="mt-1 text-sm text-slate-800">{displayValue(booking.campuses?.name ?? null)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Booking Date</p>
            <p className="mt-1 text-sm text-slate-800">{formatDate(booking.booking_date)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Time</p>
            <p className="mt-1 text-sm text-slate-800">
              {formatTime(booking.start_time)} - {formatTime(booking.end_time)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Created At</p>
            <p className="mt-1 text-sm text-slate-800">{formatDateTime(booking.created_at)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Updated At</p>
            <p className="mt-1 text-sm text-slate-800">{formatDateTime(booking.updated_at)}</p>
          </div>
          <div className="md:col-span-2">
            <p className="text-xs text-slate-500">Note</p>
            <p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800">
              {displayValue(booking.note)}
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Metadata</h3>
        <dl className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-4 text-sm md:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">parent_id</dt>
            <dd className="mt-1 break-all font-mono text-xs text-slate-700">{displayValue(booking.parent_id)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">child_id</dt>
            <dd className="mt-1 break-all font-mono text-xs text-slate-700">{displayValue(booking.child_id)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">course_id</dt>
            <dd className="mt-1 break-all font-mono text-xs text-slate-700">{displayValue(booking.course_id)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">campus_id</dt>
            <dd className="mt-1 break-all font-mono text-xs text-slate-700">{displayValue(booking.campus_id)}</dd>
          </div>
        </dl>
      </section>

      <BookingUpdateForm
        booking={{
          id: booking.id,
          status: booking.status,
          note: booking.note,
          booking_date: booking.booking_date,
          start_time: booking.start_time,
          end_time: booking.end_time
        }}
      />



      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">AI 跟進建議</h3>
          <p className="mt-1 text-sm text-slate-600">
            供 staff 複製 WeChat / WhatsApp 話術後人工聯絡家長，不會自動發送。
          </p>
        </div>

        {followUpTasksError ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            讀取 AI 跟進建議失敗：{followUpTasksError.message}
          </div>
        ) : followUpTasks.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
            目前未有 AI 跟進建議。之後可由 n8n / automation 在新 booking 建立後自動生成。
          </div>
        ) : (
          <div className="space-y-3">
            {followUpTasks.map((task) => (
              <article key={task.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={followUpPriorityBadgeClass(task.priority)}>
                    優先：{followUpPriorityLabel(task.priority)}
                  </span>
                  <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
                    {followUpChannelLabel(task.channel)}
                  </span>
                  <span className={followUpStatusBadgeClass(task.status)}>{followUpStatusLabel(task.status)}</span>
                </div>

                {task.intent_summary ? (
                  <p className="mt-3 text-sm text-slate-700">{task.intent_summary}</p>
                ) : null}

                <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">建議話術</p>
                    <FollowUpCopyButton message={task.suggested_message} />
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{task.suggested_message}</p>
                </div>

                {task.suggested_next_steps.length > 0 ? (
                  <div className="mt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">建議下一步</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                      {task.suggested_next_steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {task.internal_note ? (
                  <div className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <span className="font-medium">內部備註：</span>{task.internal_note}
                  </div>
                ) : null}

                <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-500 md:grid-cols-3">
                  <p>建立：{formatDateTime(task.created_at)}</p>
                  <p>完成：{formatDateTime(task.completed_at)}</p>
                  <p>忽略：{formatDateTime(task.dismissed_at)}</p>
                </div>

                {task.status === 'open' ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <form action={markFollowUpTaskDoneAction.bind(null, task.id, booking.id)}>
                      <button
                        type="submit"
                        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700"
                      >
                        標記已完成
                      </button>
                    </form>
                    <form action={dismissFollowUpTaskAction.bind(null, task.id, booking.id)}>
                      <button
                        type="submit"
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                      >
                        忽略
                      </button>
                    </form>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Status History</h3>
          <p className="mt-1 text-sm text-slate-600">Booking status change logs (latest first)</p>
        </div>

        {statusLogsError ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            讀取 status log 失敗：{statusLogsError.message}
          </div>
        ) : bookingStatusLogs.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            目前沒有 status log 紀錄。
          </div>
        ) : (
          <div className="space-y-3">
            {bookingStatusLogs.map((log) => (
              <article key={log.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                  <span>{statusLabel(log.old_status)}</span>
                  <span className="text-slate-400">→</span>
                  <span>{statusLabel(log.new_status)}</span>
                </div>
                <dl className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                  <div>
                    <dt className="text-xs text-slate-500">Changed At</dt>
                    <dd className="mt-1 text-slate-800">{formatDateTime(log.created_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Changed By</dt>
                    <dd className="mt-1 break-all text-slate-800">{log.changed_by ?? 'System / Unknown'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Old Status</dt>
                    <dd className="mt-1 text-slate-800">{statusLabel(log.old_status)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">New Status</dt>
                    <dd className="mt-1 text-slate-800">{statusLabel(log.new_status)}</dd>
                  </div>
                  {log.note ? (
                    <div className="md:col-span-2">
                      <dt className="text-xs text-slate-500">Note</dt>
                      <dd className="mt-1 whitespace-pre-wrap rounded-md bg-white px-3 py-2 text-slate-800">
                        {log.note}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
