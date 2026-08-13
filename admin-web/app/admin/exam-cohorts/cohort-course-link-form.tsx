'use client';

import { useActionState, useState } from 'react';
import { linkCohortCourseAction, type ExamCohortFormState } from './actions';

type CourseOption = { id: string; title: string; category: string | null; level: string | null };
const initial: ExamCohortFormState = { status: 'idle' };

export default function CohortCourseLinkForm({ cohortId, cohortSummary, courses }: { cohortId: string; cohortSummary: string; courses: CourseOption[] }) {
  const [state, action] = useActionState(linkCohortCourseAction.bind(null, cohortId), initial);
  const [courseId, setCourseId] = useState('');
  const selected = courses.find(course => course.id === courseId);
  return <form action={action} className="space-y-3">
    <p className="text-sm text-slate-700">現有班別：{cohortSummary}</p>
    <select name="course_id" aria-label="連結的課程" value={courseId} onChange={event => setCourseId(event.target.value)} required className="w-full rounded-lg border px-3 py-2 text-sm"><option value="" disabled>選擇同機構的啟用課程</option>{courses.map(course => <option key={course.id} value={course.id}>{course.title} · {course.category ?? '未設定類別'} · {course.level ?? '未設定程度'}</option>)}</select>
    {selected ? <p className="rounded-lg bg-slate-50 p-3 text-sm"><strong>{selected.title}</strong> · {selected.category ?? '類別未設定'}／{selected.level ?? '程度未設定'}</p> : null}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmed" value="true" required /><span>我已核對課程及現有班別資料，確認建立此課程連結。連結後不能用普通表單更改。</span></label>
    <button className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white" type="submit">確認連結課程</button>
    {state.message ? <p role="status" className={state.status === 'success' ? 'text-sm text-emerald-700' : 'text-sm text-rose-700'}>{state.message}</p> : null}
  </form>;
}
