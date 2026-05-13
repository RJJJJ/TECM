# TECM UAT Results

## 1. Test environment

- Local Windows machine
- Admin Web: `http://localhost:3000`
- n8n Docker: `http://localhost:5678`
- n8n to Admin Web: `http://host.docker.internal:3000`
- Supabase project resumed and schema applied

## 2. Supabase results

| Check | Result | Notes |
| --- | --- | --- |
| Tables exist | Passed | `follow_up_tasks` and `booking_parent_notifications` verified. |
| RLS enabled | Passed | Public tables reviewed with RLS enabled. |
| Trigger repaired | Passed | Trigger checks repaired and verified. |
| Bridge table works | Passed | Confirmed booking creates a bridge row. |

## 3. Admin Web results

| Check | Result | Notes |
| --- | --- | --- |
| Booking list loads | Passed | `/admin/bookings` works locally. |
| Booking detail loads | Passed | `/admin/bookings/[id]` works locally. |
| Follow-up dashboard loads | Passed | `/admin/follow-ups` works locally. |
| Copy / mark done / dismiss works | Passed | Follow-up task actions verified. |
| Confirmed notification bridge works | Passed | Confirmed booking creates parent notification bridge. |

## 4. Automation endpoint results

| Check | Result | Notes |
| --- | --- | --- |
| Wrong secret rejected | Passed | Invalid automation secret returns rejection. |
| Valid digest works | Passed | `/api/automation/follow-up-digest` returns summary and `digest_text`. |
| Preview works | Passed | `/api/automation/follow-up-preview` returns booking context. |
| Create task works | Passed | `/api/automation/follow-up-tasks` creates/updates task. |
| UTF-8 Chinese payload works | Passed | Chinese text preserved with UTF-8 bytes body. |

## 5. n8n results

| Check | Result | Notes |
| --- | --- | --- |
| Docker n8n started | Passed | n8n available at `http://localhost:5678`. |
| Manual workflow imported and executed | Passed | Manual booking follow-up workflow executed end-to-end. |
| Daily digest imported and executed | Passed | Daily digest workflow executed successfully. |
| Chinese encoding issue fixed | Passed | Workflow/example JSON repaired to UTF-8 Traditional Chinese. |
| `source=n8n` task visible in Admin dashboard | Passed | Created task visible in `/admin/follow-ups`. |

## 6. Build results

| Check | Result | Notes |
| --- | --- | --- |
| `npm run lint` passed | Passed | Completed before final evidence pack. |
| `npm run build` passed | Passed | Completed before final evidence pack. |
| `git diff --check` passed | Passed | Re-run for this evidence documentation update. |

## 7. Remaining pending

- iOS VM/Xcode regression (`docs/ios-final-regression/` package prepared; execution still pending)
- staging deployment
- real AI provider node
- production scheduler
- automated test suite
