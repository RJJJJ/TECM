import { NextResponse } from 'next/server';
import { createServiceRoleSupabaseClient } from '@/lib/supabase/service-role';
import { verifyAutomationRequest } from '@/lib/automation/auth';
import {
  type FollowUpChannel,
  type FollowUpPriority,
  type FollowUpSource,
  type FollowUpTaskInsert
} from '@/lib/types/follow-up';

export const dynamic = 'force-dynamic';

const CHANNELS = new Set<FollowUpChannel>(['wechat_manual', 'whatsapp_manual', 'phone_manual', 'in_app']);
const PRIORITIES = new Set<FollowUpPriority>(['low', 'medium', 'high']);
const SOURCES = new Set<FollowUpSource>(['automation', 'staff', 'manual_seed', 'n8n']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BookingSnapshot = {
  id: string;
  parent_name: string | null;
  phone: string | null;
  child_name: string | null;
  course_title_snapshot: string | null;
  booking_date: string | null;
  start_time: string | null;
  end_time: string | null;
  campuses: { name: string | null } | null;
};

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(request: Request) {
  const auth = verifyAutomationRequest(request);
  if (!auth.ok) return jsonError(auth.status, auth.error);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Request body must be valid JSON');
  }

  const bookingId = normalizeString(body.booking_id);
  const suggestedMessage = normalizeString(body.suggested_message);
  const channel = (normalizeString(body.channel) || 'wechat_manual') as FollowUpChannel;
  const priority = (normalizeString(body.priority) || 'medium') as FollowUpPriority;
  const source = (normalizeString(body.source) || 'n8n') as FollowUpSource;
  const intentSummary = normalizeString(body.intent_summary) || null;
  const internalNote = normalizeString(body.internal_note) || null;
  const suggestedNextSteps = Array.isArray(body.suggested_next_steps)
    ? body.suggested_next_steps.filter((step): step is string => typeof step === 'string').map((step) => step.trim()).filter(Boolean)
    : [];

  if (!bookingId || !UUID_RE.test(bookingId)) return jsonError(400, 'booking_id is required and must be a UUID');
  if (!suggestedMessage) return jsonError(400, 'suggested_message is required');
  if (!CHANNELS.has(channel)) return jsonError(400, 'channel is invalid');
  if (!PRIORITIES.has(priority)) return jsonError(400, 'priority is invalid');
  if (!SOURCES.has(source)) return jsonError(400, 'source is invalid');

  let supabase;
  try {
    supabase = createServiceRoleSupabaseClient();
  } catch {
    return jsonError(500, 'Supabase service role is not configured');
  }

  const { data: bookingData, error: bookingError } = await supabase
    .from('bookings')
    .select('id, parent_name, phone, child_name, course_title_snapshot, booking_date, start_time, end_time, campuses(name)')
    .eq('organization_id', auth.identity.organizationId)
    .eq('id', bookingId)
    .maybeSingle();

  if (bookingError) return jsonError(500, 'Failed to load booking');
  if (!bookingData) return jsonError(404, 'Booking not found');

  const booking = bookingData as unknown as BookingSnapshot;
  const payload: FollowUpTaskInsert & { organization_id: string } = {
    organization_id: auth.identity.organizationId,
    booking_id: booking.id,
    parent_name: booking.parent_name,
    phone: booking.phone,
    child_name: booking.child_name,
    course_title_snapshot: booking.course_title_snapshot,
    campus_name: booking.campuses?.name ?? null,
    booking_date: booking.booking_date,
    start_time: booking.start_time,
    end_time: booking.end_time,
    channel,
    priority,
    intent_summary: intentSummary,
    suggested_message: suggestedMessage,
    suggested_next_steps: suggestedNextSteps,
    internal_note: internalNote,
    source,
    status: 'open',
    completed_at: null,
    dismissed_at: null
  };

  // The DB has a partial unique index for one open automation/n8n task per booking.
  // For n8n retries, update the current open automation task instead of creating duplicates.
  const { data: existingTask, error: existingError } = await supabase
    .from('follow_up_tasks')
    .select('id')
    .eq('organization_id', auth.identity.organizationId)
    .eq('booking_id', bookingId)
    .eq('status', 'open')
    .in('source', ['automation', 'n8n'])
    .maybeSingle();

  if (existingError) return jsonError(500, 'Failed to check existing follow-up task');

  if (existingTask?.id) {
    const { data: updated, error: updateError } = await supabase
      .from('follow_up_tasks')
      .update(payload)
      .eq('id', existingTask.id)
      .select('id, booking_id')
      .single();

    if (updateError || !updated) return jsonError(500, 'Failed to update follow-up task');

    return NextResponse.json({ ok: true, task_id: updated.id, booking_id: updated.booking_id, status: 'updated' });
  }

  const { data: inserted, error: insertError } = await supabase
    .from('follow_up_tasks')
    .insert(payload)
    .select('id, booking_id')
    .single();

  if (insertError || !inserted) return jsonError(500, 'Failed to create follow-up task');

  return NextResponse.json(
    { ok: true, task_id: inserted.id, booking_id: inserted.booking_id, status: 'created' },
    { status: 201 }
  );
}
