'use client';

import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { createCourseAction, type CreateCourseFormState } from './actions';

type CampusOption = {
  id: string;
  name: string;
  is_active: boolean;
};

type Props = {
  campuses: CampusOption[];
};

const initialState: CreateCourseFormState = {
  status: 'idle'
};

function CreateButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
    >
      {pending ? '新增中...' : '新增課程'}
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

export default function CourseCreateForm({ campuses }: Props) {
  const [state, action] = useFormState(createCourseAction, initialState);
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
            placeholder="請輸入課程名稱"
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
            placeholder="例如：Robotics"
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
            placeholder="例如：Beginner"
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
            placeholder="例如：7-10"
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
            defaultValue=""
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
            defaultValue="false"
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
            defaultValue="true"
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
            defaultValue="0"
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
            placeholder="課程摘要（可選）"
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
            placeholder="例如：週六 10:00-12:00"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <CreateButton />
        {clientMessage && <p className="text-sm font-medium text-rose-700">{clientMessage}</p>}
        {state.status === 'success' && <p className="text-sm font-medium text-emerald-700">{state.message}</p>}
        {state.status === 'error' && <p className="text-sm font-medium text-rose-700">{state.message}</p>}
        {showSavedHint && (
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">已新增</span>
        )}
      </div>
    </form>
  );
}
