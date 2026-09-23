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
  const teacherId = String(formData.get('teacher_id') ?? '').trim();
  const idempotencyKey = String(formData.get('idempotency_key') ?? '').trim();
  if (!scheduledAt) return { status: 'error', message: '補課時間為必填。' };
  if (!teacherId) return { status: 'error', message: '請先選擇補課導師。' };
  if (!idempotencyKey) return { status: 'error', message: '補課操作識別碼遺失，請重新載入頁面再試。' };

  try {
    const context = await requireManager();
    const [{ data: task, error: taskError }, { data: student, error: studentError }] = await Promise.all([
      context.supabase.from('makeup_tasks').select('id,student_id,entitlement_id').eq('id', makeupTaskId).eq('organization_id', context.organizationId).maybeSingle(),
      context.supabase.from('students').select('id').eq('id', studentId).eq('organization_id', context.organizationId).maybeSingle()
    ]);
    if (taskError || studentError) throw taskError ?? studentError;
    if (!task || !student || task.student_id !== studentId) throw userFacingError('所選補課或學生已不存在，或不屬於目前機構，請重新選擇。');
    if (!task.entitlement_id) throw userFacingError('此補課沒有可用補課額，請先重新核對請假或出席資料。');

    const { error: bookingError } = await context.supabase.rpc('book_makeup_session', {
      target_organization_id: context.organizationId,
      target_entitlement_id: task.entitlement_id,
      target_teacher_id: teacherId,
      target_scheduled_at: normalizeMacauDateTime(scheduledAt),
      target_idempotency_key: idempotencyKey
    });
    if (bookingError) throw bookingError;

    revalidatePath('/admin/makeup');
    revalidatePath(`/admin/makeup/${makeupTaskId}`);
    revalidatePath('/admin/makeup/schedule');
    return { status: 'success', message: '補課預約已建立。' };
  } catch (error) {
    return { status: 'error', message: error instanceof UserFacingOperationError ? error.message : safeOperationMessage(error, '建立補課預約失敗，請稍後再試。', 'schedule-makeup') };
  }
}

export async function completeMakeupTaskAction(makeupTaskId: string, _prevState: MakeupFormState, _formData: FormData): Promise<MakeupFormState> {
  try {
    const context = await requireManager();
    const { data, error } = await context.supabase.rpc('complete_makeup_task', { target_makeup_task_id: makeupTaskId });
    if (error) throw error;
    if (!data) throw userFacingError('補課完成操作沒有回傳結果。');
    return { status: 'success', message: data.status === 'existing' ? '補課已完成，重複提交沒有重複扣除補課額。' : '補課已完成，補課額已一次扣除。' };
  } catch (error) {
    return { status: 'error', message: error instanceof UserFacingOperationError ? error.message : safeOperationMessage(error, '完成補課失敗，請稍後再試。', 'complete-makeup') };
  }
}
