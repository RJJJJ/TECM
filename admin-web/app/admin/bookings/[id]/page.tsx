import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import BookingUpdateForm from './booking-update-form';

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

  const booking = data as BookingDetail;

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
    </div>
  );
}
