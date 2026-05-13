# iOS Final Regression Troubleshooting

## 1. Xcode build fails

- Package dependencies: use Xcode package resolution and confirm Supabase package is available.
- Derived data: clear DerivedData if Xcode uses stale generated files.
- Simulator target: select a supported iOS simulator target.
- Signing: use simulator build to avoid physical-device signing blockers.
- Deployment target: confirm the selected simulator supports the app deployment target.

## 2. Supabase config invalid

- Wrong config file: confirm Xcode is reading `TECM/Config/Secrets.xcconfig`.
- URL/key missing: confirm `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are set locally.
- Fallback invalid URL: check startup logs for missing/invalid Supabase config.
- Project paused: resume the Supabase project before testing.

## 3. Data does not load

- RLS: confirm anon key has read access for the table being queried.
- Anon key: confirm key belongs to the same Supabase project URL.
- Network: verify simulator can reach the internet and Supabase.
- Empty seed data: confirm records exist in Supabase.
- Auth mismatch: confirm active auth/parent context matches expected data.

## 4. Booking submit fails

- Missing parent profile: confirm app has a valid parent profile/auth context.
- Course/campus lookup fails: confirm selected course/campus exists in Supabase.
- Date/time invalid: confirm selected date/time format matches service expectations.
- RLS insert policy: verify `bookings` insert policy for anon/auth context.
- Booking service error: inspect Xcode console logs around `BookingService.submitBooking()`.

## 5. Notification not visible

- `parent_id` mismatch: notification must target the same parent currently used by iOS.
- Notification created for different parent: compare `notifications.parent_id` with the app user/profile.
- Bridge row exists but notification `parent_id` wrong: inspect both SQL query results.
- App notification list not refreshed: reload the notification screen or restart the app.

## 6. Debugging sequence

1. First check Supabase SQL.
2. Then check Admin Web.
3. Then check iOS logs.
4. Then check network/config.
## Supabase `.xcconfig` runtime fixes

- If the app reports missing `SUPABASE_URL` at runtime, confirm Target Info custom properties include `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
- If `SUPABASE_URL` appears as `https:`, remember `.xcconfig` treats `//` as a comment. Use `SUPABASE_URL = https:/$()/<project-ref>.supabase.co`.
- If the Swift client rejects `SUPABASE_PUBLISHABLE_KEY`, use `SUPABASE_ANON_KEY` for the current client configuration.
- Never commit `Secrets.xcconfig`, actual Supabase keys, or the real project ref in evidence screenshots.
