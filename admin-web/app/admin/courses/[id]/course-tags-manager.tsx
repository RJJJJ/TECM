'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { addCourseTagAction, deleteCourseTagAction, type CourseTagFormState } from './actions';

type CourseTag = {
  id: string;
  course_id: string;
  tag: string;
  created_at: string | null;
};

type Props = {
  courseId: string;
  tags: CourseTag[];
};

const initialState: CourseTagFormState = {
  status: 'idle'
};

function AddTagButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
    >
      {pending ? '新增中...' : '新增 Tag'}
    </button>
  );
}

export default function CourseTagsManager({ courseId, tags }: Props) {
  const formAction = addCourseTagAction.bind(null, courseId);
  const [state, action] = useFormState(formAction, initialState);
  const [clientMessage, setClientMessage] = useState<string | null>(null);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

  const normalizedTagSet = useMemo(
    () => new Set(tags.map((item) => item.tag.trim().toLocaleLowerCase())),
    [tags]
  );

  useEffect(() => {
    if (state.status === 'success') {
      setClientMessage(null);
    }
  }, [state.status]);

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">Course Tags</h3>
        <p className="mt-1 text-xs text-slate-500">查看 / 新增 / 刪除 course_tags。</p>
      </div>

      <form
        action={action}
        className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4"
        onSubmit={(event) => {
          const formData = new FormData(event.currentTarget);
          const tag = String(formData.get('tag') ?? '').trim();

          if (!tag) {
            event.preventDefault();
            setClientMessage('Tag 不可空白。');
            return;
          }

          if (normalizedTagSet.has(tag.toLocaleLowerCase())) {
            event.preventDefault();
            setClientMessage('Tag 已存在，不可重複新增。');
            return;
          }

          setClientMessage(null);
          setDeleteMessage(null);
          setDeleteError(null);
        }}
      >
        <div>
          <label htmlFor="tag" className="mb-1 block text-sm font-medium text-slate-700">
            New Tag
          </label>
          <input
            id="tag"
            name="tag"
            type="text"
            maxLength={50}
            placeholder="例如：熱門"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <AddTagButton />
          {clientMessage && <p className="text-sm font-medium text-rose-700">{clientMessage}</p>}
          {state.status === 'success' && <p className="text-sm font-medium text-emerald-700">{state.message}</p>}
          {state.status === 'error' && <p className="text-sm font-medium text-rose-700">{state.message}</p>}
        </div>
      </form>

      {tags.length === 0 && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">目前沒有 tags。</p>
      )}

      {tags.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Tag</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Created At</th>
                <th className="px-4 py-3 text-right font-medium text-slate-600">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {tags.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 text-slate-800">{item.tag}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {item.created_at ? new Date(item.created_at).toLocaleString('zh-Hant-TW') : '-'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={() => {
                        setDeleteMessage(null);
                        setDeleteError(null);
                        startDeleteTransition(async () => {
                          const result = await deleteCourseTagAction(courseId, item.id);
                          if (result.status === 'success') {
                            setDeleteMessage(result.message ?? 'Tag 已刪除。');
                          } else if (result.status === 'error') {
                            setDeleteError(result.message ?? '刪除失敗。');
                          }
                        });
                      }}
                      className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-rose-400"
                    >
                      {isDeleting ? '刪除中...' : '刪除'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleteMessage && <p className="text-sm font-medium text-emerald-700">{deleteMessage}</p>}
      {deleteError && <p className="text-sm font-medium text-rose-700">{deleteError}</p>}
    </section>
  );
}
