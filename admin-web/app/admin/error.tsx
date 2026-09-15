'use client';
import { safeErrorMessage } from '@/lib/operations/errors';

export default function AdminError({ error, reset }: { error: Error; reset: () => void }) {
  return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6"><h1 className="text-lg font-semibold text-rose-900">未能載入頁面</h1><p className="mt-2 text-sm text-rose-800">{safeErrorMessage(error, '頁面暫時未能載入，請稍後再試。', 'admin-page')}</p><button onClick={reset} className="mt-4 rounded-lg bg-rose-800 px-4 py-2 text-sm font-medium text-white">重新載入</button></div>;
}
