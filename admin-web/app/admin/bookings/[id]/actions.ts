'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { verifyActiveStaffAccess } from '@/lib/auth/staff-access';

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
  campuses: {
    name: string | null;
  } | null;
};

function formatNotificationTime(timeValue: string | null) {
  if (!timeValue) return '-';
  return timeValue.slice(0, 5);
}

function buildBookingConfirmedNotificationDetail(booking: BookingForNotification) {
  const course = booking.course_title_snapshot ?? '體驗課';
  const campus = booking.campuses?.name ?? 'TECM';
  const date = booking.booking_date ?? '待確認日期';
  const start = formatNotificationTime(booking.start_time);
  const end = formatNotificationTime(booking.end_time);

  return `您的${course}預約已確認。地點：${campus}；日期：${date}；時間：${start} - ${end}。如需更改，請聯絡 TECM staff。`;
}

async function createBookingConfirmedParentNotification(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  booking: BookingForNotification
) {
  if (!booking.parent_id) return;

  const { data: existingBridge } = await supabase
    .from('booking_parent_notifications')
    .select('id')
    .eq('booking_id', booking.id)
    .eq('type', 'booking_confirmed')
    .maybeSingle();

  if (existingBridge) return;

  const { data: notification, error: notificationError } = await supabase
    .from('notifications')
    .insert({
      parent_id: booking.parent_id,
      title: '預約已確認',
      detail: buildBookingConfirmedNotificationDetail(booking),
      is_read: false
    })
    .select('id')
    .single();

  if (notificationError || !notification) {
    throw new Error(notificationError?.message ?? 'Failed to create parent notification');
  }

  const { error: bridgeError } = await supabase
    .from('booking_parent_notifications')
    .insert({
      booking_id: booking.id,
      notification_id: notification.id,
      type: 'booking_confirmed'
    });

  if (bridgeError && bridgeError.code !== '23505') {
    throw new Error(bridgeError.message);
  }
}

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
  const shouldNotifyParent = formData.get('notify_parent_on_confirmed') === 'true';

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

  const supabase = await createServerSupabaseClient();
  const access = await verifyActiveStaffAccess(supabase);

  if (!access.allowed) {
    await supabase.auth.signOut();
    return {
      status: 'error',
      message: '你沒有權限更新 booking。'
    };
  }

  const { data: existingBooking, error: existingBookingError } = await supabase
    .from('bookings')
    .select(
      `
      id,
      parent_id,
      status,
      course_title_snapshot,
      booking_date,
      start_time,
      end_time,
      campuses(name)
    `
    )
    .eq('id', bookingId)
    .maybeSingle();

  if (existingBookingError || !existingBooking) {
    return {
      status: 'error',
      message: existingBookingError?.message ?? '找不到 booking。'
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

  if (
    status === 'confirmed' &&
    shouldNotifyParent &&
    (existingBooking as unknown as BookingForNotification).status !== 'confirmed'
  ) {
    try {
      await createBookingConfirmedParentNotification(supabase, {
        ...((existingBooking as unknown) as BookingForNotification),
        booking_date: bookingDate,
        start_time: `${startTime}:00`,
        end_time: `${endTime}:00`
      });
    } catch (notificationError) {
      return {
        status: 'error',
        message:
          notificationError instanceof Error
            ? `Booking 已更新，但建立家長通知失敗：${notificationError.message}`
            : 'Booking 已更新，但建立家長通知失敗。'
      };
    }
  }

  revalidatePath('/admin/bookings');
  revalidatePath(`/admin/bookings/${bookingId}`);

  return {
    status: 'success',
    message: 'Booking 已更新，列表與詳情資料已同步。'
  };
}
