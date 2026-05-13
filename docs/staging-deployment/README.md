# TECM Staging Deployment Preparation

Staging is not production. It is used to validate deployed Admin Web + staging Supabase + n8n workflows in a production-like environment before any production rollout.

## Rules

- Do not use `localhost` or `host.docker.internal` in staging workflows.
- Use the deployed Admin Web URL as `base_url`.
- Use a long random `TECM_AUTOMATION_SECRET` for staging.
- n8n must not hold `SUPABASE_SERVICE_ROLE_KEY`.
- Staging workflows should remain manual until smoke tests pass.

## Files

- [Admin Web deployment guide](admin-web-deployment-guide.md)
- [Environment variables](environment-variables.md)
- [Supabase staging migration](supabase-staging-migration.md)
- [n8n staging configuration](n8n-staging-configuration.md)
- [Staging smoke test](staging-smoke-test.md)
- [Rollback plan](rollback-plan.md)
