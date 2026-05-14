'use client';

import { useFormState, useFormStatus } from 'react-dom';
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
      {pending ? 'Creating...' : 'Create session'}
    </button>
  );
}

export function LessonSessionCreateForm({ cohortId, lessons, teachers }: LessonSessionCreateFormProps) {
  const [state, action] = useFormState(createLessonSessionAction.bind(null, cohortId), initialState);

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

      <select name="lesson_plan_id" className="rounded-lg border px-3 py-2 text-sm md:col-span-2" required defaultValue="">
        <option value="" disabled>
          Select lesson
        </option>
        {lessons.map((lesson) => (
          <option key={lesson.id} value={lesson.id}>
            Lesson {lesson.sequence_no}: {lesson.title}
          </option>
        ))}
      </select>
      <select name="teacher_id" className="rounded-lg border px-3 py-2 text-sm" required defaultValue="">
        <option value="" disabled>
          Select teacher
        </option>
        {teachers.map((teacher) => (
          <option key={teacher.id} value={teacher.id}>
            {teacher.display_name}
          </option>
        ))}
      </select>
      <input name="starts_at" type="datetime-local" className="rounded-lg border px-3 py-2 text-sm" required />
      <input name="ends_at" type="datetime-local" className="rounded-lg border px-3 py-2 text-sm" required />
      <select name="status" className="rounded-lg border px-3 py-2 text-sm" defaultValue="scheduled">
        <option value="scheduled">Scheduled</option>
        <option value="completed">Completed</option>
        <option value="cancelled">Cancelled</option>
      </select>
      <SubmitButton />
    </form>
  );
}
