# Foundation security migration runbook

This runbook covers `202607180005_foundation_security.sql`. It is a forward-only
foundation gate: it does not deploy production, send real messages, or change the
APNs worker/outbox reliability design.

## Preflight

Run the read-only report against the target database before applying the migration:

```powershell
psql $env:TASK_DATABASE_URL -v ON_ERROR_STOP=1 `
  -f scripts/testing/foundation-security-preflight.sql
```

Proceed only when `safe_to_apply` is `t`. The inferable counts may be non-zero;
those are same-tenant null identities that the migration fills deterministically.
Any unsafe parent link, unsafe notification recipient, or normalized leave-key
collision is a stop condition. Record the affected organization and row IDs in a
restricted operational ticket; do not place names, email addresses, tokens, or
message bodies in logs.

## Apply and verify

Apply migrations in timestamp order. The migration repeats its preflight inside
the transaction and aborts before backfill if unsafe rows exist. After application:

```sql
select public.foundation_security_preflight();
```

The service-role-only function must report `safe_to_apply: true` and zero unsafe
counts. Run `scripts/testing/database-verify.ps1` separately; it proves a fresh
bootstrap, repeated seed, repeated migration, a negative no-partial-apply preflight,
all SQL suites, the invitation race, and both device race orderings on PostgreSQL 15
(matching `supabase/config.toml`).

## Forward recovery

There is no destructive down migration. If preflight blocks, leave the migration
unapplied, investigate tenant ownership from authoritative records, correct only
the conflicting rows in a reviewed organization-scoped repair, rerun preflight,
and then reapply the same migration. If a later verification fails after commit,
disable affected parent accounts through `disable_parent_account`, retain invitation
history, correct data with a new additive migration, and rerun the complete gate.
Never delete invitation, leave, notification, or device audit history to recover.

## Scope boundary

Passing this runbook proves database/RLS, parent lifecycle, timezone isolation,
leave idempotency, and registration/disable locking only. APNs credentials, live
delivery, outbox retry/dead-letter behavior, TestFlight, and production deployment
remain explicitly not passed by this foundation gate.
