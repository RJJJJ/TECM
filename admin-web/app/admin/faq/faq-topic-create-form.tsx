'use client';

import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { createFaqTopicAction, type CreateFaqTopicFormState } from './actions';

const initialState: CreateFaqTopicFormState = {
  status: 'idle'
};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
    >
      {pending ? '新增中...' : '新增 Topic'}
    </button>
  );
}

function clientValidate(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  const sortOrderRaw = String(formData.get('sort_order') ?? '').trim();

  if (!name) return 'Topic name 為必填。';

  const sortOrder = Number(sortOrderRaw || '0');
  if (!Number.isFinite(sortOrder)) return 'Sort order 必須是數字。';

  return null;
}

export default function FaqTopicCreateForm() {
  const [state, action] = useFormState(createFaqTopicAction, initialState);
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
        <div>
          <label htmlFor="topic_name" className="mb-1 block text-sm font-medium text-slate-700">
            Topic Name
          </label>
          <input
            id="topic_name"
            name="name"
            type="text"
            required
            maxLength={120}
            placeholder="例如：課程與預約"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
          />
        </div>

        <div>
          <label htmlFor="topic_sort_order" className="mb-1 block text-sm font-medium text-slate-700">
            Sort Order
          </label>
          <input
            id="topic_sort_order"
            name="sort_order"
            type="number"
            defaultValue={0}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton />
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
