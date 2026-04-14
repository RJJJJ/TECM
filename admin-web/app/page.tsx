import Link from 'next/link';

export default function HomePage() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-slate-900">TECM Admin Web</h1>
      <p className="mt-2 text-sm text-slate-600">
        Booking management 後台骨架已建立。
      </p>
      <div className="mt-6 flex gap-3">
        <Link
          href="/login"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          前往登入
        </Link>
        <Link
          href="/admin/bookings"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          前往 Admin / Bookings
        </Link>
      </div>
    </section>
  );
}
