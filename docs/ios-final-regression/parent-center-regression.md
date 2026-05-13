# Parent Center Regression

## Goal

Confirm parent center still reads parent bookings and booking detail.

## Checklist

- [ ] Parent center opens
- [ ] My bookings list loads
- [ ] Latest booking visible
- [ ] Booking detail opens
- [ ] Status visible
- [ ] Course/campus/date/time visible
- [ ] Empty state works if no booking

## Expected result

The parent center should show bookings associated with the active parent profile/auth context. Booking detail should match the latest booking inserted during booking submit regression.

## Possible failure causes

- `parent_id` missing
- Auth user mismatch
- RLS policy issue
- Seeded booking has `parent_id` null
- App using mock profile instead of real auth profile

## Evidence

- Parent booking list screenshot: `docs/ios-final-regression/screenshots/08-parent-center-booking-list.png`
- Parent booking detail screenshot: `docs/ios-final-regression/screenshots/09-parent-center-booking-detail.png`
