# Staging Validation Results Template

Default status: Pending. Do not mark staging as passed until the deployed environment is actually tested.

## Metadata

- Date: `<YYYY-MM-DD>`
- Operator: `<name>`
- Admin Web URL: `<url>`
- Supabase project: `<project name/id without keys>`
- n8n instance: `<url or name>`

## Results

| Area | Check | Result | Evidence | Notes |
|---|---|---|---|---|
| Admin Web | `/login` opens | Pending | `<path>` | |
| Admin Web | `/admin/bookings` opens | Pending | `<path>` | |
| Admin Web | `/admin/follow-ups` opens | Pending | `<path>` | |
| Automation | wrong secret returns `401` | Pending | `<path>` | |
| Automation | digest returns `ok: true` | Pending | `<path>` | |
| Automation | preview returns booking | Pending | `<path>` | |
| Automation | create task returns `ok: true` | Pending | `<path>` | |
| n8n | manual workflow creates `source=n8n` task | Pending | `<path>` | |
| n8n | scheduled digest template imports | Pending | `<path>` | |
| Security | no service role key in n8n | Pending | `<path>` | |

## Final decision

- [ ] Pending
- [ ] Passed staging smoke test
- [ ] Failed; fixes required
