# n8n Validation Checklist

## Manual Follow-up

- [ ] Admin Web running
- [ ] `TECM_AUTOMATION_SECRET` configured
- [ ] `booking_id` exists
- [ ] workflow imported
- [ ] `follow-up-preview` returns booking
- [ ] AI output generated
- [ ] `follow-up-tasks` returns `ok: true`
- [ ] `/admin/follow-ups` shows task
- [ ] Chinese text normal
- [ ] `source = n8n`
- [ ] no WeChat auto-send

## Daily Digest

- [ ] workflow imported
- [ ] `follow-up-digest` returns `ok: true`
- [ ] summary values correct
- [ ] `digest_text` readable
- [ ] staff can copy `digest_text` manually
- [ ] no secret exposed

## Security

- [ ] workflow JSON contains no real secret
- [ ] `.env.local` not committed
- [ ] service role key not in n8n workflow
- [ ] invalid secret returns `401`
