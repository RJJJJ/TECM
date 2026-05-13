# TECM iOS Final Regression Package

## Purpose

This package defines the final local iOS regression steps for TECM AI Operations v1. It is intended to be executed later inside the VM / Xcode environment to confirm that the iOS App still works after the Admin Web, Supabase, automation endpoint, n8n, and documentation changes.

## Scope

This regression covers:

- Xcode simulator build
- Supabase client configuration and connectivity
- iOS data loading from Supabase
- Booking submission into `public.bookings`
- Parent center booking list/detail behavior
- Parent-facing notification display after Admin Web confirms a booking

It does not add product features and should not require Swift code changes.

## What has already passed before iOS regression

- Supabase schema applied
- `follow_up_tasks` exists
- `booking_parent_notifications` exists
- RLS enabled
- triggers/policies repaired
- Admin Web `/admin/bookings` works
- Admin Web `/admin/bookings/[id]` works
- Admin Web `/admin/follow-ups` works
- confirmed booking notification bridge works
- automation endpoints work
- n8n manual follow-up workflow passed
- n8n daily digest workflow passed
- demo/UAT/evidence docs created
- `npm run lint` passed
- `npm run build` passed

## What this regression must confirm

- The iOS App builds in Xcode without code changes.
- The app launches on a simulator.
- Supabase URL and publishable/anon key are loaded correctly.
- FAQ, courses, and other parent-facing data still load.
- `BookingService.submitBooking()` still inserts into `public.bookings`.
- The new booking appears in Admin Web.
- Parent center can read parent bookings and booking detail.
- Confirmed booking notifications created by Admin Web are visible to the parent-facing iOS notification flow.
- Internal `follow_up_tasks` and AI notes are not exposed to parents.

## Required environment

- VM with Xcode installed
- iOS simulator available
- Repo checked out at the tested commit
- Supabase project resumed
- `TECM/Config/Secrets.xcconfig` configured locally from `TECM/Config/Secrets.template.xcconfig`
- Valid `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` / anon key configured locally
- Admin Web running locally if cross-checking booking visibility
- n8n is not required for iOS booking submit regression

## Checklist order

1. [Xcode build checklist](xcode-build-checklist.md)
2. [Supabase connectivity checklist](supabase-connectivity-checklist.md)
3. [Booking submit regression](booking-submit-regression.md)
4. [Parent center regression](parent-center-regression.md)
5. [Notification regression](notification-regression.md)
6. [Troubleshooting](troubleshooting.md), if needed
7. [Evidence template](evidence-template.md)
8. [Final iOS regression report](final-ios-regression-report.md)

## Important note

This package is documentation only. iOS regression remains pending until it is executed in VM / Xcode and the final report is filled in.
