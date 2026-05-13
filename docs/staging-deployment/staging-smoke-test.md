# Staging Smoke Test

## Admin Web

- [ ] GET /api/health returns ok: true and env presence booleans only
- [ ] `/login` opens
- [ ] `/admin/bookings` opens
- [ ] `/admin/follow-ups` opens
- [ ] `/admin/bookings/[id]` opens

## Supabase

- [ ] courses load
- [ ] bookings load
- [ ] follow_up_tasks load
- [ ] notifications load

## Automation

- [ ] wrong secret returns `401`
- [ ] digest endpoint returns `ok: true`
- [ ] preview endpoint returns booking
- [ ] create endpoint creates task

## n8n

- [ ] manual workflow creates `source=n8n` task
- [ ] daily digest returns `digest_text`
- [ ] no auto-send

## Security

- [ ] no service role in n8n
- [ ] no real secrets in repo
- [ ] deployed logs do not print secrets
