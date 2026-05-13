# Staging Validation Results Template

Default status: Pending. Do not mark staging as passed until the deployed environment is actually tested.

## 1. Deployment metadata

- Date: `<YYYY-MM-DD>`
- Operator: `<name>`
- Git branch: `<branch>`
- Commit SHA: `<commit>`
- Admin Web URL: `<url>`
- Supabase project: `<project name/id without keys>`
- n8n instance: `<url or name>`

## 2. Health check result

| Check | Result | Evidence | Notes |
|---|---|---|---|
| `GET /api/health` returns `ok: true` | Pending | `<path>` | |
| env presence booleans are true | Pending | `<path>` | Does not expose values. |

## 3. Admin Web route checks

| Check | Result | Evidence | Notes |
|---|---|---|---|
| `/login` opens | Pending | `<path>` | |
| `/admin/bookings` opens | Pending | `<path>` | |
| `/admin/bookings/[id]` opens | Pending | `<path>` | |
| `/admin/follow-ups` opens | Pending | `<path>` | |

## 4. Automation API checks

| Check | Result | Evidence | Notes |
|---|---|---|---|
| wrong secret returns `401` | Pending | `<path>` | |
| digest returns `ok: true` | Pending | `<path>` | |
| preview returns booking | Pending | `<path>` | |
| create task returns `ok: true` | Pending | `<path>` | |

## 5. n8n staging workflow checks

| Check | Result | Evidence | Notes |
|---|---|---|---|
| staging manual workflow imports | Pending | `<path>` | |
| staging manual workflow creates `source=n8n_staging` task | Pending | `<path>` | |
| staging digest workflow imports | Pending | `<path>` | |
| staging real AI template imports | Pending | `<path>` | Template only unless provider configured. |

## 6. Security checks

| Check | Result | Evidence | Notes |
|---|---|---|---|
| no service role key in n8n | Pending | `<path>` | |
| no real secrets in repo | Pending | `<path>` | |
| logs do not print secrets | Pending | `<path>` | |
| no direct WeChat auto-send | Pending | `<path>` | |

## 7. Issues found

- `<issue>`

## 8. Final decision

- [ ] Pending
- [ ] Passed staging smoke test
- [ ] Failed; fixes required
