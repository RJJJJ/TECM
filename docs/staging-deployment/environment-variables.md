# Staging Environment Variables

| Variable | Required | Scope | Example | Secret? | Notes |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Admin Web client/server | `https://example.supabase.co` | No | Staging Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Admin Web client/server | `eyJ...placeholder` | Public-ish | Anon key only; still do not paste real values into docs. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Admin Web server only | `replace-with-server-secret` | Yes | Never expose to browser or n8n. |
| `TECM_AUTOMATION_SECRET` | Yes | Admin Web server and n8n credential/env | `replace-with-long-random-secret` | Yes | Shared secret for automation endpoints. |
| AI provider key | Optional | n8n credential only | `replace-with-provider-key` | Yes | Keep in n8n credentials, not repo or workflow JSON. |

## Boundary clarification

- Admin Web needs the service role key server-side for automation endpoints.
- n8n needs only `TECM_AUTOMATION_SECRET` to call Admin Web endpoints.
- AI keys should live in n8n credentials or protected environment variables.
