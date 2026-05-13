# TECM Screenshot Checklist

| # | Filename suggestion | What to capture | Why it matters | Portfolio required |
| --- | --- | --- | --- | --- |
| 1 | `screenshots/01-admin-home-nav.png` | Admin Web home or navigation layout | Shows staff entry point and admin IA | Yes |
| 2 | `screenshots/02-admin-bookings-list.png` | `/admin/bookings` list with sample bookings | Shows staff can manage parent bookings | Yes |
| 3 | `screenshots/03-booking-detail.png` | `/admin/bookings/[id]` booking detail | Shows structured booking context | Yes |
| 4 | `screenshots/04-ai-follow-up-card.png` | AI follow-up suggestion card on booking detail | Shows AI-assisted operations in context | Yes |
| 5 | `screenshots/05-follow-ups-dashboard.png` | `/admin/follow-ups` dashboard | Shows central follow-up queue | Yes |
| 6 | `screenshots/06-follow-up-filters.png` | Follow-up filters | Shows staff can triage tasks | Optional |
| 7 | `screenshots/07-copy-suggested-message.png` | Copy suggested message interaction | Shows human-in-the-loop manual contact | Yes |
| 8 | `screenshots/08-mark-done-dismiss.png` | Mark done / dismiss controls | Shows task lifecycle management | Yes |
| 9 | `screenshots/09-supabase-follow-up-tasks.png` | Supabase `follow_up_tasks` table | Shows backend persistence | Optional |
| 10 | `screenshots/10-supabase-booking-parent-notifications.png` | Supabase `booking_parent_notifications` table | Shows confirmed booking notification bridge | Optional |
| 11 | `screenshots/11-n8n-manual-workflow-canvas.png` | n8n manual workflow canvas | Shows external automation workflow | Yes |
| 12 | `screenshots/12-n8n-successful-execution.png` | Successful n8n execution result | Shows workflow works end-to-end | Yes |
| 13 | `screenshots/13-n8n-daily-digest-workflow.png` | n8n daily digest workflow | Shows daily operations summary path | Yes |
| 14 | `screenshots/14-npm-build-success.png` | `npm run build` success output | Shows production build readiness | Yes |
| 15 | `screenshots/15-npm-audit-result.png` | `npm audit` result and moderate notes | Shows known dependency risk reviewed | Optional |
| 16 | `screenshots/16-supabase-rls-table-check.png` | Supabase RLS table check | Shows database access control review | Optional |

## Notes

- Blur or redact any parent phone number, secret, API key, service role key, email, or private Supabase project URL before using screenshots externally.
- Prefer demo data over real parent data.
- Keep screenshots in a separate ignored `screenshots/` folder unless intentionally adding sanitized assets.
