'use client';

import { useFormStatus } from 'react-dom';
import { disableGuardianAction, inviteGuardianAction, recoverGuardianAction } from './actions';

function PendingButton({ label, pendingLabel, className }: { label: string; pendingLabel: string; className: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className={`${className} disabled:cursor-not-allowed disabled:opacity-50`}>
    {pending ? pendingLabel : label}
  </button>;
}

export function GuardianInviteForm({ profileId, email, invitationLabel, idempotencyKey }: { profileId: string; email: string; invitationLabel: string; idempotencyKey: string }) {
  return <form action={inviteGuardianAction} className="flex min-w-72 flex-wrap gap-2">
    <input type="hidden" name="parent_profile_id" value={profileId} />
    <input type="hidden" name="idempotency_key" value={idempotencyKey} />
    <input name="email" type="email" required defaultValue={email} placeholder="parent@example.com" className="min-w-48 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
    <PendingButton label={invitationLabel} pendingLabel="發送中…" className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white" />
  </form>;
}

export function GuardianDisableForm({ profileId }: { profileId: string }) {
  return <form action={disableGuardianAction} className="mt-2" onSubmit={(event) => {
    if (!window.confirm('確定停用此家長帳戶及其現有裝置嗎？停用後不會自動重新啟用裝置。')) event.preventDefault();
  }}>
    <input type="hidden" name="parent_profile_id" value={profileId} />
    <PendingButton label="停用帳戶及裝置" pendingLabel="停用中…" className="text-xs font-semibold text-rose-700 hover:underline" />
  </form>;
}

export function GuardianRecoverForm({ profileId }: { profileId: string }) {
  return <form action={recoverGuardianAction} className="mt-2" onSubmit={(event) => {
    if (!window.confirm('確定恢復此家長帳戶嗎？這只會讓帳戶可重新邀請，不會重新啟用舊裝置。')) event.preventDefault();
  }}>
    <input type="hidden" name="parent_profile_id" value={profileId} />
    <PendingButton label="恢復並重新邀請" pendingLabel="恢復中…" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800" />
  </form>;
}
