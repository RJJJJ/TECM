# Admin Web Deployment Guide

Deployment target is TBD. These notes are platform-neutral and can be adapted for Vercel, a Node server, or a Docker host.

## Build commands

```powershell
npm install
npm run build
```

## Start command for Node server

```powershell
npm run start
```

## Required environment variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TECM_AUTOMATION_SECRET`

## Security

- `SUPABASE_SERVICE_ROLE_KEY` must be server-only.
- Never expose the service role key as `NEXT_PUBLIC_*`.
- `TECM_AUTOMATION_SECRET` must be long and random.
- Do not print secrets in deployment logs.

## Platform notes

### Vercel

- Configure env vars in project settings.
- Confirm server-side routes can access `SUPABASE_SERVICE_ROLE_KEY`.
- Use the generated deployment URL for smoke testing.

### Node server

- Install dependencies.
- Build once.
- Run `npm run start` behind the chosen process manager/reverse proxy.
- Configure env vars in the server environment.

### Docker host

- Build and run using a platform-specific Dockerfile if one is introduced later.
- Keep env vars outside the image.
- Do not bake secrets into image layers.

## Post-deploy checks

- [ ] `/login` opens
- [ ] `/admin/bookings` opens after auth
- [ ] `/admin/follow-ups` opens after auth
- [ ] `/api/automation/follow-up-digest` rejects wrong secret with `401`
- [ ] valid automation secret works against staging Supabase
- [ ] deployed logs do not print secret values
