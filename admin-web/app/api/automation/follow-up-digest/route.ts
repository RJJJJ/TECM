import { NextResponse } from 'next/server';
import { createServiceRoleSupabaseClient } from '@/lib/supabase/service-role';
import { type FollowUpStatus } from '@/lib/types/follow-up';
import { verifyAutomationRequest } from '@/lib/automation/auth';

export const dynamic = 'force-dynamic';

const STATUSES = new Set<FollowUpStatus>(['open', 'done', 'dismissed']);
const MAX_LIMIT = 50;

type DigestItem = {
  id: string;
  booking_id: string;
  priority: 'low' | 'medium' | 'high';
  channel: 'wechat_manual' | 'whatsapp_manual' | 'phone_manual' | 'in_app';
  parent_name: string | null;
  phone: string | null;
  child_name: string | null;
  course_title_snapshot: string | null;
  booking_date: string | null;
  start_time: string | null;
  intent_summary: string | null;
  suggested_message: string;
  suggested_next_steps: string[];
};

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function todayDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Macau',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function priorityRank(priority: DigestItem['priority']) {
  return priority === 'high' ? 0 : priority === 'medium' ? 1 : 2;
}

function priorityLabel(priority: DigestItem['priority']) {
  return priority === 'high' ? '高' : priority === 'medium' ? '中' : '低';
}

function formatTime(value: string | null) {
  return value ? value.slice(0, 5) : '-';
}

function buildDigestText(items: DigestItem[], summary: Record<string, number>, date: string) {
  const header = `今日 TECM 跟進摘要（${date}）：待跟進 ${summary.open_count}，高優先級 ${summary.high_priority_open_count}，今日預約相關 ${summary.today_booking_follow_up_count}，已完成 ${summary.done_count}。`;

  if (items.length === 0) {
    return `${header}\n目前沒有符合條件的跟進任務。`;
  }

  const lines = items.slice(0, 10).map((item, index) => {
    const parent = item.parent_name ?? '未填家長';
    const child = item.child_name ?? '未填學生';
    const course = item.course_title_snapshot ?? '未填課程';
    const when = `${item.booking_date ?? '-'} ${formatTime(item.start_time)}`;
    const intent = item.intent_summary ? `；${item.intent_summary}` : '';
    return `${index + 1}. [${priorityLabel(item.priority)}] ${parent} / ${child} / ${course} / ${when}${intent}`;
  });

  return `${header}\n請 staff 優先處理高優先級任務，複製建議話術後以 WeChat / WhatsApp / 電話人工聯絡家長。\n${lines.join('\n')}`;
}

export async function POST(request: Request) {
  const auth = verifyAutomationRequest(request);
  if (!auth.ok) return jsonError(auth.status, auth.error);
  const organizationId = auth.identity.organizationId;

  let body: Record<string, unknown> = {};
  try {
    const rawText = await request.text();
    body = rawText ? JSON.parse(rawText) : {};
  } catch {
    return jsonError(400, 'Request body must be valid JSON');
  }

  const status = typeof body.status === 'string' && body.status ? body.status : 'open';
  const hasDateFilter = typeof body.date === 'string' && Boolean(body.date);
  const date = hasDateFilter && typeof body.date === 'string' ? body.date : todayDateString();
  const requestedLimit = typeof body.limit === 'number' ? body.limit : Number(body.limit ?? 20);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), MAX_LIMIT) : 20;

  if (!STATUSES.has(status as FollowUpStatus)) return jsonError(400, 'status is invalid');
  if (!isValidDate(date)) return jsonError(400, 'date must be YYYY-MM-DD');

  let supabase;
  try {
    supabase = createServiceRoleSupabaseClient();
  } catch {
    return jsonError(500, 'Supabase service role is not configured');
  }

  const [openCountResult, highOpenResult, todayResult, doneResult] = await Promise.all([
    supabase.from('follow_up_tasks').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'open'),
    supabase.from('follow_up_tasks').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'open').eq('priority', 'high'),
    supabase.from('follow_up_tasks').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'open').eq('booking_date', date),
    supabase.from('follow_up_tasks').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'done')
  ]);

  if (openCountResult.error || highOpenResult.error || todayResult.error || doneResult.error) {
    return jsonError(500, 'Failed to load follow-up summary');
  }

  let itemsQuery = supabase
    .from('follow_up_tasks')
    .select('id, booking_id, priority, channel, parent_name, phone, child_name, course_title_snapshot, booking_date, start_time, intent_summary, suggested_message, suggested_next_steps')
    .eq('organization_id', organizationId)
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (hasDateFilter) {
    itemsQuery = itemsQuery.eq('booking_date', date);
  }

  const { data, error } = await itemsQuery;

  if (error) return jsonError(500, 'Failed to load follow-up digest items');

  const items = ((data ?? []) as DigestItem[]).sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  const summary = {
    open_count: openCountResult.count ?? 0,
    high_priority_open_count: highOpenResult.count ?? 0,
    today_booking_follow_up_count: todayResult.count ?? 0,
    done_count: doneResult.count ?? 0
  };

  return NextResponse.json({
    ok: true,
    summary,
    items,
    digest_text: buildDigestText(items, summary, date)
  });
}
