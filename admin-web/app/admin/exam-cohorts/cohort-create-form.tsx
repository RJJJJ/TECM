'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createExamCohortAction, type ExamCohortFormState } from './actions';

type Option = { id: string; label: string | null };
type CourseOption = { id: string; title: string; category: string | null; level: string | null };
const initial: ExamCohortFormState = { status: 'idle' };
const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';

export default function CohortCreateForm({ teachers, courses, campuses }: { teachers: Option[]; courses: CourseOption[]; campuses: Option[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createExamCohortAction, initial);
  const [courseId, setCourseId] = useState('');
  const selectedCourse = courses.find(course => course.id === courseId);

  useEffect(() => {
    if (state.status === 'success') router.refresh();
  }, [router, state]);

  return <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    <select className={field} name="course_id" aria-label="所屬課程" value={courseId} onChange={event => setCourseId(event.target.value)} required><option value="" disabled>選擇所屬課程</option>{courses.map(course => <option key={course.id} value={course.id}>{course.title} · {course.category ?? '未設定類別'} · {course.level ?? '未設定程度'}</option>)}</select>
    <input className={field} name="name" placeholder="班別名稱" aria-label="班別名稱" required />
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm" aria-live="polite">{selectedCourse ? <><span className="font-medium">{selectedCourse.title}</span><span className="ml-2 text-slate-600">{selectedCourse.category ?? '類別未設定'}／{selectedCourse.level ?? '程度未設定'}</span></> : <span className="text-slate-500">選擇課程後顯示名稱、類別及程度</span>}</div>
    <input className={field} name="exam_date" type="date" aria-label="考試日期" required />
    <select className={field} name="weekday_pattern" aria-label="上課日" defaultValue="" required><option value="" disabled>選擇上課日</option><option value="saturday">星期六</option><option value="sunday">星期日</option></select>
    <select className={field} name="lead_teacher_id" aria-label="導師" defaultValue=""><option value="">稍後分配導師</option>{teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.label}</option>)}</select>
    <select className={field} name="campus_id" aria-label="校區" defaultValue=""><option value="">未指定校區</option>{campuses.map(campus => <option key={campus.id} value={campus.id}>{campus.label}</option>)}</select>
    <select className={field} name="status" aria-label="班別狀態" defaultValue="active"><option value="active">使用中（可招生）</option><option value="draft">草稿</option></select>
    {teachers.length === 0 ? <p className="text-sm text-amber-700 sm:col-span-2 lg:col-span-3">目前沒有可選導師；你可以先建立班別，稍後在設定導師後再安排課堂。</p> : null}
    {courses.length === 0 ? <p className="text-sm text-amber-700 sm:col-span-2 lg:col-span-3">目前沒有資料完整的啟用課程，請先建立或更新課程。</p> : null}
    <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3"><button disabled={!courses.length || pending} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300" type="submit">{pending ? '建立中…' : '建立班別'}</button>{state.message ? <p role="status" className={`text-sm ${state.status === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>{state.message}</p> : null}</div>
  </form>;
}
