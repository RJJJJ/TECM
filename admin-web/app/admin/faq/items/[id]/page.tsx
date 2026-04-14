import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import FaqItemEditForm from './faq-item-edit-form';

type TopicOption = {
  id: string;
  name: string;
};

type FaqItemDetail = {
  id: string;
  topic_id: string;
  question: string;
  answer: string;
  is_popular: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
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

export default async function FaqItemDetailPage({
  params
}: {
  params: { id: string };
}) {
  const supabase = createServerSupabaseClient();

  const [{ data: itemData, error: itemError }, { data: topicData, error: topicError }] = await Promise.all([
    supabase
      .from('faq_items')
      .select('id, topic_id, question, answer, is_popular, is_active, sort_order, created_at, updated_at')
      .eq('id', params.id)
      .maybeSingle(),
    supabase.from('faq_topics').select('id, name').order('sort_order', { ascending: true }).order('created_at', { ascending: true })
  ]);

  if (itemError) {
    return (
      <section className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        讀取 FAQ item 失敗：{itemError.message}
      </section>
    );
  }

  if (topicError) {
    return (
      <section className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        讀取 FAQ topics 失敗：{topicError.message}
      </section>
    );
  }

  if (!itemData) {
    notFound();
  }

  const topics = (topicData ?? []) as TopicOption[];

  if (topics.length === 0) {
    return (
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-700">
        目前沒有可用 FAQ topic，請先回 FAQ 管理頁建立 topic。
      </section>
    );
  }

  const item = itemData as FaqItemDetail;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">FAQ Item Detail</h2>
          <p className="mt-1 text-sm text-slate-600">Item ID: {item.id}</p>
        </div>
        <Link
          href="/admin/faq"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          返回 FAQ 管理頁
        </Link>
      </div>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Metadata</h3>
        <dl className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-4 text-sm md:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">created_at</dt>
            <dd className="mt-1 text-slate-800">{formatDateTime(item.created_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">updated_at</dt>
            <dd className="mt-1 text-slate-800">{formatDateTime(item.updated_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">is_popular</dt>
            <dd className="mt-1 text-slate-800">{item.is_popular ? 'true' : 'false'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">is_active</dt>
            <dd className="mt-1 text-slate-800">{item.is_active ? 'true' : 'false'}</dd>
          </div>
        </dl>
      </section>

      <FaqItemEditForm item={item} topics={topics} />
    </div>
  );
}
