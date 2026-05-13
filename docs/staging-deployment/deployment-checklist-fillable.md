# Staging Deployment Checklist Fillable

## Deployment metadata

- Deployment platform: `<platform>`
- Deployed Admin Web URL: `<url>`
- Supabase project: `<project name/id without keys>`
- Deployment date: `<YYYY-MM-DD>`
- Operator: `<name>`

## Checklist

- [ ] env vars configured
- [ ] `NEXT_PUBLIC_SUPABASE_URL` configured
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` configured
- [ ] `SUPABASE_SERVICE_ROLE_KEY` configured server-side only
- [ ] `TECM_AUTOMATION_SECRET` configured as long random secret
- [ ] build passed
- [ ] `/login` opens
- [ ] `/admin/bookings` opens
- [ ] `/admin/follow-ups` opens
- [ ] wrong secret returns `401`
- [ ] digest works
- [ ] preview works
- [ ] create task works
- [ ] n8n `base_url` updated to deployed Admin Web URL
- [ ] n8n manual workflow creates `source=n8n` task
- [ ] daily digest works
- [ ] rollback plan reviewed

## Notes

`<notes>`
