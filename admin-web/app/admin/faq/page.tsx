import Link from 'next/link';
import { getOperationsContext } from '@/lib/operations/context';
import { ErrorState } from '@/components/operations-ui';
import FaqTopicCreateForm from './faq-topic-create-form';
import FaqItemCreateForm from './faq-item-create-form';

type FaqTopicRow = {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
};

type FaqItemRow = {
  id: string;
  topic_id: string;
  question: string;
  is_popular: boolean;
  is_active: boolean;
  sort_order: number;
  updated_at: string | null;
  faq_topics: {
    id: string;
    name: string;
    sort_order: number;
  } | null;
};

function formatDateTime(dateValue: string | null) {
  if (!dateValue) return '-';

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return dateValue;

  return new Intl.DateTimeFormat('zh-Hant-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function boolBadge(value: boolean) {
  if (value) {
    return (
      <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
        是
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
        否
    </span>
  );
}

export default async function AdminFaqPage() {
  const { supabase, organizationId } = await getOperationsContext();

  const [{ data: topicData, error: topicError }, { data: itemData, error: itemError }] = await Promise.all([
    supabase
      .from('faq_topics')
      .select('id, name, sort_order, created_at')
      .eq('organization_id', organizationId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('faq_items')
      .select('id, topic_id, question, is_popular, is_active, sort_order, updated_at, faq_topics(id, name, sort_order)')
      .eq('organization_id', organizationId)
      .order('sort_order', { ascending: true })
      .order('updated_at', { ascending: false })
  ]);

  const topics = (topicData ?? []) as FaqTopicRow[];
  const items = ((itemData ?? []) as unknown as FaqItemRow[]).sort((a, b) => {
    const topicSortA = a.faq_topics?.sort_order ?? Number.MAX_SAFE_INTEGER;
    const topicSortB = b.faq_topics?.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (topicSortA !== topicSortB) return topicSortA - topicSortB;

    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;

    const updatedA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const updatedB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    return updatedB - updatedA;
  });

  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">常見問題分類</h2>
          <p className="mt-1 text-sm text-slate-600">建立常見問題分類及排序。</p>
        </div>
        <FaqTopicCreateForm />

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-slate-900">分類列表</h3>
            <p className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">共 {topics.length} 筆</p>
          </div>

          {topicError && (
            <ErrorState error={topicError} fallback="讀取常見問題分類失敗，請稍後再試。" />
          )}

          {!topicError && topics.length === 0 && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
              目前尚無常見問題分類，請先新增第一個分類。
            </p>
          )}

          {!topicError && topics.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">名稱</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">排序</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">建立時間</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-600">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {topics.map((topic) => (
                    <tr key={topic.id}>
                      <td className="px-4 py-3 text-slate-900">
                        <p className="font-medium">{topic.name}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{topic.sort_order}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDateTime(topic.created_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Link
                          href={`/admin/faq/topics/${topic.id}`}
                          className="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                        >
                          編輯
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">常見問題</h2>
          <p className="mt-1 text-sm text-slate-600">建立問答、熱門與啟用狀態。</p>
        </div>

        {topics.length === 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-4 text-sm text-amber-700">
            請先建立至少一個 FAQ topic，才能新增 FAQ item。
          </p>
        ) : (
          <FaqItemCreateForm topics={topics.map((topic) => ({ id: topic.id, name: topic.name }))} />
        )}

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-slate-900">問題列表</h3>
            <p className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">共 {items.length} 筆</p>
          </div>

          {itemError && (
            <ErrorState error={itemError} fallback="讀取常見問題失敗，請稍後再試。" />
          )}

          {!itemError && items.length === 0 && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
              目前尚無 FAQ item，請先新增第一筆。
            </p>
          )}

          {!itemError && items.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">分類</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">問題</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">熱門</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">狀態</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">排序</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">更新時間</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-600">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3 text-slate-700">{item.faq_topics?.name ?? '-'}</td>
                      <td className="px-4 py-3 text-slate-900">
                        <p className="max-w-[440px] truncate font-medium">{item.question}</p>
                      </td>
                      <td className="px-4 py-3">{boolBadge(item.is_popular)}</td>
                      <td className="px-4 py-3">{boolBadge(item.is_active)}</td>
                      <td className="px-4 py-3 text-slate-700">{item.sort_order}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDateTime(item.updated_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Link
                          href={`/admin/faq/items/${item.id}`}
                          className="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                        >
                          編輯
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
