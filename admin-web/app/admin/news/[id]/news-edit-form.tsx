'use client';

import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { updateNewsAction, type UpdateNewsFormState } from './actions';

type NewsEditable = {
  id: string;
  category: string | null;
  title: string;
  summary: string | null;
  content: string | null;
  image_url: string | null;
  is_featured: boolean;
  is_active: boolean;
  published_at: string;
  sort_order: number;
};

type Props = {
  newsItem: NewsEditable;
};

const initialState: UpdateNewsFormState = {
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

function normalizeDateTimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const offsetMs = date.getTimezoneOffset() * 60_000;
  const local = new Date(date.getTime() - offsetMs);
  return local.toISOString().slice(0, 16);
}

function clientValidate(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim();
  const publishedAt = String(formData.get('published_at') ?? '').trim();
  const sortOrderRaw = String(formData.get('sort_order') ?? '').trim();

  if (!title) return 'Title 為必填。';
  if (!publishedAt) return 'Publish date 為必填。';
  if (!sortOrderRaw) return 'Sort order 為必填。';
  if (!Number.isFinite(Number(sortOrderRaw))) return 'Sort order 必須是數字。';

  return null;
}

export default function NewsEditForm({ newsItem }: Props) {
  const formAction = updateNewsAction.bind(null, newsItem.id);
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
        <h3 className="text-lg font-semibold text-slate-900">編輯 News</h3>
        <p className="mt-1 text-xs text-slate-500">可更新 news_items 全部主要欄位。</p>
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
            <label htmlFor="category" className="mb-1 block text-sm font-medium text-slate-700">
              Category
            </label>
            <input
              id="category"
              name="category"
              type="text"
              maxLength={80}
              defaultValue={newsItem.category ?? ''}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
            />
          </div>

          <div>
            <label htmlFor="sort_order" className="mb-1 block text-sm font-medium text-slate-700">
              Sort Order
            </label>
            <input
              id="sort_order"
              name="sort_order"
              type="number"
              required
              defaultValue={newsItem.sort_order}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
            />
          </div>

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
              defaultValue={newsItem.title}
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
              defaultValue={normalizeDateTimeLocal(newsItem.published_at)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
            />
          </div>

          <div>
            <label htmlFor="is_featured" className="mb-1 block text-sm font-medium text-slate-700">
              Is Featured
            </label>
            <select
              id="is_featured"
              name="is_featured"
              defaultValue={newsItem.is_featured ? 'true' : 'false'}
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
              defaultValue={newsItem.is_active ? 'true' : 'false'}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label htmlFor="image_url" className="mb-1 block text-sm font-medium text-slate-700">
              Image URL
            </label>
            <input
              id="image_url"
              name="image_url"
              type="text"
              defaultValue={newsItem.image_url ?? ''}
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
              defaultValue={newsItem.summary ?? ''}
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
              rows={7}
              defaultValue={newsItem.content ?? ''}
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
