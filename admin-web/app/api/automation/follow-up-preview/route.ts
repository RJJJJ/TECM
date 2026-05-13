import { NextResponse } from 'next/server';
import { createServiceRoleSupabaseClient } from '@/lib/supabase/service-role';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BookingPreview = {
  id: string;
  parent_name: string | null;
  phone: string | null;
  child_name: string | null;
  child_age: number | null;
  school_name: string | null;
  course_title_snapshot: string | null;
  booking_date: string | null;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
  status: string | null;
  campuses: { name: string | null } | null;
};

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function verifyAutomationSecret(request: Request) {
  const expected = process.env.TECM_AUTOMATION_SECRET;
  if (!expected) return { ok: false as const, response: jsonError(500, 'Automation secret is not configured') };

  const received = request.headers.get('x-tecm-automation-secret');
  if (!received || received !== expected) {
    return { ok: false as const, response: jsonError(401, 'Invalid automation secret') };
  }

  return { ok: true as const };
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildRecommendedPrompt(booking: BookingPreview) {
  return `你是 TECM 澳門教育中心的課程顧問助理。請根據以下 booking 資料，為 staff 生成內部跟進建議。不要聲稱已自動發送 WeChat；suggested_message 必須是可供 staff 複製到 WeChat / WhatsApp 的繁體中文人工跟進話術。\n\nBooking 資料：\n- 家長：${booking.parent_name ?? '未提供'}\n- 電話：${booking.phone ?? '未提供'}\n- 孩子：${booking.child_name ?? '未提供'}\n- 年齡：${booking.child_age ?? '未提供'}\n- 學校：${booking.school_name ?? '未提供'}\n- 課程：${booking.course_title_snapshot ?? '未提供'}\n- 校區：${booking.campuses?.name ?? '未提供'}\n- 日期：${booking.booking_date ?? '未提供'}\n- 時間：${booking.start_time ?? '未提供'} - ${booking.end_time ?? '未提供'}\n- 備註：${booking.note ?? '未提供'}\n- 狀態：${booking.status ?? '未提供'}\n\n請只輸出嚴格 JSON：\n{\n  "channel": "wechat_manual",\n  "priority": "high|medium|low",\n  "intent_summary": "...",\n  "suggested_message": "...",\n  "suggested_next_steps": ["...", "..."],\n  "internal_note": "..."\n}`;
}

export async function POST(request: Request) {
  const secretCheck = verifyAutomationSecret(request);
  if (!secretCheck.ok) return secretCheck.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Request body must be valid JSON');
  }

  const bookingId = normalizeString(body.booking_id);
  if (!bookingId || !UUID_RE.test(bookingId)) {
    return jsonError(400, 'booking_id is required and must be a UUID');
  }

  let supabase;
  try {
    supabase = createServiceRoleSupabaseClient();
  } catch {
    return jsonError(500, 'Supabase service role is not configured');
  }

  const { data, error } = await supabase
    .from('bookings')
    .select('id, parent_name, phone, child_name, child_age, school_name, course_title_snapshot, booking_date, start_time, end_time, note, status, campuses(name)')
    .eq('id', bookingId)
    .maybeSingle();

  if (error) return jsonError(500, 'Failed to load booking');
  if (!data) return jsonError(404, 'Booking not found');

  const booking = data as unknown as BookingPreview;

  return NextResponse.json({
    booking: {
      parent_name: booking.parent_name,
      phone: booking.phone,
      child_name: booking.child_name,
      child_age: booking.child_age,
      school_name: booking.school_name,
      course_title_snapshot: booking.course_title_snapshot,
      campus_name: booking.campuses?.name ?? null,
      booking_date: booking.booking_date,
      start_time: booking.start_time,
      end_time: booking.end_time,
      note: booking.note,
      status: booking.status
    },
    recommended_prompt: buildRecommendedPrompt(booking)
  });
}
