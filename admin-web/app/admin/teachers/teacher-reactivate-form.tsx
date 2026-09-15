'use client';

import { useActionState } from 'react';
import type { OperationState } from '@/lib/operations/actions';
import { createTeacherAction } from './actions';

const initial: OperationState = { status: 'idle' };

export default function TeacherReactivateForm({ email, displayName, phone }: { email: string; displayName: string; phone: string | null }) {
  const [state, action, pending] = useActionState(createTeacherAction, initial);
  return <form action={action} className="flex flex-wrap items-center gap-2">
    <input type="hidden" name="email" value={email} />
    <input type="hidden" name="display_name" value={displayName} />
    <input type="hidden" name="phone" value={phone ?? ''} />
    <button className="rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 disabled:cursor-not-allowed disabled:opacity-50" type="submit" disabled={pending}>
      {pending ? '重新啟用中…' : '重新啟用'}
    </button>
    {state.message ? <span role="status" className={`text-xs ${state.status === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>{state.message}</span> : null}
  </form>;
}
