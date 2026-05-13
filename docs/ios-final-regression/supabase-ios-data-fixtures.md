# Supabase iOS Data Fixtures

This document helps prepare safe read-only checks for iOS regression. Do not include real keys. Avoid destructive SQL. Optional insert examples are demo-only and must be reviewed before use.

## Confirm courses exist

```sql
select id, title, status, created_at
from public.courses
order by created_at desc
limit 20;
```

## Confirm campuses exist

```sql
select id, name, address, created_at
from public.campuses
order by created_at desc
limit 20;
```

## Confirm FAQ exists

```sql
select id, question, answer, created_at
from public.faq_items
order by created_at desc
limit 20;
```

If the FAQ table name differs in the current schema, inspect public tables first:

```sql
select tablename
from pg_tables
where schemaname = 'public'
order by tablename;
```

## Find latest booking

```sql
select id, parent_id, parent_name, phone, child_name, course_title_snapshot, booking_date, start_time, end_time, status, created_at
from public.bookings
order by created_at desc
limit 10;
```

## Verify parent profile

```sql
select id, user_id, name, phone, created_at
from public.parents
order by created_at desc
limit 20;
```

If the active iOS app uses an auth user, compare the parent/profile ID used by the app with booking and notification rows.

## Identify a booking with `parent_id`

```sql
select id, parent_id, parent_name, phone, child_name, status, created_at
from public.bookings
where parent_id is not null
order by created_at desc
limit 10;
```

## Verify notifications for a parent

```sql
select id, parent_id, title, body, created_at
from public.notifications
order by created_at desc
limit 10;
```

## Verify booking notification bridge

```sql
select id, booking_id, notification_id, type, created_at
from public.booking_parent_notifications
order by created_at desc
limit 10;
```

## Demo-only optional insert example

Use only in a disposable local/staging project after reviewing required columns and RLS. Do not run against production data.

```sql
-- Demo-only placeholder. Adjust columns to current schema before use.
-- insert into public.bookings (parent_name, phone, child_name, booking_date, start_time, end_time, status)
-- values ('Demo Parent', '+853 0000 0000', 'Demo Child', current_date, '10:00', '11:00', 'pending');
```
