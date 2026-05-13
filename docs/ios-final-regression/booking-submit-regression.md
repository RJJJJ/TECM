# Booking Submit Regression

## Goal

Confirm `BookingService.submitBooking()` in the iOS App still inserts into `public.bookings` and Admin Web can see the result.

## Steps

1. Launch iOS App.
2. Navigate to booking/reservation flow.
3. Choose course.
4. Fill parent name, phone, school, date/time, and note.
5. Submit booking.
6. Confirm success UI.
7. Check Supabase `public.bookings` table.
8. Check Admin Web `/admin/bookings`.
9. Open booking detail.

## Expected result

- Booking created with status `pending`.
- `course_title_snapshot` present.
- `parent_name`, `phone`, and `child_name` correct.
- `booking_date`, `start_time`, and `end_time` correct.
- Admin Web shows booking.
- No n8n dependency required for booking submit.

## Important

Booking submit should not depend on n8n. If n8n is off, booking should still work.

## SQL verification

```sql
select id, parent_name, phone, child_name, course_title_snapshot, booking_date, start_time, end_time, status, created_at
from public.bookings
order by created_at desc
limit 5;
```

## Evidence

- iOS success UI screenshot: `docs/ios-final-regression/screenshots/05-booking-submit-success.png`
- Supabase row screenshot: `docs/ios-final-regression/screenshots/06-supabase-booking-row.png`
- Admin Web latest booking screenshot: `docs/ios-final-regression/screenshots/07-admin-latest-booking.png`
