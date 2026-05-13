# TECM v1.1 Execution Roadmap

## Phase 1: iOS VM / Xcode final regression

Goal: confirm the iOS app still builds, connects to Supabase, submits bookings, reads parent center data, and displays parent notifications after Admin Web / Supabase / automation changes.

Inputs:
- `docs/ios-final-regression/`
- active Supabase project
- local Admin Web for cross-checking booking visibility

Exit criteria:
- final iOS regression report completed
- evidence screenshots/logs captured
- no unresolved blocker for build, booking submit, or notification display

## Phase 2: Staging deployment

Goal: deploy Admin Web and connect it to staging Supabase and staging n8n workflows.

Inputs:
- `docs/staging-deployment/`
- staging env vars
- deployed Admin Web URL
- staging Supabase project

Exit criteria:
- staging smoke test passed
- invalid secret returns 401
- n8n manual workflow creates `source=n8n` task
- no secrets exposed in repo, workflow JSON, or logs

## Phase 3: n8n scheduler + real AI provider

Goal: safely upgrade from manual workflows to scheduled digest and provider-backed AI suggestions.

Inputs:
- `docs/production-automation/`
- `docs/real-ai-provider/`

Exit criteria:
- daily digest schedule tested in staging
- AI provider output validated against schema
- fallback policy tested
- no direct WeChat auto-send

## Phase 4: automated tests and CI

Goal: reduce repeated manual verification through smoke tests and future CI.

Inputs:
- `docs/testing/`
- `scripts/testing/automation-api-smoke-test.ps1`

Exit criteria:
- automation API smoke test repeatable locally/staging
- CI plan approved before adding workflows
- secrets only configured in protected CI/staging settings
