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
import {
  runApnsOutboxWorker,
  type RpcClient,
  type RpcResult
} from '../../../supabase/functions/send-apns/orchestrator.ts';

const apnsRequestId = '123e4567-e89b-42d3-a456-426614174000';

const item: ClaimedNotification = {
  outbox_id: 'outbox-id',
  notification_id: 'notification-id',
  device_id: 'device-id',
  device_token: 'a'.repeat(64),
  environment: 'sandbox',
  bundle_id: 'app.TECM',
  apns_request_id: apnsRequestId,
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
  assert.deepEqual(classifyApnsResponse(403, 'InvalidProviderToken').failureClass, 'provider');
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
  assert.equal(headers['apns-id'], apnsRequestId);
  assert.equal(headers['apns-push-type'], 'alert');
  assert.ok(capturedInit!.signal, 'APNs requests must have a bounded timeout signal');
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

function ok<T>(data: T = null as T) {
  return Promise.resolve({ data, error: null } as RpcResult<T>);
}

function fail<T = unknown>(message: string) {
  return Promise.resolve({ data: null, error: { message } } as RpcResult<T>);
}

function workerConfig(overrides: Partial<Parameters<typeof runApnsOutboxWorker>[1]> = {}) {
  return {
    workerId: 'worker-a',
    dryRun: false,
    bundleId: 'app.TECM',
    keyId: 'ABCDEFGHIJ',
    teamId: 'KLMNOPQRST',
    privateKey: 'private-key',
    completionRetryDelayMs: 0,
    ...overrides
  };
}

function makeDb(claims: ClaimedNotification[], options: {
  completeFailures?: number;
  completeOutcome?: string | null;
  beginFailure?: string;
  uncertaintyFailure?: string;
  retryRejectsRequestId?: boolean;
  calls?: Array<{ name: string; args: Record<string, unknown> }>;
} = {}) {
  const calls = options.calls ?? [];
  let completeFailures = options.completeFailures ?? 0;
  const db: RpcClient = {
    async rpc<T = unknown>(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === 'claim_notification_outbox') {
        return ok((claims.length ? [claims.shift()!] : []) as T);
      }
      if (name === 'begin_notification_dispatch') {
        if (options.beginFailure) return fail<T>(options.beginFailure);
        return ok('dispatching' as T);
      }
      if (name === 'mark_notification_delivery_uncertain') {
        if (options.uncertaintyFailure) return fail<T>(options.uncertaintyFailure);
        return ok('delivery_uncertain' as T);
      }
      if (name === 'complete_notification_delivery') {
        if (completeFailures > 0) {
          completeFailures -= 1;
          return fail<T>('lease unavailable');
        }
        return ok((Object.hasOwn(options, 'completeOutcome')
          ? options.completeOutcome
          : args.p_delivery_status) as T);
      }
      if (
        name === 'retry_notification_delivery' &&
        options.retryRejectsRequestId &&
        Object.hasOwn(args, 'p_provider_request_id')
      ) {
        return fail<T>('unexpected p_provider_request_id');
      }
      if (name === 'retry_notification_delivery') return ok('retry' as T);
      throw new Error(`unexpected rpc ${name}`);
    }
  };
  return { db, calls };
}

test('worker creates the provider token before the first outbox claim', async () => {
  const calls: string[] = [];
  const { db } = makeDb([], { calls: [] });
  const wrappedDb: RpcClient = {
    async rpc(name, args) {
      calls.push(name);
      return db.rpc(name, args);
    }
  };

  await runApnsOutboxWorker({
    db: wrappedDb,
    async createProviderToken() {
      calls.push('createProviderToken');
      return 'provider-token';
    },
    async send() {
      throw new Error('send should not run');
    }
  }, workerConfig());

  assert.deepEqual(calls.slice(0, 2), ['createProviderToken', 'claim_notification_outbox']);
});

test('provider token preflight failure stops before claiming work', async () => {
  const { db, calls } = makeDb([item]);
  await assert.rejects(
    () => runApnsOutboxWorker({
      db,
      async createProviderToken() {
        throw new Error('token failed');
      },
      async send() {
        throw new Error('send should not run');
      }
    }, workerConfig()),
    /token failed/
  );
  assert.equal(calls.length, 0);
});

test('dry-run preflights credentials and completes would_send without calling Apple', async () => {
  let tokenCreated = false;
  let sendCalled = false;
  const { db, calls } = makeDb([{ ...item }]);
  const summary = await runApnsOutboxWorker({
    db,
    async createProviderToken() {
      tokenCreated = true;
      return 'provider-token';
    },
    async send() {
      sendCalled = true;
      return classifyApnsResponse(200, null);
    }
  }, workerConfig({ dryRun: true }));

  assert.equal(tokenCreated, true);
  assert.equal(sendCalled, false);
  assert.equal(summary.would_send, 1);
  const complete = calls.find((call) => call.name === 'complete_notification_delivery')!;
  assert.equal(complete.args.p_delivery_status, 'would_send');
  assert.equal(complete.args.p_provider_request_id, apnsRequestId);
});

test('accepted APNs response completes delivery with the provider request id', async () => {
  const { db, calls } = makeDb([{ ...item }]);
  const summary = await runApnsOutboxWorker({
    db,
    async createProviderToken() {
      return 'provider-token';
    },
    async send(received, token) {
      assert.equal(token, 'provider-token');
      assert.equal(received.apns_request_id, apnsRequestId);
      return classifyApnsResponse(200, null, 'apple-request-id');
    }
  }, workerConfig());

  assert.equal(summary.delivered, 1);
  assert.deepEqual(
    calls.filter((call) => [
      'claim_notification_outbox',
      'begin_notification_dispatch',
      'complete_notification_delivery'
    ].includes(call.name)).slice(0, 3).map((call) => call.name),
    ['claim_notification_outbox', 'begin_notification_dispatch', 'complete_notification_delivery']
  );
  const complete = calls.find((call) => call.name === 'complete_notification_delivery')!;
  assert.equal(complete.args.p_provider_request_id, 'apple-request-id');
  assert.equal(complete.args.p_delivery_status, 'delivered');
});

for (const outcome of ['expired', 'cancelled'] as const) {
  test(`accepted APNs completion outcome ${outcome} is not counted as delivered`, async () => {
    const { db } = makeDb([{ ...item }], { completeOutcome: outcome });
    const summary = await runApnsOutboxWorker({
      db,
      async createProviderToken() {
        return 'provider-token';
      },
      async send() {
        return classifyApnsResponse(200, null, 'apple-request-id');
      }
    }, workerConfig());

    assert.equal(summary.delivered, 0);
    assert.equal(summary[outcome], 1);
  });
}

for (const outcome of ['expired', 'cancelled'] as const) {
  test(`dry-run completion outcome ${outcome} is not counted as would_send`, async () => {
    const { db } = makeDb([{ ...item }], { completeOutcome: outcome });
    const summary = await runApnsOutboxWorker({
      db,
      async createProviderToken() {
        return 'provider-token';
      },
      async send() {
        throw new Error('dry run must not send');
      }
    }, workerConfig({ dryRun: true }));

    assert.equal(summary.would_send, 0);
    assert.equal(summary[outcome], 1);
  });
}

for (const outcome of [null, 'unexpected'] as const) {
  test(`invalid completion outcome ${String(outcome)} never defaults to delivered`, async () => {
    const { db } = makeDb([{ ...item }], { completeOutcome: outcome });
    const summary = await runApnsOutboxWorker({
      db,
      async createProviderToken() {
        return 'provider-token';
      },
      async send() {
        return classifyApnsResponse(200, null, 'apple-request-id');
      },
      async sleep() {}
    }, workerConfig({ completionRetries: 1 }));

    assert.equal(summary.delivered, 0);
    assert.equal(summary.uncertain, 1);
    assert.equal(summary.stop_reason, 'completion_exhausted');
  });
}

test('accepted completion retries briefly and succeeds without retrying the send transition', async () => {
  const { db, calls } = makeDb([{ ...item }], { completeFailures: 2 });
  const summary = await runApnsOutboxWorker({
    db,
    async createProviderToken() {
      return 'provider-token';
    },
    async send() {
      return classifyApnsResponse(200, null, 'apple-request-id');
    },
    async sleep() {}
  }, workerConfig({ completionRetries: 3 }));

  assert.equal(summary.delivered, 1);
  assert.equal(calls.filter((call) => call.name === 'complete_notification_delivery').length, 3);
  assert.equal(calls.some((call) => call.name === 'retry_notification_delivery'), false);
});

test('accepted completion exhaustion marks delivery uncertain and stops the batch', async () => {
  const { db, calls } = makeDb([{ ...item }, { ...item, outbox_id: 'next' }], { completeFailures: 5 });
  const summary = await runApnsOutboxWorker({
    db,
    async createProviderToken() {
      return 'provider-token';
    },
    async send() {
      return classifyApnsResponse(200, null, 'apple-request-id');
    },
    async sleep() {}
  }, workerConfig({ completionRetries: 3 }));

  assert.equal(summary.stopped, true);
  assert.equal(summary.stop_reason, 'completion_exhausted');
  assert.equal(summary.delivered, 0);
  assert.equal(summary.uncertain, 1);
  assert.equal(calls.filter((call) => call.name === 'claim_notification_outbox').length, 1);
  assert.equal(calls.some((call) => call.name === 'retry_notification_delivery'), false);
  assert.equal(calls.some((call) => call.name === 'mark_notification_delivery_uncertain'), true);
});

test('a second worker invocation after dispatch lease expiry never sends the row again', async () => {
  let state: 'pending' | 'claimed' | 'dispatching' | 'delivery_uncertain' = 'pending';
  let leaseExpired = false;
  let sends = 0;
  const calls: string[] = [];
  const db: RpcClient = {
    async rpc<T = unknown>(name: string) {
      calls.push(name);
      if (name === 'claim_notification_outbox') {
        if (state === 'dispatching' && leaseExpired) state = 'delivery_uncertain';
        if (state !== 'pending') return ok([] as T);
        state = 'claimed';
        return ok([{ ...item }] as T);
      }
      if (name === 'begin_notification_dispatch') {
        assert.equal(state, 'claimed');
        state = 'dispatching';
        return ok('dispatching' as T);
      }
      if (name === 'complete_notification_delivery') return fail<T>('database unavailable');
      if (name === 'mark_notification_delivery_uncertain') return fail<T>('database unavailable');
      throw new Error(`unexpected rpc ${name}`);
    }
  };
  const deps = {
    db,
    async createProviderToken() {
      return 'provider-token';
    },
    async send() {
      sends += 1;
      return classifyApnsResponse(200, null, 'apple-request-id');
    },
    async sleep() {}
  };

  const first = await runApnsOutboxWorker(deps, workerConfig({ completionRetries: 2 }));
  assert.equal(first.stop_reason, 'completion_exhausted');
  assert.equal(state, 'dispatching');
  assert.equal(sends, 1);

  leaseExpired = true;
  const second = await runApnsOutboxWorker(deps, workerConfig({ completionRetries: 2 }));
  assert.equal(second.claimed, 0);
  assert.equal(state, 'delivery_uncertain');
  assert.equal(sends, 1);
  assert.equal(calls.filter((name) => name === 'begin_notification_dispatch').length, 1);
});

test('begin dispatch failure prevents every APNs send', async () => {
  let sends = 0;
  const { db, calls } = makeDb([{ ...item }], { beginFailure: 'lease lost' });
  await assert.rejects(
    () => runApnsOutboxWorker({
      db,
      async createProviderToken() {
        return 'provider-token';
      },
      async send() {
        sends += 1;
        return classifyApnsResponse(200, null);
      }
    }, workerConfig()),
    /Dispatch boundary failed: lease lost/
  );
  assert.equal(sends, 0);
  assert.deepEqual(
    calls.slice(0, 2).map((call) => call.name),
    ['claim_notification_outbox', 'begin_notification_dispatch']
  );
});

test('provider failure retries the current row, does not invalidate, and stops the batch', async () => {
  const { db, calls } = makeDb([{ ...item }, { ...item, outbox_id: 'next' }]);
  const summary = await runApnsOutboxWorker({
    db,
    async createProviderToken() {
      return 'provider-token';
    },
    async send() {
      return classifyApnsResponse(403, 'InvalidProviderToken');
    }
  }, workerConfig());

  assert.equal(summary.stopped, true);
  assert.equal(summary.stop_reason, 'provider_failure');
  assert.equal(summary.retried, 1);
  assert.equal(calls.filter((call) => call.name === 'claim_notification_outbox').length, 1);
  const retry = calls.find((call) => call.name === 'retry_notification_delivery')!;
  assert.equal(retry.args.p_retryable, true);
  assert.equal(retry.args.p_provider_request_id, apnsRequestId);
  assert.equal(retry.args.p_invalidate_device, false);
});

test('retry RPC falls back to the legacy signature only when request id is unsupported', async () => {
  const { db, calls } = makeDb([{ ...item }], { retryRejectsRequestId: true });
  const summary = await runApnsOutboxWorker({
    db,
    async createProviderToken() {
      return 'provider-token';
    },
    async send() {
      return classifyApnsResponse(500, 'InternalServerError', 'apple-retry-id');
    }
  }, workerConfig());

  assert.equal(summary.retried, 1);
  const retries = calls.filter((call) => call.name === 'retry_notification_delivery');
  assert.equal(retries.length, 2);
  assert.equal(retries[0].args.p_provider_request_id, 'apple-retry-id');
  assert.equal(Object.hasOwn(retries[1].args, 'p_provider_request_id'), false);
});

test('410 device failure invalidates through the retry RPC', async () => {
  const { db, calls } = makeDb([{ ...item }]);
  const summary = await runApnsOutboxWorker({
    db,
    async createProviderToken() {
      return 'provider-token';
    },
    async send() {
      return classifyApnsResponse(410, 'Unregistered');
    }
  }, workerConfig());

  assert.equal(summary.failed, 1);
  const retry = calls.find((call) => call.name === 'retry_notification_delivery')!;
  assert.equal(retry.args.p_retryable, false);
  assert.equal(retry.args.p_invalidate_device, true);
});

test('invalid device token is classified as a device failure without calling Apple fetch', async () => {
  let fetchCalled = false;
  const invalid = { ...item, device_token: 'not-a-token' };
  const result = await sendToApns(invalid, 'provider-token', async () => {
    fetchCalled = true;
    return new Response(null, { status: 200 });
  });

  assert.equal(fetchCalled, false);
  assert.equal(result.failureClass, 'device');
  assert.equal(result.invalidateDevice, true);
});

test('ambiguous network errors become delivery uncertain and stop without send retry', async () => {
  const { db, calls } = makeDb([{ ...item }, { ...item, outbox_id: 'next' }]);
  let sends = 0;
  const summary = await runApnsOutboxWorker({
    db,
    async createProviderToken() {
      return 'provider-token';
    },
    async send() {
      sends += 1;
      throw new TypeError('socket timeout with token abc');
    }
  }, workerConfig());

  assert.equal(summary.retried, 0);
  assert.equal(summary.uncertain, 1);
  assert.equal(summary.stopped, true);
  assert.equal(summary.stop_reason, 'ambiguous_delivery');
  assert.equal(sends, 1);
  assert.equal(calls.some((call) => call.name === 'retry_notification_delivery'), false);
  const uncertain = calls.find((call) => call.name === 'mark_notification_delivery_uncertain')!;
  assert.equal(uncertain.args.p_reason, 'TypeError');
});

test('returned summary and recorded diagnostics omit secret substrings from thrown send errors', async () => {
  const secret = 'super-secret-token-value';
  const { db, calls } = makeDb([{ ...item }]);
  const summary = await runApnsOutboxWorker({
    db,
    async createProviderToken() {
      return 'provider-token';
    },
    async send() {
      throw new TypeError(`timeout while using ${secret}`);
    }
  }, workerConfig());

  const serializedSummary = JSON.stringify(summary);
  const serializedCalls = JSON.stringify(calls);
  assert.equal(serializedSummary.includes(secret), false);
  assert.equal(serializedCalls.includes(secret), false);
  assert.equal(serializedCalls.includes('provider-token'), false);
});

test('permanent message failures dead-letter only the current row', async () => {
  const { db, calls } = makeDb([{ ...item }]);
  const summary = await runApnsOutboxWorker({
    db,
    async createProviderToken() {
      return 'provider-token';
    },
    async send() {
      return classifyApnsResponse(400, 'PayloadTooLarge');
    }
  }, workerConfig());

  assert.equal(summary.failed, 1);
  const retry = calls.find((call) => call.name === 'retry_notification_delivery')!;
  assert.equal(retry.args.p_retryable, false);
  assert.equal(retry.args.p_invalidate_device, false);
});

test('bundle mismatches fail through retry RPC without calling Apple or invalidating devices', async () => {
  let sendCalled = false;
  const { db, calls } = makeDb([{ ...item, bundle_id: 'wrong.bundle' }]);
  const summary = await runApnsOutboxWorker({
    db,
    async createProviderToken() {
      return 'provider-token';
    },
    async send() {
      sendCalled = true;
      return classifyApnsResponse(200, null);
    }
  }, workerConfig());

  assert.equal(sendCalled, false);
  assert.equal(summary.failed, 1);
  const retry = calls.find((call) => call.name === 'retry_notification_delivery')!;
  assert.equal(retry.args.p_error, 'BundleIdMismatch');
  assert.equal(retry.args.p_retryable, false);
  assert.equal(retry.args.p_invalidate_device, false);
});

test('missing DB APNs UUID fails closed before calling Apple', async () => {
  let sendCalled = false;
  const { db, calls } = makeDb([{ ...item, apns_request_id: '' }]);
  const summary = await runApnsOutboxWorker({
    db,
    async createProviderToken() {
      return 'provider-token';
    },
    async send() {
      sendCalled = true;
      return classifyApnsResponse(200, null);
    }
  }, workerConfig());

  assert.equal(sendCalled, false);
  assert.equal(summary.failed, 1);
  const retry = calls.find((call) => call.name === 'retry_notification_delivery')!;
  assert.equal(retry.args.p_error, 'MissingApnsRequestId');
  assert.equal(retry.args.p_retryable, false);
});

test('worker claim loop is bounded by configured max claims and deadline', async () => {
  const claims = Array.from({ length: 5 }, (_, index) => ({ ...item, outbox_id: `outbox-${index}` }));
  const { db, calls } = makeDb(claims);
  let now = 0;
  const summary = await runApnsOutboxWorker({
    db,
    async createProviderToken() {
      return 'provider-token';
    },
    async send() {
      now += 1_500;
      return classifyApnsResponse(200, null, 'apple-request-id');
    },
    now() {
      return now;
    }
  }, workerConfig({ maxClaims: 4, deadlineMs: 2_000 }));

  assert.equal(summary.claimed, 2);
  assert.equal(summary.stopped, true);
  assert.equal(summary.stop_reason, 'deadline');
  assert.equal(calls.filter((call) => call.name === 'claim_notification_outbox').length, 2);
});
