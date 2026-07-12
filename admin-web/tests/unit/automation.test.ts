import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyAutomationRequest } from '../../lib/automation/auth.ts';
import {
  defaultPeriodKey,
  deterministicAutomationMessage,
  isOperationJobType
} from '../../lib/automation/messages.ts';

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000000';

test('automation authentication requires a tenant UUID', () => {
  process.env.TECM_AUTOMATION_SECRET = 'test-only';
  const request = new Request('http://localhost/api/automation/operations', {
    headers: { 'x-tecm-automation-secret': 'test-only' }
  });
  const result = verifyAutomationRequest(request);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 400);
});

test('automation authentication rejects an invalid secret', () => {
  process.env.TECM_AUTOMATION_SECRET = 'test-only';
  process.env.TECM_ORGANIZATION_ID = ORGANIZATION_ID;
  const request = new Request('http://localhost/api/automation/operations', {
    headers: {
      'x-tecm-organization-id': ORGANIZATION_ID,
      'x-tecm-automation-secret': 'wrong'
    }
  });
  const result = verifyAutomationRequest(request);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 401);
});

test('organization-scoped secret takes precedence over the fallback secret', () => {
  process.env.TECM_AUTOMATION_SECRET = 'fallback';
  process.env.TECM_AUTOMATION_ORGANIZATION_SECRETS = JSON.stringify({
    [ORGANIZATION_ID]: 'scoped-secret'
  });
  const request = new Request('http://localhost/api/automation/operations', {
    headers: {
      'x-tecm-organization-id': ORGANIZATION_ID,
      'x-tecm-automation-secret': 'scoped-secret',
      'x-tecm-automation-key-id': 'automation-test'
    }
  });
  const result = verifyAutomationRequest(request);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.identity, { organizationId: ORGANIZATION_ID, keyId: 'automation-test' });
  delete process.env.TECM_AUTOMATION_ORGANIZATION_SECRETS;
});

test('global fallback secret cannot be replayed for another organization', () => {
  process.env.TECM_AUTOMATION_SECRET = 'test-only';
  process.env.TECM_ORGANIZATION_ID = ORGANIZATION_ID;
  const request = new Request('http://localhost/api/automation/operations', {
    headers: {
      'x-tecm-organization-id': '00000000-0000-4000-8000-000000000002',
      'x-tecm-automation-secret': 'test-only'
    }
  });
  const result = verifyAutomationRequest(request);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 401);
});

test('job type and deterministic fallback are stable', () => {
  assert.equal(isOperationJobType('low_credit'), true);
  assert.equal(isOperationJobType('send_whatsapp'), false);
  assert.equal(defaultPeriodKey('morning_summary', new Date('2026-07-11T00:00:00Z')), '2026-07-11');
  const message = deterministicAutomationMessage('overdue_payment', '2026-07-11', 2);
  assert.match(message, /欠費跟進/);
  assert.match(message, /人工複製/);
});
