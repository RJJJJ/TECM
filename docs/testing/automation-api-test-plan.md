# Automation API Test Plan

## Tests

- missing secret
- invalid secret
- digest valid
- preview valid
- create/update task
- UTF-8 Chinese
- wrong `booking_id`
- invalid enum
- missing `suggested_message`

## Expected behavior

- Missing/invalid secret must reject safely.
- Valid digest returns `ok: true` and `digest_text`.
- Valid preview returns booking context.
- Valid create/update task returns `ok: true`.
- Chinese request bodies remain UTF-8.
- Invalid input returns controlled errors, not stack traces with secrets.

## Current script

Use `scripts/testing/automation-api-smoke-test.ps1` for a first repeatable smoke check.
