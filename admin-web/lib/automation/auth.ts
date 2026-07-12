import { timingSafeEqual } from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AutomationIdentity = {
  organizationId: string;
  keyId: string;
};

export type AutomationAuthResult =
  | { ok: true; identity: AutomationIdentity }
  | { ok: false; status: 400 | 401 | 500; error: string };

function safeEqual(received: string, expected: string) {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

function organizationSecrets(): Record<string, string> {
  const raw = process.env.TECM_AUTOMATION_ORGANIZATION_SECRETS;
  if (!raw) return {};

  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string] => UUID_RE.test(entry[0]) && typeof entry[1] === 'string')
    );
  } catch {
    return {};
  }
}

export function verifyAutomationRequest(request: Request): AutomationAuthResult {
  const organizationId = request.headers.get('x-tecm-organization-id')?.trim() ?? '';
  if (!UUID_RE.test(organizationId)) {
    return { ok: false, status: 400, error: 'x-tecm-organization-id must be a UUID' };
  }

  const received = request.headers.get('x-tecm-automation-secret') ?? '';
  const scopedSecrets = organizationSecrets();
  const scopedSecret = scopedSecrets[organizationId];
  const fallbackOrganizationId = process.env.TECM_ORGANIZATION_ID?.trim() ?? '';
  if (!scopedSecret && (!UUID_RE.test(fallbackOrganizationId) || fallbackOrganizationId !== organizationId)) {
    return { ok: false, status: 401, error: 'Automation credentials are not scoped to this organization' };
  }
  const expected = scopedSecret ?? process.env.TECM_AUTOMATION_SECRET ?? '';
  if (!expected) {
    return { ok: false, status: 500, error: 'Automation secret is not configured' };
  }

  if (!received || !safeEqual(received, expected)) {
    return { ok: false, status: 401, error: 'Invalid automation credentials' };
  }

  return {
    ok: true,
    identity: {
      organizationId,
      keyId: request.headers.get('x-tecm-automation-key-id')?.trim() || 'default'
    }
  };
}
