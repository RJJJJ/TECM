# Admin Web Deployment Guide

Deployment target is TBD. These notes are platform-neutral and can be adapted for Vercel-style hosting, a Node server, or a future Docker host.

## 1. Vercel-style deployment

- Root directory: `admin-web`
- Install command: `npm install`
- Build command: `npm run build`
- Output: Next.js app
- Required environment variables:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `TECM_AUTOMATION_SECRET`
  - `NEXT_PUBLIC_APP_ENV=staging`

Server-side env vars must not be prefixed with `NEXT_PUBLIC`. `SUPABASE_SERVICE_ROLE_KEY` and `TECM_AUTOMATION_SECRET` must remain server-side only.

## 2. Node server deployment

```powershell
cd admin-web
npm install
npm run build
npm run start
```

Reverse proxy, HTTPS, process supervision, and log retention are handled by the chosen platform.

## 3. Docker deployment future note

Docker deployment is not implemented unless a Dockerfile exists. Do not invent or assume a Dockerfile for staging without a separate implementation task. If Docker is added later, keep secrets outside the image and pass them at runtime.

## 4. Post-deploy checks

- [ ] `GET /api/health` returns `ok: true`
- [ ] `/login` loads
- [ ] `/admin/bookings` loads after login
- [ ] `/admin/follow-ups` loads after login
- [ ] invalid automation secret returns `401`
- [ ] valid digest endpoint works
- [ ] deployed logs do not print secrets

## 5. Known deployment blockers

- Missing `SUPABASE_SERVICE_ROLE_KEY`
- Missing `TECM_AUTOMATION_SECRET`
- Supabase project paused
- RLS/auth mismatch
- Next workspace root / multiple lockfile warning
- Staging n8n workflow still using `localhost` or `host.docker.internal`
