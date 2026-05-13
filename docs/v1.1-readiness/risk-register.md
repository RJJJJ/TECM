# TECM v1.1 Risk Register

| Risk | Impact | Likelihood | Mitigation | Status |
| --- | --- | --- | --- | --- |
| iOS build risk | Blocks final local full-stack signoff | Medium | Execute VM/Xcode regression runbook before staging signoff | Open |
| Supabase config risk | iOS/Admin cannot connect or uses wrong project | Medium | Verify env/config files and project URL/key pairs | Open |
| RLS/auth mismatch | Parent center or notifications may not show expected rows | Medium | Use SQL fixtures/checks and compare `parent_id` | Open |
| n8n localhost/Docker routing | n8n cannot call Admin Web | Medium | Use `host.docker.internal` locally; deployed URL in staging | Mitigated locally |
| AI provider output schema drift | Follow-up task creation may fail or produce unsafe wording | Medium | Enforce prompt contract, validation node, and fallback policy | Planned |
| Secrets leakage | Production security incident | High | Keep service role server-side; n8n only gets automation secret; redact evidence | Open |
| Audit remaining moderate dependency | Release risk or required exception | Medium | Document audit result and review before production | Open |
| Staging env mismatch | Local RC does not reproduce when deployed | Medium | Use staging smoke test and env var checklist | Open |
| No automated test suite yet | Manual regression cost remains high | High | Add automation API smoke test first, then CI plan | In progress |
