# Playwright Future Plan

Playwright is not enabled yet. Do not add dependencies or modify `package.json` until auth setup, staging environment, and test data isolation are approved.

## What to test

- `/login`
- `/admin/bookings`
- `/admin/bookings/[id]`
- `/admin/follow-ups`
- booking filters
- follow-up filters
- copy button
- mark done / dismiss

## Why not enabled yet

- Needs admin auth setup.
- Needs staging env with stable URL.
- Needs isolated test data and cleanup strategy.
- Needs decision on whether screenshots/videos are stored as artifacts.

## Future command examples

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

Do not expose credentials in public CI logs or workflow files.

## Test data strategy

- Prefer staging-only test bookings.
- Prefix test-created records with a clear marker when possible.
- Avoid using real parent phone numbers.
- Clean up or dismiss test follow-up tasks after each run.
