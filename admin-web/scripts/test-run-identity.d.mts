export type TestRunIdentity = {
  canonicalId: string;
  source: 'github-actions' | 'local-only';
  runId: string | null;
  attempt: string | null;
};

export function deriveTestRunIdentity(env?: Record<string, string | undefined>): TestRunIdentity;
export function assertTestRunIdentity(env?: Record<string, string | undefined>): TestRunIdentity;
