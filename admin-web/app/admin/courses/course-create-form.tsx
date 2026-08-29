'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
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

  if (!title) return '課程名稱為必填。';
  if (sortOrderRaw && !Number.isFinite(Number(sortOrderRaw))) return '排序必須是數字。';

  return null;
}

export default function CourseCreateForm({ campuses }: Props) {
  const router = useRouter();
  const [state, action] = useActionState(createCourseAction, initialState);
  const [clientMessage, setClientMessage] = useState<string | null>(null);
  const [showSavedHint, setShowSavedHint] = useState(false);

  useEffect(() => {
    if (state.status === 'success') {
      router.refresh();
      setShowSavedHint(true);
      const timer = window.setTimeout(() => setShowSavedHint(false), 2600);
      return () => window.clearTimeout(timer);
    }

    return undefined;
  }, [router, state]);

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
            課程名稱
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
            類別
          </label>
          <input
            id="category"
            name="category"
            type="text"
            maxLength={80}
            placeholder="例如：機械人編程"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
          />
        </div>

        <div>
          <label htmlFor="level" className="mb-1 block text-sm font-medium text-slate-700">
            程度
          </label>
          <input
            id="level"
            name="level"
            type="text"
            maxLength={80}
            placeholder="例如：入門"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
          />
        </div>

        <div>
          <label htmlFor="age_group" className="mb-1 block text-sm font-medium text-slate-700">
            年齡組別
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
            校區
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
                {campus.name} {!campus.is_active ? '（停用）' : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="recommended" className="mb-1 block text-sm font-medium text-slate-700">
            推薦課程
          </label>
          <select
            id="recommended"
            name="recommended"
            defaultValue="false"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
          >
            <option value="false">否</option>
            <option value="true">是</option>
          </select>
        </div>

        <div>
          <label htmlFor="is_active" className="mb-1 block text-sm font-medium text-slate-700">
            啟用狀態
          </label>
          <select
            id="is_active"
            name="is_active"
            defaultValue="true"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
          >
            <option value="true">啟用</option>
            <option value="false">停用</option>
          </select>
        </div>

        <div>
          <label htmlFor="sort_order" className="mb-1 block text-sm font-medium text-slate-700">
            排序
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
            課程摘要
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
            課堂時間說明
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
        {state.status === 'success' && <p role="status" className="text-sm font-medium text-emerald-700">{state.message}</p>}
        {state.status === 'error' && <p role="status" className="text-sm font-medium text-rose-700">{state.message}</p>}
        {showSavedHint && (
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">已新增</span>
        )}
      </div>
    </form>
  );
}
