# TECM v1.1 Readiness Package

TECM AI Operations v1 has reached local release-candidate status. v1.1 readiness is not a new feature push; it prepares the next validation and hardening work needed before staging and production automation.

## v1 local RC status

Local RC evidence exists for Supabase schema, Admin Web operations, automation endpoints, n8n manual workflows, demo/UAT docs, final evidence pack, and iOS regression preparation. iOS VM / Xcode execution is still pending and must not be marked passed until actually run.

## v1.1 goals

- Regression: execute final iOS VM / Xcode checks.
- Staging: prepare deployed Admin Web + Supabase + n8n validation.
- Automation hardening: prepare scheduler, real AI provider, and safer production workflow stages.
- Test harness: start repeatable smoke testing, beginning with automation API checks.

## Three workstreams

1. [iOS final regression](../ios-final-regression/README.md)
2. [Staging deployment](../staging-deployment/README.md)
3. [Production automation / tests](../production-automation/README.md), [real AI provider](../real-ai-provider/README.md), and [testing](../testing/README.md)

## Files

- [Execution roadmap](execution-roadmap.md)
- [Risk register](risk-register.md)
- [Release gate checklist](release-gate-checklist.md)
- [Manual commands](manual-commands.md)
## v1.1 practical support files

- [Real AI workflow template](../n8n/workflows/tecm-booking-follow-up-real-ai-template.json)
- [Scheduled daily digest workflow template](../n8n/workflows/tecm-daily-follow-up-digest-scheduled-template.json)
- [Future pending booking polling workflow template](../n8n/workflows/tecm-pending-booking-polling-future-template.json)
- [Automation API smoke test runbook](../testing/automation-api-smoke-test-runbook.md)
- [Staging env example](../staging-deployment/staging-env.example)
- [Playwright future plan](../testing/playwright-future-plan.md)

These are preparation/support assets. Staging is not deployed, real AI provider is not active, and production scheduler is not active.
