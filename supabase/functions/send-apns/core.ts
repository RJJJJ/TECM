export type ApnsEnvironment = "sandbox" | "production";

export type ClaimedNotification = {
  outbox_id: string;
  notification_id: string;
  device_id: string;
  device_token: string;
  environment: ApnsEnvironment;
  bundle_id: string;
  title: string | null;
  body: string | null;
  category: string;
  deep_link: string | null;
  attempt_count: number;
};

export type ApnsResult = {
  status: number;
  requestId: string | null;
  reason: string | null;
  retryable: boolean;
  invalidateDevice: boolean;
};

const PERMANENT_DEVICE_REASONS = new Set([
  "BadDeviceToken",
  "DeviceTokenNotForTopic",
  "Unregistered",
]);

const TRANSIENT_REASONS = new Set([
  "ExpiredProviderToken",
  "InternalServerError",
  "ServiceUnavailable",
  "Shutdown",
  "TooManyProviderTokenUpdates",
  "TooManyRequests",
]);

const CATEGORY_COPY: Record<string, string> = {
  announcement: "你有一則新的教育中心公告。",
  attendance: "你有一則新的出席通知。",
  booking: "你的預約資料已有更新。",
  class_reminder: "你有一則新的課堂提醒。",
  leave: "你的請假申請已有更新。",
  makeup: "你的補堂安排已有更新。",
  payment: "你的付款或收據資料已有更新。",
  receipt: "你有一張新的收據可供查看。",
  transactional: "你有一則新的帳戶通知。",
};

export function apnsEndpoint(environment: ApnsEnvironment) {
  return environment === "production"
    ? "https://api.push.apple.com"
    : "https://api.sandbox.push.apple.com";
}

export function safeAlertCopy(category: string) {
  return {
    title: "TECM 教育中心",
    body: CATEGORY_COPY[category] ?? "你有一則新的通知，請登入 App 查看。",
  };
}

export function buildApnsPayload(item: ClaimedNotification, badge?: number) {
  const alert = safeAlertCopy(item.category);
  const route = isSafeDeepLink(item.deep_link)
    ? item.deep_link
    : `tecm://notifications/${item.notification_id}`;

  return {
    aps: {
      alert,
      sound: "default",
      ...(typeof badge === "number" && Number.isInteger(badge) && badge >= 0
        ? { badge }
        : {}),
    },
    notification_id: item.notification_id,
    category: item.category,
    deep_link: route,
  };
}

export function isSafeDeepLink(value: string | null): value is string {
  if (!value || value.length > 500) return false;
  try {
    const url = new URL(value);
    return url.protocol === "tecm:";
  } catch {
    return false;
  }
}

export function isValidDeviceToken(value: string) {
  return /^[a-fA-F0-9]{64,200}$/.test(value);
}

export function classifyApnsResponse(
  status: number,
  reason: string | null,
  requestId: string | null = null,
): ApnsResult {
  if (status === 200) {
    return {
      status,
      requestId,
      reason: null,
      retryable: false,
      invalidateDevice: false,
    };
  }

  const invalidateDevice = status === 410 ||
    (reason ? PERMANENT_DEVICE_REASONS.has(reason) : false);
  const retryable = !invalidateDevice && (
    status === 408 ||
    status === 429 ||
    status >= 500 ||
    (reason ? TRANSIENT_REASONS.has(reason) : false)
  );

  return { status, requestId, reason, retryable, invalidateDevice };
}

export function retryDelaySeconds(attemptCount: number) {
  const exponent = Math.max(0, Math.min(attemptCount, 8));
  return Math.min(3600, 15 * (2 ** exponent));
}

function base64Url(input: Uint8Array | string) {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function privateKeyBytes(pem: string) {
  const normalized = pem.replace(/\\n/g, "\n");
  const body = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  if (!body) throw new Error("APNS_PRIVATE_KEY is empty or malformed");
  const binary = atob(body);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function createProviderToken(
  keyId: string,
  teamId: string,
  privateKeyPem: string,
  issuedAtSeconds = Math.floor(Date.now() / 1000),
) {
  if (!/^[A-Z0-9]{10}$/.test(keyId) || !/^[A-Z0-9]{10}$/.test(teamId)) {
    throw new Error(
      "APNs Key ID and Team ID must be 10 uppercase alphanumeric characters",
    );
  }
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = base64Url(
    JSON.stringify({ iss: teamId, iat: issuedAtSeconds }),
  );
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes(privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

export async function sendToApns(
  item: ClaimedNotification,
  providerToken: string,
  fetcher: typeof fetch = fetch,
): Promise<ApnsResult> {
  if (!isValidDeviceToken(item.device_token)) {
    return classifyApnsResponse(400, "BadDeviceToken");
  }
  const response = await fetcher(
    `${apnsEndpoint(item.environment)}/3/device/${item.device_token}`,
    {
      method: "POST",
      headers: {
        authorization: `bearer ${providerToken}`,
        "apns-topic": item.bundle_id,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      },
      body: JSON.stringify(buildApnsPayload(item)),
    },
  );

  let reason: string | null = null;
  if (!response.ok) {
    try {
      const parsed = await response.json() as { reason?: unknown };
      reason = typeof parsed.reason === "string"
        ? parsed.reason.slice(0, 120)
        : null;
    } catch {
      reason = null;
    }
  }
  return classifyApnsResponse(
    response.status,
    reason,
    response.headers.get("apns-id"),
  );
}
