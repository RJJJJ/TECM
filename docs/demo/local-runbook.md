# TECM Local Runbook

## 1. Start Admin Web

```powershell
cd admin-web
npm install
npm run dev
```

Do not run `npm install` unless dependencies are missing or the package lock intentionally needs to be refreshed.

## 2. Required `.env.local`

Create `admin-web/.env.local` with local/staging values. Keep real values out of git.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
TECM_AUTOMATION_SECRET=
```

Restart the dev server after changing `.env.local`.

## 3. Start n8n Docker

```powershell
docker volume create n8n_data

docker run -it --rm `
  --name n8n `
  -p 5678:5678 `
  -e GENERIC_TIMEZONE="Asia/Macau" `
  -e TZ="Asia/Macau" `
  -e N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true `
  -e N8N_RUNNERS_ENABLED=true `
  -v n8n_data:/home/node/.n8n `
  docker.n8n.io/n8nio/n8n
```

## 4. URLs

- Admin Web: `http://localhost:3000`
- n8n: `http://localhost:5678`
- n8n to Admin Web from Docker: `http://host.docker.internal:3000`

## 5. Test commands

PowerShell UTF-8 endpoint test:

```powershell
chcp 65001
$body = [System.Text.Encoding]::UTF8.GetBytes('{"booking_id":"<BOOKING_UUID>","note":"家長想了解 Python 課程"}')
Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:3000/api/automation/follow-up-preview" `
  -ContentType "application/json; charset=utf-8" `
  -Headers @{ "x-tecm-automation-secret" = $env:TECM_AUTOMATION_SECRET } `
  -Body $body
```

For n8n Docker, use `http://host.docker.internal:3000` as the workflow `base_url`.

## 6. Common errors

### `401 Unauthorized`

The `x-tecm-automation-secret` header is missing or does not match `TECM_AUTOMATION_SECRET`.

### `500 Automation secret is not configured`

`TECM_AUTOMATION_SECRET` is missing in `admin-web/.env.local`, or the dev server was not restarted after adding it.

### Service role missing

`SUPABASE_SERVICE_ROLE_KEY` is missing or invalid in the Admin Web server environment. Do not put this key into n8n.

### Docker localhost issue

Inside the n8n Docker container, `localhost` points to the container. Use `http://host.docker.internal:3000` to call the host Admin Web.

### Next `.next` cache issue

If local Next.js output appears stale after environment or migration changes, stop the dev server, remove `.next`, and restart `npm run dev`.

### Chinese mojibake

Send JSON request bodies as UTF-8 bytes in PowerShell and ensure workflow templates are saved as UTF-8. Do not rely on console default encoding for Chinese text.
