import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOperationsContext } from '@/lib/operations/context';
import { ErrorState } from '@/components/operations-ui';
import NewsEditForm from './news-edit-form';

type NewsDetail = {
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
  created_at: string;
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

export default async function NewsDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, organizationId } = await getOperationsContext();

  const { data, error } = await supabase
    .from('news_items')
    .select(
      'id, category, title, summary, content, image_url, is_featured, is_active, published_at, sort_order, created_at, updated_at'
    )
    .eq('id', id)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error) {
    return <ErrorState error={error} fallback="讀取最新消息失敗，請稍後再試。" />;
  }

  if (!data) {
    notFound();
  }

  const newsItem = data as NewsDetail;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">編輯最新消息</h2>
          <p className="mt-1 text-sm text-slate-600">管理發布內容及顯示狀態。</p>
        </div>
        <Link
          href="/admin/news"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          返回列表
        </Link>
      </div>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">發布摘要</h3>
        <dl className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-4 text-sm md:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">建立時間</dt>
            <dd className="mt-1 text-slate-800">{formatDateTime(newsItem.created_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">更新時間</dt>
            <dd className="mt-1 text-slate-800">{formatDateTime(newsItem.updated_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">發布時間</dt>
            <dd className="mt-1 text-slate-800">{formatDateTime(newsItem.published_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">排序</dt>
            <dd className="mt-1 text-slate-800">{newsItem.sort_order}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">置頂</dt>
            <dd className="mt-1 text-slate-800">{newsItem.is_featured ? '是' : '否'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">狀態</dt>
            <dd className="mt-1 text-slate-800">{newsItem.is_active ? '啟用' : '停用'}</dd>
          </div>
        </dl>
      </section>

      <NewsEditForm newsItem={newsItem} />
    </div>
  );
}
