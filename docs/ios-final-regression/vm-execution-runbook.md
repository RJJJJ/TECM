# TECM iOS VM / Xcode Regression Execution Runbook

## 1. Before opening VM

- [ ] Current branch recorded
- [ ] Commit SHA recorded
- [ ] Working tree clean or intentional docs-only changes noted
- [ ] Supabase project active
- [ ] Admin Web can run locally
- [ ] iOS config template present: `TECM/Config/Secrets.template.xcconfig`
- [ ] Local `Secrets.xcconfig` prepared inside VM if needed
- [ ] No secrets committed

## 2. VM startup

1. Boot VM.
2. Open repo folder.
3. Confirm Xcode version.
4. Confirm simulator version.
5. Confirm Git branch and commit SHA.
6. Open `docs/ios-final-regression/ios-regression-session-log.md` and start filling the session log.

## 3. Xcode project open

1. Open `TECM.xcodeproj` unless a workspace exists and is required.
2. Select the TECM scheme.
3. Select a simulator.
4. Resolve package dependencies.
5. Clean build folder.
6. Build.

## 4. Minimum iOS regression path

- [ ] Launch app
- [ ] Courses load
- [ ] FAQ load
- [ ] Booking submit
- [ ] Booking appears in Supabase
- [ ] Booking appears in Admin Web
- [ ] Confirm booking in Admin Web
- [ ] Notification appears in iOS if parent auth/profile linkage supports it

## 5. Evidence collection

- Xcode build screenshot
- App launch screenshot
- Course page screenshot
- Booking submit screenshot
- Supabase booking row screenshot
- Admin Web booking row screenshot
- Notification screenshot

Use the paths in `evidence-template.md` where possible.

## 6. If blocked

- Do not patch blindly.
- Document the exact error.
- Capture screenshot/log.
- Update `ios-regression-session-log.md`.
- Use `xcode-error-triage-table.md` to choose the next diagnostic step.
