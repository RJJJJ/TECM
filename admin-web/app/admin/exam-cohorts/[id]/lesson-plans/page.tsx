import { createServerSupabaseClient } from '@/lib/supabase/server';
import { saveLessonPlanAction } from '../../actions';

type LessonPlan = {
  sequence_no: number;
  title: string | null;
  teaching_content: string | null;
  makeup_guidance: string | null;
};

export default async function LessonPlanEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from('lesson_plans')
    .select('sequence_no,title,teaching_content,makeup_guidance')
    .eq('cohort_id', id)
    .order('sequence_no');

  const existing = new Map((data ?? []).map((row) => [(row as LessonPlan).sequence_no, row as LessonPlan]));
  async function saveAction(formData: FormData) {
    'use server';
    await saveLessonPlanAction(id, { status: 'idle' }, formData);
  }

  return (
    <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">LessonPlanEditor</p>
        <h2 className="text-2xl font-semibold text-slate-900">12 lesson plan editor</h2>
        <p className="mt-1 text-sm text-slate-600">Define each lesson content and makeup guidance for missed lessons.</p>
      </div>

      <form action={saveAction} className="space-y-4">
        {Array.from({ length: 12 }, (_, index) => {
          const sequenceNo = index + 1;
          const row = existing.get(sequenceNo);
          return (
            <div key={sequenceNo} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <h3 className="font-semibold text-slate-900">Lesson {sequenceNo}</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <input
                  name={`title_${sequenceNo}`}
                  defaultValue={row?.title ?? `Lesson ${sequenceNo}`}
                  className="rounded-lg border px-3 py-2 text-sm"
                  placeholder="Title"
                />
                <textarea
                  name={`teaching_content_${sequenceNo}`}
                  defaultValue={row?.teaching_content ?? ''}
                  className="min-h-24 rounded-lg border px-3 py-2 text-sm md:col-span-1"
                  placeholder="Teaching content"
                />
                <textarea
                  name={`makeup_guidance_${sequenceNo}`}
                  defaultValue={row?.makeup_guidance ?? ''}
                  className="min-h-24 rounded-lg border px-3 py-2 text-sm md:col-span-1"
                  placeholder="Makeup guidance"
                />
              </div>
            </div>
          );
        })}

        <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white" type="submit">
          Save lesson plans
        </button>
      </form>
    </section>
  );
}
