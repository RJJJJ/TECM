'use server';

import { revalidatePath } from 'next/cache';
import { getOperationsContext } from '@/lib/operations/context';

async function updateFollowUpTaskStatus(
  taskId: string,
  bookingId: string | null,
  status: 'done' | 'dismissed',
  outcome?: string
) {
  const { supabase, organizationId } = await getOperationsContext();
  const { data: task, error: taskError } = await supabase
    .from('follow_up_tasks')
    .select('id,booking_id')
    .eq('organization_id', organizationId)
    .eq('id', taskId)
    .maybeSingle();
  if (taskError || !task) throw new Error(taskError?.message ?? '找不到跟進事項。');

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
}

export async function markFollowUpTaskDoneAction(taskId: string, bookingId?: string | null, formData?: FormData) {
  const outcome = formData ? String(formData.get('outcome') ?? '').trim() : '';
  await updateFollowUpTaskStatus(taskId, bookingId ?? null, 'done', outcome);
}

export async function dismissFollowUpTaskAction(taskId: string, bookingId?: string | null) {
  await updateFollowUpTaskStatus(taskId, bookingId ?? null, 'dismissed');
}
