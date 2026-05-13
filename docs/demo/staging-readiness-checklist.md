# TECM Staging Readiness Checklist

## 1. Required before staging

- [ ] clean git status or reviewed intentional changes only
- [ ] no secrets committed
- [ ] `npm run lint` passed
- [ ] `npm run build` passed
- [ ] audit risk reviewed, including known moderate dependency notes
- [ ] Supabase schema applied
- [ ] environment variables configured
- [ ] Admin login works
- [ ] n8n workflows imported

## 2. Environment variables

### Admin Web

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TECM_AUTOMATION_SECRET`

### Supabase

- Confirm project URL and anon key match the intended staging project.
- Confirm RLS policies are enabled and reviewed.
- Confirm service role key is only used server-side.

### n8n

- Store `TECM_AUTOMATION_SECRET` in n8n credentials or environment configuration.
- Do not store `SUPABASE_SERVICE_ROLE_KEY` in n8n.
- Set workflow `base_url` to the deployed Admin Web URL.

## 3. Deployment notes

- Service role must remain server-side only.
- `TECM_AUTOMATION_SECRET` must be a long random value.
- n8n should call the public deployed Admin Web URL.
- Do not use `localhost` in staging workflows.
- Do not expose service role to n8n.
- Keep v1 workflows manual until staff signs off on output quality.

## 4. Rollback plan

- Disable the n8n workflow.
- Rotate `TECM_AUTOMATION_SECRET` if workflow access is suspected to be exposed.
- Remove `follow_up_tasks` created by `source=n8n` if needed.
- Keep the core booking system independent from n8n so bookings can continue without automation.
