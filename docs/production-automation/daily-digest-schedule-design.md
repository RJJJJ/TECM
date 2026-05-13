# Daily Digest Schedule Design

## Design

- Trigger: Schedule Trigger
- Time: daily at 09:00 Asia/Macau
- Endpoint: `POST /api/automation/follow-up-digest`
- Output: `digest_text`
- Staff action: manually copy `digest_text` to WeChat / WhatsApp group
- Auto-send: not allowed

## n8n config table

| Setting | Value |
| --- | --- |
| Timezone | `Asia/Macau` |
| Trigger | Schedule Trigger |
| Frequency | Daily |
| Time | `09:00` |
| URL | `<DEPLOYED_ADMIN_WEB_URL>/api/automation/follow-up-digest` |
| Auth | `x-tecm-automation-secret` header |

## Test checklist

- [ ] Manual digest workflow passes first
- [ ] Schedule Trigger set to Asia/Macau
- [ ] Endpoint returns `ok: true`
- [ ] `digest_text` readable
- [ ] No auto-send node connected
- [ ] Failed execution visible in n8n logs

## Failure behavior

If digest fails, staff can still open `/admin/follow-ups` directly. Do not block core booking operations.

## Duplicate handling

Daily digest is read-only and should not create tasks. Multiple digest runs may repeat the same open tasks; staff should treat it as a summary, not a new task source.
