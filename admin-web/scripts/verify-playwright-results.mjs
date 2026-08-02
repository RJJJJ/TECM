import { readFileSync, statSync } from 'node:fs';

const resultFile = process.env.PLAYWRIGHT_RESULT_FILE ?? process.argv[2] ?? 'test-results/playwright-results.json';
const expectedTests = Number(process.env.PLAYWRIGHT_EXPECTED_TESTS ?? 8);
const expectedProjects = (process.env.PLAYWRIGHT_EXPECTED_PROJECTS ?? 'desktop-chromium,teacher-mobile')
  .split(',').map((value) => value.trim()).filter(Boolean).sort();
const isCi = process.env.CI === 'true' || process.env.CI === '1';
const localOptOut = !isCi && process.env.TECM_E2E_ALLOW_MISSING_SUPABASE === '1';

function fail(message) {
  console.error(`[PLAYWRIGHT RESULT] ${message}`);
  process.exitCode = 1;
}

let result;
try {
  result = JSON.parse(readFileSync(resultFile, 'utf8'));
} catch (error) {
  fail(`missing or malformed result file ${resultFile}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit();
}

const requiredKeys = ['schemaVersion', 'runId', 'startedAt', 'finishedAt', 'status', 'configuredProjects', 'testCount', 'counts', 'tests'];
if (!result || typeof result !== 'object' || requiredKeys.some((key) => !(key in result))) {
  fail('result file is missing the required machine-readable fields');
  process.exit();
}
if (result.schemaVersion !== 1 || !Array.isArray(result.tests) || !Array.isArray(result.configuredProjects)) {
  fail('result file has an unsupported or malformed schema');
  process.exit();
}
if (process.env.PLAYWRIGHT_RUN_ID && result.runId !== process.env.PLAYWRIGHT_RUN_ID) {
  fail(`result belongs to run ${String(result.runId)}, expected ${process.env.PLAYWRIGHT_RUN_ID}`);
}
if (process.env.GITHUB_SHA && result.headSha !== process.env.GITHUB_SHA) {
  fail(`result belongs to head ${String(result.headSha)}, expected ${process.env.GITHUB_SHA}`);
}
const startedAt = Date.parse(result.startedAt);
const finishedAt = Date.parse(result.finishedAt);
if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) {
  fail('result timestamps are missing or invalid');
}
try {
  if (statSync(resultFile).mtimeMs + 1_000 < finishedAt) fail('result file timestamp predates its recorded completion');
} catch (error) {
  fail(`cannot stat result file: ${error instanceof Error ? error.message : String(error)}`);
}

const configuredProjects = result.configuredProjects.slice().sort();
if (JSON.stringify(configuredProjects) !== JSON.stringify(expectedProjects)) {
  fail(`unexpected projects: ${configuredProjects.join(', ') || '(none)'}`);
}
if (result.testCount !== expectedTests || result.tests.length !== expectedTests) {
  fail(`expected exactly ${expectedTests} test cases, got testCount=${String(result.testCount)} entries=${result.tests.length}`);
}

const counts = result.counts;
const numericCounts = Boolean(counts) && typeof counts === 'object' && ['passed', 'failed', 'skipped', 'flaky'].every((key) => Number.isInteger(counts[key]) && counts[key] >= 0);
if (!numericCounts) fail('result counts are malformed');
const allowedOutcomes = new Set(['expected', 'unexpected', 'skipped', 'flaky']);
const derivedCounts = result.tests.reduce((summary, test) => {
  if (!Array.isArray(test.titlePath) || test.titlePath.length === 0 || !allowedOutcomes.has(test.outcome)) {
    fail('result contains a malformed test entry');
    return summary;
  }
  if (test.outcome === 'expected') summary.passed += 1;
  else if (test.outcome === 'unexpected') summary.failed += 1;
  else if (test.outcome === 'skipped') summary.skipped += 1;
  else summary.flaky += 1;
  return summary;
}, { passed: 0, failed: 0, skipped: 0, flaky: 0 });
if (numericCounts && JSON.stringify(derivedCounts) !== JSON.stringify(counts)) {
  fail(`result counts do not match individual test outcomes: derived=${JSON.stringify(derivedCounts)} reported=${JSON.stringify(counts)}`);
}
if (numericCounts) {
  if (counts.failed !== 0 || counts.flaky !== 0) fail(`failed=${counts.failed} flaky=${counts.flaky}; expected both 0`);
  if (counts.skipped !== 0 && !localOptOut) fail(`skipped=${counts.skipped}; release validation never accepts skipped tests`);
  if (counts.passed + counts.skipped + counts.failed + counts.flaky !== expectedTests) fail('result counts do not cover every expected test case');
  if (!localOptOut && (result.status !== 'passed' || counts.passed !== expectedTests)) {
    fail(`release validation requires status=passed and passed=${expectedTests}; got status=${result.status} passed=${counts.passed}`);
  }
}

if (process.exitCode !== 1) {
  console.log(JSON.stringify({
    resultFile,
    runId: result.runId,
    headSha: result.headSha,
    projects: configuredProjects,
    passed: counts.passed,
    failed: counts.failed,
    skipped: counts.skipped,
    flaky: counts.flaky
  }));
}
