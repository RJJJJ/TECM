# TECM Release Gate Checklist

## Gate 1: Local RC

Pass criteria:
- [ ] Supabase schema applied locally
- [ ] Admin Web booking and follow-up flows pass locally
- [ ] Automation endpoints pass locally
- [ ] n8n manual workflows pass locally
- [ ] `npm run lint` passed
- [ ] `npm run build` passed
- [ ] evidence pack completed

Status: local RC completed before v1.1 preparation, pending final documentation review.

## Gate 2: iOS RC

Pass criteria:
- [x] Xcode build succeeds in VM
- [x] iOS app launches on simulator
- [ ] Supabase data loads
- [x] booking submit creates `public.bookings` row
- [x] Admin Web sees iOS booking
- [ ] parent center reads booking
- [x] Admin confirmed notification bridge creates `public.notifications` and `public.booking_parent_notifications` rows
- [ ] confirmed booking notification visible in iOS when parent linkage supports it
- [ ] final iOS regression report completed

Status: core iOS RC checks passed for build, launch, booking submit, Supabase/Admin visibility, and Admin notification bridge. iOS visual notification display remains pending unless verified in the iOS UI.

## Gate 3: Staging RC

Pass criteria:
- [ ] Admin Web deployed to staging
- [ ] staging Supabase schema applied and verified
- [ ] staging env vars configured
- [ ] n8n workflows imported with deployed Admin Web URL
- [ ] staging smoke test passed
- [ ] no service role key in n8n
- [ ] no secrets exposed in repo or logs

Status: pending.

## Gate 4: Production candidate

Pass criteria:
- [ ] iOS RC passed
- [ ] staging RC passed
- [ ] scheduler upgrade plan approved
- [ ] real AI provider output validated in staging
- [ ] fallback policy tested
- [ ] production rollback plan reviewed
- [ ] direct WeChat auto-send remains excluded

Status: pending.
## Staging deployment support update

- Full Local RC: Passed.
- iOS core regression: Passed for build, launch, booking submit, Supabase/Admin visibility, and Admin notification bridge.
- Staging deployment: support package prepared, pending execution.
- Production scheduler: template prepared, not active.
- Real AI provider: template prepared, not configured.
- Automated smoke tests: local script prepared; staging smoke test script added.
- iOS visual notification display: pending unless explicitly verified in the iOS UI.

Do not treat staging as passed until `docs/staging-deployment/staging-validation-results-template.md` is completed with real evidence.
