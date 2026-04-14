import Link from 'next/link';

export default function BookingNotFoundPage() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-2xl font-semibold text-slate-900">Booking 不存在</h1>
      <p className="mt-2 text-sm text-slate-600">找不到這筆 booking，可能已被刪除或 ID 錯誤。</p>
      <Link
        href="/admin/bookings"
        className="mt-5 inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
      >
        返回 Booking 列表
      </Link>
    </section>
  );
}
