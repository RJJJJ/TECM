'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, type FormEvent } from 'react';
import type { OperationState } from '@/lib/operations/actions';
import { createGuardianStudentAction, createLeaveRequestAction, createMakeupBookingAction, recordPaymentAction, submitAttendanceAction } from '@/lib/operations/actions';

const initial: OperationState = { status: 'idle' };
const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100';
function Submit({ label, pending = false, disabled = false }: { label: string; pending?: boolean; disabled?: boolean }) { return <button disabled={disabled || pending} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white enabled:hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-400" type="submit">{pending ? '提交中…' : label}</button>; }
function Result({ state }: { state: OperationState }) { return state.message ? <p role="status" className={`text-sm ${state.status === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>{state.message}</p> : null; }
function SetupHint({ children }: { children: React.ReactNode }) { return <p className="text-sm text-slate-600 sm:col-span-2">{children}</p>; }
type Option = { id: string; label: string };
type RosterStudent = Option & { status?: 'present' | 'absent' | 'excused' | null; revision: number | null };
function ensureIdempotencyKey(event: FormEvent<HTMLFormElement>) {
  const input = event.currentTarget.elements.namedItem('idempotency_key');
  if (input instanceof HTMLInputElement && !input.value) input.value = crypto.randomUUID();
}

function useRotatingIdempotencyKey(state: OperationState) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status !== 'success' || !state.completionToken) return;
    const input = formRef.current?.elements.namedItem('idempotency_key');
    if (input instanceof HTMLInputElement) {
      input.defaultValue = state.completionToken;
      input.value = state.completionToken;
    }
  }, [state.status, state.completionToken]);
  return formRef;
}

export function IntakeForm({ classes, plans }: { classes: Option[]; plans: Option[] }) {
  const [state, action, pending] = useActionState(createGuardianStudentAction, initial);
  const formRef = useRotatingIdempotencyKey(state);
  return <form ref={formRef} action={action} onSubmit={ensureIdempotencyKey} className="grid gap-3 sm:grid-cols-2">
    <input type="hidden" name="idempotency_key" defaultValue=""/>
    <input aria-label="家長姓名" className={field} name="guardian_name" placeholder="家長姓名" required/><input aria-label="電話" className={field} name="phone" placeholder="電話" required/>
    <input aria-label="學生姓名" className={field} name="student_name" placeholder="學生姓名" required/><input aria-label="學校" className={field} name="school_name" placeholder="學校（選填）"/>
    <div>
      <select aria-label="班別" className={field} name="class_group_id" required disabled={!classes.length} defaultValue=""><option value="" disabled>選擇班別</option>{classes.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select>
      {!classes.length ? <SetupHint>尚未有可選班別，請先<Link className="font-medium text-teal-700 underline" href="/admin/exam-cohorts">建立班別</Link>。</SetupHint> : null}
    </div>
    <div>
      <select aria-label="套票" className={field} name="fee_plan_id" required disabled={!plans.length} defaultValue=""><option value="" disabled>選擇套票</option>{plans.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select>
      {!plans.length ? <SetupHint>尚未有可選套票，請先<Link className="font-medium text-teal-700 underline" href="/admin/packages">建立套票</Link>。</SetupHint> : null}
    </div>
    <div className="flex items-center gap-3 sm:col-span-2"><Submit label="建立資料" pending={pending}/><Result state={state}/></div>
  </form>;
}

export function PaymentForm({ charges, guardians }: { charges: Option[]; guardians: Option[] }) {
  const [state, action, pending] = useActionState(recordPaymentAction, initial);
  const formRef = useRotatingIdempotencyKey(state);
  return <form ref={formRef} action={action} onSubmit={ensureIdempotencyKey} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><input type="hidden" name="idempotency_key" defaultValue=""/><select aria-label="收費項目" className={field} name="charge_id" required defaultValue=""><option value="" disabled>選擇收費項目</option>{charges.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select><select aria-label="付款家長" className={field} name="guardian_id" defaultValue=""><option value="">未指定付款家長</option>{guardians.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select><input aria-label="付款金額（仙）" className={field} name="amount_minor" type="number" min="1" step="1" placeholder="金額（仙）" required/><select aria-label="付款方式" className={field} name="method" defaultValue="cash"><option value="cash">現金</option><option value="bank_transfer">銀行轉帳</option><option value="digital_wallet">電子錢包</option><option value="card">卡</option><option value="other">其他</option></select><div className="flex items-center gap-3 lg:col-span-4"><Submit label="確認收款" pending={pending}/><Result state={state}/></div></form>;
}

function StaffAttendanceRowForm({ sessionId, student, requiresReason, disabled }: { sessionId: string; student: RosterStudent; requiresReason: boolean; disabled: boolean }) {
  const [state, action, pending] = useActionState(submitAttendanceAction, initial);
  const selected = student.status ?? 'present';
  const prepareRequest = (event: FormEvent<HTMLFormElement>) => {
    const input = event.currentTarget.elements.namedItem('request_id');
    if (input instanceof HTMLInputElement && !input.value) input.value = crypto.randomUUID();
  };
  return <form action={action} onSubmit={prepareRequest} className="grid gap-2 border-t border-slate-100 px-4 py-3 sm:grid-cols-[minmax(10rem,1fr)_auto_auto] sm:items-center">
    <input type="hidden" name="session_id" value={sessionId}/>
    <input type="hidden" name="student_id" value={student.id}/>
    <input type="hidden" name="expected_revision" value={student.revision ?? ''}/>
    <input type="hidden" name="request_id" defaultValue=""/>
    <div><p className="font-medium text-slate-900">{student.label}</p>{requiresReason ? <input aria-label={`${student.label}的修改原因`} className={`mt-2 ${field}`} name="reason" placeholder="修改原因（必填）" required/> : <input type="hidden" name="reason" value=""/>}</div>
    <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 text-xs font-medium">{([['present','出席'],['excused','請假'],['absent','缺席']] as const).map(([status,label]) => <label key={status} className="cursor-pointer rounded-md px-2 py-2 text-center has-[:checked]:bg-white has-[:checked]:text-teal-800 has-[:checked]:shadow-sm"><input className="sr-only" type="radio" name="status" value={status} defaultChecked={selected === status} disabled={disabled}/>{label}</label>)}</div>
    <div className="flex flex-col items-start gap-1 sm:items-end"><Submit label="更新點名" pending={pending} disabled={disabled}/>{state.message ? <p role="status" className={`max-w-64 text-xs ${state.status === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>{state.message}</p> : null}</div>
  </form>;
}

export function SessionAttendanceForm({ sessionId, students, requiresReason, disabled }: { sessionId: string; students: RosterStudent[]; requiresReason: boolean; disabled: boolean }) {
  return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">{students.map((student) => <StaffAttendanceRowForm key={`${student.id}:${student.revision ?? 'absent'}`} sessionId={sessionId} student={student} requiresReason={requiresReason} disabled={disabled}/>)}</div>;
}

export function LeaveForm({ sessions, students }: { sessions: Option[]; students: Option[] }) { const [state, action] = useActionState(createLeaveRequestAction, initial); return <form action={action} onSubmit={ensureIdempotencyKey} className="grid gap-3 sm:grid-cols-2"><input type="hidden" name="idempotency_key" defaultValue=""/><select aria-label="請假學生" className={field} name="student_id" required defaultValue=""><option value="" disabled>選擇學生</option>{students.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select><select aria-label="原課堂" className={field} name="session_id" required defaultValue=""><option value="" disabled>選擇課堂</option>{sessions.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select><input aria-label="請假原因" className={field} name="reason" placeholder="請假原因" required/><div className="flex items-center gap-3"><Submit label="提交請假"/><Result state={state}/></div></form>; }

export function MakeupForm({ entitlements, teachers }: { entitlements: Option[]; teachers: Option[] }) { const [state, action] = useActionState(createMakeupBookingAction, initial); return <form action={action} onSubmit={ensureIdempotencyKey} className="grid gap-3 sm:grid-cols-3"><input type="hidden" name="idempotency_key" defaultValue=""/><select aria-label="可用補課額" className={field} name="entitlement_id" required defaultValue=""><option value="" disabled>選擇可用補課額</option>{entitlements.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select><select aria-label="補課導師" className={field} name="teacher_id" required defaultValue=""><option value="" disabled>選擇導師</option>{teachers.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select><input aria-label="補課時間" className={field} name="scheduled_at" type="datetime-local" required/><div className="flex items-center gap-3 sm:col-span-3"><Submit label="預約補課"/><Result state={state}/></div></form>; }
