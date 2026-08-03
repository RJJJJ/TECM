'use client';

import { useActionState } from 'react';
import { saveLessonPlanAction, type ExamCohortFormState } from '../../actions';

type LessonPlan = { sequence_no: number; title: string | null; teaching_content: string | null; makeup_guidance: string | null };
const initial: ExamCohortFormState = { status: 'idle' };
const field = 'rounded-lg border border-slate-300 px-3 py-2 text-sm';

export default function LessonPlanForm({ cohortId, existing }: { cohortId: string; existing: LessonPlan[] }) {
  const [state, action] = useActionState(saveLessonPlanAction.bind(null, cohortId), initial);
  const bySequence = new Map(existing.map(row => [row.sequence_no, row]));
  return <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    {Array.from({ length: 12 }, (_, index) => { const sequenceNo = index + 1; const row = bySequence.get(sequenceNo); return <div key={sequenceNo} className="rounded-lg border border-slate-200 bg-slate-50 p-4"><h2 className="font-semibold text-slate-900">第 {sequenceNo} 堂</h2><div className="mt-3 grid gap-3 md:grid-cols-3"><input aria-label={`第 ${sequenceNo} 堂名稱`} name={`title_${sequenceNo}`} defaultValue={row?.title ?? `第 ${sequenceNo} 堂`} className={field} placeholder="課堂名稱" /><textarea aria-label={`第 ${sequenceNo} 堂教學內容`} name={`teaching_content_${sequenceNo}`} defaultValue={row?.teaching_content ?? ''} className={`min-h-24 ${field}`} placeholder="教學內容" /><textarea aria-label={`第 ${sequenceNo} 堂補課提示`} name={`makeup_guidance_${sequenceNo}`} defaultValue={row?.makeup_guidance ?? ''} className={`min-h-24 ${field}`} placeholder="補課提示" /></div></div>; })}
    <div className="flex items-center gap-3"><button className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white" type="submit">儲存教案</button>{state.message ? <p role="status" className={`text-sm ${state.status === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>{state.message}</p> : null}</div>
  </form>;
}
