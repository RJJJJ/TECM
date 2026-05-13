# TECM n8n Validation Results

## 1. Manual Booking Follow-up Workflow

Import status: passed

### Config

- `base_url = http://host.docker.internal:3000`
- `automation_secret = local placeholder`
- `booking_id = test booking id`

### Result

- Preview node passed.
- AI output node passed.
- Create follow-up task node passed.
- Admin dashboard shows `source=n8n`.
- Chinese text normal after UTF-8 fix.

## 2. Daily Digest Workflow

Import status: passed

### Result

- Digest endpoint returned summary.
- `digest_text` generated.
- No auto-send behavior occurred.
- Staff manual copy workflow confirmed.

## 3. Issues encountered and fixes

| Issue | Fix | Status |
| --- | --- | --- |
| Docker localhost issue | Use `http://host.docker.internal:3000` for n8n Docker to call Admin Web. | Fixed |
| Workflow JSON Chinese `???` issue | Repaired workflow/example JSON files as UTF-8 Traditional Chinese. | Fixed |
| PowerShell Chinese payload issue | Send request body as UTF-8 bytes. | Fixed |
| Next `.next` cache chunk issue | Remove `.next` and restart dev server. | Fixed |

## 4. Security validation

- n8n has only automation secret.
- n8n does not receive Supabase service role key.
- No direct WeChat API is included.
- No real secret is stored in workflow JSON.
