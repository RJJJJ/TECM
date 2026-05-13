# TECM AI Operations v1 Local Release Candidate Summary

This is a local release candidate, not a production release.

## 1. What is included

- iOS parent-facing app foundation
- Admin Web booking operations
- Supabase data layer with RLS boundaries
- `follow_up_tasks` staff operations table
- `booking_parent_notifications` bridge
- Admin follow-up dashboard
- AI follow-up suggestion flow
- Automation endpoints for preview, task creation, and digest
- n8n manual booking follow-up workflow
- n8n daily digest workflow
- Demo, UAT, runbook, architecture, and portfolio documentation

## 2. What has passed local UAT

- Supabase schema applied and repaired locally
- RLS, triggers, and policies verified locally
- Admin booking list, detail, and follow-up dashboard verified locally
- Copy suggested message, mark done, and dismiss verified locally
- Confirmed booking parent notification bridge verified locally
- Automation endpoints verified locally
- Invalid automation secret rejection verified locally
- UTF-8 Chinese payload verified locally
- `npm run lint` passed
- `npm run build` passed
- n8n Docker workflows imported and executed locally

## 3. What is intentionally not included

- Direct WeChat auto-send is intentionally excluded.
- Supabase realtime triggers are not included in v1.
- Database webhooks are not included in v1.
- Production scheduler is not enabled in v1.
- n8n does not receive Supabase service role key.

## 4. Remaining blockers before production

- Core iOS VM/Xcode regression has passed for build, launch, booking submit, Supabase/Admin visibility, and Admin notification bridge. iOS visual notification display remains pending unless verified in the iOS UI.
- Staging deployment remains pending.
- Real AI provider node remains pending.
- Production scheduler remains pending.
- Automated test suite remains pending.
- Final production security review remains pending.

## 5. Recommended next steps

1. Capture sanitized evidence screenshots under `docs/demo/screenshots/` or an external evidence folder.
2. Complete the iOS VM/Xcode regression package in `docs/ios-final-regression/`, including build, Supabase connectivity, booking submit, parent center, and notification checks.
3. Deploy staging Admin Web and apply staging Supabase schema.
4. Import n8n workflows into staging and replace local URLs with deployed Admin Web URL.
5. Add real AI provider node after staff approves prompt/output format.
6. Add scheduled daily digest only after manual workflow remains stable.
7. Perform production readiness review before public launch.
## v1.1 readiness references

- [v1.1 readiness package](../v1.1-readiness/README.md)
- [Staging deployment package](../staging-deployment/README.md)
- [Production automation package](../production-automation/README.md)
- [Real AI provider package](../real-ai-provider/README.md)
- [Testing package](../testing/README.md)

These packages prepare next steps only; they do not mean iOS regression, staging deployment, production scheduler, real AI provider integration, or full automated tests have passed.
## v1.1 practical templates

- [Real AI workflow template](../n8n/workflows/tecm-booking-follow-up-real-ai-template.json)
- [Scheduled daily digest workflow template](../n8n/workflows/tecm-daily-follow-up-digest-scheduled-template.json)
- [Future pending booking polling template](../n8n/workflows/tecm-pending-booking-polling-future-template.json)
- [Automation API smoke test runbook](../testing/automation-api-smoke-test-runbook.md)
- [Staging env example](../staging-deployment/staging-env.example)

These are templates/support files. Staging is not deployed, real AI provider is not active, production scheduler is not active, and direct WeChat auto-send remains excluded.
