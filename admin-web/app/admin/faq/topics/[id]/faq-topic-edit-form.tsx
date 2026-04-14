'use client';

import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { updateFaqTopicAction, type UpdateFaqTopicFormState } from './actions';

type TopicEditable = {
  id: string;
  name: string;
  sort_order: number;
};

type Props = {
  topic: TopicEditable;
};

const initialState: UpdateFaqTopicFormState = {
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
  const name = String(formData.get('name') ?? '').trim();
  const sortOrderRaw = String(formData.get('sort_order') ?? '').trim();

  if (!name) return 'Topic name 為必填。';

  const sortOrder = Number(sortOrderRaw || '0');
  if (!Number.isFinite(sortOrder)) return 'Sort order 必須是數字。';

  return null;
}

export default function FaqTopicEditForm({ topic }: Props) {
  const formAction = updateFaqTopicAction.bind(null, topic.id);
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
        <h3 className="text-lg font-semibold text-slate-900">編輯 FAQ Topic</h3>
        <p className="mt-1 text-xs text-slate-500">可更新 topic 名稱與排序。</p>
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
              defaultValue={topic.name}
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
              defaultValue={topic.sort_order}
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
