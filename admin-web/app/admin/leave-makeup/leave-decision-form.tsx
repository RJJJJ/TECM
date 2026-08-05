'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { decideLeaveRequestAction, type OperationState } from '@/lib/operations/actions';

const initialState: OperationState = { status: 'idle' };

function DecisionButtons() {
  const { pending } = useFormStatus();
  return <>
    <button disabled={pending} name="decision" value="approved" className="rounded bg-emerald-700 px-2 py-1 text-xs text-white disabled:opacity-50">批准及建立補課額</button>
    <button disabled={pending} name="decision" value="rejected" className="rounded border px-2 py-1 text-xs disabled:opacity-50">拒絕</button>
  </>;
}

export default function LeaveDecisionForm({ leaveRequestId }: { leaveRequestId: string }) {
  const [state, action] = useActionState(decideLeaveRequestAction, initialState);
  return <form action={action} className="flex flex-wrap gap-1">
    <input type="hidden" name="leave_request_id" value={leaveRequestId}/>
    <DecisionButtons />
    {state.message ? <p role="status" className={`basis-full text-xs ${state.status === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>{state.message}</p> : null}
  </form>;
}
