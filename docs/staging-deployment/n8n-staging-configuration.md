# n8n Staging Configuration

## Steps

1. Import `docs/n8n/workflows/tecm-booking-follow-up-manual.json`.
2. Import `docs/n8n/workflows/tecm-daily-follow-up-digest.json`.
3. Replace `base_url` with deployed staging Admin Web URL.
4. Replace `automation_secret` with the staging automation secret stored in n8n credentials/env.
5. Do not use `host.docker.internal` in staging.
6. Test manual follow-up workflow first.
7. Confirm `/admin/follow-ups` shows `source=n8n`.
8. Test daily digest workflow.
9. Only after stable manual results, consider Schedule Trigger for digest.

## Security

- Do not put `SUPABASE_SERVICE_ROLE_KEY` into n8n.
- Do not export workflow JSON containing real secrets.
- Do not configure direct WeChat auto-send.
