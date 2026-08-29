import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const workflowPath = resolve(repositoryRoot, '.github/workflows/release-validation.yml');
const boundaryPath = resolve(repositoryRoot, 'scripts/testing/verify-local-supabase.sh');
const identityPath = resolve(repositoryRoot, 'admin-web/scripts/test-run-identity.mjs');
const fixtureEnvironmentPath = resolve(repositoryRoot, 'scripts/testing/prepare-admin-e2e-env.mjs');
const workflow = readFileSync(workflowPath, 'utf8');
const boundary = readFileSync(boundaryPath, 'utf8');
const identity = readFileSync(identityPath, 'utf8');
const fixtureEnvironment = readFileSync(fixtureEnvironmentPath, 'utf8');
const failures = [];

function requireMatch(text, pattern, message) {
  if (!pattern.test(text)) failures.push(message);
}

function rejectMatch(text, pattern, message) {
  if (pattern.test(text)) failures.push(message);
}

requireMatch(workflow, /docker network create[\s\S]*com\.docker\.network\.bridge\.host_binding_ipv4=127\.0\.0\.1/, 'Supabase CI network must bind published ports to loopback');
requireMatch(workflow, /supabase start --network-id "\$TECM_SUPABASE_NETWORK"\s+>\/dev\/null\s+2>&1/, 'Supabase must start on the loopback-bound CI network');
requireMatch(workflow, /supabase db reset --network-id "\$TECM_SUPABASE_NETWORK"\s+>\/dev\/null\s+2>&1/, 'Supabase reset must use the loopback-bound CI network');
requireMatch(workflow, /bash scripts\/testing\/verify-local-supabase\.sh/, 'Supabase loopback boundary check is required');
requireMatch(workflow, /\.\/scripts\/testing\/migration-014-session-timeouts-mutation-verify\.ps1/, 'Migration 014 session-timeout mutation verification is required');
requireMatch(workflow, /name: Verify attendance function ACL M36\/M37\/M38 and lifecycle controls\s+run: node scripts\/testing\/attendance-function-acl-mutation-verify\.mjs/, 'Attendance function ACL M36/M37/M38 and lifecycle controls are required');
requireMatch(workflow, /app_path='\$\{\{ runner\.temp \}\}\/TECM-DerivedData\/Build\/Products\/Debug-iphonesimulator\/TECM\.app'/, 'iOS validation must target the Xcode-built TECM.app');
requireMatch(workflow, /bash scripts\/testing\/test-ios-launch-metadata-harness\.sh TECM\/Info\.plist/, 'Portable iOS launch-metadata harness regression is required');
requireMatch(workflow, /bash scripts\/testing\/validate-ios-launch-metadata\.sh "\$app_path"/, 'Built TECM.app launch metadata validation is required');
requireMatch(workflow, /bash scripts\/testing\/test-ios-launch-metadata-mutation\.sh "\$app_path"/, 'Built TECM.app launch metadata mutation is required');
requireMatch(workflow, /status_json="\$\(supabase status -o json\)"/, 'Supabase status must be captured, not printed');
requireMatch(workflow, /name: Prepare non-echoing Admin E2E fixture environment[\s\S]*node scripts\/testing\/prepare-admin-e2e-env\.mjs/, 'Non-echoing Admin E2E fixture helper is required');
requireMatch(workflow, /TECM_E2E_MASK_DESTINATION="\$mask_file"[\s\S]*while IFS= read -r mask; do[\s\S]*::add-mask::\$mask/, 'Fixture values must be masked before the Playwright step');
requireMatch(workflow, /trap 'rm -f "\$mask_file"' EXIT[\s\S]*rm -f "\$mask_file"/, 'Fixture mask material must be cleaned on success and failure');
rejectMatch(workflow, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, 'Release workflow must not echo literal fixture emails');
rejectMatch(workflow, /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])/i, 'Release workflow must not echo a literal fixture URI');
requireMatch(workflow, /TECM_EXPECTED_GITHUB_RUN_ID:\s*\$\{\{\s*github\.run_id\s*\}\}/, 'Workflow must pass authoritative GitHub run ID metadata');
requireMatch(workflow, /TECM_EXPECTED_GITHUB_RUN_ATTEMPT:\s*\$\{\{\s*github\.run_attempt\s*\}\}/, 'Workflow must pass authoritative GitHub attempt metadata');
requireMatch(workflow, /node admin-web\/scripts\/test-run-identity\.mjs/, 'Workflow must establish and re-check canonical test identity');
rejectMatch(workflow, /node scripts\/test-run-identity\.mjs/, 'Root-level workflow steps must use the repository path to the identity helper');
requireMatch(workflow, /TECM_TEST_RUN_ID/, 'Workflow must use one canonical test identity');
requireMatch(workflow, /TECM_SUPABASE_NETWORK=\"tecm-local-only-\$\{TECM_TEST_RUN_ID\}\"/, 'Supabase namespace must use the canonical test identity');
requireMatch(fixtureEnvironment, /PLAYWRIGHT_RUN_ID:\s*runId/, 'Playwright run ID must use canonical test identity');
requireMatch(fixtureEnvironment, /playwright-results-\$\{runId\}\.json/, 'Playwright result path must use canonical test identity');
rejectMatch(workflow, /PLAYWRIGHT_RUN_ID=\"\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}\"/, 'Raw GitHub variables must not bypass canonical identity validation');
rejectMatch(workflow, /playwright-results-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}/, 'Raw GitHub variables must not construct a stale result path');
rejectMatch(workflow, /^\s*supabase start\s*$/m, 'Unredirected supabase start output is forbidden');
rejectMatch(workflow, /^\s*supabase status(?:\s+[^$].*)?$/m, 'Uncaptured supabase status output is forbidden');
if (workflow.split(/\r?\n/).some((line) =>
  /(?:echo|printf|tee|cat)/.test(line) &&
  /(?:ANON_KEY|SERVICE_ROLE_KEY|status_json)/.test(line) &&
  !/::add-mask::/.test(line)
)) {
  failures.push('Credential/status material must not be printed');
}

requireMatch(boundary, /status_json="\$\(supabase status -o json\)"/, 'Boundary script must capture Supabase status');
requireMatch(boundary, /http:\/\/127\.0\.0\.1:\*\|http:\/\/localhost:\*/, 'Boundary script must require loopback API URL');
requireMatch(boundary, /docker inspect --format/, 'Boundary script must inspect published Docker ports');
requireMatch(boundary, /127\.0\.0\.1\|::1/, 'Boundary script must accept only loopback port bindings');
requireMatch(boundary, /Supabase started.*required local endpoints healthy.*project is local-only/s, 'Boundary script must emit sanitized operational evidence');
requireMatch(identity, /GITHUB_RUN_ID/, 'Identity helper must validate GitHub run ID');
requireMatch(identity, /GITHUB_RUN_ATTEMPT/, 'Identity helper must validate GitHub run attempt');
requireMatch(identity, /TECM_EXPECTED_GITHUB_RUN_ATTEMPT/, 'Identity helper must compare runtime attempt with authoritative metadata');
requireMatch(identity, /local-only/, 'Identity helper must make local identity explicit');
requireMatch(fixtureEnvironment, /LOOPBACK_HOSTS[\s\S]*requireLoopbackUrl/, 'Fixture helper must enforce explicit loopback targets');
requireMatch(fixtureEnvironment, /GITHUB_ENV[\s\S]*TECM_E2E_MASK_DESTINATION/, 'Fixture helper must require environment and mask destinations');
requireMatch(fixtureEnvironment, /writeStatus\('E2E_FIXTURE_ENV_READY'\)/, 'Fixture helper must emit only the allowlisted ready label');
rejectMatch(fixtureEnvironment, /console\.log\(|console\.error\(/, 'Fixture helper must not print environment material');

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('release workflow secret-output and local-boundary guard passed');
}
