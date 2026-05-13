# TECM Evidence Index

| Area | Evidence | Status | Notes |
|---|---|---|---|
| Supabase schema | SQL query result: 14 public tables with RLS enabled | Passed | Local Supabase project resumed and schema applied. Screenshot placeholder: `docs/demo/screenshots/11-supabase-rls-table-check.png` |
| Supabase schema | `follow_up_tasks` table exists | Passed | Evidence placeholder: `docs/demo/screenshots/08-supabase-follow-up-tasks.png` |
| Supabase schema | `booking_parent_notifications` table exists | Passed | Evidence placeholder: `docs/demo/screenshots/09-supabase-notification-bridge.png` |
| Supabase schema | Trigger check | Passed | Triggers repaired during local UAT; evidence can be captured from Supabase SQL result. |
| Supabase schema | Policy check | Passed | Policies repaired and RLS enabled; evidence can be captured from Supabase SQL result. |
| Admin Web | `/admin/bookings` screenshot | Passed | Placeholder: `docs/demo/screenshots/01-admin-bookings-list.png` |
| Admin Web | `/admin/bookings/[id]` screenshot | Passed | Placeholder: `docs/demo/screenshots/02-booking-detail.png` |
| Admin Web | `/admin/follow-ups` screenshot | Passed | Placeholder: `docs/demo/screenshots/04-follow-ups-dashboard.png` |
| Admin Web | `npm run build` output | Passed | Placeholder: `docs/demo/screenshots/10-build-success.png` |
| Automation API | Invalid secret test | Passed | Invalid `x-tecm-automation-secret` rejected. |
| Automation API | `follow-up-digest` valid test | Passed | Digest endpoint returned valid summary and `digest_text`. |
| Automation API | `follow-up-preview` valid test | Passed | Preview endpoint returned booking context. |
| Automation API | `follow-up-tasks` create test | Passed | Task created/updated successfully. |
| Automation API | UTF-8 Chinese payload test | Passed | PowerShell UTF-8 bytes body preserved Chinese text. |
| n8n | Manual workflow canvas | Passed | Placeholder: `docs/demo/screenshots/05-n8n-manual-workflow.png` |
| n8n | Manual execution success | Passed | Placeholder: `docs/demo/screenshots/06-n8n-manual-success.png` |
| n8n | Daily digest workflow success | Passed | Placeholder: `docs/demo/screenshots/07-n8n-daily-digest.png` |
| n8n | Admin follow-up task created from `source=n8n` | Passed | Visible in `/admin/follow-ups`. Placeholder: `docs/demo/screenshots/04-follow-ups-dashboard.png` |
| Demo package | Demo scripts | Complete | `docs/demo/demo-script-5min.md`, `docs/demo/demo-script-10min.md` |
| Demo package | UAT checklist | Complete | `docs/demo/uat-checklist.md` |
| Demo package | Local runbook | Complete | `docs/demo/local-runbook.md` |
| Demo package | Architecture overview | Complete | `docs/demo/architecture-overview.md` |
| Demo package | Portfolio writeup | Complete | `docs/demo/portfolio-writeup.md` |
| Security | `.env.local` not committed | Passed | Real local env files remain out of git. |
| Security | Service role remains server-side | Passed | n8n does not receive Supabase service role key. |
| Security | Workflow JSON has placeholder secret only | Passed | Uses `REPLACE_WITH_TECM_AUTOMATION_SECRET`. |
| Security | No direct WeChat auto-send | Passed | Staff manually copies WeChat / WhatsApp text. |
