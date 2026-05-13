# CI Plan

Do not add GitHub Actions until the team explicitly approves it.

## Future CI candidates

- Admin Web lint
- Admin Web build
- Markdown/diff whitespace checks
- Automation API smoke test against staging only
- Optional future iOS build CI

## Required GitHub Actions secrets for staging smoke tests

- `STAGING_ADMIN_BASE_URL`
- `STAGING_TECM_AUTOMATION_SECRET`
- `STAGING_TEST_BOOKING_ID`

## Security notes

- Do not run Supabase service role tests on public PRs.
- Do not expose staging secrets to forked PRs.
- Do not print secrets in logs.
- Prefer API-level smoke tests over direct DB service-role scripts.

## Why no workflow is added now

The repo is still in v1.1 preparation. CI should be enabled only after staging env values and secret handling are approved.
