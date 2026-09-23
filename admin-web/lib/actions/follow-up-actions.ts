'use server';

import { revalidatePath } from 'next/cache';
import { getOperationsContext } from '@/lib/operations/context';
import { safeOperationMessage, UserFacingOperationError, userFacingError } from '@/lib/operations/errors';

function safeActionError(error: unknown) {
  return error instanceof UserFacingOperationError ? error : userFacingError(safeOperationMessage(error, '更新跟進事項失敗，請稍後再試。', 'update-follow-up'));
}

async function updateFollowUpTaskStatus(
  taskId: string,
  bookingId: string | null,
  status: 'done' | 'dismissed',
  outcome?: string
) {
  try {
    const context = await getOperationsContext();
    if (!['admin', 'staff'].includes(context.role)) throw userFacingError('只有管理員或職員可以更新跟進事項。');
    const { supabase, organizationId } = context;
    let taskQuery = supabase
      .from('follow_up_tasks')
      .select('id,booking_id')
      .eq('organization_id', organizationId)
      .eq('id', taskId);
    if (bookingId) taskQuery = taskQuery.eq('booking_id', bookingId);
    const { data: task, error: taskError } = await taskQuery.maybeSingle();
    if (taskError) throw taskError;
    if (!task) throw userFacingError('找不到跟進事項。');

  if (status === 'done') {
    const { error } = await supabase.rpc('complete_follow_up_task', {
      target_task_id: taskId,
      target_outcome: outcome || null
    });
    if (error) throw error;
  } else {
    let query = supabase
      .from('follow_up_tasks')
      .update({ status: 'dismissed', dismissed_at: new Date().toISOString(), completed_at: null })
      .eq('organization_id', organizationId)
      .eq('id', taskId);
    if (bookingId) query = query.eq('booking_id', bookingId);
    const { error } = await query;
    if (error) throw error;
  }

    revalidatePath('/admin/bookings');
    revalidatePath('/admin/follow-ups');
    revalidatePath('/admin/dashboard');
    if (task.booking_id) revalidatePath(`/admin/bookings/${task.booking_id}`);
  } catch (error) {
    throw safeActionError(error);
  }
}

export async function markFollowUpTaskDoneAction(taskId: string, bookingId?: string | null, formData?: FormData) {
  const outcome = formData ? String(formData.get('outcome') ?? '').trim() : '';
  await updateFollowUpTaskStatus(taskId, bookingId ?? null, 'done', outcome);
}

export async function dismissFollowUpTaskAction(taskId: string, bookingId?: string | null) {
  await updateFollowUpTaskStatus(taskId, bookingId ?? null, 'dismissed');
}
