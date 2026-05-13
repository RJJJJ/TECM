# TECM UAT Checklist

## 1. Supabase schema

- [ ] `follow_up_tasks` exists
- [ ] `booking_parent_notifications` exists
- [ ] RLS enabled
- [ ] triggers exist
- [ ] policies exist

## 2. Admin booking

- [ ] booking list loads
- [ ] filters work
- [ ] booking detail loads
- [ ] status update works
- [ ] status log works

## 3. Follow-up dashboard

- [ ] open task visible
- [ ] priority badge visible
- [ ] channel badge visible
- [ ] copy works
- [ ] mark done works
- [ ] dismiss works
- [ ] filters work

## 4. Parent notification bridge

- [ ] pending to confirmed creates notification
- [ ] bridge row created
- [ ] duplicate confirmed does not create duplicate

## 5. Automation endpoints

- [ ] invalid secret returns `401`
- [ ] missing secret returns safe `500`
- [ ] digest endpoint returns `ok: true`
- [ ] preview endpoint returns booking
- [ ] create endpoint creates task
- [ ] Chinese UTF-8 preserved

## 6. n8n

- [ ] Docker n8n starts
- [ ] manual workflow imports
- [ ] `base_url` uses `host.docker.internal` when Docker
- [ ] preview node succeeds
- [ ] create task node succeeds
- [ ] dashboard shows `source=n8n`
- [ ] digest workflow succeeds

## 7. Security

- [ ] `.env.local` not committed
- [ ] service role key not in n8n
- [ ] workflow JSON contains no real secret
- [ ] no direct WeChat auto-send

## 8. Build

- [ ] `npm run lint` passed
- [ ] `npm run build` passed
- [ ] `git diff --check` passed
