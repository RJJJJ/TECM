'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyActiveStaffAccess } from '@/lib/auth/staff-access';

export type UpdateFormState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
};

const ALLOWED_STATUSES = new Set(['pending', 'confirmed', 'completed', 'cancelled']);

export async function updateBookingAction(
  bookingId: string,
  _prevState: UpdateFormState,
  formData: FormData
): Promise<UpdateFormState> {
  const status = String(formData.get('status') ?? '').trim();
  const note = String(formData.get('note') ?? '').trim();
  const bookingDate = String(formData.get('booking_date') ?? '').trim();
  const startTime = String(formData.get('start_time') ?? '').trim();
  const endTime = String(formData.get('end_time') ?? '').trim();

  if (!ALLOWED_STATUSES.has(status)) {
    return {
      status: 'error',
      message: 'Status 僅允許 pending / confirmed / completed / cancelled。'
    };
  }

  if (!bookingDate) {
    return { status: 'error', message: 'Booking date 為必填。' };
  }

  if (!startTime) {
    return { status: 'error', message: 'Start time 為必填。' };
  }

  if (!endTime) {
    return { status: 'error', message: 'End time 為必填。' };
  }

  if (startTime > endTime) {
    return { status: 'error', message: 'Start time 不可晚於 end time。' };
  }

  const supabase = createServerSupabaseClient();
  const access = await verifyActiveStaffAccess(supabase);

  if (!access.allowed) {
    await supabase.auth.signOut();
    return {
      status: 'error',
      message: '你沒有權限更新 booking。'
    };
  }

  const { data, error } = await supabase
    .from('bookings')
    .update({
      status,
      note: note || null,
      booking_date: bookingDate,
      start_time: `${startTime}:00`,
      end_time: `${endTime}:00`
    })
    .eq('id', bookingId)
    .select('id')
    .single();

  if (error || !data) {
    return {
      status: 'error',
      message: error?.message ?? '更新失敗，請稍後再試。'
    };
  }

  revalidatePath('/admin/bookings');
  revalidatePath(`/admin/bookings/${bookingId}`);

  return {
    status: 'success',
    message: 'Booking 已更新，列表與詳情資料已同步。'
  };
}
