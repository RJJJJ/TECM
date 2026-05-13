# Xcode Build Checklist

## 1. Environment

- VM running: `[ ]`
- Xcode version: `<XCODE_VERSION>`
- iOS simulator version: `<IOS_SIMULATOR_VERSION>`
- Repo path: `<LOCAL_REPO_PATH>`
- Branch/commit: `<BRANCH_OR_COMMIT_SHA>`

## 2. Open project

- [ ] Open `TECM.xcodeproj` or workspace if applicable.
- [ ] Select the correct TECM scheme.
- [ ] Select an iOS simulator target.
- [ ] Confirm local config files are present but not committed.

## 3. Build checks

- [ ] Clean build folder
- [ ] Resolve package dependencies
- [ ] Build succeeds
- [ ] No Swift compile errors
- [ ] No missing Supabase package errors
- [ ] No asset/catalog errors
- [ ] No signing blocker for simulator

## 4. Evidence

- Screenshot path: `docs/ios-final-regression/screenshots/01-xcode-build-success.png`
- Build log location: `<LOCAL_BUILD_LOG_PATH>`

## 5. Pass criteria

- App builds successfully on simulator.
- No code changes are required to build.
- If code changes are required, document them separately and do not silently patch during regression.
