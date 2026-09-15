'use client';

import { useActionState } from 'react';
import type { OperationState } from '@/lib/operations/actions';
import { createTeacherAction } from './actions';

const initial: OperationState = { status: 'idle' };
const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100';

export default function TeacherCreateForm() {
  const [state, action, pending] = useActionState(createTeacherAction, initial);
  return <form action={action} className="grid gap-3 sm:grid-cols-3">
    <input aria-label="導師姓名" className={field} name="display_name" placeholder="導師姓名" required maxLength={120} />
    <input aria-label="登入電郵" className={field} name="email" type="email" placeholder="登入電郵（須已建立帳戶）" required />
    <input aria-label="電話" className={field} name="phone" placeholder="電話（選填）" maxLength={40} />
    <div className="flex items-center gap-3 sm:col-span-3">
      <button className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" type="submit" disabled={pending}>{pending ? '連結中…' : '連結導師'}</button>
      {state.message ? <p role="status" className={`text-sm ${state.status === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>{state.message}</p> : null}
    </div>
  </form>;
}
