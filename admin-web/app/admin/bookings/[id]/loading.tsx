export default function BookingDetailLoading() {
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <p className="text-sm font-medium text-slate-700">載入 booking 詳情中...</p>
        <p className="text-xs text-slate-500">正在取得詳細資料與可編輯欄位。</p>
      </div>

      <div className="animate-pulse space-y-3">
        <div className="h-7 w-48 rounded bg-slate-100" />
        <div className="h-24 rounded bg-slate-100" />
        <div className="h-40 rounded bg-slate-100" />
      </div>
    </section>
  );
}
