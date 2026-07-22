import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { createProviderToken, sendToApns } from "./core.ts";
import { type RpcResult, runApnsOutboxWorker } from "./orchestrator.ts";

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
    const keyId = requiredSecret("APNS_KEY_ID");
    const teamId = requiredSecret("APNS_TEAM_ID");
    const privateKey = requiredSecret("APNS_PRIVATE_KEY");
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const db = {
      async rpc<T = unknown>(name: string, args: Record<string, unknown>) {
        const result = await supabase.rpc(name, args);
        return result as unknown as RpcResult<T>;
      },
    };
    const summary = await runApnsOutboxWorker(
      {
        db,
        createProviderToken,
        send: sendToApns,
      },
      {
        workerId,
        dryRun,
        bundleId: configuredBundleId,
        keyId,
        teamId,
        privateKey,
      },
    );

    return response(200, summary);
  } catch (error) {
    const kind = error instanceof Error && error.name ? error.name : "Error";
    console.error("send-apns failed", { kind });
    return response(500, { error: "worker_failed" });
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
