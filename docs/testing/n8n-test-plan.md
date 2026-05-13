# n8n Test Plan

## Manual workflow tests

- Manual booking follow-up workflow imports
- Manual workflow preview node succeeds
- AI output or fallback node produces valid fields
- Create follow-up task node succeeds
- Admin dashboard shows `source=n8n`
- Daily digest workflow imports
- Digest workflow returns `digest_text`
- No auto-send node exists

## Future scheduler tests

- Schedule Trigger uses Asia/Macau
- Digest runs once at expected time
- Failed executions are visible
- Disabling workflow stops automation immediately

## Security tests

- Workflow JSON contains no real secret
- n8n has no Supabase service role key
- Provider credentials stored only in n8n credentials/env
