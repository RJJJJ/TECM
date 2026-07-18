# APNs outbox recovery runbook

This runbook is forward-only. Do not recover APNs outbox incidents by rolling
back delivery state. Disable scheduling, classify the failure, repair the
credential or data issue, and replay only investigated, eligible `dead_letter`
or `delivery_uncertain` rows through the service-role RPC.

## Scope and limits

Local and mock capabilities:

- Inspect outbox status and provider evidence.
- Validate worker secrets with `APNS_DRY_RUN=true`.
- Reclaim only expired pre-dispatch `claimed` leases through `claim_notification_outbox`.
- Replay eligible `dead_letter` or `delivery_uncertain` rows with an operator reason and idempotency
  UUID.

NOT PASSED by local/mock recovery:

- Real Apple sandbox delivery.
- TestFlight or production APNs delivery.
- Apple Developer entitlement, provisioning, key ownership, or production
  scheduler behavior.
- CI or mutation-test completion unless current artifacts explicitly show a
  pass.

## First response

1. Disable the `send-apns` scheduler for the affected environment.
2. Keep the Edge Function deployed; do not delete outbox rows.
3. Record the incident window, environment, worker summary, and whether the
   worker reported `provider_failure`, `completion_exhausted`, `deadline`, or a
   generic `worker_failed`.
4. Run the status and lease queries below.
5. Repair credentials or data before replaying anything.

## Status counts

Run with service-role database access. Add the organization filter when the
incident is tenant-specific.

```sql
select
  status,
  count(*) as rows
from public.notification_outbox
where status in (
  'pending',
  'retry',
  'claimed',
  'dispatching',
  'delivery_uncertain',
  'dead_letter',
  'expired',
  'cancelled'
)
group by status
order by status;
```

Tenant-scoped version:

```sql
select
  status,
  count(*) as rows
from public.notification_outbox
where organization_id = :'organization_id'::uuid
  and status in (
    'pending',
    'retry',
    'claimed',
    'dispatching',
    'delivery_uncertain',
    'dead_letter',
    'expired',
    'cancelled'
  )
group by status
order by status;
```

## Claimed rows and expired leases

Active leases are still owned by a worker and should not be replayed:

```sql
select
  id,
  notification_id,
  device_id,
  claimed_by,
  claimed_at,
  lease_expires_at,
  attempt_count,
  apns_request_id
from public.notification_outbox
where status = 'claimed'
  and lease_expires_at > statement_timestamp()
order by lease_expires_at;
```

Expired or malformed leases are recovered by the next service-role claim. Rows
below the attempt ceiling move back to `retry`; rows at the ceiling move to
`dead_letter`.

```sql
select
  id,
  notification_id,
  device_id,
  claimed_by,
  claimed_at,
  lease_expires_at,
  attempt_count,
  apns_request_id,
  last_error
from public.notification_outbox
where status = 'claimed'
  and (
    lease_expires_at is null
    or lease_expires_at <= statement_timestamp()
    or nullif(btrim(coalesce(claimed_by, '')), '') is null
  )
order by coalesce(lease_expires_at, claimed_at) nulls first;
```

`APNS_DRY_RUN=true` is mutating: it claims eligible rows and terminalizes them as
`would_send`. Never point it at a real production backlog merely to recover
leases or test credentials. Use only synthetic notifications in an isolated
environment or an explicitly approved set of disposable rows. Normal claim
cleanup will recover expired leases on the next real worker invocation.

`dispatching` is different: the pre-send boundary has already committed, so
Apple may have received the request. An expired dispatch lease becomes
`delivery_uncertain`; it never returns to `pending` or `retry`, is excluded from
normal claims, and must not be automatically resent.

## Provider 403 stop-worker procedure

Provider credential failures include APNs `403` reasons such as
`InvalidProviderToken`, `ExpiredProviderToken`, and
`TooManyProviderTokenUpdates`.

Expected worker behavior:

- The current row is recorded through `retry_notification_delivery`.
- Devices are not invalidated.
- The batch stops with `stop_reason = 'provider_failure'`.
- The scheduler must stay disabled until credentials are repaired.

Procedure:

1. Disable the `send-apns` scheduler.
2. Confirm recent provider failures:

   ```sql
   select
     id,
     status,
     available_at,
     attempt_count,
     apns_request_id,
     provider_response,
     last_error,
     updated_at
   from public.notification_outbox
   where provider_response->>'http_status' = '403'
      or last_error in (
        'InvalidProviderToken',
        'ExpiredProviderToken',
        'TooManyProviderTokenUpdates'
      )
   order by updated_at desc
   limit 100;
   ```

3. Repair `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, and
   `APNS_BUNDLE_ID` in the affected environment.
4. In an isolated environment with synthetic disposable rows, set
   `APNS_DRY_RUN=true`, invoke one bounded worker run, and confirm local ES256
   provider-token construction succeeds. This does not prove Apple accepts the
   Key ID, Team ID, or key.
5. If Apple credentials are available, perform one controlled real send to an
   owned test device before treating the provider repair as validated. Without
   that evidence, keep the Apple credential gate `NOT PASSED`.
6. Set `APNS_DRY_RUN=false`.
7. Re-enable the scheduler only after the controlled evidence and status review
   are complete.
8. Replay only eligible `dead_letter` rows that reached terminal state because
   of the credential outage. Do not replay `cancelled` or `expired` rows.

## Credential repair checklist

- The Apple key still exists and is enabled in Apple Developer.
- Key ID and Team ID are exactly 10 uppercase alphanumeric characters.
- The private key is a PKCS8 `.p8` value with line breaks preserved or encoded
  in the secret format expected by the runtime.
- `APNS_BUNDLE_ID` matches the Bundle ID stored on active `push_devices`.
- Debug builds target `sandbox`; TestFlight/App Store builds target
  `production`.
- The worker can create a provider token before the first claim.

## Safe replay

Replay is service-role-only:

```sql
select public.replay_dead_letter_notification_outbox(
  :'outbox_id'::uuid,
  :'replay_request_id'::uuid,
  :'operator_reason'
);
```

Requirements:

- `outbox_id` is currently `dead_letter` or an investigated `delivery_uncertain` row.
- `replay_request_id` is a new UUID generated for this operator action.
- `operator_reason` is non-empty and 500 characters or fewer.
- The device is active and not invalidated.
- The outbox row's `device_registration_generation` still matches the device.
- The notification is not expired.

The replay RPC is idempotent for the same `replay_request_id` and same outbox
row. Reusing a replay UUID for a different row fails.

Use a reason that includes the incident ticket and root cause:

```sql
select public.replay_dead_letter_notification_outbox(
  '00000000-0000-4000-8000-000000000001'::uuid,
  '00000000-0000-4000-8000-000000000002'::uuid,
  'INC-1234 APNs provider credential repaired; replay approved by ops'
);
```

Replay preserves the previous attempt count in
`replay_preserved_attempt_count`, resets `attempt_count` to `0`, records
`replayed_at`, `replayed_by`, `replay_reason`, and assigns a new
`apns_request_id`.

## Find replay candidates

Use this query before calling the replay RPC:

```sql
select
  o.id,
  o.organization_id,
  o.notification_id,
  o.device_id,
  o.attempt_count,
  o.dead_lettered_at,
  o.last_error,
  o.provider_response,
  o.device_registration_generation,
  d.registration_generation as current_generation,
  d.is_active,
  d.invalidated_at,
  n.expires_at
from public.notification_outbox o
join public.push_devices d on d.id = o.device_id
join public.notifications n on n.id = o.notification_id
where o.status in ('dead_letter', 'delivery_uncertain')
  and o.replay_request_id is null
  and d.is_active
  and d.invalidated_at is null
  and o.device_registration_generation = d.registration_generation
  and (n.expires_at is null or n.expires_at > statement_timestamp())
order by o.dead_lettered_at nulls last, o.updated_at
limit 100;
```

Review candidates manually. Do not batch replay rows only because they are
`dead_letter` or `delivery_uncertain`; confirm the failure class, whether APNs
may already have delivered, and the incident root cause.

## 410 expectations

APNs `410`, `Unregistered`, `BadDeviceToken`, and
`DeviceTokenNotForTopic` are device failures.

Expected database result:

- The current outbox row becomes `dead_letter`.
- The device generation is invalidated.
- Unfinished backlog for that exact registration generation becomes
  `cancelled`.
- A later re-registration creates a new generation and receives only new
  notifications.

Do not replay old-generation `dead_letter`, `cancelled`, or `expired` rows after
a 410-style invalidation. If the user later reinstalls or reauthorizes push,
new outbox rows must come from new notifications.

## Accepted or possibly delivered but completion failed

If Apple accepted the request but `complete_notification_delivery` failed after
bounded retries, the worker stops with `stop_reason = 'completion_exhausted'`.
The worker does not call the send-retry transition in that invocation.

Observable symptoms:

- The row is already `dispatching`; the worker attempts to move it to
  `delivery_uncertain`, or lease recovery does so after PostgreSQL becomes available.
- No `delivered` attempt row is written if completion never committed.
- APNs may have delivered the notification. The system does not promise
  exactly-once, but this ambiguous row is never automatically resent.

Diagnosis query:

```sql
select
  o.id,
  o.notification_id,
  o.device_id,
  o.claimed_by,
  o.claimed_at,
  o.lease_expires_at,
  o.attempt_count,
  o.apns_request_id,
  o.provider_response,
  count(a.id) as attempt_rows
from public.notification_outbox o
left join public.notification_delivery_attempts a on a.outbox_id = o.id
where o.status in ('dispatching', 'delivery_uncertain')
group by
  o.id,
  o.notification_id,
  o.device_id,
  o.claimed_by,
  o.claimed_at,
  o.lease_expires_at,
  o.attempt_count,
  o.apns_request_id,
  o.provider_response
order by o.claimed_at desc;
```

Recovery options:

- If a `dispatching` lease is still valid and the operator has exact APNs
  accepted evidence plus the current `claimed_by` worker id, complete the row
  with the existing RPC and provider request id.
- If accepted evidence is unavailable or the lease expired, keep the row in
  `delivery_uncertain`. Generic claim/recovery must not resend it.
- Replay only after operator investigation and approval. The reason must explain
  the ambiguity; replay preserves the original attempt evidence and assigns a
  new logical `apns_request_id`.

APNs and PostgreSQL cannot form one atomic transaction. A crash after the
dispatch boundary but before the network call may therefore miss a push. The
notification remains available in the App notification center; avoiding blind
automatic resend is the intentional safety tradeoff.

Manual completion during a valid lease:

```sql
select public.complete_notification_delivery(
  :'outbox_id'::uuid,
  :'claimed_by',
  :'provider_request_id',
  200,
  'delivered'
);
```

## Scheduler disable and dry-run

Disable the recurring scheduler before:

- Credential repair.
- Provider `403` investigation.
- Replay batches.
- Completion ambiguity triage.
- Any production dry-run.

The repo does not define the scheduler job. Disable it in the Supabase dashboard
or the deployment automation that owns the schedule.

Dry-run sequence:

1. Disable the scheduler.
2. Confirm the selected rows are synthetic and disposable; dry-run consumes
   them by completing them as `would_send`.
3. Set `APNS_DRY_RUN=true`.
4. Invoke one manual `send-apns` run with the worker secret.
5. Confirm only the approved rows completed as `would_send` and no Apple send
   occurred. This validates local signing only, not Apple credential acceptance.
6. Set `APNS_DRY_RUN=false` before real delivery.
7. Re-enable the scheduler after status counts look healthy.

## Monitoring queries

Backlog by status and age:

```sql
select
  status,
  count(*) as rows,
  min(created_at) as oldest_created_at,
  min(available_at) filter (where status in ('pending', 'retry')) as oldest_available_at
from public.notification_outbox
group by status
order by status;
```

Rows ready to claim:

```sql
select count(*) as ready_to_claim
from public.notification_outbox o
join public.push_devices d on d.id = o.device_id
join public.notifications n on n.id = o.notification_id
where o.status in ('pending', 'retry')
  and o.available_at <= statement_timestamp()
  and o.attempt_count < 8
  and d.is_active
  and d.invalidated_at is null
  and o.device_registration_generation = d.registration_generation
  and (n.expires_at is null or n.expires_at > statement_timestamp());
```

Recent terminal failures:

```sql
select
  o.status,
  o.last_error,
  o.provider_response,
  count(*) as rows,
  max(o.updated_at) as latest_update
from public.notification_outbox o
where o.status in ('dead_letter', 'delivery_uncertain', 'expired', 'cancelled')
  and o.updated_at >= statement_timestamp() - interval '24 hours'
group by o.status, o.last_error, o.provider_response
order by latest_update desc;
```

Replay audit:

```sql
select
  id,
  replay_request_id,
  replayed_at,
  replayed_by,
  replay_reason,
  replay_preserved_attempt_count,
  apns_request_id
from public.notification_outbox
where replay_request_id is not null
order by replayed_at desc
limit 100;
```

## Forward recovery closeout

Close the incident only after:

- Scheduler state is intentional for the environment.
- `pending` and `retry` counts are stable or draining.
- `claimed` rows do not have unexpected expired leases and every
  `delivery_uncertain` row has an investigation disposition.
- New provider `403` rows are not appearing.
- Replay audit records include operator reasons and idempotency UUIDs.
- Apple sandbox/TestFlight/production evidence is collected when the incident
  affected those environments.
- CI and mutation-test status are reported only from current artifacts, not from
  this runbook.
