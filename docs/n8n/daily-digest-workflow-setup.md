# Daily Follow-up Digest Workflow Setup

## 1. Purpose

Use this workflow to generate a daily follow-up digest for staff. It returns summary values, open task items, and `digest_text`. Staff manually copy `digest_text` to the WeChat / WhatsApp work group. This workflow does not auto-send messages.

## 2. Import workflow

1. Open n8n.
2. Import from file.
3. Select `docs/n8n/workflows/tecm-daily-follow-up-digest.json`.
4. Replace `base_url` if Admin Web is not `http://localhost:3000`.
5. Replace `REPLACE_WITH_TECM_AUTOMATION_SECRET` inside n8n only.
6. Execute the workflow from **Manual Trigger**.

## 3. Optional schedule mode

v1 is intentionally manual. After staff validate the workflow, the **Manual Trigger** can be replaced with a **Schedule Trigger**, for example daily at 09:00. Do not enable production auto-run until the manual workflow is stable and approved.

## 4. Expected output

- `summary`
- `items`
- `digest_text`
- `admin_follow_ups_url`

## 5. Staff operating procedure

1. Open `/admin/follow-ups`.
2. Process high-priority tasks first.
3. Copy the suggested message when contacting a parent.
4. Contact the parent manually by WeChat / WhatsApp.
5. Mark completed tasks as done.
6. Dismiss irrelevant tasks.

## 6. Troubleshooting

- `401 Unauthorized`: wrong `TECM_AUTOMATION_SECRET` or missing `x-tecm-automation-secret` header.
- `500 Automation secret is not configured`: `.env.local` is missing `TECM_AUTOMATION_SECRET`, or the dev server was not restarted.
- Service role error: missing or invalid `SUPABASE_SERVICE_ROLE_KEY` in Admin Web server env.
- Docker n8n cannot reach `localhost:3000`: use `http://host.docker.internal:3000` as `base_url`.
- Empty digest: confirm open follow-up tasks exist and match the configured `status`.
- Chinese mojibake in PowerShell tests: send UTF-8 bytes for JSON request bodies.
