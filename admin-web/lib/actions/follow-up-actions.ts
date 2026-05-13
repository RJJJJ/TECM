'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyActiveStaffAccess } from '@/lib/auth/staff-access';

async function updateFollowUpTaskStatus(
  taskId: string,
  bookingId: string | null,
  status: 'done' | 'dismissed'
) {
  const supabase = createServerSupabaseClient();
  const access = await verifyActiveStaffAccess(supabase);

  if (!access.allowed) {
    await supabase.auth.signOut();
    throw new Error('Not allowed to update follow-up tasks');
  }

  const timestampField = status === 'done' ? 'completed_at' : 'dismissed_at';
  const resetField = status === 'done' ? 'dismissed_at' : 'completed_at';
  let query = supabase
    .from('follow_up_tasks')
    .update({
      status,
      [timestampField]: new Date().toISOString(),
      [resetField]: null
    })
    .eq('id', taskId);

  if (bookingId) {
    query = query.eq('booking_id', bookingId);
  }

  const { data, error } = await query.select('booking_id').maybeSingle();

  if (error || !data) {
    throw new Error(error?.message ?? 'Follow-up task not found');
  }

  revalidatePath('/admin/bookings');
  revalidatePath('/admin/follow-ups');
  revalidatePath(`/admin/bookings/${data.booking_id}`);
}

export async function markFollowUpTaskDoneAction(taskId: string, bookingId?: string | null) {
  await updateFollowUpTaskStatus(taskId, bookingId ?? null, 'done');
}

export async function dismissFollowUpTaskAction(taskId: string, bookingId?: string | null) {
  await updateFollowUpTaskStatus(taskId, bookingId ?? null, 'dismissed');
}
