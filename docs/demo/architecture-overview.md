# TECM Architecture Overview

## 1. System architecture

```mermaid
flowchart LR
  IOS[iOS App\nParent-facing] -->|anon key + RLS| SUPA[(Supabase\nPostgres + RLS)]
  ADMIN[Admin Web\nNext.js] -->|server/client data access| SUPA
  N8N[n8n\nWorkflow templates] -->|TECM_AUTOMATION_SECRET| API[Admin Web\nAutomation endpoints]
  API -->|server-side service role| SUPA
  SUPA --> TASKS[follow_up_tasks\nstaff-only]
  SUPA --> NOTIFS[notifications +\nbooking_parent_notifications]
  ADMIN --> TASKS
  ADMIN --> NOTIFS
  STAFF[Staff] -->|manual copy| CHAT[WeChat / WhatsApp]
  ADMIN --> STAFF
```

## 2. Follow-up workflow

```mermaid
flowchart TD
  A[Booking created] --> B[n8n manual workflow]
  B --> C[POST /api/automation/follow-up-preview]
  C --> D[AI output\nSet node in v1 template]
  D --> E[POST /api/automation/follow-up-tasks]
  E --> F[follow_up_tasks row created or updated]
  F --> G[Staff sees /admin/follow-ups dashboard]
  G --> H[Staff manually contacts parent\nvia WeChat / WhatsApp]
  H --> I[Staff marks task done]
```

## 3. Security boundary

```mermaid
flowchart TB
  IOS[iOS App] -->|NEXT_PUBLIC_SUPABASE_ANON_KEY + RLS| SUPA[(Supabase)]
  N8N[n8n] -->|TECM_AUTOMATION_SECRET only| ADMINAPI[Admin Web automation endpoints]
  ADMINAPI -->|SUPABASE_SERVICE_ROLE_KEY\nserver-side only| SUPA
  ADMIN[Admin Web staff UI] --> ADMINAPI
  SUPA --> STAFFONLY[follow_up_tasks\nstaff-only operations data]
  SUPA --> PARENT[Parent notifications\nparent-facing data]
```

## Boundary notes

- n8n only has `TECM_AUTOMATION_SECRET`.
- Admin Web server has `SUPABASE_SERVICE_ROLE_KEY`.
- iOS uses anon key + RLS.
- `follow_up_tasks` are staff-only operational records.
- Parent notifications are separate parent-facing records.
- v1 does not implement direct WeChat auto-send, Supabase realtime triggers, database webhooks, or production auto-run.
