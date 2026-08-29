import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveTestRunIdentity } from '../../scripts/test-run-identity.mjs';

function githubEnvironment(runId: string, attempt: string, overrides: Record<string, string> = {}) {
  return {
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    GITHUB_RUN_ID: runId,
    GITHUB_RUN_ATTEMPT: attempt,
    TECM_EXPECTED_GITHUB_RUN_ID: runId,
    TECM_EXPECTED_GITHUB_RUN_ATTEMPT: attempt,
    ...overrides
  };
}

test('canonical identity maps run 123 attempt 1 to 123-1', () => {
  assert.deepEqual(deriveTestRunIdentity(githubEnvironment('123', '1')), {
    canonicalId: '123-1',
    source: 'github-actions',
    runId: '123',
    attempt: '1'
  });
});

test('canonical identity maps run 123 attempt 3 to 123-3', () => {
  assert.equal(deriveTestRunIdentity(githubEnvironment('123', '3')).canonicalId, '123-3');
});

test('stale attempt 1 identity cannot override attempt 3', () => {
  assert.throws(
    () => deriveTestRunIdentity(githubEnvironment('123', '3', { TECM_TEST_RUN_ID: '123-1' })),
    /does not match the current GitHub attempt/
  );
  assert.throws(
    () => deriveTestRunIdentity(githubEnvironment('123', '3', { TECM_EXPECTED_GITHUB_RUN_ATTEMPT: '1' })),
    /disagrees with workflow metadata/
  );
});

test('missing or malformed GitHub attempt fails closed', () => {
  assert.throws(
    () => deriveTestRunIdentity(githubEnvironment('123', '')),
    /GITHUB_RUN_ATTEMPT must be a positive integer/
  );
  assert.throws(
    () => deriveTestRunIdentity(githubEnvironment('123', 'not-an-attempt')),
    /GITHUB_RUN_ATTEMPT must be a positive integer/
  );
  assert.throws(
    () => deriveTestRunIdentity({ ...githubEnvironment('123', '3'), TECM_EXPECTED_GITHUB_RUN_ATTEMPT: undefined }),
    /TECM_EXPECTED_GITHUB_RUN_ATTEMPT must be a positive integer/
  );
});

test('local execution is explicit local-only identity and never CI evidence', () => {
  assert.deepEqual(deriveTestRunIdentity({ TECM_LOCAL_TEST_RUN_ID: 'local-test-123' }), {
    canonicalId: 'local-test-123',
    source: 'local-only',
    runId: null,
    attempt: null
  });
  assert.equal(deriveTestRunIdentity({}).canonicalId, 'local-only');
  assert.throws(
    () => deriveTestRunIdentity({ GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '3' }),
    /requires CI=true and GITHUB_ACTIONS=true/
  );
});
