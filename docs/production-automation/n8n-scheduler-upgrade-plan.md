# n8n Scheduler Upgrade Plan

## Stage 0: Manual workflow only

- Goal: preserve current safe v1 behavior.
- Required endpoint: preview, create task, digest endpoints.
- Failure risk: operator error in workflow config.
- Rollback: stop executing manual workflow.
- Acceptance test: manual workflow creates `source=n8n` task and digest returns text.

## Stage 1: Daily digest Schedule Trigger at 09:00 Asia/Macau

- Goal: remind staff daily about open follow-up tasks.
- Required endpoint: `POST /api/automation/follow-up-digest`.
- Failure risk: duplicate or noisy staff reminders.
- Rollback: disable Schedule Trigger.
- Acceptance test: scheduled execution returns `digest_text`; no auto-send occurs.

## Stage 2: Polling pending bookings every 15 or 30 minutes

- Goal: create follow-up tasks for new pending bookings that need staff attention.
- Required endpoint: future pending-booking discovery endpoint or approved existing preview flow.
- Failure risk: duplicates, excessive API calls, wrong booking selection.
- Rollback: disable polling workflow and dismiss unwanted `source=n8n` tasks.
- Acceptance test: one task per eligible booking; repeated runs do not create duplicates.

## Stage 3: Real AI provider generates suggestions

- Goal: replace simulated AI output with provider-backed suggestions.
- Required endpoint: preview endpoint plus follow-up task endpoint.
- Failure risk: invalid JSON, hallucinated details, unsafe wording.
- Rollback: restore simulated/manual Set node or fallback template.
- Acceptance test: outputs pass schema validation and staff review.

## Stage 4: Monitoring and failure alerts

- Goal: make workflow failures visible to operators.
- Required endpoint: n8n execution logs and chosen alerting channel.
- Failure risk: alert fatigue or leaking sensitive payloads.
- Rollback: disable alert workflow.
- Acceptance test: test failure creates a safe internal alert without secrets.
