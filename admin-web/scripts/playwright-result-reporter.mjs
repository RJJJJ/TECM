import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { assertTestRunIdentity } from './test-run-identity.mjs';

function outcomeFor(test) {
  if (typeof test.outcome === 'function') return test.outcome();
  const results = typeof test.results === 'function' ? test.results() : [];
  if (results.length === 0) return 'skipped';
  return results.some((result) => result.status === 'failed' || result.status === 'timedOut') ? 'unexpected' : 'expected';
}

export default class PlaywrightResultReporter {
  constructor(options = {}) {
    this.outputFile = options.outputFile ?? process.env.PLAYWRIGHT_RESULT_FILE ?? 'test-results/playwright-results.json';
    this.runId = assertTestRunIdentity().canonicalId;
    this.headSha = process.env.GITHUB_SHA ?? null;
    this.startedAt = null;
    this.suite = null;
    this.configuredProjects = [];
  }

  onBegin(config, suite) {
    this.startedAt = new Date().toISOString();
    this.suite = suite;
    this.configuredProjects = config.projects.map((project) => project.name);
  }

  onEnd(result) {
    const tests = this.suite?.allTests?.() ?? [];
    const normalizedTests = tests.map((test) => ({
      titlePath: typeof test.titlePath === 'function' ? test.titlePath() : [test.title],
      outcome: outcomeFor(test),
      resultStatuses: typeof test.results === 'function' ? test.results().map((item) => item.status) : []
    }));
    const counts = normalizedTests.reduce((summary, test) => {
      if (test.outcome === 'expected') summary.passed += 1;
      else if (test.outcome === 'skipped') summary.skipped += 1;
      else if (test.outcome === 'flaky') summary.flaky += 1;
      else summary.failed += 1;
      return summary;
    }, { passed: 0, failed: 0, skipped: 0, flaky: 0 });
    const finishedAt = new Date().toISOString();
    const payload = {
      schemaVersion: 1,
      runId: this.runId,
      headSha: this.headSha,
      startedAt: this.startedAt,
      finishedAt,
      status: result.status,
      durationMs: result.duration,
      configuredProjects: this.configuredProjects,
      testCount: normalizedTests.length,
      counts,
      tests: normalizedTests
    };
    mkdirSync(dirname(this.outputFile), { recursive: true });
    writeFileSync(this.outputFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
}
