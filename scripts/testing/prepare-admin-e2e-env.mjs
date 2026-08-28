import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const FIXTURE = Object.freeze({
  organizationId: '10000000-0000-4000-8000-000000000000',
  authIds: [
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000004'
  ],
  adminEmail: 'admin@tecm.local',
  teacherEmail: 'teacher-a@tecm.test',
  parentEmail: 'guardian-a@tecm.test',
  browserUrl: 'http://127.0.0.1:3000'
});

function requireDestination(path, label) {
  if (!path || !existsSync(dirname(resolve(path)))) {
    throw new Error(`${label} destination is unavailable`);
  }
  return resolve(path);
}

function requireSingleLine(value, label) {
  if (!value || /[\r\n]/.test(value)) throw new Error(`${label} is missing or invalid`);
  return value;
}

export function requireLoopbackUrl(raw, label) {
  const value = requireSingleLine(raw, label);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  const hostname = parsed.hostname.toLowerCase();
  const normalizedHostname = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (!['http:', 'https:'].includes(parsed.protocol)
      || parsed.username || parsed.password
      || !LOOPBACK_HOSTS.has(normalizedHostname)) {
    throw new Error(`${label} must target an explicit loopback HTTP endpoint`);
  }
  return parsed.toString().replace(/\/$/, '');
}

export function prepareAdminE2EEnvironment({
  environment = process.env,
  writeStatus = (label) => process.stdout.write(`${label}\n`)
} = {}) {
  const environmentDestination = requireDestination(environment.GITHUB_ENV, 'environment');
  const maskDestination = requireDestination(environment.TECM_E2E_MASK_DESTINATION, 'mask');
  const runId = requireSingleLine(environment.TECM_TEST_RUN_ID, 'canonical run identity');
  let status;
  try {
    status = JSON.parse(requireSingleLine(
      environment.TECM_E2E_SUPABASE_STATUS_JSON,
      'Supabase status'
    ));
  } catch {
    throw new Error('Supabase status is missing or invalid');
  }

  const apiUrl = requireLoopbackUrl(status.API_URL, 'Supabase API URL');
  const browserUrl = requireLoopbackUrl(
    environment.TECM_E2E_BROWSER_URL || FIXTURE.browserUrl,
    'browser URL'
  );
  const anonKey = requireSingleLine(status.ANON_KEY, 'Supabase anon key');
  const serviceRoleKey = requireSingleLine(status.SERVICE_ROLE_KEY, 'Supabase service-role key');
  const password = randomBytes(32).toString('hex');
  const resultFile = `test-results/playwright-results-${runId}.json`;

  const values = {
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    TECM_ORGANIZATION_ID: FIXTURE.organizationId,
    TECM_E2E_AUTH_IDS: FIXTURE.authIds.join(' '),
    LOCAL_E2E_PASSWORD: password,
    PLAYWRIGHT_ADMIN_EMAIL: FIXTURE.adminEmail,
    PLAYWRIGHT_ADMIN_PASSWORD: password,
    PLAYWRIGHT_TEACHER_EMAIL: FIXTURE.teacherEmail,
    PLAYWRIGHT_TEACHER_PASSWORD: password,
    PLAYWRIGHT_PARENT_EMAIL: FIXTURE.parentEmail,
    PLAYWRIGHT_PARENT_PASSWORD: password,
    PLAYWRIGHT_BASE_URL: browserUrl,
    PLAYWRIGHT_RUN_ID: runId,
    PLAYWRIGHT_RESULT_FILE: resultFile,
    PLAYWRIGHT_EXPECTED_TESTS: '14'
  };

  for (const [name, value] of Object.entries(values)) {
    requireSingleLine(value, name);
    appendFileSync(environmentDestination, `${name}=${value}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  const masks = new Set([
    apiUrl,
    browserUrl,
    anonKey,
    serviceRoleKey,
    password,
    FIXTURE.organizationId,
    ...FIXTURE.authIds,
    FIXTURE.adminEmail,
    FIXTURE.teacherEmail,
    FIXTURE.parentEmail
  ]);
  writeFileSync(maskDestination, `${[...masks].join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  writeStatus('E2E_FIXTURE_ENV_READY');
  return { environmentDestination, maskDestination, names: Object.keys(values) };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  try {
    prepareAdminE2EEnvironment();
  } catch {
    process.stderr.write('E2E_FIXTURE_ENV_FAILED\n');
    process.exitCode = 1;
  }
}
