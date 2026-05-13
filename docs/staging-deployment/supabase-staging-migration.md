# Supabase Staging Migration

## Apply schema

1. Open the staging Supabase project.
2. Review `supabase_v1_schema.sql` before running it.
3. Apply it using Supabase SQL editor or the chosen migration runner.
4. Re-run in staging only after review to confirm idempotency behavior.

Warning: do not run destructive reset commands on production data. The schema is safer to rerun, but it should still be reviewed before production.

## Verification SQL

### Tables and RLS

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
```

### Triggers

```sql
select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where trigger_schema = 'public'
order by event_object_table, trigger_name;
```

### Policies

```sql
select schemaname, tablename, policyname, permissive, roles, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

### Follow-up tasks via API

Use the deployed Admin Web automation endpoint with a valid staging `TECM_AUTOMATION_SECRET`, then verify:

```sql
select id, booking_id, priority, channel, status, source, created_at
from public.follow_up_tasks
order by created_at desc
limit 20;
```

### Booking parent notification bridge

Confirm a booking in Admin Web, then verify:

```sql
select id, booking_id, notification_id, type, created_at
from public.booking_parent_notifications
order by created_at desc
limit 20;
```
## Verification SQL file

Use [`staging-supabase-verification.sql`](staging-supabase-verification.sql) for non-destructive staging verification queries. The file contains SELECT checks only and does not insert, update, delete, or drop data.
