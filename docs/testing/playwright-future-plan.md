# Playwright Future Plan

Credentialed Playwright runs are local-only and use isolated reset data. Never point this suite at staging or production.

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

## Required env vars

- `PLAYWRIGHT_BASE_URL`
- `PLAYWRIGHT_ADMIN_EMAIL`
- `PLAYWRIGHT_ADMIN_PASSWORD`
- `PLAYWRIGHT_TEST_BOOKING_ID`

Do not expose credentials in CI logs or workflow files; CI reads the masked `PLAYWRIGHT_ADMIN_PASSWORD` secret and rejects non-local Supabase URLs.

## Test data strategy

- Prefer staging-only test bookings.
- Prefix test-created records with a clear marker when possible.
- Avoid using real parent phone numbers.
- Clean up or dismiss test follow-up tasks after each run.
