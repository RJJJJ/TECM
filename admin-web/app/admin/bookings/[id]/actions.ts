'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getOperationsContext } from '@/lib/operations/context';
import { safeOperationMessage, UserFacingOperationError, userFacingError } from '@/lib/operations/errors';

export type UpdateFormState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
};

const ALLOWED_STATUSES = new Set(['pending', 'confirmed', 'completed', 'cancelled']);

type BookingForNotification = {
  id: string;
  parent_id: string | null;
  status: string | null;
  course_title_snapshot: string | null;
  booking_date: string | null;
  start_time: string | null;
  end_time: string | null;
  campuses: { name: string | null } | null;
};

function formatNotificationTime(timeValue: string | null) {
  return timeValue ? timeValue.slice(0, 5) : '-';
}

function buildBookingConfirmedNotificationDetail(booking: BookingForNotification) {
  const course = booking.course_title_snapshot ?? '體驗課';
  const campus = booking.campuses?.name ?? 'TECM';
  const date = booking.booking_date ?? '待確認日期';
  return `您的${course}預約已確認。地點：${campus}；日期：${date}；時間：${formatNotificationTime(booking.start_time)} - ${formatNotificationTime(booking.end_time)}。如需更改，請聯絡教育中心。`;
}

async function createBookingConfirmedParentNotification(supabase: SupabaseClient, booking: BookingForNotification, organizationId: string) {
  if (!booking.parent_id) return;
  const { data: existingBridge } = await supabase.from('booking_parent_notifications').select('id').eq('organization_id', organizationId).eq('booking_id', booking.id).eq('type', 'booking_confirmed').maybeSingle();
  if (existingBridge) return;

  const { data: notification, error: notificationError } = await supabase.from('notifications').insert({
    organization_id: organizationId,
    parent_id: booking.parent_id,
    title: '預約已確認',
    detail: buildBookingConfirmedNotificationDetail(booking),
    is_read: false
  }).select('id').single();
  if (notificationError || !notification) throw notificationError ?? new Error('parent notification insert returned no row');

  const { error: bridgeError } = await supabase.from('booking_parent_notifications').insert({
    organization_id: organizationId,
    booking_id: booking.id,
    notification_id: notification.id,
    type: 'booking_confirmed'
  });
  if (bridgeError && bridgeError.code !== '23505') throw bridgeError;
}

export async function updateBookingAction(bookingId: string, _prevState: UpdateFormState, formData: FormData): Promise<UpdateFormState> {
  const status = String(formData.get('status') ?? '').trim();
  const note = String(formData.get('note') ?? '').trim();
  const bookingDate = String(formData.get('booking_date') ?? '').trim();
  const startTime = String(formData.get('start_time') ?? '').trim();
  const endTime = String(formData.get('end_time') ?? '').trim();
  const shouldNotifyParent = formData.get('notify_parent_on_confirmed') === 'true';

  if (!ALLOWED_STATUSES.has(status)) return { status: 'error', message: '預約狀態無效。' };
  if (!bookingDate) return { status: 'error', message: '預約日期為必填。' };
  if (!startTime) return { status: 'error', message: '開始時間為必填。' };
  if (!endTime) return { status: 'error', message: '結束時間為必填。' };
  if (startTime >= endTime) return { status: 'error', message: '開始時間必須早於結束時間。' };

  try {
    const context = await getOperationsContext();
    if (!['admin', 'staff'].includes(context.role)) throw userFacingError('只有管理員或職員可以管理試堂預約。');
    const { data: existingBooking, error: existingBookingError } = await context.supabase.from('bookings').select('id,parent_id,status,course_title_snapshot,booking_date,start_time,end_time,campuses(name)').eq('id', bookingId).eq('organization_id', context.organizationId).maybeSingle();
    if (existingBookingError || !existingBooking) throw existingBookingError ?? userFacingError('所選預約已不存在或不屬於目前機構。');

    const { data, error } = await context.supabase.from('bookings').update({ status, note: note || null, booking_date: bookingDate, start_time: `${startTime}:00`, end_time: `${endTime}:00` }).eq('id', bookingId).eq('organization_id', context.organizationId).select('id').single();
    if (error || !data) throw error ?? new Error('booking update returned no row');

    if (status === 'confirmed' && shouldNotifyParent && (existingBooking as unknown as BookingForNotification).status !== 'confirmed') {
      try {
        await createBookingConfirmedParentNotification(context.supabase, { ...(existingBooking as unknown as BookingForNotification), booking_date: bookingDate, start_time: `${startTime}:00`, end_time: `${endTime}:00` }, context.organizationId);
      } catch (notificationError) {
        return { status: 'error', message: safeOperationMessage(notificationError, '預約已更新，但家長通知未能建立。', 'booking-notification') };
      }
    }

    revalidatePath('/admin/bookings');
    revalidatePath(`/admin/bookings/${bookingId}`);
    return { status: 'success', message: '預約已更新，列表與詳情資料已同步。' };
  } catch (error) {
    return { status: 'error', message: error instanceof UserFacingOperationError ? error.message : safeOperationMessage(error, '更新預約失敗，請稍後再試。', 'update-booking') };
  }
}
