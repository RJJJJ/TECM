'use client';

import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { createNewsAction, type CreateNewsFormState } from './actions';

const initialState: CreateNewsFormState = {
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
      {pending ? '新增中...' : '新增 News'}
    </button>
  );
}

function clientValidate(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim();
  if (!title) return 'Title 為必填。';

  const publishedAt = String(formData.get('published_at') ?? '').trim();
  if (!publishedAt) return 'Publish date 為必填。';

  return null;
}

export default function NewsCreateForm() {
  const [state, action] = useFormState(createNewsAction, initialState);
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
            placeholder="請輸入 news title"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
          />
        </div>

        <div>
          <label htmlFor="published_at" className="mb-1 block text-sm font-medium text-slate-700">
            Publish Date
          </label>
          <input
            id="published_at"
            name="published_at"
            type="datetime-local"
            required
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
          />
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

        <div className="md:col-span-2">
          <label htmlFor="summary" className="mb-1 block text-sm font-medium text-slate-700">
            Summary
          </label>
          <textarea
            id="summary"
            name="summary"
            rows={3}
            placeholder="可選，簡短摘要"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
          />
        </div>

        <div className="md:col-span-2">
          <label htmlFor="content" className="mb-1 block text-sm font-medium text-slate-700">
            Content
          </label>
          <textarea
            id="content"
            name="content"
            rows={5}
            placeholder="可選，詳細內容"
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
