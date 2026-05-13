# Supabase Test Plan

## Manual verification

- Tables exist
- RLS enabled
- policies exist
- triggers exist
- `follow_up_tasks` stores automation tasks
- `booking_parent_notifications` links confirmed bookings to notifications

## Suggested SQL checks

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

select schemaname, tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

select event_object_table, trigger_name
from information_schema.triggers
where trigger_schema = 'public'
order by event_object_table, trigger_name;
```

## Future automation

- Non-destructive schema checks
- Staging seed data validation
- API-level insert/read tests through Admin Web routes rather than direct service role scripts
