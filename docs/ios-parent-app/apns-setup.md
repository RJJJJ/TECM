# APNs setup

This document covers the TECM parent-app APNs worker and the credentials needed
to run it. The database-backed reliability model is documented in
`apns-outbox-reliability-design.md`; operator recovery steps are in
`apns-outbox-recovery-runbook.md`.

## Apple developer setup

1. In Apple Developer, enable Push Notifications for the TECM parent app Bundle
   ID. The worker currently expects `APNS_BUNDLE_ID` to match every claimed
   outbox row's `bundle_id`; mismatches are recorded as non-retryable message
   failures without calling Apple.
2. Create an APNs token signing key and record the 10-character Key ID and
   10-character Team ID.
3. Store the `.p8` private key only in the Supabase secret manager or the local
   development environment used to run the Edge Function. Do not commit `.p8`
   material, provisioning profiles, certificates, or exported workflow secrets.
4. Use the APNs environment attached to the device token:
   - Debug/development-signed apps use `sandbox`.
   - TestFlight/App Store apps use `production`.
5. Keep the Xcode Push Notifications entitlement aligned with the signing
   environment before claiming any production Apple pass.

## Supabase secrets

`send-apns` requires these secrets:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
PUSH_WORKER_SECRET
APNS_KEY_ID
APNS_TEAM_ID
APNS_BUNDLE_ID
APNS_PRIVATE_KEY
APNS_DRY_RUN=true|false
```

`PUSH_WORKER_SECRET` is accepted through either
`Authorization: Bearer <PUSH_WORKER_SECRET>` or `x-tecm-worker-secret`.

`APNS_DRY_RUN=true` still validates the APNs Key ID, Team ID, private key, and
provider-token creation before the first outbox claim. It then completes claimed
rows as `would_send` and does not call Apple.

Dry-run is not read-only. It consumes selected outbox rows as terminal
`would_send`, so use it only with synthetic/disposable notifications in an
isolated environment. Because it never contacts Apple, it proves local ES256
signing but does not prove that Apple accepts the Key ID, Team ID, or key.

## Credential preflight

The worker creates the APNs provider JWT before calling
`claim_notification_outbox`. A missing or malformed APNs secret stops the
invocation before any row is claimed.

Preflight validates:

| Secret | Local validation |
| --- | --- |
| `APNS_KEY_ID` | 10 uppercase alphanumeric characters |
| `APNS_TEAM_ID` | 10 uppercase alphanumeric characters |
| `APNS_PRIVATE_KEY` | non-empty PKCS8 private key that can sign ES256 |
| `APNS_BUNDLE_ID` | compared against each claimed row before Apple send |

Provider responses such as `InvalidProviderToken`, `ExpiredProviderToken`, and
`TooManyProviderTokenUpdates` are runtime provider failures. They are not fixed
by replaying rows first; repair credentials, verify dry-run, then resume the
scheduler.

## Deploy

Deploy the function without JWT verification because it uses the worker secret
and the Supabase service-role key internally:

```powershell
supabase functions deploy send-apns --no-verify-jwt
```

The repository config also pins:

```toml
[functions.send-apns]
verify_jwt = false
```

## Scheduler guidance

This repository does not currently contain a committed Supabase Cron definition
for `send-apns`. Configure the schedule in the Supabase dashboard or your
deployment automation, and record the schedule owner outside the source tree.

Recommended scheduler behavior:

- Invoke `send-apns` with `POST` only.
- Include `PUSH_WORKER_SECRET` in the authorization header.
- Keep only one active schedule per environment unless operations deliberately
  increase concurrency.
- Disable the schedule before credential repair, production replay, or any
  investigation where a provider failure could repeatedly claim more rows.
- Re-enable the schedule only after a dry-run or controlled manual invocation
  returns the expected summary.

## Delivery semantics

The APNs outbox is at-least-once. Each logical delivery attempt has one stable
UUID in `notification_outbox.apns_request_id`, and every send retry for that
logical delivery uses it as the APNs `apns-id` header. This helps correlate
database rows, APNs responses, and attempt records. It is not an exactly-once
guarantee because APNs can accept a request while the database completion RPC
fails or times out.

Replay of an eligible `dead_letter` row creates a new logical delivery attempt
on the same outbox row. It preserves replay evidence and assigns a new
`apns_request_id`.

## Failure classification

| Class | Examples | Worker behavior |
| --- | --- | --- |
| `accepted` | HTTP `200` | Retries only the completion RPC briefly; if completion still fails, stops the batch with `completion_exhausted` and leaves the lease visible for recovery. |
| `device` | HTTP `410`, `BadDeviceToken`, `DeviceTokenNotForTopic`, `Unregistered` | Dead-letters the current row, invalidates that device generation, and cancels unfinished backlog for the same registration generation. |
| `provider` | `InvalidProviderToken`, `ExpiredProviderToken`, `TooManyProviderTokenUpdates` | Records a retry for the current row, does not invalidate devices, and stops the batch with `provider_failure`. |
| `transient` | network errors, HTTP `408`, HTTP `429`, APNs `5xx` | Records a bounded retry with backoff or dead-letters at the database-enforced attempt ceiling. |
| `permanent-message` | other non-retryable APNs responses such as `PayloadTooLarge` | Dead-letters only the current row. |

## Generation-bound backlog

Every outbox row snapshots the target device's
`device_registration_generation`. Token, bundle, environment, activation, or
invalidation changes advance the device generation and cancel unfinished work
from the old generation.

Do not replay `cancelled` or `expired` rows. A new active registration receives
only newly enqueued work.

## Local and mock coverage

Local/mock tests cover:

- APNs provider-token construction from a generated PKCS8 key.
- Request metadata, including `apns-topic`, stable `apns-id`, push type,
  priority, timeout signal, and safe payload copy.
- Response classification for `429`, `5xx`, `410`, `BadDeviceToken`,
  provider-token failures, and network errors.
- Dry-run completing `would_send` without calling Apple.
- Database reliability cases in `supabase/tests/009_apns_outbox_reliability.sql`.

NOT PASSED by local/mock evidence:

- Real Apple sandbox delivery to a physical device.
- TestFlight or production APNs delivery.
- Apple Developer provisioning, entitlement, certificate, and key ownership.
- Production scheduler behavior.
- CI or mutation-test completion unless the current run artifacts explicitly say
  they passed.
