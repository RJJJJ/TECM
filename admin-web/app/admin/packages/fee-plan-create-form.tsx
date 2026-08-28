'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { OperationState } from '@/lib/operations/actions';
import { createFeePlanAction } from './actions';

type Option = { id: string; label: string };
const initial: OperationState = { status: 'idle' };
const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100';

export default function FeePlanCreateForm({ courses }: { courses: Option[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createFeePlanAction, initial);

  useEffect(() => {
    if (state.status === 'success') router.refresh();
  }, [router, state.status]);

  return <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <input aria-label="套票名稱" className={field} name="name" placeholder="套票名稱" required maxLength={120} />
    <select aria-label="適用課程" className={field} name="course_id" defaultValue=""><option value="">所有課程</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.label}</option>)}</select>
    <input aria-label="堂數" className={field} name="credit_units" type="number" min="1" step="1" placeholder="堂數" required />
    <input aria-label="金額（仙）" className={field} name="amount_minor" type="number" min="0" step="1" placeholder="金額（仙）" required />
    <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4"><button className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" type="submit" disabled={pending}>{pending ? '建立中…' : '建立套票'}</button>{state.message ? <p role="status" className={`text-sm ${state.status === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>{state.message}</p> : null}</div>
  </form>;
}
