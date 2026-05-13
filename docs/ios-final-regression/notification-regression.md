# Notification Regression

## Goal

Confirm confirmed booking parent-facing notification can be read by iOS `NotificationService`.

## Context

Admin Web can create `public.notifications` when booking is confirmed, with a bridge record in `public.booking_parent_notifications`. iOS `NotificationService` reads `public.notifications` by `parent_id`.

## Test steps

1. Create or find booking with `parent_id`.
2. In Admin Web, change status from `pending` to `confirmed`.
3. Confirm notifications row created.
4. Confirm `booking_parent_notifications` row created.
5. Open iOS App parent center / notifications area.
6. Confirm notification appears.

## SQL checks

```sql
select *
from public.notifications
order by created_at desc
limit 10;
```

```sql
select *
from public.booking_parent_notifications
order by created_at desc
limit 10;
```

## Pass criteria

- Notification title visible.
- Notification detail visible.
- No duplicate notification after repeated confirmed save.
- Internal `follow_up_tasks` are not visible to parent.

## Important

Do not expose internal AI follow-up notes to parent.

## Evidence

- Supabase notification screenshot: `docs/ios-final-regression/screenshots/10-supabase-notification-row.png`
- Supabase bridge screenshot: `docs/ios-final-regression/screenshots/11-supabase-notification-bridge.png`
- iOS notification screenshot: `docs/ios-final-regression/screenshots/12-ios-notification-visible.png`
