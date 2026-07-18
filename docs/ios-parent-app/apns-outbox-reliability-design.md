# APNs outbox reliability design

This document fixes the state machine and invariants for the APNs reliability
forward migration. PostgreSQL is the authority for every transition; worker
counters and UI labels are observations only.

## State machine

| State | Terminal | Entry | Valid exit |
| --- | --- | --- | --- |
| `pending` | no | enqueue or eligible operator replay | `claimed`, `cancelled`, `expired`, `dead_letter` |
| `retry` | no | retryable explicit provider response | `claimed`, `cancelled`, `expired`, `dead_letter` |
| `claimed` | no | lease acquired atomically before APNs I/O | `dispatching`, `would_send`, `retry`, `cancelled`, `expired`, `dead_letter` |
| `dispatching` | no | durable pre-send boundary with stable request evidence | `delivered`, `retry`, `dead_letter`, `cancelled`, `expired`, `delivery_uncertain` |
| `delivery_uncertain` | operator controlled | ambiguous network outcome or expired dispatch lease | `pending` only through eligible, idempotent service-role replay |
| `delivered` | yes | APNs accepted and the completion transaction committed | none |
| `would_send` | yes | dry-run completion transaction committed | none |
| `dead_letter` | yes | non-retryable failure or attempt ceiling | `pending` only through eligible, idempotent service-role replay |
| `cancelled` | yes | device/registration became ineligible | none; a new registration receives only newly enqueued work |
| `expired` | yes | `notifications.expires_at` passed before completion | none |

`delivered` and `would_send` are immutable. `cancelled` and `expired` are not
replayable because their eligibility condition cannot be repaired without
changing the original delivery's meaning. An eligible `dead_letter` or
`delivery_uncertain` replay is
a new logical delivery attempt on the same outbox row: existing attempt history
is preserved and a new stable APNs request UUID is assigned once.

## Database invariants

1. Real APNs I/O requires a successful `begin_notification_dispatch` call.
   The RPC locks the row, verifies the live claimed lease, tenant, active device,
   registration generation, and notification expiry, then atomically persists
   `dispatching`, the stable `apns_request_id`, and `dispatch_started_at`.
   The completion RPC independently rejects a real `delivered` transition from
   `claimed`; only dry-run `would_send` may complete without dispatch evidence.
2. Claim uses `FOR UPDATE SKIP LOCKED`, increments `attempt_count` atomically,
   and never claims a row whose attempt count is already 8.
3. An expired pre-dispatch claimed lease at attempt 8 is atomically dead-lettered before candidate
   selection. Pending/retry rows already at the ceiling are also terminalized.
4. Claim atomically terminalizes stale work for inactive devices, mismatched
   registration generations, and expired notifications.
5. Each device row carries a monotonically increasing registration generation.
   Each outbox row snapshots that generation at enqueue. Token, environment,
   bundle, activation, deactivation, or invalidation changes advance the device
   generation and terminalize unfinished work from the old generation.
6. Reactivation never changes `cancelled`, `expired`, `delivered`, or
   `would_send` work back into a claimable state.
7. A device-level permanent APNs failure atomically invalidates only that
   registration and cancels all of its unfinished backlog. Provider/configuration
   failures never invalidate a device.
8. Every logical delivery has one UUID-format `apns_request_id`. APNs and
   PostgreSQL cannot participate in one atomic transaction, and APNs does not
   make this identifier an exactly-once guarantee. After the dispatch boundary,
   ambiguous outcomes are not automatically resent. This avoids blind duplicate
   delivery at the cost of an extreme crash possibly missing a push; the
   notification body remains available in the App notification center.
9. Expired `dispatching` leases become `delivery_uncertain`, never `retry`.
   Generic claim and lease recovery cannot acquire or reset them, and their
   request UUID, attempt count, worker, and timestamps remain evidence.
10. Replay is service-role-only, accepts only an eligible `dead_letter` or
   `delivery_uncertain`, verifies
   tenant/device/registration/expiry eligibility under row locks, records a
   bounded operator reason and request UUID, preserves attempts, and is
   idempotent for repeated replay request UUIDs.
11. Anonymous and authenticated callers have no direct outbox, attempt, or
    replay mutation rights. Every security-definer function has a fixed
    `search_path`, has `PUBLIC` execute revoked, and is granted only to its
    required role.
12. Existing FORCE RLS and tenant-coherence triggers remain authoritative.
    Outbox registration snapshots and replay evidence must agree with the
    referenced organization, notification, and device.

## Worker failure classes

- `device`: `410`, `BadDeviceToken`, `DeviceTokenNotForTopic`, and
  `Unregistered`; invalidate and cancel that registration's backlog atomically.
- `provider`: authentication/configuration failures such as
  `InvalidProviderToken`, `ExpiredProviderToken`, and
  `TooManyProviderTokenUpdates`; release/retry the current row and stop the
  invocation without touching devices.
- `transient`: explicit APNs `408`, `429`, and `5xx` responses use bounded retry
  or dead-letter at the database-enforced ceiling. Network exceptions whose
  delivery outcome is unknowable enter `delivery_uncertain` and stop the batch.
- `permanent-message`: other non-retryable responses; dead-letter the current
  row without invalidating unrelated registrations.
- `accepted`: APNs `200`; retry only the completion RPC for a short bounded
  interval. If completion still fails, mark `delivery_uncertain` when possible,
  otherwise leave `dispatching` for lease recovery; never invoke the send-retry
  transition.

Provider credentials and configuration are validated and the provider token is
created before the first claim. Dry-run follows the same preflight but never
calls Apple. All network, completion-retry, concurrency, and test waits have
explicit deadlines.
