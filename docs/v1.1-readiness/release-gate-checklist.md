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
- [ ] Xcode build succeeds in VM
- [ ] iOS app launches on simulator
- [ ] Supabase data loads
- [ ] booking submit creates `public.bookings` row
- [ ] Admin Web sees iOS booking
- [ ] parent center reads booking
- [ ] confirmed booking notification visible in iOS when parent linkage supports it
- [ ] final iOS regression report completed

Status: pending execution.

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
