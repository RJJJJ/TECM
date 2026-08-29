'use client';

import { useActionState, type FormEvent } from 'react';
import { submitTeacherAttendanceAction, type OperationState } from '@/lib/operations/actions';

type Student = {
  id: string;
  label: string;
  status: 'present' | 'absent' | 'excused' | null;
  revision: number | null;
};

const initial: OperationState = { status: 'idle' };
const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100';

function prepareRequest(event: FormEvent<HTMLFormElement>) {
  const request = event.currentTarget.elements.namedItem('request_id');
  if (request instanceof HTMLInputElement && !request.value) request.value = crypto.randomUUID();
}

export function TeacherAttendanceForm({
  sessionId,
  student,
  requiresReason,
  disabled = false
}: {
  sessionId: string;
  student: Student;
  requiresReason: boolean;
  disabled?: boolean;
}) {
  const [state, action, pending] = useActionState(submitTeacherAttendanceAction, initial);
  const selected = student.status ?? 'present';

  return (
    <form action={action} onSubmit={prepareRequest} className="grid gap-2 border-t border-slate-100 px-4 py-3 sm:grid-cols-[minmax(10rem,1fr)_auto_auto] sm:items-center">
      <input type="hidden" name="session_id" value={sessionId}/>
      <input type="hidden" name="student_id" value={student.id}/>
      <input type="hidden" name="expected_revision" value={student.revision ?? ''}/>
      <input type="hidden" name="request_id" defaultValue=""/>
      <div>
        <p className="font-medium text-slate-900">{student.label}</p>
        {requiresReason ? <input aria-label={`${student.label}的修改原因`} className={`mt-2 ${field}`} name="reason" placeholder="修改原因（必填）" required/> : <input type="hidden" name="reason" value=""/>}
      </div>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 text-xs font-medium">
        {([['present', '出席'], ['excused', '請假'], ['absent', '缺席']] as const).map(([status, label]) => (
          <label key={status} className="cursor-pointer rounded-md px-2 py-2 text-center has-[:checked]:bg-white has-[:checked]:text-teal-800 has-[:checked]:shadow-sm">
            <input className="sr-only" type="radio" name="status" value={status} defaultChecked={selected === status} disabled={disabled}/>{label}
          </label>
        ))}
      </div>
      <div className="flex flex-col items-start gap-1 sm:items-end">
        <button type="submit" disabled={disabled || pending} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white enabled:hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-400">
          {disabled ? '尚未開始' : pending ? '提交中…' : '更新點名'}
        </button>
        {state.message ? <p role="status" className={`max-w-64 text-xs ${state.status === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>{state.message}</p> : null}
      </div>
    </form>
  );
}
