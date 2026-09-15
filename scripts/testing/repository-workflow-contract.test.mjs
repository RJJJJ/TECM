import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { repositoryWorkflowIsValid } from './repository-workflow-contract.mjs';

const root = resolve(import.meta.dirname, '../..');
const moduleURL = new URL('./repository-workflow-contract.mjs', import.meta.url);
const requireAdmin = createRequire(new URL('../../admin-web/package.json', import.meta.url));
const { parse, stringify } = requireAdmin('yaml');
const normal = execFileSync('git', ['show', 'HEAD:.github/workflows/release-validation.yml'], {
  cwd: root, encoding: 'utf8', windowsHide: true
});
const invocation = './scripts/testing/database-verify.ps1';
const quotedName = `jobs:
  database:
    steps:
      - {name: "Verifier documentation
        shell: pwsh
        run: ./scripts/testing/database-verify.ps1
        ",
        shell: pwsh,
        run: Write-Host SKIPPED}
  other:
    steps: []
`;

test('normal committed workflow: expected PASS', () => {
  assert.equal(repositoryWorkflowIsValid(normal), true);
});

test('quoted multiline name: expected FAIL; real run remains SKIPPED', () => {
  let document;
  assert.doesNotThrow(() => {
    document = parse(quotedName, { version: '1.2', uniqueKeys: true, merge: false });
  });
  const step = document.jobs.database.steps[0];
  assert.ok(step.name.includes('shell: pwsh'));
  assert.ok(step.name.includes('run: ./scripts/testing/database-verify.ps1'));
  assert.equal(step.shell, 'pwsh');
  assert.equal(step.run, 'Write-Host SKIPPED');
  const verifierRunCount = Object.values(document.jobs)
    .flatMap(job => job.steps)
    .filter(step => typeof step.run === 'string' &&
      step.run.includes('scripts/testing/database-verify.ps1')).length;
  assert.equal(verifierRunCount, 0);
  assert.equal(repositoryWorkflowIsValid(quotedName), false);
  console.log('PARSED_COUNTEREXAMPLE =', JSON.stringify({ ...step, verifierRunCount }));
});

test('invalid YAML or contract structure: expected FAIL', () => {
  for (const source of ['jobs: [', 'jobs: {}', 'jobs: { database: { steps: {} } }']) {
    assert.equal(repositoryWorkflowIsValid(source), false);
  }
});

const negativeCases = [
  ['duplicate invocation', (job, step) => job.steps.push({ ...step })],
  ['arguments', (_job, step) => { step.run += ' -SkipTests'; }],
  ['wrapper', (_job, step) => { step.run = 'pwsh -File ' + step.run; }],
  ['job-level if', job => { job.if = 'always()'; }],
  ['verifier-step if', (_job, step) => { step.if = 'always()'; }],
  ['job continue-on-error', job => { job['continue-on-error'] = true; }],
  ['step continue-on-error', (_job, step) => { step['continue-on-error'] = true; }]
];
for (const [name, mutate] of negativeCases) {
  test(`${name}: expected FAIL`, () => {
    const document = parse(normal);
    const job = document.jobs.database;
    const step = job.steps.find(step => step.run === invocation);
    assert.ok(step, 'normal workflow must contain the verifier step');
    mutate(job, step);
    assert.equal(repositoryWorkflowIsValid(stringify(document)), false);
  });
}

test('root and admin-web CWD: same pinned parser and production result', () => {
  const manifest = requireAdmin('./package.json');
  const lock = requireAdmin('./package-lock.json');
  const entry = lock.packages['node_modules/yaml'];
  assert.equal(manifest.devDependencies.yaml, '2.9.0');
  assert.equal(lock.packages[''].devDependencies.yaml, '2.9.0');
  assert.equal(entry.version, '2.9.0');
  assert.equal(entry.resolved, 'https://registry.npmjs.org/yaml/-/yaml-2.9.0.tgz');
  assert.equal(entry.integrity, 'sha512-2AvhNX3mb8zd6Zy7INTtSpl1F15HW6Wnqj0srWlkKLcpYl/gMIMJiyuGq2KeI2YFxUPjdlB+3Lc10seMLtL4cA==');
  const script = `
    import { createRequire } from 'node:module';
    import { readFileSync } from 'node:fs';
    const moduleURL = new URL(${JSON.stringify(moduleURL.href)});
    const { repositoryWorkflowIsValid } = await import(moduleURL.href);
    const valid = repositoryWorkflowIsValid(readFileSync(0, 'utf8'));
    const load = createRequire(new URL('../../admin-web/package.json', moduleURL));
    console.log(JSON.stringify({ valid, resolved: load.resolve('yaml'), version: load('yaml/package.json').version }));
  `;
  const observations = [root, join(root, 'admin-web')].map(cwd => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd, input: normal, encoding: 'utf8', windowsHide: true, timeout: 10000
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stderr, '');
    const observed = JSON.parse(child.stdout);
    assert.equal(observed.valid, true);
    assert.equal(observed.version, '2.9.0');
    assert.equal(observed.resolved, requireAdmin.resolve('yaml'));
    console.log('RESOLUTION_EVIDENCE =', JSON.stringify({ cwd, exit: child.status, ...observed }));
    return observed;
  });
  assert.deepEqual(observations[0], observations[1]);
  console.log('LOCK_EVIDENCE =', JSON.stringify(entry));
});

test('missing parser: import succeeds; invocation exits nonzero with sanitized error', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'tecm-s2-missing-parser-'));
  const fixtureModule = join(fixture, 'scripts/testing/repository-workflow-contract.mjs');
  mkdirSync(dirname(fixtureModule), { recursive: true });
  mkdirSync(join(fixture, 'admin-web'));
  copyFileSync(fileURLToPath(moduleURL), fixtureModule);
  writeFileSync(join(fixture, 'admin-web/package.json'), '{"private":true}\n', { flag: 'wx' });
  console.log('RETAINED_MISSING_PARSER_FIXTURE =', fixture);
  console.log('CLEANUP = NOT_PERFORMED; fixture retained for explicit review and removal');
  assert.equal(existsSync(join(fixture, 'admin-web/node_modules')), false);
  assert.deepEqual(readFileSync(fixtureModule), readFileSync(moduleURL));
  const imported = `const { repositoryWorkflowIsValid } = await import(${JSON.stringify(pathToFileURL(fixtureModule).href)});`;
  const options = { cwd: fixture, encoding: 'utf8', windowsHide: true, timeout: 10000 };
  const importOnly = spawnSync(process.execPath, ['--input-type=module', '-e', imported], options);
  assert.equal(importOnly.error, undefined);
  assert.equal(importOnly.status, 0, importOnly.stderr);
  assert.equal(importOnly.stdout, '');
  assert.equal(importOnly.stderr, '');
  const called = spawnSync(process.execPath, ['--input-type=module', '-e', imported + `
    try { repositoryWorkflowIsValid('jobs: {}'); }
    catch (error) { process.stderr.write(error.message + '\\n'); process.exitCode = 1; }
  `], options);
  assert.equal(called.error, undefined);
  assert.equal(called.status, 1);
  assert.equal(called.stdout, '');
  assert.equal(called.stderr, 'S2_YAML_PARSER_UNAVAILABLE: Run npm --prefix admin-web ci\n');
  console.log('MISSING_DEPENDENCY_EVIDENCE =', JSON.stringify({ importExit: importOnly.status, invocationExit: called.status, stderr: called.stderr }));
});
