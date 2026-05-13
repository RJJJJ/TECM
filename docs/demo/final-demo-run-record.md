# TECM Final Demo Run Record

Demo run name: TECM AI Operations v1 Local Demo Run

Date: YYYY-MM-DD

Operator: RJ

| Step | Expected result | Actual result | Evidence screenshot path | Status |
| --- | --- | --- | --- | --- |
| 1. Start Admin Web | Admin Web starts at `http://localhost:3000`. | Passed locally. | `docs/demo/screenshots/10-build-success.png` | Passed |
| 2. Start n8n Docker | n8n starts at `http://localhost:5678`. | Passed locally. | `docs/demo/screenshots/05-n8n-manual-workflow.png` | Passed |
| 3. Open `/admin/follow-ups` | Follow-up dashboard loads. | Passed locally. | `docs/demo/screenshots/04-follow-ups-dashboard.png` | Passed |
| 4. Run n8n manual workflow | Workflow executes preview, AI output, and create task nodes. | Passed locally. | `docs/demo/screenshots/06-n8n-manual-success.png` | Passed |
| 5. Confirm `source=n8n` task appears | Admin dashboard shows n8n-created task. | Passed locally. | `docs/demo/screenshots/04-follow-ups-dashboard.png` | Passed |
| 6. Copy suggested message | Staff can copy Chinese suggested message. | Passed locally. | `docs/demo/screenshots/03-ai-follow-up-card.png` | Passed |
| 7. Mark task done | Task can be marked done. | Passed locally. | `docs/demo/screenshots/04-follow-ups-dashboard.png` | Passed |
| 8. Confirm booking | Booking can be updated to confirmed. | Passed locally. | `docs/demo/screenshots/02-booking-detail.png` | Passed |
| 9. Verify parent notification bridge | `booking_parent_notifications` bridge row exists. | Passed locally. | `docs/demo/screenshots/09-supabase-notification-bridge.png` | Passed |
| 10. Run daily digest workflow | Digest workflow returns summary and `digest_text`. | Passed locally. | `docs/demo/screenshots/07-n8n-daily-digest.png` | Passed |
