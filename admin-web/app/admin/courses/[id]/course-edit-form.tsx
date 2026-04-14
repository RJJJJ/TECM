'use client';

import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { updateCourseAction, type UpdateCourseFormState } from './actions';

type CampusOption = {
  id: string;
  name: string;
  is_active: boolean;
};

type CourseEditable = {
  id: string;
  title: string;
  category: string | null;
  level: string | null;
  age_group: string | null;
  summary: string | null;
  schedule_text: string | null;
  campus_id: string | null;
  recommended: boolean;
  is_active: boolean;
  sort_order: number;
};

type Props = {
  course: CourseEditable;
  campuses: CampusOption[];
};

const initialState: UpdateCourseFormState = {
  status: 'idle'
};

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
    >
      {pending ? '儲存中...' : '儲存變更'}
    </button>
  );
}

function clientValidate(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim();
  const sortOrderRaw = String(formData.get('sort_order') ?? '').trim();

  if (!title) return 'Title 為必填。';
  if (sortOrderRaw && !Number.isFinite(Number(sortOrderRaw))) return 'Sort order 必須是數字。';

  return null;
}

export default function CourseEditForm({ course, campuses }: Props) {
  const formAction = updateCourseAction.bind(null, course.id);
  const [state, action] = useFormState(formAction, initialState);
  const [clientMessage, setClientMessage] = useState<string | null>(null);
  const [showSavedHint, setShowSavedHint] = useState(false);

  useEffect(() => {
    if (state.status === 'success') {
      setShowSavedHint(true);
      const timer = window.setTimeout(() => setShowSavedHint(false), 2600);
      return () => window.clearTimeout(timer);
    }

    return undefined;
  }, [state.status]);

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">課程基本資訊</h3>
        <p className="mt-1 text-xs text-slate-500">可更新 courses 全部欄位。</p>
      </div>

      <form
        action={action}
        className="space-y-4"
        onSubmit={(event) => {
          const validationMessage = clientValidate(new FormData(event.currentTarget));
          if (validationMessage) {
            event.preventDefault();
            setClientMessage(validationMessage);
            return;
          }

          setClientMessage(null);
        }}
      >
        <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label htmlFor="title" className="mb-1 block text-sm font-medium text-slate-700">
              Title
            </label>
            <input
              id="title"
              name="title"
              type="text"
              required
              maxLength={160}
              defaultValue={course.title}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
            />
          </div>

          <div>
            <label htmlFor="category" className="mb-1 block text-sm font-medium text-slate-700">
              Category
            </label>
            <input
              id="category"
              name="category"
              type="text"
              maxLength={80}
              defaultValue={course.category ?? ''}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
            />
          </div>

          <div>
            <label htmlFor="level" className="mb-1 block text-sm font-medium text-slate-700">
              Level
            </label>
            <input
              id="level"
              name="level"
              type="text"
              maxLength={80}
              defaultValue={course.level ?? ''}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
            />
          </div>

          <div>
            <label htmlFor="age_group" className="mb-1 block text-sm font-medium text-slate-700">
              Age Group
            </label>
            <input
              id="age_group"
              name="age_group"
              type="text"
              maxLength={80}
              defaultValue={course.age_group ?? ''}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
            />
          </div>

          <div>
            <label htmlFor="campus_id" className="mb-1 block text-sm font-medium text-slate-700">
              Campus
            </label>
            <select
              id="campus_id"
              name="campus_id"
              defaultValue={course.campus_id ?? ''}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
            >
              <option value="">未指定</option>
              {campuses.map((campus) => (
                <option key={campus.id} value={campus.id}>
                  {campus.name} {!campus.is_active ? '(Inactive)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="recommended" className="mb-1 block text-sm font-medium text-slate-700">
              Recommended
            </label>
            <select
              id="recommended"
              name="recommended"
              defaultValue={course.recommended ? 'true' : 'false'}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
            >
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </div>

          <div>
            <label htmlFor="is_active" className="mb-1 block text-sm font-medium text-slate-700">
              Is Active
            </label>
            <select
              id="is_active"
              name="is_active"
              defaultValue={course.is_active ? 'true' : 'false'}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>

          <div>
            <label htmlFor="sort_order" className="mb-1 block text-sm font-medium text-slate-700">
              Sort Order
            </label>
            <input
              id="sort_order"
              name="sort_order"
              type="number"
              defaultValue={course.sort_order}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
            />
          </div>

          <div className="md:col-span-2">
            <label htmlFor="summary" className="mb-1 block text-sm font-medium text-slate-700">
              Summary
            </label>
            <textarea
              id="summary"
              name="summary"
              rows={3}
              defaultValue={course.summary ?? ''}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
            />
          </div>

          <div className="md:col-span-2">
            <label htmlFor="schedule_text" className="mb-1 block text-sm font-medium text-slate-700">
              Schedule Text
            </label>
            <textarea
              id="schedule_text"
              name="schedule_text"
              rows={3}
              defaultValue={course.schedule_text ?? ''}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SaveButton />
          {clientMessage && <p className="text-sm font-medium text-rose-700">{clientMessage}</p>}
          {state.status === 'success' && <p className="text-sm font-medium text-emerald-700">{state.message}</p>}
          {state.status === 'error' && <p className="text-sm font-medium text-rose-700">{state.message}</p>}
          {showSavedHint && (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">已儲存最新資料</span>
          )}
        </div>
      </form>
    </section>
  );
}
