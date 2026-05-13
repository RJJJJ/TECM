# Booking Follow-up Polling Design

## Future workflow design

- Trigger: Schedule Trigger every 15 or 30 minutes
- Goal: identify pending bookings without an open n8n/automation follow-up task
- Action: create a follow-up task for staff review
- Safety: no dependency on iOS booking submit and no direct parent message send

## Candidate flow

1. Schedule Trigger runs.
2. Workflow calls a future endpoint that lists pending bookings without open automation follow-up tasks.
3. For each eligible booking, call preview endpoint.
4. Generate or fallback to follow-up suggestion.
5. Call create follow-up task endpoint.
6. Admin staff reviews task manually.

## Current API gap

If the current API lacks a list-pending-without-follow-up endpoint, treat that as a future endpoint requirement. Do not implement the endpoint as part of this design document.

## Duplicate avoidance

Use the existing database/API duplicate protection for open n8n/automation tasks. Acceptance requires repeated polling runs to avoid duplicate open tasks for the same booking.

## Acceptance test

- [ ] One eligible pending booking creates one follow-up task
- [ ] Re-running workflow does not create duplicate open task
- [ ] iOS booking submit still works when n8n is off
- [ ] No direct WeChat auto-send
