# Xcode Error Triage Table

| Symptom | Likely Cause | Check | Fix Strategy | Escalation |
|---|---|---|---|---|
| Package resolution failed | Network, GitHub access, or package cache issue | Xcode package resolution logs | Retry package resolution; clear package cache if needed | Capture log and pause if package version conflict appears |
| Supabase module not found | Package not resolved or target not linked | Package dependencies and target settings | Resolve packages and verify target dependency | Document exact missing module error |
| `Secrets.xcconfig` missing | Local config not created in VM | `TECM/Config/Secrets.xcconfig` exists locally | Copy from template and fill local values outside git | Do not commit real secrets |
| Invalid Supabase URL | Wrong or empty `SUPABASE_URL` | Info.plist resolved value / app logs | Correct local config and rebuild | Confirm project URL belongs to intended Supabase project |
| Simulator signing issue | Physical-device signing settings applied | Selected destination and signing settings | Use simulator target; avoid production signing changes | Escalate only if simulator cannot build |
| Build succeeds but app crashes on launch | Config, environment, or startup service issue | Xcode console crash logs | Check Supabase config and provider initialization | Capture stack trace before changes |
| Data fetch empty | Empty seed data, RLS, wrong project, or auth mismatch | Supabase SQL and app logs | Verify table rows and anon access | Compare staging/local project IDs |
| Booking submit fails | RLS insert policy, invalid form data, service error | Xcode console and Supabase table | Verify required fields, parent profile, and insert policy | Capture failed request/error body |
| Notification not visible | Parent mismatch or notification list not refreshed | `notifications.parent_id`, bridge row, app state | Refresh app and compare parent IDs | Document if parent auth linkage blocks test |
| RLS / parent profile mismatch | Test data not linked to current parent | SQL checks for `parent_id` | Use a booking/profile with matching parent ID | Do not loosen RLS just for demo without review |
