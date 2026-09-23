# Admin Web Test Plan

## Areas

- Login route opens
- Booking list loads
- Booking filters work
- Booking detail loads
- Booking status update works
- Follow-up dashboard loads
- Copy suggested message works
- Mark done works
- Dismiss works
- Confirmed booking notification bridge works

## Suggested future automation

- Component/unit tests for pure formatting helpers
- Server action tests where feasible
- Playwright smoke tests against staging
- Regression screenshots for key admin pages

## Manual checks remain required

Admin auth, Supabase-backed data, and staff workflow should remain part of staging UAT until stable automated coverage exists.

Run Admin Web UAT in a browser Guest profile with all extensions disabled. Browser extensions may inject attributes such as `data-sharkid` before React hydrates the page and create a false hydration-mismatch report; this is not a product failure and must not be worked around with `suppressHydrationWarning` or other product code.
