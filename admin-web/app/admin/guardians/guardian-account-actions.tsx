'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  disableGuardianAction,
  inviteGuardianAction,
  linkExistingParentStudentAction,
  recoverGuardianAction,
  unlinkExistingParentStudentAction,
  type GuardianActionState
} from './actions';

const initialState: GuardianActionState = { status: 'idle' };

function ActionResult({ state }: { state: GuardianActionState }) {
  return state.message ? <p role="status" className={`basis-full text-sm ${state.status === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>{state.message}</p> : null;
}

function PendingButton({ label, pendingLabel, className }: { label: string; pendingLabel: string; className: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className={`${className} disabled:cursor-not-allowed disabled:opacity-50`}>
    {pending ? pendingLabel : label}
  </button>;
}

export function GuardianInviteForm({ profileId, email, invitationLabel, idempotencyKey }: { profileId: string; email: string; invitationLabel: string; idempotencyKey: string }) {
  const [state, action] = useActionState(inviteGuardianAction, initialState);
  return <form action={action} className="flex min-w-72 flex-wrap gap-2">
    <input type="hidden" name="parent_profile_id" value={profileId} />
    <input type="hidden" name="idempotency_key" value={idempotencyKey} />
    <input name="email" type="email" required defaultValue={email} placeholder="parent@example.com" className="min-w-48 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
    <PendingButton label={invitationLabel} pendingLabel="發送中…" className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white" />
    <ActionResult state={state} />
  </form>;
}

export function GuardianDisableForm({ profileId }: { profileId: string }) {
  const [state, action] = useActionState(disableGuardianAction, initialState);
  return <form action={action} className="mt-2" onSubmit={(event) => {
    if (!window.confirm('確定停用此家長帳戶及其現有裝置嗎？停用後不會自動重新啟用裝置。')) event.preventDefault();
  }}>
    <input type="hidden" name="parent_profile_id" value={profileId} />
    <PendingButton label="停用帳戶及裝置" pendingLabel="停用中…" className="text-xs font-semibold text-rose-700 hover:underline" />
    <ActionResult state={state} />
  </form>;
}

export function GuardianRecoverForm({ profileId }: { profileId: string }) {
  const [state, action] = useActionState(recoverGuardianAction, initialState);
  return <form action={action} className="mt-2" onSubmit={(event) => {
    if (!window.confirm('確定恢復此家長帳戶嗎？這只會讓帳戶可重新邀請，不會重新啟用舊裝置。')) event.preventDefault();
  }}>
    <input type="hidden" name="parent_profile_id" value={profileId} />
    <PendingButton label="恢復並重新邀請" pendingLabel="恢復中…" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800" />
    <ActionResult state={state} />
  </form>;
}

export function ExistingParentStudentLinkForm({ profileId, students }: { profileId: string; students: Array<{ id: string; label: string }> }) {
  const [state, action] = useActionState(linkExistingParentStudentAction, initialState);
  return <form action={action} className="mt-3 flex flex-wrap items-center gap-2">
    <input type="hidden" name="parent_profile_id" value={profileId} />
    <select name="student_id" aria-label="連結另一名學生" defaultValue="" required disabled={!students.length} className="min-w-52 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100">
      <option value="" disabled>{students.length ? '選擇另一名學生' : '沒有可連結的學生'}</option>
      {students.map(student => <option key={student.id} value={student.id}>{student.label}</option>)}
    </select>
    <PendingButton label="連結學生" pendingLabel="連結中…" className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white" />
    <ActionResult state={state} />
  </form>;
}

export function ExistingParentStudentUnlinkForm({ linkId, studentName }: { linkId: string; studentName: string }) {
  const [state, action] = useActionState(unlinkExistingParentStudentAction, initialState);
  return <form action={action} className="inline-flex flex-wrap items-center gap-2" onSubmit={(event) => {
    if (!window.confirm(`確定移除與「${studentName}」的連結？家長帳戶及其他學生連結不會被停用。`)) event.preventDefault();
  }}>
    <input type="hidden" name="link_id" value={linkId} />
    <input type="hidden" name="confirmed" value="true" />
    <PendingButton label="移除連結" pendingLabel="移除中…" className="text-xs font-semibold text-rose-700 hover:underline" />
    <ActionResult state={state} />
  </form>;
}
