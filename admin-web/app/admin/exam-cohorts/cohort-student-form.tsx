'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { addCohortStudentAction, type ExamCohortFormState } from './actions';

type Option = { id: string; label: string | null };
const initial: ExamCohortFormState = { status: 'idle' };

export default function CohortStudentForm({ cohortId, students }: { cohortId: string; students: Option[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(addCohortStudentAction.bind(null, cohortId), initial);

  useEffect(() => {
    if (state.status === 'success') router.refresh();
  }, [router, state]);

  return <form action={action} className="flex flex-wrap items-center gap-3">
    <select name="student_id" aria-label="要加入的學生" defaultValue="" required className="min-w-64 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="" disabled>{students.length ? '選擇學生' : '沒有可加入的學生'}</option>{students.map(student => <option key={student.id} value={student.id}>{student.label}</option>)}</select>
    <button disabled={!students.length || pending} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300" type="submit">{pending ? '加入中…' : '加入班別'}</button>
    {students.length === 0 ? <p className="text-sm text-slate-600">所有在讀學生已加入此班別，或請先建立學生資料。</p> : null}
    {state.message ? <p role="status" className={`text-sm ${state.status === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>{state.message}</p> : null}
  </form>;
}
