export default function BookingsLoading() {
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <p className="text-sm font-medium text-slate-700">載入 booking 列表中...</p>
        <p className="text-xs text-slate-500">正在整理最新資料，請稍候。</p>
      </div>

      <div className="animate-pulse space-y-3">
        <div className="h-10 rounded-lg bg-slate-100" />
        <div className="h-14 rounded-lg bg-slate-100" />
        <div className="h-14 rounded-lg bg-slate-100" />
        <div className="h-14 rounded-lg bg-slate-100" />
      </div>
    </section>
  );
}
