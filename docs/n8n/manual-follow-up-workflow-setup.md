# Manual Booking Follow-up Workflow Setup

## 1. Purpose

Use this workflow to manually test TECM booking follow-up automation. It does not replace the iOS App, Admin Web, or Supabase. It does not automatically send WeChat messages. It only prepares staff-copyable follow-up wording and creates/updates an internal Admin Web follow-up task.

## 2. Prerequisites

- Admin Web running at `http://localhost:3000`.
- Supabase schema applied.
- `admin-web/.env.local` includes:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `TECM_AUTOMATION_SECRET`
- A real `booking_id` exists for testing.
- `POST /api/automation/follow-up-preview` is available.
- `POST /api/automation/follow-up-tasks` is available.

## 3. Import workflow

1. Open n8n.
2. Import from file.
3. Select `docs/n8n/workflows/tecm-booking-follow-up-manual.json`.
4. Replace `base_url` if Admin Web is not `http://localhost:3000`.
5. Set `TECM_AUTOMATION_SECRET` and `TECM_ORGANIZATION_ID` in n8n environment/credentials. Do not place the secret in workflow data or commit the real value.
6. Replace the sample `booking_id` with an existing booking UUID.
7. Execute the workflow from **Manual Trigger**.

For production, store the automation secret in n8n credentials or environment variables instead of hard-coding it in the workflow.

## 4. Expected result

- The preview endpoint returns booking data and `recommended_prompt`.
- The simulated AI output node generates a Chinese follow-up suggestion.
- The follow-up task endpoint creates or updates an open task.
- `/admin/follow-ups` shows a task with `source = n8n`.
- Chinese text renders correctly.
- Staff can manually copy the suggested WeChat / WhatsApp message.

## 5. Troubleshooting

- `401 Unauthorized`: wrong `TECM_AUTOMATION_SECRET` or missing `x-tecm-automation-secret` header.
- `500 Automation secret is not configured`: `.env.local` is missing `TECM_AUTOMATION_SECRET`, or the dev server was not restarted after adding it.
- Service role error: missing or invalid `SUPABASE_SERVICE_ROLE_KEY` in Admin Web server env.
- Docker n8n cannot reach `localhost:3000`: use `http://host.docker.internal:3000` as `base_url`.
- Chinese mojibake in PowerShell tests: send UTF-8 bytes rather than relying on console default encoding.
- Duplicate task: the endpoint may update an existing open `n8n` task for the same booking instead of creating a new row.

## 6. Security notes

- Do not commit the real automation secret.
- Do not put the Supabase service role key into n8n.
- n8n only needs `TECM_AUTOMATION_SECRET`.
- The service role key stays in Admin Web server environment variables.
