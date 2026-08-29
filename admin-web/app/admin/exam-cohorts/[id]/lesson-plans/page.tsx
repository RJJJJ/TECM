import Link from 'next/link';
import { getOperationsContext } from '@/lib/operations/context';
import { ErrorState, PageHeader } from '@/components/operations-ui';
import LessonPlanForm from './lesson-plan-form';

type LessonPlan = { sequence_no: number; title: string | null; teaching_content: string | null; makeup_guidance: string | null };

export default async function LessonPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, organizationId } = await getOperationsContext();
  const { data, error } = await supabase.from('lesson_plans').select('sequence_no,title,teaching_content,makeup_guidance').eq('organization_id', organizationId).eq('cohort_id', id).order('sequence_no');
  if (error) return <ErrorState error={error} fallback="讀取教案失敗，請稍後再試。" />;
  const existing = (data ?? []) as LessonPlan[];
  return <section className="space-y-5"><PageHeader title="編輯教案" description="為每一堂課填寫教學內容及補課提示，完成後即可安排未來課堂。" action={<Link className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" href={`/admin/exam-cohorts/${id}`}>返回班別</Link>} /><LessonPlanForm cohortId={id} existing={existing} /></section>;
}
