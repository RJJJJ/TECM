'use client';

import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { updateFaqItemAction, type UpdateFaqItemFormState } from './actions';

type TopicOption = {
  id: string;
  name: string;
};

type ItemEditable = {
  id: string;
  topic_id: string;
  question: string;
  answer: string;
  is_popular: boolean;
  is_active: boolean;
  sort_order: number;
};

type Props = {
  item: ItemEditable;
  topics: TopicOption[];
};

const initialState: UpdateFaqItemFormState = {
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
  const topicId = String(formData.get('topic_id') ?? '').trim();
  const question = String(formData.get('question') ?? '').trim();
  const answer = String(formData.get('answer') ?? '').trim();
  const sortOrderRaw = String(formData.get('sort_order') ?? '').trim();

  if (!topicId) return 'Topic 為必填。';
  if (!question) return 'Question 為必填。';
  if (!answer) return 'Answer 為必填。';

  const sortOrder = Number(sortOrderRaw || '0');
  if (!Number.isFinite(sortOrder)) return 'Sort order 必須是數字。';

  return null;
}

export default function FaqItemEditForm({ item, topics }: Props) {
  const formAction = updateFaqItemAction.bind(null, item.id);
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
        <h3 className="text-lg font-semibold text-slate-900">編輯 FAQ Item</h3>
        <p className="mt-1 text-xs text-slate-500">可更新 topic、問題、答案、熱門與啟用狀態。</p>
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
            <label htmlFor="item_topic_id" className="mb-1 block text-sm font-medium text-slate-700">
              Topic
            </label>
            <select
              id="item_topic_id"
              name="topic_id"
              required
              defaultValue={item.topic_id}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
            >
              {topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="item_sort_order" className="mb-1 block text-sm font-medium text-slate-700">
              Sort Order
            </label>
            <input
              id="item_sort_order"
              name="sort_order"
              type="number"
              defaultValue={item.sort_order}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
            />
          </div>

          <div className="md:col-span-2">
            <label htmlFor="item_question" className="mb-1 block text-sm font-medium text-slate-700">
              Question
            </label>
            <input
              id="item_question"
              name="question"
              type="text"
              required
              defaultValue={item.question}
              maxLength={300}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
            />
          </div>

          <div className="md:col-span-2">
            <label htmlFor="item_answer" className="mb-1 block text-sm font-medium text-slate-700">
              Answer
            </label>
            <textarea
              id="item_answer"
              name="answer"
              required
              rows={6}
              defaultValue={item.answer}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
            />
          </div>

          <div>
            <label htmlFor="item_is_popular" className="mb-1 block text-sm font-medium text-slate-700">
              Is Popular
            </label>
            <select
              id="item_is_popular"
              name="is_popular"
              defaultValue={item.is_popular ? 'true' : 'false'}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </div>

          <div>
            <label htmlFor="item_is_active" className="mb-1 block text-sm font-medium text-slate-700">
              Is Active
            </label>
            <select
              id="item_is_active"
              name="is_active"
              defaultValue={item.is_active ? 'true' : 'false'}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
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
