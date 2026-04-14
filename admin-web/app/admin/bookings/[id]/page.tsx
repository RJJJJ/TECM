import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import BookingUpdateForm from './booking-update-form';

type BookingDetail = {
  id: string;
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

function formatTime(timeValue: string | null) {
  if (!timeValue) return '-';
  return timeValue.slice(0, 5);
}

export default async function BookingDetailPage({
  params
}: {
  params: { id: string };
}) {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from('bookings')
    .select(
      `
      id,
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Booking Detail</h1>
          <p className="mt-1 text-sm text-slate-600">ID: {booking.id}</p>
        </div>
        <Link
          href="/admin/bookings"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          返回列表
        </Link>
      </div>

      <section className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2">
        <h2 className="md:col-span-2 text-lg font-semibold text-slate-900">基本資料</h2>

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
          <p className="text-xs text-slate-500">Status</p>
          <p className="mt-1 text-sm text-slate-800">{displayValue(booking.status)}</p>
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
        <div className="md:col-span-2">
          <p className="text-xs text-slate-500">Note</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{displayValue(booking.note)}</p>
        </div>
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
