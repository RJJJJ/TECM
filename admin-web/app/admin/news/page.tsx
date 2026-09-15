import Link from 'next/link';
import { getOperationsContext } from '@/lib/operations/context';
import { EmptyState, ErrorState } from '@/components/operations-ui';
import NewsCreateForm from './news-create-form';

type NewsItemRow = {
  id: string;
  category: string | null;
  title: string;
  summary: string | null;
  content: string | null;
  is_featured: boolean;
  is_active: boolean;
  published_at: string;
  sort_order: number;
  updated_at: string;
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

function activeBadge(isActive: boolean) {
  if (isActive) {
    return 'inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700';
  }

  return 'inline-flex rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600';
}

function featuredBadge(isFeatured: boolean) {
  if (isFeatured) {
    return 'inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700';
  }

  return 'inline-flex rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600';
}

export default async function AdminNewsPage() {
  const { supabase, organizationId } = await getOperationsContext();

  const { data, error } = await supabase
    .from('news_items')
    .select('id, category, title, summary, content, is_featured, is_active, published_at, sort_order, updated_at')
    .eq('organization_id', organizationId)
    .order('published_at', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('updated_at', { ascending: false });

  const newsItems = (data ?? []) as NewsItemRow[];

  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">最新消息管理</h2>
          <p className="mt-1 text-sm text-slate-600">管理首頁公告及發布次序。</p>
        </div>
        <NewsCreateForm />
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-slate-900">消息列表</h3>
          <p className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">共 {newsItems.length} 筆</p>
        </div>

        {error && (
            <ErrorState error={error} fallback="讀取最新消息失敗，請稍後再試。" />
        )}

        {!error && newsItems.length === 0 && (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
            目前尚無最新消息，請先建立第一則。
          </p>
        )}

        {!error && newsItems.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">標題</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">類別</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">置頂</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">狀態</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">發布時間</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">排序</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">更新時間</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {newsItems.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 text-slate-900">
                      <p className="font-medium">{item.title}</p>
                      {(item.summary || item.content) && (
                        <p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.summary ?? item.content}</p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{item.category ?? '-'}</td>
                    <td className="px-4 py-3">
                      <span className={featuredBadge(item.is_featured)}>{item.is_featured ? '是' : '否'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={activeBadge(item.is_active)}>{item.is_active ? '啟用' : '停用'}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDateTime(item.published_at)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{item.sort_order}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDateTime(item.updated_at)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Link
                        href={`/admin/news/${item.id}`}
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
      </section>
    </div>
  );
}
