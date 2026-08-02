import { safeErrorMessage } from '@/lib/operations/errors';
import { statusLabel } from '@/lib/operations/labels';

export function PageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{title}</h1><p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p></div>{action}</div>;
}

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><h2 className="mb-4 text-base font-semibold text-slate-950">{title}</h2>{children}</section>;
}

export function Metric({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold text-slate-950">{value}</p>{hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}</div>;
}

export function EmptyState({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) { return <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">{children}{action ? <div className="mt-4">{action}</div> : null}</div>; }
export function ErrorState({ error, message, fallback = '未能載入資料，請稍後再試。' }: { error?: unknown; message?: string; fallback?: string }) {
  const safeMessage = error !== undefined ? safeErrorMessage(error, fallback, 'admin-page-read') : message ?? fallback;
  return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{safeMessage}</div>;
}
export function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate'|'green'|'amber'|'rose'|'blue' }) {
  const tones = { slate:'bg-slate-100 text-slate-700', green:'bg-emerald-50 text-emerald-700', amber:'bg-amber-50 text-amber-800', rose:'bg-rose-50 text-rose-700', blue:'bg-blue-50 text-blue-700' };
  const label = typeof children === 'string' ? statusLabel(children) : children;
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>{label}</span>;
}
export function DataTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="min-w-full text-sm"><thead className="bg-slate-50"><tr>{headers.map(h => <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100 bg-white">{children}</tbody></table></div>;
}
