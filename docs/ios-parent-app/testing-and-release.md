# Testing and release gate

Use this checklist to decide whether the parent-app notification work is ready
to release. A gate is not passed until the named command or external evidence
has been collected for the current branch and environment.

## Local verification

Run these from the repository root:

```powershell
./scripts/testing/database-verify.ps1
Set-Location admin-web
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
Set-Location ..
node scripts/testing/validate-n8n.mjs
node scripts/testing/repository-security-scan.mjs
deno check supabase/functions/send-apns/index.ts
```

`database-verify.ps1` covers the SQL suites, including
`supabase/tests/009_apns_outbox_reliability.sql` and
`supabase/tests/010_apns_dispatch_ambiguity.sql` when the branch includes the
APNs outbox reliability migrations.

## CI gate

The current GitHub workflow is `.github/workflows/release-validation.yml`.
It defines:

| Job | Evidence |
| --- | --- |
| `database` | `./scripts/testing/database-verify.ps1` on PostgreSQL 15 |
| `admin-web` | install, lint, typecheck, unit tests, build, high-severity audit |
| `repository-safety` | n8n validation, repository security scan, `deno check send-apns` |
| `admin-e2e` | local Supabase reset plus Playwright Chromium/WebKit flows |
| `ios` | Xcode package resolve, unsigned simulator build, Swift tests |

Do not mark CI or mutation testing as passed from documentation alone. Use the
latest workflow artifacts for the exact commit under review.

Every job runs `scripts/testing/verify-ci-checkout.sh` immediately after
checkout. For a pull request, the job intentionally tests GitHub's synthetic
merge ref and verifies that its first parent equals the event Base SHA, its
second parent equals the event Head SHA, and checked-out `HEAD` equals
`GITHUB_SHA`. For a push, it verifies `HEAD == GITHUB_SHA`. A mismatch fails the
job; CI evidence must not be described as a direct PR Head checkout.

## APNs reliability gate

Local/mock APNs evidence can pass before Apple evidence:

1. Mock sender tests cover safe payload copy, endpoint selection, stable
   `apns-id`, APNs timeout, provider-token construction, response
   classification, dry-run, provider failure stop, and completion ambiguity.
2. SQL suites 009-010 cover outbox statuses, the durable pre-send dispatch
   boundary, non-reclaimable delivery uncertainty, retry ceilings, generation
   cancellation, service-role-only RPC access, controlled replay idempotency,
   concurrency, and FORCE RLS/search-path checks.
3. Dry-run can validate worker secrets and database transitions without Apple:
   claimed rows complete as `would_send`, not `delivered`.

NOT PASSED by local/mock evidence:

- Sandbox push to a physical development-signed iPhone.
- TestFlight push to a production-token iPhone.
- App Store production APNs delivery.
- Apple Developer account, entitlement, key, provisioning profile, and device
  evidence.
- Production scheduler behavior under live load.

## Apple sandbox gate

Required evidence:

- A development-signed build with the Push Notifications entitlement.
- A registered sandbox token stored through `register_push_device`.
- `push_devices.environment = 'sandbox'` for the claimed row.
- `APNS_BUNDLE_ID` matching the app bundle.
- A worker invocation with `APNS_DRY_RUN=false`.
- A delivered notification on a physical iPhone, including foreground,
  background, tap route, and badge behavior where applicable.

Record the outbox row, `apns_request_id`, APNs provider request id if present,
and device generation used for the test.

## TestFlight and production gate

Required evidence:

- Production-signed TestFlight or App Store build.
- `push_devices.environment = 'production'`.
- Production APNs endpoint selection.
- Real device receipt for foreground, background, tap route, and badge behavior
  where applicable.
- Scheduler owner, cadence, and rollback-free forward recovery procedure.

Do not use simulator notification injection as production APNs evidence.

## Simulator gate

Simulator notification injection only verifies app handling of a payload file:

```powershell
xcrun simctl push booted app.TECM docs/ios-parent-app/fixtures/notification.apns
```

It does not verify APNs provider auth, device-token registration, Apple network
delivery, entitlement correctness, or production endpoint behavior.

## iOS logout and leave-operation lifecycle

Logout immediately clears local notification, protected-route, badge, and
Realtime state, then gives remote push-device deactivation a bounded five-second
attempt before continuing to Supabase logout. Remote cleanup, network, or
Supabase logout errors cannot retain authenticated UI state. The app also clears
the local session and parent cache. Any incomplete remote cleanup is reported
with generic copy that contains no account, child, session, or device-token data.
The APNs sender's generic lock-screen payload remains the privacy boundary for a
stale remote registration.

One in-memory `ParentLeaveOperation` owns the idempotency key for a logical
student/session/reason submission. An uncertain retry reuses that operation;
parallel taps are rejected; success closes it and prevents the same payload
from being submitted again during that view-model lifetime. A changed payload
starts a new operation with a new key. Pending operations are intentionally not
persisted because the reason and student/session association are sensitive.
View recreation or app relaunch therefore never auto-replays a leave request;
the parent must reload server state before starting another submission.

## Release checklist

- Database migration and APNs SQL suite passed for the current commit.
- Admin web lint, typecheck, tests, build, audit, and E2E passed for the current
  commit.
- `deno check supabase/functions/send-apns/index.ts` passed for the current
  commit.
- iOS simulator build and Swift tests passed on macOS.
- APNs sandbox physical-device gate passed.
- TestFlight or production APNs gate passed before public release.
- `APNS_DRY_RUN` value is intentional for the target environment.
- Scheduler is enabled only after credential and dry-run checks are complete.
- `docs/ios-parent-app/apns-outbox-recovery-runbook.md` has been reviewed by
  the release operator.

## Recovery stance

APNs outbox recovery is forward-only. Do not describe recovery as rollback.
Disable the scheduler, repair credentials or data, use the service-role replay
RPC only for investigated, eligible `dead_letter` or `delivery_uncertain` rows,
and keep operator evidence on each replay. Generic claim/recovery never resends
`delivery_uncertain` rows.
