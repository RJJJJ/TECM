import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import {
  type ClaimedNotification,
  createProviderToken,
  sendToApns,
} from "./core.ts";

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function requiredSecret(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing server secret: ${name}`);
  return value;
}

async function equalSecrets(actual: string, expected: string) {
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(actualHash);
  const b = new Uint8Array(expectedHash);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return mismatch === 0;
}

async function authorize(request: Request) {
  const expected = requiredSecret("PUSH_WORKER_SECRET");
  const bearer =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const explicit = request.headers.get("x-tecm-worker-secret") ?? "";
  return equalSecrets(explicit || bearer, expected);
}

export async function handleRequest(request: Request) {
  if (request.method !== "POST") {
    return response(405, { error: "method_not_allowed" });
  }
  if (!await authorize(request)) {
    return response(401, { error: "unauthorized" });
  }

  try {
    const supabaseUrl = requiredSecret("SUPABASE_URL");
    const serviceRoleKey = requiredSecret("SUPABASE_SERVICE_ROLE_KEY");
    const workerId = `${Deno.env.get("SB_EXECUTION_ID") ?? crypto.randomUUID()}`
      .slice(0, 200);
    const dryRun = Deno.env.get("APNS_DRY_RUN")?.toLowerCase() === "true";
    const configuredBundleId = requiredSecret("APNS_BUNDLE_ID");
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supabase.rpc("claim_notification_outbox", {
      p_worker_id: workerId,
      p_limit: 25,
      p_lease_seconds: 90,
    });
    if (error) throw new Error(`Outbox claim failed: ${error.message}`);

    const items = (data ?? []) as ClaimedNotification[];
    const providerToken = dryRun || items.length === 0
      ? null
      : await createProviderToken(
        requiredSecret("APNS_KEY_ID"),
        requiredSecret("APNS_TEAM_ID"),
        requiredSecret("APNS_PRIVATE_KEY"),
      );
    let delivered = 0;
    let wouldSend = 0;
    let retried = 0;
    let failed = 0;

    for (const item of items) {
      if (item.bundle_id !== configuredBundleId) {
        const { error: retryError } = await supabase.rpc(
          "retry_notification_delivery",
          {
            p_outbox_id: item.outbox_id,
            p_worker_id: workerId,
            p_http_status: null,
            p_error: "BundleIdMismatch",
            p_retryable: false,
            p_invalidate_device: false,
          },
        );
        if (retryError) {
          throw new Error(
            `Bundle validation update failed: ${retryError.message}`,
          );
        }
        failed += 1;
        continue;
      }
      if (dryRun) {
        const { error: completeError } = await supabase.rpc(
          "complete_notification_delivery",
          {
            p_outbox_id: item.outbox_id,
            p_worker_id: workerId,
            p_provider_request_id: null,
            p_http_status: null,
            p_delivery_status: "would_send",
          },
        );
        if (completeError) {
          throw new Error(
            `Dry-run completion failed: ${completeError.message}`,
          );
        }
        wouldSend += 1;
        continue;
      }

      try {
        const result = await sendToApns(item, providerToken!);
        if (result.status === 200) {
          const { error: completeError } = await supabase.rpc(
            "complete_notification_delivery",
            {
              p_outbox_id: item.outbox_id,
              p_worker_id: workerId,
              p_provider_request_id: result.requestId,
              p_http_status: result.status,
              p_delivery_status: "delivered",
            },
          );
          if (completeError) {
            throw new Error(
              `Delivery completion failed: ${completeError.message}`,
            );
          }
          delivered += 1;
        } else {
          const { error: retryError } = await supabase.rpc(
            "retry_notification_delivery",
            {
              p_outbox_id: item.outbox_id,
              p_worker_id: workerId,
              p_http_status: result.status,
              p_error: result.reason ?? `HTTP ${result.status}`,
              p_retryable: result.retryable,
              p_invalidate_device: result.invalidateDevice,
            },
          );
          if (retryError) {
            throw new Error(
              `Delivery failure update failed: ${retryError.message}`,
            );
          }
          if (result.retryable) retried += 1;
          else failed += 1;
        }
      } catch (sendError) {
        const sanitized = sendError instanceof Error
          ? sendError.name
          : "NetworkError";
        const { error: retryError } = await supabase.rpc(
          "retry_notification_delivery",
          {
            p_outbox_id: item.outbox_id,
            p_worker_id: workerId,
            p_http_status: null,
            p_error: sanitized,
            p_retryable: true,
            p_invalidate_device: false,
          },
        );
        if (retryError) {
          throw new Error(
            `Network failure update failed: ${retryError.message}`,
          );
        }
        retried += 1;
      }
    }

    return response(200, {
      claimed: items.length,
      delivered,
      would_send: wouldSend,
      retried,
      failed,
      dry_run: dryRun,
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Unexpected worker failure";
    console.error("send-apns failed", { message });
    return response(500, { error: "worker_failed" });
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
