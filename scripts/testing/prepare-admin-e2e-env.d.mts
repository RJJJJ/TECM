export type AdminE2EEnvironmentOptions = {
  environment?: Record<string, string | undefined>;
  writeStatus?: (label: string) => void;
};

export type PreparedAdminE2EEnvironment = {
  environmentDestination: string;
  maskDestination: string;
  names: string[];
};

export function requireLoopbackUrl(raw: string, label: string): string;

export function parseSupabaseStatus(raw: unknown): Record<string, unknown>;

export function prepareAdminE2EEnvironment(
  options?: AdminE2EEnvironmentOptions
): PreparedAdminE2EEnvironment;
