# Final iOS Regression Report

Status: Local full-stack RC passed, with iOS visual notification display still pending unless separately verified in the iOS UI.

## 1. Regression date

- [x] 2026-05-14

## 2. Operator

- [x] RJ

## 3. Commit SHA

- [ ] `<COMMIT_SHA>`

## 4. VM / Xcode version

- [x] VM: local VM used for Xcode regression
- [ ] Xcode: `<XCODE_VERSION>`

## 5. Simulator model / iOS version

- [ ] Simulator model: `<SIMULATOR_MODEL>`
- [ ] iOS version: `<IOS_VERSION>`

## 6. Build result

- [x] Passed
- [ ] Failed
- Notes: Xcode build passed in VM.

## 7. Supabase connectivity result

- [x] Passed
- [ ] Failed
- Notes: Supabase config was fixed and app runtime connectivity passed.

## 8. Booking submit result

- [x] Passed
- [ ] Failed
- Notes: iOS booking submit passed; iOS-created booking appeared in Supabase `public.bookings` and Admin Web `/admin/bookings`.

## 9. Parent center result

- [ ] Passed
- [ ] Failed
- Notes: `<PARENT_CENTER_NOTES>`

## 10. Notification result

- [ ] Passed
- [ ] Failed
- Notes: Admin pending to confirmed passed; `public.notifications` row and `public.booking_parent_notifications` row were created. iOS visual notification display remains pending unless separately verified in the iOS UI.

## 11. Issues found

1. Missing `SUPABASE_URL` at runtime.
2. `SUPABASE_URL` parsed as `https:`.
3. `SUPABASE_PUBLISHABLE_KEY` mismatch with current Swift client configuration.

## 12. Fixes applied

1. Added `SUPABASE_URL` and `SUPABASE_ANON_KEY` to Target Info custom properties so runtime Info values are injected. Do not commit actual keys.
2. In `.xcconfig`, use `SUPABASE_URL = https:/$()/<project-ref>.supabase.co` because `//` is parsed as a comment. Do not write the real project ref in committed docs.
3. Use `SUPABASE_ANON_KEY` for the current Supabase Swift client configuration. Do not commit `Secrets.xcconfig`.

## 13. Final decision

- [ ] Pending execution
- [x] Passed for local full-stack RC, excluding explicitly pending iOS visual notification display
- [ ] Failed; requires fixes before release candidate

Do not mark iOS notification display as passed until it is actually verified in the iOS UI.
