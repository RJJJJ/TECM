'use client';

import { useActionState } from 'react';
import { transferCohortStudentAction, type ExamCohortFormState } from './actions';

type Target = { id: string; name: string };
const initial: ExamCohortFormState = { status: 'idle' };

export default function CohortTransferForm({ sourceCohortId, studentId, studentName, sourceName, courseName, targets }: { sourceCohortId: string; studentId: string; studentName: string; sourceName: string; courseName: string; targets: Target[] }) {
  const [state, action] = useActionState(transferCohortStudentAction.bind(null, sourceCohortId, studentId), initial);
  return <form action={action} className="mt-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
    <p className="text-sm"><strong>學生：</strong>{studentName}</p>
    <p className="text-sm"><strong>目前班別：</strong>{sourceName}</p>
    <p className="text-sm"><strong>課程：</strong>{courseName}</p>
    <select name="target_cohort_id" aria-label={`為${studentName}選擇目標班別`} defaultValue="" required className="w-full rounded-lg border bg-white px-3 py-2 text-sm"><option value="" disabled>選擇目標班別</option>{targets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}</select>
    <p className="text-xs text-slate-700">確認後，目前報讀會改為已退出並保留歷史，目標班別會建立或恢復有效報讀；整個操作會原子化完成。</p>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmed" value="true" required /><span>我確認學生、目前班別、目標班別及上述影響。</span></label>
    <button className="rounded-lg bg-amber-700 px-3 py-2 text-sm font-semibold text-white" type="submit">確認轉班</button>
    {state.message ? <p role="status" className={state.status === 'success' ? 'text-sm text-emerald-700' : 'text-sm text-rose-700'}>{state.message}</p> : null}
  </form>;
}
