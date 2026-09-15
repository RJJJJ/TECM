'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { completeMakeupTaskAction, scheduleMakeupSessionAction, type MakeupFormState } from './actions';

const initial: MakeupFormState = { status: 'idle' };
const field = 'rounded-lg border px-3 py-2 text-sm';

function SubmitButton({ label, pendingLabel, className }: { label: string; pendingLabel: string; className: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className={`${className} disabled:cursor-not-allowed disabled:opacity-50`}>{pending ? pendingLabel : label}</button>;
}

export function MakeupScheduleForm({ taskId, studentId, teachers, idempotencyKey }: { taskId: string; studentId: string; teachers: Array<{ id: string; display_name: string | null }>; idempotencyKey: string }) {
  const formAction = scheduleMakeupSessionAction.bind(null, taskId, studentId);
  const [state, action] = useActionState(formAction, initial);
  return <form action={action} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-3">
    <input type="hidden" name="idempotency_key" value={idempotencyKey} />
    <input aria-label="補課時間" name="scheduled_at" type="datetime-local" className={field} required />
    <select aria-label="補課導師" name="teacher_id" className={field} defaultValue="" required>
      <option value="" disabled>選擇補課導師</option>
      {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.display_name ?? '未命名導師'}</option>)}
    </select>
    <div className="flex items-center gap-3">
      <SubmitButton label="安排補課" pendingLabel="安排中…" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white" />
      {state.message ? <p role="status" className={`text-sm ${state.status === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>{state.message}</p> : null}
    </div>
  </form>;
}

export function MakeupCompletionForm({ taskId }: { taskId: string }) {
  const formAction = completeMakeupTaskAction.bind(null, taskId);
  const [state, action] = useActionState(formAction, initial);
  return <form action={action} onSubmit={(event) => {
    if (!window.confirm('確定這節補課已完成嗎？完成後會一次扣除補課額，並更新補課及課堂狀態。')) event.preventDefault();
  }}>
    <SubmitButton label="標記為已完成" pendingLabel="處理中…" className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700" />
    {state.message ? <p role="status" className={`mt-2 text-sm ${state.status === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>{state.message}</p> : null}
  </form>;
}
