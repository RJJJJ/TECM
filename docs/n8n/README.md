# TECM n8n Workflow Templates

## Overview

This folder contains safe v1 n8n workflow templates for TECM booking follow-up automation. n8n calls the Admin Web automation endpoints only; it does not connect directly to Supabase and does not send WeChat / WhatsApp messages automatically.

## Workflow list

| Workflow | File | Setup guide | Purpose |
| --- | --- | --- | --- |
| Manual Booking Follow-up | [`workflows/tecm-booking-follow-up-manual.json`](workflows/tecm-booking-follow-up-manual.json) | [`manual-follow-up-workflow-setup.md`](manual-follow-up-workflow-setup.md) | Manually generate a booking follow-up suggestion and create/update a task in Admin Web. |
| Daily Follow-up Digest | [`workflows/tecm-daily-follow-up-digest.json`](workflows/tecm-daily-follow-up-digest.json) | [`daily-digest-workflow-setup.md`](daily-digest-workflow-setup.md) | Generate a staff-readable digest of open follow-up tasks. |

## Security model

- n8n calls Admin Web automation endpoints with `x-tecm-automation-secret`.
- n8n does **not** receive `SUPABASE_SERVICE_ROLE_KEY`.
- Admin Web remains the server-side authority for Supabase access, validation, and task creation.
- Workflow JSON files use `REPLACE_WITH_TECM_AUTOMATION_SECRET`; never commit a real secret.
- In production, store the automation secret in n8n credentials or environment variables instead of hard-coding it in nodes.

## Local testing

1. Start Admin Web at `http://localhost:3000`.
2. Confirm `.env.local` includes `TECM_AUTOMATION_SECRET` and server-side Supabase variables.
3. Import a workflow JSON from [`workflows/`](workflows/).
4. Replace `base_url`, `automation_secret`, and any test input such as `booking_id` inside n8n.
5. Execute the manual trigger and inspect `/admin/follow-ups`.

If n8n runs in Docker, `localhost` may point to the n8n container. Use `http://host.docker.internal:3000` for the Admin Web host.

## Production cautions

- Keep v1 workflows manual until staff validate output quality and operating procedures.
- Do not add Supabase realtime triggers, database webhooks, or production auto-run until manual workflows are stable.
- Do not add direct WeChat API or auto-send behavior in v1.
- Review imported workflow credentials before sharing exports.

## Why no direct WeChat auto-send in v1

TECM v1 keeps humans in the loop. The workflows generate `suggested_message` or `digest_text`; staff review, copy, and manually send via WeChat / WhatsApp. This avoids accidental parent messaging, provider lock-in, and unsafe automation around personal chat channels.

## Examples

- [`examples/manual-follow-up-ai-output.example.json`](examples/manual-follow-up-ai-output.example.json)
- [`examples/daily-digest-response.example.json`](examples/daily-digest-response.example.json)

## Demo and UAT package

- [TECM AI Operations Demo Package](../demo/README.md)
- [UAT checklist](../demo/uat-checklist.md)
- [Local runbook](../demo/local-runbook.md)
## v1.1 automation readiness

- [v1.1 readiness](../v1.1-readiness/README.md)
- [Staging n8n configuration](../staging-deployment/n8n-staging-configuration.md)
- [Production automation preparation](../production-automation/README.md)
- [Real AI provider preparation](../real-ai-provider/README.md)
- [n8n test plan](../testing/n8n-test-plan.md)

Status: these are preparation documents. The production scheduler and real AI provider are not active.
## v1.1 workflow templates

- [Real AI follow-up template](workflows/tecm-booking-follow-up-real-ai-template.json) — provider-neutral template; not active until configured with n8n credentials.
- [Scheduled daily digest template](workflows/tecm-daily-follow-up-digest-scheduled-template.json) — schedule template; not active until imported and enabled.
- [Future pending booking polling template](workflows/tecm-pending-booking-polling-future-template.json) — disabled future placeholder; backend endpoint is not implemented yet.

All v1.1 templates preserve human-in-the-loop review and do not send WeChat / WhatsApp automatically.
## Staging workflow templates

- [Staging manual follow-up workflow](workflows/staging-tecm-booking-follow-up-manual.json)
- [Staging daily digest workflow](workflows/staging-tecm-daily-follow-up-digest.json)
- [Staging real AI template](workflows/staging-tecm-real-ai-template.json)

Local Docker workflows may use `host.docker.internal`. Staging workflows must use the deployed Admin Web URL and must never use `localhost` or `host.docker.internal`.

n8n must never receive the Supabase service role key. It only needs `TECM_AUTOMATION_SECRET` or provider credentials stored in n8n credentials/env.
