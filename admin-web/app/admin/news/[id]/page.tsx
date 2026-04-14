import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
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
  params: { id: string };
}) {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from('news_items')
    .select(
      'id, category, title, summary, content, image_url, is_featured, is_active, published_at, sort_order, created_at, updated_at'
    )
    .eq('id', params.id)
    .maybeSingle();

  if (error) {
    return (
      <section className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        讀取 news 失敗：{error.message}
      </section>
    );
  }

  if (!data) {
    notFound();
  }

  const newsItem = data as NewsDetail;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">News Edit</h2>
          <p className="mt-1 text-sm text-slate-600">News ID: {newsItem.id}</p>
        </div>
        <Link
          href="/admin/news"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          返回列表
        </Link>
      </div>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Metadata</h3>
        <dl className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-4 text-sm md:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">created_at</dt>
            <dd className="mt-1 text-slate-800">{formatDateTime(newsItem.created_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">updated_at</dt>
            <dd className="mt-1 text-slate-800">{formatDateTime(newsItem.updated_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">published_at</dt>
            <dd className="mt-1 text-slate-800">{formatDateTime(newsItem.published_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">sort_order</dt>
            <dd className="mt-1 text-slate-800">{newsItem.sort_order}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">is_featured</dt>
            <dd className="mt-1 text-slate-800">{newsItem.is_featured ? 'true' : 'false'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">is_active</dt>
            <dd className="mt-1 text-slate-800">{newsItem.is_active ? 'true' : 'false'}</dd>
          </div>
        </dl>
      </section>

      <NewsEditForm newsItem={newsItem} />
    </div>
  );
}
