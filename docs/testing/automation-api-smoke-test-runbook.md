# Automation API Smoke Test Runbook

Use this runbook to repeat local or staging automation endpoint checks without hard-coding secrets.

## Script

`scripts/testing/automation-api-smoke-test.ps1`

## Required parameters

- `BaseUrl`: Admin Web base URL.
- `AutomationSecret`: `TECM_AUTOMATION_SECRET`; the script prints only its length.
- `BookingId`: an existing booking UUID.

## Local example

```powershell
.\scripts\testing\automation-api-smoke-test.ps1 `
  -BaseUrl "http://localhost:3000" `
  -AutomationSecret "<secret>" `
  -BookingId "<booking-id>"
```

## Staging example

```powershell
.\scripts\testing\automation-api-smoke-test.ps1 `
  -BaseUrl "https://<staging-admin-web>" `
  -AutomationSecret "<staging-secret>" `
  -BookingId "<staging-booking-id>"
```

## Dry run

```powershell
.\scripts\testing\automation-api-smoke-test.ps1 `
  -AutomationSecret "placeholder" `
  -BookingId "placeholder" `
  -DryRun
```

## Checks performed

- Missing secret is rejected.
- Invalid secret returns `401`.
- Digest endpoint returns `ok: true`.
- Preview endpoint returns booking and `recommended_prompt`.
- Create/update follow-up task returns `ok: true`.
- Chinese request payload is sent as UTF-8 bytes.

## Exit codes

- `0`: all checks passed.
- `1`: one or more endpoint checks failed.
- `2`: required parameter missing.

## Safety

- The script does not print the full automation secret.
- The script does not contain real secrets.
- The create task check may create or update an open follow-up task for the provided booking. Staff may dismiss it after verification.
## Related staging smoke test

After deployment, use the staging-specific script:

```powershell
.\scripts\testing\staging-smoke-test.ps1 `
  -BaseUrl "https://tecm-admin-staging.example.com" `
  -AutomationSecret "<staging-secret>" `
  -BookingId "<booking-uuid>"
```

Expected output is a PASS/FAIL summary. The script must not print the full secret.
