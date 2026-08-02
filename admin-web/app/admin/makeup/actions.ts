'use server';

import { revalidatePath } from 'next/cache';
import { getOperationsContext } from '@/lib/operations/context';
import { safeOperationMessage, UserFacingOperationError, userFacingError } from '@/lib/operations/errors';

export type MakeupFormState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
};

async function requireManager() {
  const context = await getOperationsContext();
  if (!['admin', 'staff'].includes(context.role)) throw userFacingError('只有管理員或職員可以管理補課。');
  return context;
}

function normalizeMacauDateTime(value: string) {
  return value.length === 16 ? `${value}:00+08:00` : value;
}

export async function scheduleMakeupSessionAction(makeupTaskId: string, studentId: string, _prevState: MakeupFormState, formData: FormData): Promise<MakeupFormState> {
  const scheduledAt = String(formData.get('scheduled_at') ?? '').trim();
  const teacherId = String(formData.get('teacher_id') ?? '').trim() || null;
  if (!scheduledAt) return { status: 'error', message: '補課時間為必填。' };

  try {
    const context = await requireManager();
    const [{ data: task, error: taskError }, { data: student, error: studentError }, teacherResult] = await Promise.all([
      context.supabase.from('makeup_tasks').select('id,student_id,entitlement_id').eq('id', makeupTaskId).eq('organization_id', context.organizationId).maybeSingle(),
      context.supabase.from('students').select('id').eq('id', studentId).eq('organization_id', context.organizationId).maybeSingle(),
      teacherId ? context.supabase.from('teacher_profiles').select('id').eq('id', teacherId).eq('organization_id', context.organizationId).eq('is_active', true).maybeSingle() : Promise.resolve({ data: null, error: null })
    ]);
    if (taskError || studentError || teacherResult.error) throw taskError ?? studentError ?? teacherResult.error;
    if (!task || !student || task.student_id !== studentId) throw userFacingError('所選補課或學生已不存在，或不屬於目前機構，請重新選擇。');
    if (teacherId && !teacherResult.data) throw userFacingError('所選導師未啟用或不屬於目前機構，請重新選擇。');

    const { error: sessionError } = await context.supabase.from('makeup_sessions').insert({
      organization_id: context.organizationId,
      makeup_task_id: makeupTaskId,
      entitlement_id: task.entitlement_id,
      student_id: studentId,
      teacher_id: teacherId,
      scheduled_at: normalizeMacauDateTime(scheduledAt),
      status: 'scheduled',
      created_by: context.user.id,
      idempotency_key: String(formData.get('idempotency_key') ?? '').trim() || crypto.randomUUID()
    });
    if (sessionError) throw sessionError;

    const { error: updateError } = await context.supabase.from('makeup_tasks').update({ status: 'scheduled' }).eq('id', makeupTaskId).eq('organization_id', context.organizationId);
    if (updateError) throw updateError;

    revalidatePath('/admin/makeup');
    revalidatePath(`/admin/makeup/${makeupTaskId}`);
    revalidatePath('/admin/makeup/schedule');
    return { status: 'success', message: '補課預約已建立。' };
  } catch (error) {
    return { status: 'error', message: error instanceof UserFacingOperationError ? error.message : safeOperationMessage(error, '建立補課預約失敗，請稍後再試。', 'schedule-makeup') };
  }
}

export async function completeMakeupTaskAction(makeupTaskId: string): Promise<void> {
  const context = await requireManager();
  const { data: task, error: taskError } = await context.supabase.from('makeup_tasks').select('id').eq('id', makeupTaskId).eq('organization_id', context.organizationId).maybeSingle();
  if (taskError || !task) throw taskError ?? userFacingError('所選補課已不存在或不屬於目前機構。');
  const { error: taskUpdateError } = await context.supabase.from('makeup_tasks').update({ status: 'completed' }).eq('id', makeupTaskId).eq('organization_id', context.organizationId);
  if (taskUpdateError) throw taskUpdateError;
  const { error: sessionUpdateError } = await context.supabase.from('makeup_sessions').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('makeup_task_id', makeupTaskId).eq('organization_id', context.organizationId).eq('status', 'scheduled');
  if (sessionUpdateError) throw sessionUpdateError;
  revalidatePath('/admin/makeup');
  revalidatePath(`/admin/makeup/${makeupTaskId}`);
}
