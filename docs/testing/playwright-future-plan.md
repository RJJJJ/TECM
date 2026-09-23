# Playwright Future Plan

Credentialed Admin Playwright runs are loopback-only. They use a reset local Supabase instance and deterministic seed organization `10000000-0000-4000-8000-000000000000`. Staging and production URLs, credentials, data, and users are blocked by the test guard.

## What to test

- `/login`
- `/admin/bookings`
- `/admin/bookings/[id]`
- `/admin/follow-ups`
- booking filters
- follow-up filters
- copy button
- mark done / dismiss

## Local command examples

```powershell
cd admin-web
npx playwright test
npx playwright test --headed
```

When local Supabase is intentionally unavailable, a developer may explicitly opt out of credentialed cases with `TECM_E2E_ALLOW_MISSING_SUPABASE=1`. This is a local-only opt-out; CI never accepts skipped credentialed cases.

## Required env vars

- `PLAYWRIGHT_BASE_URL` must be loopback (`http://127.0.0.1:*`)
- `NEXT_PUBLIC_SUPABASE_URL` must be loopback
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` for the Playwright process and local fixture cleanup only
- `TECM_ORGANIZATION_ID` must be the deterministic local organization
- `PLAYWRIGHT_ADMIN_EMAIL`
- `PLAYWRIGHT_ADMIN_PASSWORD`
- `PLAYWRIGHT_TEST_BOOKING_ID` for future booking-focused cases

CI creates an ephemeral local Auth password at run time, masks it, and keeps it in the single credentialed test step. It is not a GitHub password secret, is not written to workflow files, and is not rotated in any staging or production system. The service-role key is loopback-only, step-scoped, and never passed to the browser page or logged.

## Test data strategy

- Use local seed Auth state and deterministic organization fixtures only.
- Prefix every test-created record with a unique run identifier.
- Avoid real parent phone numbers, email addresses, device tokens, APNs, and email delivery.
- Delete or terminalize synthetic records in `finally`/`afterAll`; report cleanup failure separately while preserving the original assertion failure.
- Keep notification outbox and device fixtures coherent, and do not claim provider delivery.
