import { pathToFileURL } from 'node:url';

const POSITIVE_INTEGER = /^[1-9]\d*$/;
const LOCAL_IDENTITY = /^local-[a-z0-9][a-z0-9._-]*$/i;

function requirePositiveInteger(name, value) {
  if (typeof value !== 'string' || !POSITIVE_INTEGER.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function hasValue(value) {
  return typeof value === 'string' && value.length > 0;
}

export function deriveTestRunIdentity(env = process.env) {
  const isCi = env.CI === 'true' || env.CI === '1';
  const isGitHubActions = env.GITHUB_ACTIONS === 'true';
  const hasGitHubRuntimeMetadata = [
    env.GITHUB_RUN_ID,
    env.GITHUB_RUN_ATTEMPT,
    env.TECM_EXPECTED_GITHUB_RUN_ID,
    env.TECM_EXPECTED_GITHUB_RUN_ATTEMPT
  ].some(hasValue);

  if (isCi || isGitHubActions || hasGitHubRuntimeMetadata) {
    if (!isCi || !isGitHubActions) {
      throw new Error('GitHub run identity requires CI=true and GITHUB_ACTIONS=true');
    }

    const runId = requirePositiveInteger('GITHUB_RUN_ID', env.GITHUB_RUN_ID);
    const attempt = requirePositiveInteger('GITHUB_RUN_ATTEMPT', env.GITHUB_RUN_ATTEMPT);
    const expectedRunId = requirePositiveInteger(
      'TECM_EXPECTED_GITHUB_RUN_ID',
      env.TECM_EXPECTED_GITHUB_RUN_ID
    );
    const expectedAttempt = requirePositiveInteger(
      'TECM_EXPECTED_GITHUB_RUN_ATTEMPT',
      env.TECM_EXPECTED_GITHUB_RUN_ATTEMPT
    );

    if (runId !== expectedRunId || attempt !== expectedAttempt) {
      throw new Error('GitHub runtime identity disagrees with workflow metadata');
    }

    const canonicalId = `${runId}-${attempt}`;
    if (hasValue(env.TECM_TEST_RUN_ID) && env.TECM_TEST_RUN_ID !== canonicalId) {
      throw new Error('TECM_TEST_RUN_ID does not match the current GitHub attempt');
    }
    if (hasValue(env.TECM_TEST_RUN_SOURCE) && env.TECM_TEST_RUN_SOURCE !== 'github-actions') {
      throw new Error('TECM_TEST_RUN_SOURCE is not GitHub Actions');
    }

    return {
      canonicalId,
      source: 'github-actions',
      runId,
      attempt
    };
  }

  const canonicalId = env.TECM_LOCAL_TEST_RUN_ID ?? 'local-only';
  if (!LOCAL_IDENTITY.test(canonicalId)) {
    throw new Error('TECM_LOCAL_TEST_RUN_ID must use the local- prefix');
  }
  if (hasValue(env.TECM_TEST_RUN_ID) && env.TECM_TEST_RUN_ID !== canonicalId) {
    throw new Error('TECM_TEST_RUN_ID does not match the local-only identity');
  }
  if (hasValue(env.TECM_TEST_RUN_SOURCE) && env.TECM_TEST_RUN_SOURCE !== 'local-only') {
    throw new Error('TECM_TEST_RUN_SOURCE is not local-only');
  }

  return {
    canonicalId,
    source: 'local-only',
    runId: null,
    attempt: null
  };
}

export function assertTestRunIdentity(env = process.env) {
  const identity = deriveTestRunIdentity(env);
  if (hasValue(env.PLAYWRIGHT_RUN_ID) && env.PLAYWRIGHT_RUN_ID !== identity.canonicalId) {
    throw new Error('PLAYWRIGHT_RUN_ID does not match the canonical test identity');
  }
  return identity;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(deriveTestRunIdentity()));
  } catch (error) {
    console.error(`[TECM TEST IDENTITY] ${error instanceof Error ? error.message : 'invalid runtime identity'}`);
    process.exitCode = 1;
  }
}
