# TECM Manual Commands

## Admin Web dev commands

```powershell
cd admin-web
npm install
npm run dev
```

## Build / lint / audit commands

```powershell
cd admin-web
npm run lint
npm run build
npm audit --audit-level=moderate
```

## n8n Docker command

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

## PowerShell UTF-8 endpoint test

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

## Supabase verification SQL

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

select id, booking_id, priority, channel, status, source, created_at
from public.follow_up_tasks
order by created_at desc
limit 20;

select id, booking_id, notification_id, type, created_at
from public.booking_parent_notifications
order by created_at desc
limit 20;
```

## Git safety commands

```powershell
git status --short
git diff --check
git diff --stat
```

If Git reports dubious ownership in this sandbox, use the local command form:

```powershell
git -c safe.directory=C:/Users/RJ/Desktop/TECM diff --check
```
