'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { createLessonSessionAction, type ExamCohortFormState } from '../../actions';

type LessonPlanOption = {
  id: string;
  sequence_no: number;
  title: string;
};

type TeacherOption = {
  id: string;
  display_name: string;
};

type LessonSessionCreateFormProps = {
  cohortId: string;
  lessons: LessonPlanOption[];
  teachers: TeacherOption[];
};

const initialState: ExamCohortFormState = {
  status: 'idle'
};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 md:col-span-4"
      disabled={pending}
      type="submit"
    >
      {pending ? '建立中…' : '建立未來課堂'}
    </button>
  );
}

export function LessonSessionCreateForm({ cohortId, lessons, teachers }: LessonSessionCreateFormProps) {
  const router = useRouter();
  const [state, action] = useActionState(createLessonSessionAction.bind(null, cohortId), initialState);

  useEffect(() => {
    if (state.status === 'success') router.refresh();
  }, [router, state]);

  return (
    <form action={action} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-5">
      {state.status !== 'idle' && state.message ? (
        <p
          className={`rounded-lg border px-3 py-2 text-sm md:col-span-5 ${
            state.status === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
        >
          {state.message}
        </p>
      ) : null}

      <select aria-label="教案" name="lesson_plan_id" className="rounded-lg border px-3 py-2 text-sm md:col-span-2" required defaultValue="">
        <option value="" disabled>
          選擇教案
        </option>
        {lessons.map((lesson) => (
          <option key={lesson.id} value={lesson.id}>
            第 {lesson.sequence_no} 堂：{lesson.title}
          </option>
        ))}
      </select>
      <select aria-label="導師" name="teacher_id" className="rounded-lg border px-3 py-2 text-sm" required defaultValue="">
        <option value="" disabled>
          選擇導師
        </option>
        {teachers.map((teacher) => (
          <option key={teacher.id} value={teacher.id}>
            {teacher.display_name}
          </option>
        ))}
      </select>
      <input aria-label="開始時間" name="starts_at" type="datetime-local" className="rounded-lg border px-3 py-2 text-sm" required />
      <input aria-label="結束時間" name="ends_at" type="datetime-local" className="rounded-lg border px-3 py-2 text-sm" required />
      <select aria-label="課堂狀態" name="status" className="rounded-lg border px-3 py-2 text-sm" defaultValue="scheduled">
        <option value="scheduled">已排課</option>
        <option value="completed">已完成</option>
        <option value="cancelled">已取消</option>
      </select>
      <SubmitButton />
    </form>
  );
}
