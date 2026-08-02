export const LOCAL_E2E_ORGANIZATION_ID = '10000000-0000-4000-8000-000000000000';

const LOOPBACK_SUPABASE_URL = /^http:\/\/127\.0\.0\.1(?::\d+)?$/;

export type CredentialedE2EEnvironment = {
  email: string | undefined;
  password: string | undefined;
  supabaseUrl: string | undefined;
  anonKey: string | undefined;
  serviceRoleKey: string | undefined;
  organizationId: string | undefined;
};

export function credentialedE2EEnvironment(): CredentialedE2EEnvironment {
  return {
    email: process.env.PLAYWRIGHT_ADMIN_EMAIL,
    password: process.env.PLAYWRIGHT_ADMIN_PASSWORD,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    organizationId: process.env.TECM_ORGANIZATION_ID
  };
}

export function missingCredentialedE2EEnvironment(environment = credentialedE2EEnvironment()) {
  const missing: string[] = [];
  if (!environment.email) missing.push('PLAYWRIGHT_ADMIN_EMAIL');
  if (!environment.password) missing.push('PLAYWRIGHT_ADMIN_PASSWORD');
  if (!environment.supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!environment.anonKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!environment.serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!environment.organizationId) missing.push('TECM_ORGANIZATION_ID');
  return missing;
}

export function credentialedE2ELocalOptOutEnabled() {
  return process.env.CI !== 'true' && process.env.CI !== '1' && process.env.TECM_E2E_ALLOW_MISSING_SUPABASE === '1';
}

export function assertCredentialedE2EEnvironment(environment = credentialedE2EEnvironment()) {
  const missing = missingCredentialedE2EEnvironment(environment);
  if (environment.supabaseUrl && !LOOPBACK_SUPABASE_URL.test(environment.supabaseUrl)) {
    throw new Error(`Credentialed Admin E2E is loopback-only; refusing Supabase URL ${environment.supabaseUrl}`);
  }
  if (environment.organizationId && environment.organizationId !== LOCAL_E2E_ORGANIZATION_ID) {
    throw new Error(`Admin E2E must use the deterministic local organization ${LOCAL_E2E_ORGANIZATION_ID}`);
  }
  if (missing.length > 0 && !credentialedE2ELocalOptOutEnabled()) {
    throw new Error(`Credentialed Admin E2E configuration is incomplete: missing ${missing.join(', ')}`);
  }
}
