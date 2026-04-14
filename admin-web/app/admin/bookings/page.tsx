import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled';

type BookingRow = {
  id: string;
  parent_name: string | null;
  child_name: string | null;
  course_title_snapshot: string | null;
  booking_date: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string | null;
  created_at: string;
  campuses: {
    name: string | null;
  } | null;
};

type CampusOption = {
  id: string;
  name: string;
};

type SearchParams = {
  status?: string | string[];
  campus?: string | string[];
  date?: string | string[];
};

const STATUS_OPTIONS: Array<{ label: string; value: 'all' | BookingStatus }> = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Confirmed', value: 'confirmed' },
  { label: 'Completed', value: 'completed' },
  { label: 'Cancelled', value: 'cancelled' }
];

function pickSingle(value?: string | string[]) {
  if (Array.isArray(value)) return value[0];
  return value;
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

function statusBadgeClass(status: string | null) {
  switch (status) {
    case 'pending':
      return 'bg-amber-100 text-amber-800';
    case 'confirmed':
      return 'bg-blue-100 text-blue-800';
    case 'completed':
      return 'bg-emerald-100 text-emerald-800';
    case 'cancelled':
      return 'bg-rose-100 text-rose-800';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

export default async function AdminBookingsPage({
  searchParams
}: {
  searchParams?: SearchParams;
}) {
  const supabase = createServerSupabaseClient();

  const selectedStatus = pickSingle(searchParams?.status) ?? 'all';
  const selectedCampusId = pickSingle(searchParams?.campus) ?? 'all';
  const selectedDate = pickSingle(searchParams?.date) ?? '';

  const { data: campusData } = await supabase
    .from('campuses')
    .select('id, name')
    .order('name', { ascending: true });

  const campuses = (campusData ?? []) as CampusOption[];

  let bookingsQuery = supabase
    .from('bookings')
    .select(
      `
      id,
      parent_name,
      child_name,
      course_title_snapshot,
      booking_date,
      start_time,
      end_time,
      status,
      created_at,
      campuses(name)
    `
    )
    .order('created_at', { ascending: false });

  if (selectedStatus !== 'all') {
    bookingsQuery = bookingsQuery.eq('status', selectedStatus);
  }

  if (selectedCampusId !== 'all') {
    bookingsQuery = bookingsQuery.eq('campus_id', selectedCampusId);
  }

  if (selectedDate) {
    bookingsQuery = bookingsQuery.eq('booking_date', selectedDate);
  }

  const { data, error } = await bookingsQuery;

  const bookings = (data ?? []) as BookingRow[];

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-slate-900">Booking Management</h1>
        <p className="mt-1 text-sm text-slate-600">最新 booking 列表（依建立時間由新到舊）</p>
      </div>

      <form
        method="get"
        className="mb-5 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-4"
      >
        <div>
          <label htmlFor="status" className="mb-1 block text-xs font-medium text-slate-600">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={selectedStatus}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-slate-300 focus:ring"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="campus" className="mb-1 block text-xs font-medium text-slate-600">
            Campus
          </label>
          <select
            id="campus"
            name="campus"
            defaultValue={selectedCampusId}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-slate-300 focus:ring"
          >
            <option value="all">All</option>
            {campuses.map((campus) => (
              <option key={campus.id} value={campus.id}>
                {campus.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="date" className="mb-1 block text-xs font-medium text-slate-600">
            Booking Date
          </label>
          <input
            id="date"
            name="date"
            type="date"
            defaultValue={selectedDate}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-slate-300 focus:ring"
          />
        </div>

        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            套用篩選
          </button>
          <Link
            href="/admin/bookings"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            清除
          </Link>
        </div>
      </form>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          讀取 bookings 失敗：{error.message}
        </div>
      ) : bookings.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          查無符合條件的 booking。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-medium">Parent</th>
                <th className="px-4 py-3 font-medium">Child</th>
                <th className="px-4 py-3 font-medium">Course</th>
                <th className="px-4 py-3 font-medium">Campus</th>
                <th className="px-4 py-3 font-medium">Booking Date</th>
                <th className="px-4 py-3 font-medium">Start</th>
                <th className="px-4 py-3 font-medium">End</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {bookings.map((booking) => (
                <tr key={booking.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-3 text-slate-700">{booking.parent_name || '-'}</td>
                  <td className="px-4 py-3 text-slate-700">{booking.child_name || '-'}</td>
                  <td className="px-4 py-3 text-slate-700">{booking.course_title_snapshot || '-'}</td>
                  <td className="px-4 py-3 text-slate-700">{booking.campuses?.name || '-'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                    {formatDate(booking.booking_date)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                    {formatTime(booking.start_time)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                    {formatTime(booking.end_time)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusBadgeClass(
                        booking.status
                      )}`}
                    >
                      {booking.status || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      查看詳情
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
