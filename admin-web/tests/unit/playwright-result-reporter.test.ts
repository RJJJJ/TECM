import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
const { default: Reporter } = await import(new URL('../../scripts/playwright-result-reporter.mjs', import.meta.url).href);

test('reporter retains actual Playwright result arrays without changing failure classification', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tecm-result-reporter-'));
  // This reporter unit test is local evidence, including when npm test runs in CI.
  const identityKeys = ['CI', 'GITHUB_ACTIONS', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT',
    'TECM_EXPECTED_GITHUB_RUN_ID', 'TECM_EXPECTED_GITHUB_RUN_ATTEMPT', 'TECM_TEST_RUN_ID',
    'TECM_TEST_RUN_SOURCE', 'TECM_LOCAL_TEST_RUN_ID', 'PLAYWRIGHT_RUN_ID'];
  const previous = new Map(identityKeys.map((key) => [key, process.env[key]]));
  try {
    for (const key of identityKeys) delete process.env[key];
    process.env.TECM_LOCAL_TEST_RUN_ID = 'local-reporter-regression';
    const outputFile = join(directory, 'result.json');
    const failed = {
      titlePath: () => ['teacher-mobile', 'stale attendance'],
      outcome: () => 'unexpected',
      results: [{ status: 'failed', error: { message: 'PRIVATE ERROR MUST NOT BE SAVED' } }],
      location: { file: '/tests/e2e/education-operations.spec.ts', line: 917 },
      parent: { project: () => ({ name: 'teacher-mobile' }) }
    };
    const reporter = new Reporter({ outputFile });
    reporter.onBegin({ projects: [{ name: 'teacher-mobile' }] }, { allTests: () => [failed] });
    reporter.onTestBegin(failed);
    reporter.onTestEnd(failed, { status: 'failed', duration: 67 });
    reporter.onEnd({ status: 'failed', duration: 100 });
    const raw = readFileSync(outputFile, 'utf8');
    const result = JSON.parse(raw);
    assert.equal(result.runId, 'local-reporter-regression');
    assert.equal(result.status, 'failed');
    assert.equal(result.testCount, 1);
    assert.deepEqual(result.counts, { passed: 0, skipped: 0, flaky: 0, failed: 1 });
    assert.deepEqual(result.tests[0].resultStatuses, ['failed']);
    assert.doesNotMatch(raw, /PRIVATE ERROR/);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
