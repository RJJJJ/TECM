import { NextResponse } from 'next/server';
import { createServiceRoleSupabaseClient } from '@/lib/supabase/service-role';
import { verifyAutomationRequest } from '@/lib/automation/auth';
import {
  defaultPeriodKey,
  deterministicAutomationMessage,
  isOperationJobType
} from '@/lib/automation/messages';

export const dynamic = 'force-dynamic';

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  const auth = verifyAutomationRequest(request);
  if (!auth.ok) return jsonError(auth.status, auth.error);

  let body: Record<string, unknown> = {};
  try {
    const raw = await request.text();
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return jsonError(400, 'Request body must be valid JSON');
  }

  if (!isOperationJobType(body.job_type)) {
    return jsonError(400, 'job_type is invalid');
  }

  const periodKey = typeof body.period_key === 'string' && body.period_key.trim()
    ? body.period_key.trim()
    : defaultPeriodKey(body.job_type);

  if (!/^[a-zA-Z0-9:_-]{1,80}$/.test(periodKey)) {
    return jsonError(400, 'period_key is invalid');
  }

  let supabase;
  try {
    supabase = createServiceRoleSupabaseClient();
  } catch {
    return jsonError(500, 'Supabase service role is not configured');
  }

  const { data, error } = await supabase.rpc('run_automation_job', {
    target_organization_id: auth.identity.organizationId,
    target_job_type: body.job_type,
    target_period_key: periodKey
  });

  if (error) return jsonError(500, `Automation job failed: ${error.message}`);

  const result = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const affectedCount = typeof result.affected_count === 'number' ? result.affected_count : 0;

  return NextResponse.json({
    ok: true,
    organization_id: auth.identity.organizationId,
    key_id: auth.identity.keyId,
    job_type: body.job_type,
    period_key: periodKey,
    affected_count: affectedCount,
    summary_text: deterministicAutomationMessage(body.job_type, periodKey, affectedCount),
    external_message_sent: false,
    result
  });
}

