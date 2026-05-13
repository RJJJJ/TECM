# Known Limitations and Future Work

## Current limitations

- iOS visual notification display pending unless verified in the iOS UI; core iOS build/launch/booking regression passed
- n8n workflow v1 manual only
- AI output currently simulated in workflow template
- no production scheduler
- no direct WeChat API
- audit still has moderate Next nested postcss issue
- staging deployment not yet done
- staff assignment not implemented
- no automated test suite yet

## Future work

- real AI provider node
- scheduled daily digest
- staging deployment
- iOS notification regression using `docs/ios-final-regression/notification-regression.md`
- staff assignment / owner field
- dashboard metrics
- test harness
- production observability
## v1.1 readiness references

- [v1.1 readiness package](../v1.1-readiness/README.md)
- [Staging deployment package](../staging-deployment/README.md)
- [Production automation package](../production-automation/README.md)
- [Real AI provider package](../real-ai-provider/README.md)
- [Testing package](../testing/README.md)
## v1.1 practical update

- real AI workflow template prepared, but provider credentials/configuration are not active
- scheduled digest workflow template prepared, but production scheduler is not active
- future pending booking polling workflow documented as placeholder only
- automation API smoke test script prepared for local/staging checks
## Staging deployment support update

- Full Local RC: Passed.
- iOS core regression: Passed for build, launch, booking submit, Supabase/Admin visibility, and Admin notification bridge.
- Staging deployment: support package prepared, pending execution.
- Production scheduler: template prepared, not active.
- Real AI provider: template prepared, not configured.
- Automated smoke tests: local script prepared; staging smoke test script added.
- iOS visual notification display: pending unless explicitly verified in the iOS UI.

Do not treat staging as passed until `docs/staging-deployment/staging-validation-results-template.md` is completed with real evidence.
