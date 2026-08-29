export const LOCAL_E2E_ORGANIZATION_ID = '10000000-0000-4000-8000-000000000000';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export type CredentialedE2EEnvironment = {
  email: string | undefined;
  password: string | undefined;
  supabaseUrl: string | undefined;
  playwrightBaseUrl: string | undefined;
  anonKey: string | undefined;
  serviceRoleKey: string | undefined;
  organizationId: string | undefined;
  teacherEmail: string | undefined;
  teacherPassword: string | undefined;
  parentEmail: string | undefined;
  parentPassword: string | undefined;
};

export function credentialedE2EEnvironment(): CredentialedE2EEnvironment {
  return {
    email: process.env.PLAYWRIGHT_ADMIN_EMAIL,
    password: process.env.PLAYWRIGHT_ADMIN_PASSWORD,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    playwrightBaseUrl: process.env.PLAYWRIGHT_BASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    organizationId: process.env.TECM_ORGANIZATION_ID,
    teacherEmail: process.env.PLAYWRIGHT_TEACHER_EMAIL,
    teacherPassword: process.env.PLAYWRIGHT_TEACHER_PASSWORD,
    parentEmail: process.env.PLAYWRIGHT_PARENT_EMAIL,
    parentPassword: process.env.PLAYWRIGHT_PARENT_PASSWORD
  };
}

export function missingCredentialedE2EEnvironment(environment = credentialedE2EEnvironment()) {
  const missing: string[] = [];
  if (!environment.email) missing.push('PLAYWRIGHT_ADMIN_EMAIL');
  if (!environment.password) missing.push('PLAYWRIGHT_ADMIN_PASSWORD');
  if (!environment.supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!environment.playwrightBaseUrl) missing.push('PLAYWRIGHT_BASE_URL');
  if (!environment.anonKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!environment.serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!environment.organizationId) missing.push('TECM_ORGANIZATION_ID');
  if (!environment.teacherEmail) missing.push('PLAYWRIGHT_TEACHER_EMAIL');
  if (!environment.teacherPassword) missing.push('PLAYWRIGHT_TEACHER_PASSWORD');
  if (!environment.parentEmail) missing.push('PLAYWRIGHT_PARENT_EMAIL');
  if (!environment.parentPassword) missing.push('PLAYWRIGHT_PARENT_PASSWORD');
  return missing;
}

export function credentialedE2ELocalOptOutEnabled() {
  return process.env.CI !== 'true' && process.env.CI !== '1' && process.env.TECM_E2E_ALLOW_MISSING_SUPABASE === '1';
}

function normalizedHostname(url: URL) {
  return url.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

export function assertLoopbackHttpUrl(value: string | undefined, variableName: string) {
  if (!value) throw new Error(`${variableName} is required for local Admin E2E`);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid local http URL`);
  }

  if (url.protocol !== 'http:') {
    throw new Error(`${variableName} must use http for local Admin E2E`);
  }

  if (url.username || url.password) {
    throw new Error(`${variableName} must not contain URL credentials`);
  }

  if (!LOOPBACK_HOSTS.has(normalizedHostname(url))) {
    throw new Error(`${variableName} must target an explicit loopback host`);
  }

  return url;
}

export function assertLocalE2EPreflight(environment = credentialedE2EEnvironment()) {
  assertLoopbackHttpUrl(environment.playwrightBaseUrl, 'PLAYWRIGHT_BASE_URL');

  const localMissing: string[] = [];
  if (!environment.supabaseUrl) localMissing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!environment.organizationId) localMissing.push('TECM_ORGANIZATION_ID');
  if (localMissing.length > 0 && !credentialedE2ELocalOptOutEnabled()) {
    throw new Error(`Local Admin E2E configuration is incomplete: missing ${localMissing.join(', ')}`);
  }

  if (environment.supabaseUrl) assertLoopbackHttpUrl(environment.supabaseUrl, 'NEXT_PUBLIC_SUPABASE_URL');
  if (environment.organizationId && environment.organizationId !== LOCAL_E2E_ORGANIZATION_ID) {
    throw new Error('Admin E2E must use the deterministic local organization');
  }
}

export function assertCredentialedE2EEnvironment(environment = credentialedE2EEnvironment()) {
  assertLocalE2EPreflight(environment);

  const missing = missingCredentialedE2EEnvironment(environment);
  if (missing.length > 0 && !credentialedE2ELocalOptOutEnabled()) {
    throw new Error(`Credentialed Admin E2E configuration is incomplete: missing ${missing.join(', ')}`);
  }
}

export function requiredPlaywrightBaseUrl(environment = credentialedE2EEnvironment()) {
  return assertLoopbackHttpUrl(environment.playwrightBaseUrl, 'PLAYWRIGHT_BASE_URL').toString().replace(/\/$/, '');
}
