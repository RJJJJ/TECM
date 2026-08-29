'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { OperationState } from '@/lib/operations/actions';
import { createCampusAction } from './actions';

const initial: OperationState = { status: 'idle' };
const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100';

export default function CampusCreateForm() {
  const router = useRouter();
  const [state, action, pending] = useActionState(createCampusAction, initial);

  useEffect(() => {
    if (state.status === 'success') router.refresh();
  }, [router, state]);

  return <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
    <input aria-label="校區名稱" className={field} name="name" placeholder="校區名稱" required maxLength={120} />
    <input aria-label="校區地址" className={field} name="address" placeholder="地址（選填）" maxLength={240} />
    <button className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" type="submit" disabled={pending}>{pending ? '建立中…' : '建立校區'}</button>
    {state.message ? <p role="status" className={`text-sm sm:col-span-3 ${state.status === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>{state.message}</p> : null}
  </form>;
}
