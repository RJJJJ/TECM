import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '../..');
const testPath = 'admin-web/tests/unit/batch1-release-blockers.test.ts';
const migrationPath = 'supabase/migrations/20260830100127_batch1_staff_attendance_operation_idempotency.sql';
const files = [
  testPath,
  migrationPath,
  'admin-web/components/operation-forms.tsx',
  'admin-web/lib/operations/actions.ts',
  'admin-web/lib/operations/errors.ts',
  'admin-web/app/admin/attendance/page.tsx'
];

const cases = [
  {
    id: 'B1-M1', file: migrationPath,
    search: '  elsif target_expected_revision is null\n        or target_expected_revision <> attendance_row.revision then',
    replacement: '  elsif false then',
    test: 'Batch 1 staff attendance shares the revision, lock, lifecycle, and replay contract',
    failure: 'B1-M1 staff stale/null revision guard missing'
  },
  {
    id: 'B1-M4', file: migrationPath,
    search: 'revoke insert, update, delete on table public.attendance_records from authenticated;',
    replacement: 'grant insert, update, delete on table public.attendance_records to authenticated;',
    test: 'Batch 1 removes direct authenticated attendance DML and the legacy RPC',
    failure: 'B1-M4 direct authenticated attendance DML revoke missing'
  },
  {
    id: 'B1-M5', file: migrationPath,
    search: '      if payment_row.request_fingerprint <> request_fingerprint then',
    replacement: '      if false then',
    test: 'Batch 1 payment and intake keys are bound to canonical server fingerprints',
    failure: 'B1-M5 payment payload comparison missing'
  },
  {
    id: 'B1-M6', file: migrationPath,
    search: '      if existing_fingerprint <> request_fingerprint then',
    replacement: '      if false then',
    test: 'Batch 1 payment and intake keys are bound to canonical server fingerprints',
    failure: 'B1-M6 intake payload comparison missing'
  },
  {
    id: 'B1-M7', file: 'admin-web/components/operation-forms.tsx',
    search: "    if (state.status !== 'success' || !state.completionToken) return;",
    replacement: '    if (true) return;',
    test: 'mounted operation forms rotate keys only after confirmed success and remain pending-safe',
    failure: 'B1-M7 success key rotation missing'
  }
];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const snapshots = new Map(files.map((file) => [file, readFileSync(resolve(repoRoot, file))]));

function copyInputs(root) {
  for (const file of files) {
    const destination = resolve(root, file);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(resolve(repoRoot, file), destination);
  }
}

function runTest(root, name) {
  return spawnSync(process.execPath, [
    '--experimental-strip-types', '--test', '--test-name-pattern', name, resolve(root, testPath)
  ], { cwd: root, encoding: 'utf8', timeout: 30_000, windowsHide: true });
}

function count(text, target) {
  return text.split(target).length - 1;
}

function assertRepositoryRestored() {
  for (const [file, bytes] of snapshots) {
    const current = readFileSync(resolve(repoRoot, file));
    if (!current.equals(bytes) || sha256(current) !== sha256(bytes)) {
      throw new Error(`repository restoration failed: ${file}`);
    }
  }
}

function mutate(spec, { zero = false, multiple = false } = {}) {
  const root = mkdtempSync(resolve(tmpdir(), `tecm-batch1-${spec.id.toLowerCase()}-`));
  try {
    copyInputs(root);
    const targetPath = resolve(root, spec.file);
    let text = readFileSync(targetPath, 'utf8');
    const search = zero ? '__BATCH1_ZERO_MATCH__' : spec.search;
    if (multiple) text += `\n${spec.search}\n`;
    const matches = count(text, search);
    if (matches !== 1) {
      const classification = matches === 0 ? 'ZERO_MATCH_FAIL_CLOSED' : 'MULTIPLE_MATCH_FAIL_CLOSED';
      return { id: spec.id, caught: false, matches, classification, restoration: 'PASS', cleanup: 'PENDING' };
    }
    writeFileSync(targetPath, text.replace(search, spec.replacement));
    const result = runTest(root, spec.test);
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    if (result.status === 0 || !output.includes(spec.failure) || !/AssertionError/.test(output)) {
      throw new Error(`${spec.id} was not caught by its semantic assertion`);
    }
    return { id: spec.id, caught: true, matches, classification: 'SEMANTIC_ASSERTION', restoration: 'PASS', cleanup: 'PENDING' };
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (existsSync(root)) throw new Error(`temporary cleanup failed: ${spec.id}`);
    assertRepositoryRestored();
  }
}

const baseline = runTest(repoRoot, 'Batch 1');
if (baseline.status !== 0) throw new Error('Batch 1 mutation baseline must pass');

const controls = [mutate(cases[0], { zero: true }), mutate(cases[0], { multiple: true })];
if (controls[0].classification !== 'ZERO_MATCH_FAIL_CLOSED' || controls[1].classification !== 'MULTIPLE_MATCH_FAIL_CLOSED') {
  throw new Error('mutation target-count controls did not fail closed');
}
const results = cases.map((spec) => mutate(spec));
for (const result of [...controls, ...results]) result.cleanup = 'PASS';
process.stdout.write(`${JSON.stringify({ baseline: 'PASS', controls, results, restoration: 'PASS', cleanup: 'PASS', final_result: 'PASS' })}\n`);
