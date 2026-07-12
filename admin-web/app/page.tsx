import Link from 'next/link';

export default function HomePage() {
  return (
    <section className="mx-auto my-10 max-w-4xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-slate-900">TECM 教育中心營運助手</h1>
      <p className="mt-2 text-sm text-slate-600">
        在一個地方完成招生、排班、點名、請假補課、堂數、收費及家長跟進。
      </p>
      <div className="mt-6 flex gap-3">
        <Link
          href="/login"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          前往登入
        </Link>
        <Link
          href="/admin"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          開啟營運後台
        </Link>
      </div>
    </section>
  );
}
