import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOperationsContext } from '@/lib/operations/context';
import { ErrorState } from '@/components/operations-ui';
import FaqTopicEditForm from './faq-topic-edit-form';

type FaqTopicDetail = {
  id: string;
  name: string;
  sort_order: number;
  created_at: string | null;
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

export default async function FaqTopicDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, organizationId } = await getOperationsContext();

  const { data, error } = await supabase
    .from('faq_topics')
    .select('id, name, sort_order, created_at')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error) {
    return <ErrorState error={error} fallback="讀取常見問題分類失敗，請稍後再試。" />;
  }

  if (!data) {
    notFound();
  }

  const topic = data as FaqTopicDetail;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">常見問題分類詳情</h2>
          <p className="mt-1 text-sm text-slate-600">管理常見問題分類及排序。</p>
        </div>
        <Link
          href="/admin/faq"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          返回 FAQ 管理頁
        </Link>
      </div>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">分類摘要</h3>
        <dl className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-4 text-sm md:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">建立時間</dt>
            <dd className="mt-1 text-slate-800">{formatDateTime(topic.created_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">排序</dt>
            <dd className="mt-1 text-slate-800">{topic.sort_order}</dd>
          </div>
        </dl>
      </section>

      <FaqTopicEditForm topic={topic} />
    </div>
  );
}
