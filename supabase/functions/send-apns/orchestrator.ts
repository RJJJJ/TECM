import { type ApnsResult, type ClaimedNotification } from "./core.ts";

export type RpcResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

export type RpcClient = {
  rpc<T = unknown>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<RpcResult<T>>;
};

export type ApnsWorkerConfig = {
  workerId: string;
  dryRun: boolean;
  bundleId: string;
  keyId: string;
  teamId: string;
  privateKey: string;
  maxClaims?: number;
  leaseSeconds?: number;
  deadlineMs?: number;
  completionRetries?: number;
  completionRetryDelayMs?: number;
};

export type ApnsWorkerDependencies = {
  db: RpcClient;
  createProviderToken(
    keyId: string,
    teamId: string,
    privateKey: string,
  ): Promise<string>;
  send(item: ClaimedNotification, providerToken: string): Promise<ApnsResult>;
  sleep?(milliseconds: number): Promise<void>;
  now?(): number;
};

export type ApnsWorkerSummary = {
  claimed: number;
  delivered: number;
  would_send: number;
  expired: number;
  cancelled: number;
  uncertain: number;
  retried: number;
  failed: number;
  dry_run: boolean;
  stopped: boolean;
  stop_reason: string | null;
};

const DEFAULT_MAX_CLAIMS = 25;
const DEFAULT_LEASE_SECONDS = 90;
const DEFAULT_DEADLINE_MS = 55_000;
const DEFAULT_COMPLETION_RETRIES = 3;
const DEFAULT_COMPLETION_RETRY_DELAY_MS = 50;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPLETION_OUTCOMES = new Set([
  "delivered",
  "would_send",
  "expired",
  "cancelled",
]);

type CompletionOutcome = "delivered" | "would_send" | "expired" | "cancelled";

function rpcMessage(operation: string, message: string) {
  return `${operation} failed: ${message}`;
}

function sanitizeError(error: unknown) {
  return error instanceof Error && error.name ? error.name : "NetworkError";
}

function resultError(result: RpcResult<unknown>) {
  return result.error?.message ?? "unknown RPC error";
}

function supportsLegacyRetryFallback(message: string) {
  return /p_provider_request_id|function .*retry_notification_delivery|could not find|schema cache|unexpected/i
    .test(message);
}

function hasTimeRemaining(
  startedAt: number,
  now: () => number,
  deadlineMs: number,
) {
  return now() - startedAt < deadlineMs;
}

async function completeWithBoundedRetries(
  deps: ApnsWorkerDependencies,
  config:
    & Required<
      Pick<ApnsWorkerConfig, "completionRetries" | "completionRetryDelayMs">
    >
    & Pick<ApnsWorkerConfig, "workerId">,
  args: Record<string, unknown>,
) {
  let lastMessage = "unknown RPC error";
  for (let attempt = 1; attempt <= config.completionRetries; attempt += 1) {
    const result = await deps.db.rpc<unknown>(
      "complete_notification_delivery",
      args,
    );
    if (!result.error) {
      if (
        typeof result.data === "string" && COMPLETION_OUTCOMES.has(result.data)
      ) {
        return result.data as CompletionOutcome;
      }
      lastMessage = "invalid completion outcome";
    } else {
      lastMessage = resultError(result);
    }
    if (attempt < config.completionRetries) {
      await (deps.sleep ?? defaultSleep)(config.completionRetryDelayMs);
    }
  }
  throw new Error(rpcMessage("Delivery completion", lastMessage));
}

function recordCompletionOutcome(
  summary: ApnsWorkerSummary,
  outcome: CompletionOutcome,
) {
  summary[outcome] += 1;
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function claimNext(
  deps: ApnsWorkerDependencies,
  workerId: string,
  leaseSeconds: number,
) {
  const { data, error } = await deps.db.rpc<ClaimedNotification[]>(
    "claim_notification_outbox",
    {
      p_worker_id: workerId,
      p_limit: 1,
      p_lease_seconds: leaseSeconds,
    },
  );
  if (error) throw new Error(rpcMessage("Outbox claim", error.message));
  return ((data ?? []) as ClaimedNotification[])[0] ?? null;
}

async function beginDispatch(
  deps: ApnsWorkerDependencies,
  item: ClaimedNotification,
  workerId: string,
) {
  const result = await deps.db.rpc<string>("begin_notification_dispatch", {
    p_outbox_id: item.outbox_id,
    p_worker_id: workerId,
    p_apns_request_id: item.apns_request_id,
  });
  if (result.error) {
    throw new Error(rpcMessage("Dispatch boundary", result.error.message));
  }
  return result.data;
}

async function markDeliveryUncertain(
  deps: ApnsWorkerDependencies,
  item: ClaimedNotification,
  workerId: string,
  reason: string,
) {
  const result = await deps.db.rpc<string>(
    "mark_notification_delivery_uncertain",
    {
      p_outbox_id: item.outbox_id,
      p_worker_id: workerId,
      p_reason: reason,
    },
  );
  if (result.error) {
    throw new Error(
      rpcMessage("Delivery uncertainty update", result.error.message),
    );
  }
  if (result.data !== "delivery_uncertain") {
    throw new Error("Delivery uncertainty update returned an invalid state");
  }
}

async function retryDelivery(
  deps: ApnsWorkerDependencies,
  item: ClaimedNotification,
  config: Pick<ApnsWorkerConfig, "workerId">,
  result: {
    status: number | null;
    requestId?: string | null;
    reason: string | null;
    retryable: boolean;
    invalidateDevice: boolean;
  },
) {
  const nextArgs = {
    p_outbox_id: item.outbox_id,
    p_worker_id: config.workerId,
    p_http_status: result.status,
    p_provider_request_id: result.requestId ?? item.apns_request_id ?? null,
    p_error: result.reason ?? `HTTP ${result.status}`,
    p_retryable: result.retryable,
    p_invalidate_device: result.invalidateDevice,
  };
  const next = await deps.db.rpc<string>(
    "retry_notification_delivery",
    nextArgs,
  );
  if (!next.error) return;
  if (!supportsLegacyRetryFallback(next.error.message)) {
    throw new Error(rpcMessage("Delivery failure update", next.error.message));
  }

  const { p_provider_request_id: _requestId, ...legacyArgs } = nextArgs;
  const legacy = await deps.db.rpc<string>(
    "retry_notification_delivery",
    legacyArgs,
  );
  if (legacy.error) {
    throw new Error(
      rpcMessage("Delivery failure update", legacy.error.message),
    );
  }
}

export async function runApnsOutboxWorker(
  deps: ApnsWorkerDependencies,
  config: ApnsWorkerConfig,
): Promise<ApnsWorkerSummary> {
  const maxClaims = Math.max(
    1,
    Math.min(config.maxClaims ?? DEFAULT_MAX_CLAIMS, 100),
  );
  const leaseSeconds = Math.max(
    10,
    config.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
  );
  const deadlineMs = Math.max(1_000, config.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const completionRetries = Math.max(
    1,
    Math.min(config.completionRetries ?? DEFAULT_COMPLETION_RETRIES, 5),
  );
  const completionRetryDelayMs = Math.max(
    0,
    Math.min(
      config.completionRetryDelayMs ?? DEFAULT_COMPLETION_RETRY_DELAY_MS,
      1_000,
    ),
  );
  const now = deps.now ?? Date.now;
  const startedAt = now();

  const summary: ApnsWorkerSummary = {
    claimed: 0,
    delivered: 0,
    would_send: 0,
    expired: 0,
    cancelled: 0,
    uncertain: 0,
    retried: 0,
    failed: 0,
    dry_run: config.dryRun,
    stopped: false,
    stop_reason: null,
  };

  const providerToken = await deps.createProviderToken(
    config.keyId,
    config.teamId,
    config.privateKey,
  );

  for (let index = 0; index < maxClaims; index += 1) {
    if (!hasTimeRemaining(startedAt, now, deadlineMs)) {
      summary.stopped = true;
      summary.stop_reason = "deadline";
      break;
    }

    const item = await claimNext(deps, config.workerId, leaseSeconds);
    if (!item) break;
    summary.claimed += 1;

    if (item.bundle_id !== config.bundleId) {
      await retryDelivery(deps, item, config, {
        status: 400,
        reason: "BundleIdMismatch",
        retryable: false,
        invalidateDevice: false,
      });
      summary.failed += 1;
      continue;
    }

    if (!UUID_PATTERN.test(item.apns_request_id)) {
      await retryDelivery(deps, item, config, {
        status: 400,
        reason: "MissingApnsRequestId",
        retryable: false,
        invalidateDevice: false,
      });
      summary.failed += 1;
      continue;
    }

    if (config.dryRun) {
      const outcome = await completeWithBoundedRetries(
        deps,
        {
          workerId: config.workerId,
          completionRetries,
          completionRetryDelayMs,
        },
        {
          p_outbox_id: item.outbox_id,
          p_worker_id: config.workerId,
          p_provider_request_id: item.apns_request_id,
          p_http_status: null,
          p_delivery_status: "would_send",
        },
      );
      recordCompletionOutcome(summary, outcome);
      continue;
    }

    const dispatchState = await beginDispatch(deps, item, config.workerId);
    if (dispatchState !== "dispatching") {
      summary.failed += 1;
      continue;
    }

    let result: ApnsResult;
    try {
      result = await deps.send(item, providerToken);
    } catch (error) {
      await markDeliveryUncertain(
        deps,
        item,
        config.workerId,
        sanitizeError(error),
      );
      summary.uncertain += 1;
      summary.stopped = true;
      summary.stop_reason = "ambiguous_delivery";
      break;
    }

    if (result.failureClass === "accepted") {
      try {
        const outcome = await completeWithBoundedRetries(
          deps,
          {
            workerId: config.workerId,
            completionRetries,
            completionRetryDelayMs,
          },
          {
            p_outbox_id: item.outbox_id,
            p_worker_id: config.workerId,
            p_provider_request_id: result.requestId ?? item.apns_request_id,
            p_http_status: result.status,
            p_delivery_status: "delivered",
          },
        );
        recordCompletionOutcome(summary, outcome);
      } catch {
        try {
          await markDeliveryUncertain(
            deps,
            item,
            config.workerId,
            "AcceptedByApnsCompletionExhausted",
          );
          summary.uncertain += 1;
        } catch {
          // If PostgreSQL is still unavailable, the durable dispatching row is
          // recovered to delivery_uncertain after lease expiry by the claim RPC.
        }
        summary.stopped = true;
        summary.stop_reason = "completion_exhausted";
        break;
      }
      continue;
    }

    await retryDelivery(deps, item, config, result);
    if (result.retryable) summary.retried += 1;
    else summary.failed += 1;

    if (result.failureClass === "provider") {
      summary.stopped = true;
      summary.stop_reason = "provider_failure";
      break;
    }
  }

  return summary;
}
