# Testing Scripts

This folder contains local/staging smoke test helpers. Scripts must not contain real secrets.

## Automation API smoke test

Use `automation-api-smoke-test.ps1` with explicit parameters:

```powershell
.\scripts\testing\automation-api-smoke-test.ps1 `
  -BaseUrl "http://localhost:3000" `
  -AutomationSecret "<secret>" `
  -BookingId "<booking_uuid>"
```

The script does not write files by default and does not print the full secret.
