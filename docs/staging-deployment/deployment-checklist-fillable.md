# Staging Deployment Checklist Fillable

## Deployment metadata

- Git branch: `<branch>`
- Commit SHA: `<commit>`
- Deployment platform: `<platform>`
- Staging Admin Web URL: `<url>`
- Supabase project: `<project name/id without keys>`
- Deployment date: `<YYYY-MM-DD>`
- Operator: `<name>`

## Checklist

- [ ] env vars configured
- [ ] `NEXT_PUBLIC_SUPABASE_URL` configured
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` configured
- [ ] `SUPABASE_SERVICE_ROLE_KEY` configured server-side only
- [ ] `TECM_AUTOMATION_SECRET` configured as long random secret
- [ ] `NEXT_PUBLIC_APP_ENV=staging` configured
- [ ] build passed
- [ ] health endpoint ok
- [ ] login ok
- [ ] Admin booking list ok
- [ ] Follow-ups dashboard ok
- [ ] wrong secret returns `401`
- [ ] digest works
- [ ] preview works
- [ ] create task works
- [ ] n8n staging workflow imported
- [ ] n8n staging workflow executed
- [ ] rollback plan reviewed

## Notes

`<notes>`
