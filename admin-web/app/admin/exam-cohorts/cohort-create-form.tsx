'use client';

import { useActionState } from 'react';
import { createExamCohortAction, type ExamCohortFormState } from './actions';

type Option = { id: string; label: string | null };
const initial: ExamCohortFormState = { status: 'idle' };
const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';

export default function CohortCreateForm({ teachers }: { teachers: Option[] }) {
  const [state, action] = useActionState(createExamCohortAction, initial);
  return <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    <input className={field} name="name" placeholder="班別名稱" aria-label="班別名稱" required />
    <select className={field} name="subject" aria-label="科目" defaultValue="" required><option value="" disabled>選擇科目</option><option value="Python">Python</option><option value="Scratch">Scratch</option><option value="C++">C++</option></select>
    <input className={field} name="level" placeholder="程度，例如：入門" aria-label="程度" required />
    <input className={field} name="exam_date" type="date" aria-label="考試日期" required />
    <select className={field} name="weekday_pattern" aria-label="上課日" defaultValue="" required><option value="" disabled>選擇上課日</option><option value="saturday">星期六</option><option value="sunday">星期日</option></select>
    <select className={field} name="lead_teacher_id" aria-label="導師" defaultValue=""><option value="">稍後分配導師</option>{teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.label}</option>)}</select>
    {teachers.length === 0 ? <p className="text-sm text-amber-700 sm:col-span-2 lg:col-span-3">目前沒有可選導師；你可以先建立班別，稍後在設定導師後再安排課堂。</p> : null}
    <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3"><button className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white" type="submit">建立班別</button>{state.message ? <p role="status" className={`text-sm ${state.status === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>{state.message}</p> : null}</div>
  </form>;
}
