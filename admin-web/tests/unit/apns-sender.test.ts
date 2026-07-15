import assert from 'node:assert/strict';
import test from 'node:test';
import {
  apnsEndpoint,
  buildApnsPayload,
  classifyApnsResponse,
  createProviderToken,
  isValidDeviceToken,
  retryDelaySeconds,
  sendToApns,
  type ClaimedNotification
} from '../../../supabase/functions/send-apns/core.ts';

const item: ClaimedNotification = {
  outbox_id: 'outbox-id',
  notification_id: 'notification-id',
  device_id: 'device-id',
  device_token: 'a'.repeat(64),
  environment: 'sandbox',
  bundle_id: 'app.TECM',
  title: 'Student Full Name',
  body: 'Private payment amount 9999',
  category: 'payment',
  deep_link: 'tecm://payments/payment-id',
  attempt_count: 1
};

test('APNs payload contains only generic lock-screen copy and safe routing metadata', () => {
  const payload = buildApnsPayload(item, 3);
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes(item.title!), false);
  assert.equal(serialized.includes(item.body!), false);
  assert.deepEqual(payload.aps.alert, {
    title: 'TECM 教育中心',
    body: '你的付款或收據資料已有更新。'
  });
  assert.equal(payload.notification_id, item.notification_id);
  assert.equal(payload.deep_link, item.deep_link);
  assert.equal(payload.aps.badge, 3);
});

test('unknown or unsafe deep links fall back to the notification route', () => {
  const payload = buildApnsPayload({ ...item, deep_link: 'https://example.com/private' });
  assert.equal(payload.deep_link, `tecm://notifications/${item.notification_id}`);
});

test('APNs response policy retries transient failures and invalidates permanent tokens', () => {
  assert.deepEqual(classifyApnsResponse(429, 'TooManyRequests').retryable, true);
  assert.deepEqual(classifyApnsResponse(500, 'InternalServerError').retryable, true);
  assert.deepEqual(classifyApnsResponse(410, 'Unregistered').invalidateDevice, true);
  assert.deepEqual(classifyApnsResponse(400, 'BadDeviceToken').invalidateDevice, true);
  assert.deepEqual(classifyApnsResponse(400, 'PayloadTooLarge').retryable, false);
});

test('endpoint, token validation, and retry backoff are deterministic', () => {
  assert.equal(apnsEndpoint('sandbox'), 'https://api.sandbox.push.apple.com');
  assert.equal(apnsEndpoint('production'), 'https://api.push.apple.com');
  assert.equal(isValidDeviceToken('a'.repeat(64)), true);
  assert.equal(isValidDeviceToken('not-a-token'), false);
  assert.equal(retryDelaySeconds(0), 15);
  assert.equal(retryDelaySeconds(20), 3600);
});

test('provider token is an ES256 JWT generated from a PKCS8 key', async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
  const base64 = Buffer.from(pkcs8).toString('base64').match(/.{1,64}/g)!.join('\n');
  const pem = `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----`;
  const token = await createProviderToken('ABCDEFGHIJ', 'KLMNOPQRST', pem, 1_700_000_000);
  const segments = token.split('.');
  assert.equal(segments.length, 3);
  const header = JSON.parse(Buffer.from(segments[0], 'base64url').toString('utf8'));
  const claims = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
  assert.deepEqual(header, { alg: 'ES256', kid: 'ABCDEFGHIJ' });
  assert.deepEqual(claims, { iss: 'KLMNOPQRST', iat: 1_700_000_000 });
  assert.equal(Buffer.from(segments[2], 'base64url').length, 64);
});

test('mock APNs provider receives HTTP/2-compatible request metadata and safe payload', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const result = await sendToApns(item, 'provider-token', async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(null, { status: 200, headers: { 'apns-id': 'request-id' } });
  });
  assert.equal(capturedUrl, `https://api.sandbox.push.apple.com/3/device/${item.device_token}`);
  const headers = capturedInit!.headers as Record<string, string>;
  assert.equal(headers.authorization, 'bearer provider-token');
  assert.equal(headers['apns-topic'], 'app.TECM');
  assert.equal(headers['apns-push-type'], 'alert');
  assert.equal(String(capturedInit!.body).includes(item.body!), false);
  assert.equal(result.status, 200);
  assert.equal(result.requestId, 'request-id');
});

test('mock APNs provider classifies 429, 500, 410, BadDeviceToken, and timeout paths', async () => {
  for (const [status, reason, retryable, invalid] of [
    [429, 'TooManyRequests', true, false],
    [500, 'InternalServerError', true, false],
    [410, 'Unregistered', false, true],
    [400, 'BadDeviceToken', false, true]
  ] as const) {
    const result = await sendToApns(item, 'provider-token', async () => new Response(
      JSON.stringify({ reason }),
      { status, headers: { 'content-type': 'application/json' } }
    ));
    assert.equal(result.retryable, retryable);
    assert.equal(result.invalidateDevice, invalid);
  }
  await assert.rejects(
    () => sendToApns(item, 'provider-token', async () => { throw new TypeError('network timeout'); }),
    /network timeout/
  );
});
