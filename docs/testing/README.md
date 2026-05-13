# TECM Testing Preparation

Manual UAT has already been completed for the local RC. This folder prepares repeatable smoke tests so v1.1 validation can become less manual over time.

## Current test status

- Admin Web lint/build passed locally before v1.1 preparation.
- Automation endpoints passed manual local UAT.
- n8n manual workflows passed local UAT.
- iOS automated tests remain future work.

## First automated target

The first automated target is the automation API smoke test:

- `scripts/testing/automation-api-smoke-test.ps1`

This script uses a caller-provided base URL, automation secret, and booking ID. It does not contain real secrets.

## Files

- [Admin Web test plan](admin-web-test-plan.md)
- [Automation API test plan](automation-api-test-plan.md)
- [Supabase test plan](supabase-test-plan.md)
- [n8n test plan](n8n-test-plan.md)
- [CI plan](ci-plan.md)
## New test support

- [Automation API smoke test runbook](automation-api-smoke-test-runbook.md)
- [Playwright future plan](playwright-future-plan.md)

The smoke test script is available, but full automated coverage and Playwright are not enabled yet.
