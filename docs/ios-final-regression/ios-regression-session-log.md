# TECM iOS Regression Session Log

Status: Core iOS build / launch / booking regression passed. iOS visual notification display remains pending unless separately verified in the iOS UI.

- Date: `2026-05-14`
- Operator: `RJ`
- VM name: `<VM_NAME>`
- Xcode version: `<XCODE_VERSION>`
- Simulator: `<SIMULATOR_MODEL_AND_IOS_VERSION>`
- Branch: `<BRANCH>`
- Commit SHA: `<COMMIT_SHA>`
- Supabase project: `<PROJECT_NAME_OR_ID_WITHOUT_KEYS>`
- Admin Web status: `RUNNING during cross-check`
- Test result summary: `Local full-stack RC passed, except visual iOS notification display pending`

| Step | Expected | Actual | Status | Evidence | Notes |
|---|---|---|---|---|---|
| VM boot | VM starts and repo is accessible | VM/Xcode environment used | Passed | `<path>` | |
| Xcode open | `TECM.xcodeproj` opens with correct scheme | Project opened | Passed | `<path>` | |
| Build | Simulator build succeeds | Xcode build passed | Passed | `<path>` | |
| App launch | App launches without crash | App launch passed | Passed | `<path>` | |
| Supabase config | Runtime config loads URL and anon key | Config fixed and loaded | Passed | `<path>` | Target Info properties added locally; no secrets committed. |
| Courses load | Courses render from Supabase or graceful empty state appears | App run passed after config fix | Passed | `<path>` | |
| FAQ load | FAQ renders from Supabase or graceful empty state appears | App run passed after config fix | Passed | `<path>` | |
| Booking submit | Booking success UI appears | iOS booking submit passed | Passed | `<path>` | |
| Supabase booking row | Latest booking row exists | iOS-created booking appeared in `public.bookings` | Passed | `<path>` | |
| Admin Web booking visibility | Latest booking appears in `/admin/bookings` | iOS-created booking appeared in Admin Web | Passed | `<path>` | Booking detail opened. |
| Admin confirmed bridge | Pending booking can be confirmed and creates notification records | pending to confirmed passed; notifications and bridge rows created | Passed | `<path>` | |
| Confirmed notification visual display | Parent notification appears in iOS UI | Pending unless separately verified in iOS UI | Pending | `<path>` | Do not mark passed until visually verified. |
| Final decision | Pass/fail decision recorded | Local full-stack RC passed except pending visual notification display | Passed with pending item | `<path>` | |

## iOS config issues fixed

1. Missing `SUPABASE_URL` at runtime
   - Root cause: `Secrets.xcconfig` values existed in Build Settings but were not injected into Target Info runtime properties.
   - Fix: added `SUPABASE_URL` and `SUPABASE_ANON_KEY` to Target Info custom properties.

2. `SUPABASE_URL` parsed as `https:`
   - Root cause: `.xcconfig` treats `//` as comment.
   - Fix: use `SUPABASE_URL = https:/$()/<project-ref>.supabase.co`.

3. `SUPABASE_PUBLISHABLE_KEY` mismatch
   - Root cause: current Swift client initialization works with `SUPABASE_ANON_KEY`.
   - Fix: use `SUPABASE_ANON_KEY` in `SupabaseConfig` / `SupabaseClientProvider` runtime configuration.

Do not commit actual project refs, keys, or `Secrets.xcconfig`.
