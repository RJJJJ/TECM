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
`supabase/tests/009_apns_outbox_reliability.sql` when the branch includes the
APNs outbox reliability migration.

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

## APNs reliability gate

Local/mock APNs evidence can pass before Apple evidence:

1. Mock sender tests cover safe payload copy, endpoint selection, stable
   `apns-id`, APNs timeout, provider-token construction, response
   classification, dry-run, provider failure stop, and completion ambiguity.
2. SQL suite 009 covers outbox statuses, leases, retry ceilings, generation
   cancellation, service-role-only RPC access, replay idempotency, and FORCE
   RLS/search-path checks.
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
RPC only for eligible `dead_letter` rows, and keep operator evidence on each
replay.
