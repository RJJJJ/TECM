# Staging Rollback Plan

If staging automation behaves incorrectly:

1. Disable n8n workflows.
2. Rotate `TECM_AUTOMATION_SECRET` if access may be exposed.
3. Remove, dismiss, or mark done `source=n8n` follow-up tasks if needed.
4. Keep the core booking flow independent from automation.
5. Roll back Admin Web deployment to the previous known-good version.
6. Verify iOS booking still works against the intended Supabase project.
7. Do not drop Supabase tables unless a full backup exists and a rollback owner approves.

Rollback must preserve parent booking data and avoid destructive operations by default.
