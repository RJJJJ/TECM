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

const fingerprintTest = 'Batch 1 payment and intake keys are bound to canonical server fingerprints';
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
    search: '    if payment_row.request_fingerprint <> request_fingerprint then',
    replacement: '    if false then', test: fingerprintTest,
    failure: 'B1-M5 payment payload comparison missing'
  },
  {
    id: 'B1-M6', file: migrationPath,
    search: '    if existing_fingerprint <> request_fingerprint then',
    replacement: '    if false then', test: fingerprintTest,
    failure: 'B1-M6 intake payload comparison missing'
  },
  {
    id: 'B1-M7', file: 'admin-web/components/operation-forms.tsx',
    search: "    if (state.status !== 'success' || !state.completionToken) return;",
    replacement: '    if (true) return;',
    test: 'mounted operation forms rotate keys only after confirmed success and remain pending-safe',
    failure: 'B1-M7 success key rotation missing'
  },
  {
    id: 'B1-M8', file: migrationPath,
    search: '    if payment_row.request_fingerprint is null\n       or payment_row.request_fingerprint_version is distinct from 1 then',
    replacement: '    if false then', test: fingerprintTest,
    failure: 'B1-M8 payment legacy conflict missing'
  },
  {
    id: 'B1-M9', file: migrationPath,
    search: '    if existing_fingerprint is null or existing_fingerprint_version is distinct from 1 then',
    replacement: '    if false then', test: fingerprintTest,
    failure: 'B1-M9 intake legacy conflict missing'
  },
  {
    id: 'B1-M10', file: migrationPath,
    search: 'request_fingerprint, 1, auth.uid()',
    replacement: 'request_fingerprint, null, auth.uid()', test: fingerprintTest,
    failure: 'B1-M10 trusted payment provenance missing'
  },
  {
    id: 'B1-M11', file: migrationPath,
    search: 'normalized_key, request_fingerprint, 1',
    replacement: 'normalized_key, request_fingerprint, null', test: fingerprintTest,
    failure: 'B1-M11 trusted intake provenance missing'
  },
  {
    id: 'B1-M12', file: migrationPath,
    search: 'revoke insert, update, delete on table public.payments, public.student_packages, public.payment_allocations from authenticated;',
    replacement: 'grant insert, update, delete on table public.payments, public.student_packages, public.payment_allocations to authenticated;',
    test: 'Batch 1 makes operation identity unreachable through authenticated direct DML',
    failure: 'B1-M12 authenticated operation DML revoke missing'
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

function runTest(root, name, timeout = 30_000) {
  return spawnSync(process.execPath, [
    '--experimental-strip-types', '--test', '--test-name-pattern', name, resolve(root, testPath)
  ], { cwd: root, encoding: 'utf8', timeout, windowsHide: true });
}

function compactProcess(result) {
  return {
    status: Number.isInteger(result?.status) ? result.status : null,
    signal: result?.signal ?? null,
    error_code: result?.error?.code ?? null
  };
}

function classifyMutationRun(result, spec) {
  const output = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`;
  const lifecycleAccepted = !result?.error && !result?.signal && Number.isInteger(result?.status) && result.status === 1;
  const semanticAccepted = output.includes(spec.failure) && /AssertionError/.test(output);
  return {
    accepted: lifecycleAccepted && semanticAccepted,
    lifecycle: lifecycleAccepted ? 'EXPECTED_EXIT_1' : 'REJECTED_PROCESS_LIFECYCLE',
    assertion: semanticAccepted ? 'EXACT_ASSERTION' : 'MISSING_OR_WRONG_ASSERTION',
    process: compactProcess(result)
  };
}

function count(text, target) {
  return text.split(target).length - 1;
}

function repositoryRestored() {
  return [...snapshots].every(([file, bytes]) => {
    const current = readFileSync(resolve(repoRoot, file));
    return current.equals(bytes) && sha256(current) === sha256(bytes);
  });
}

function withWorkspace(label, action) {
  const root = mkdtempSync(resolve(tmpdir(), `tecm-batch1-${label.toLowerCase()}-`));
  try {
    copyInputs(root);
    return action(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (existsSync(root)) throw new Error(`temporary cleanup failed: ${label}`);
    if (!repositoryRestored()) throw new Error(`repository restoration failed: ${label}`);
  }
}

function mutate(spec, { targetMode = 'one', neutral = false } = {}) {
  return withWorkspace(spec.id, (root) => {
    const targetPath = resolve(root, spec.file);
    let text = readFileSync(targetPath, 'utf8');
    const search = targetMode === 'zero' ? '__BATCH1_ZERO_MATCH__' : spec.search;
    if (targetMode === 'multiple') text += `\n${spec.search}\n`;
    const matches = count(text, search);
    if (matches !== 1) {
      return {
        id: spec.id, accepted: false, matches,
        classification: matches === 0 ? 'ZERO_MATCH_FAIL_CLOSED' : 'MULTIPLE_MATCH_FAIL_CLOSED',
        control_passed: targetMode === 'zero' ? matches === 0 : matches > 1,
        process: null, restoration: 'PASS', cleanup: 'PASS'
      };
    }
    const replacement = neutral ? `${spec.search} ` : spec.replacement;
    writeFileSync(targetPath, text.replace(search, replacement));
    const classified = classifyMutationRun(runTest(root, spec.test), spec);
    return {
      id: spec.id, matches, classification: classified.accepted ? 'SEMANTIC_ASSERTION' : 'REJECTED',
      ...classified, restoration: 'PASS', cleanup: 'PASS'
    };
  });
}

function allGatesPassed({ baseline, targetControls, lifecycleControls, results, restoration }) {
  return baseline.accepted && targetControls.every((control) => control.control_passed) &&
    lifecycleControls.every((control) => control.control_passed) &&
    results.every((result) => result.accepted) && restoration === 'PASS';
}

function runLifecycleControls() {
  const timeout = spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
    encoding: 'utf8', timeout: 25, windowsHide: true
  });
  const signal = spawnSync(process.execPath, ['-e', 'process.kill(process.pid, "SIGTERM")'], {
    encoding: 'utf8', windowsHide: true
  });
  const unrelated = spawnSync(process.execPath, ['-e', 'process.exit(7)'], { encoding: 'utf8', windowsHide: true });
  const spawnFailure = spawnSync('__tecm_batch1_missing_executable__', [], { encoding: 'utf8', windowsHide: true });
  const uncaughtFinal = spawnSync(process.execPath, [import.meta.filename, '--control=uncaught-final'], {
    encoding: 'utf8', windowsHide: true
  });
  const spec = cases[0];
  const timeoutClassification = classifyMutationRun(timeout, spec);
  const signalClassification = classifyMutationRun(signal, spec);
  const unrelatedClassification = classifyMutationRun(unrelated, spec);
  const spawnClassification = classifyMutationRun(spawnFailure, spec);
  const statusZero = mutate(spec, { neutral: true });
  const restorationOnly = classifyMutationRun({ status: 0, signal: null, stdout: '', stderr: '' }, spec);
  return [
    { id: 'CONTROL-TIMEOUT', ...timeoutClassification, control_passed: !timeoutClassification.accepted && timeout.error?.code === 'ETIMEDOUT' },
    { id: 'CONTROL-SIGNAL', ...signalClassification, control_passed: !signalClassification.accepted && (Boolean(signal.signal) || signal.status !== 0) },
    { id: 'CONTROL-UNRELATED-EXIT', ...unrelatedClassification, control_passed: !unrelatedClassification.accepted && unrelated.status === 7 },
    { id: 'CONTROL-SPAWN-FAILURE', ...spawnClassification, control_passed: !spawnClassification.accepted && spawnFailure.error?.code === 'ENOENT' },
    { ...statusZero, id: 'CONTROL-UNCAUGHT-STATUS-0', control_passed: !statusZero.accepted && statusZero.process?.status === 0 },
    {
      id: 'CONTROL-RESTORATION-NOT-COMPENSATING',
      ...restorationOnly,
      control_passed: !restorationOnly.accepted,
      restoration: 'PASS'
    },
    {
      id: 'CONTROL-UNCAUGHT-COMPLETE-VERIFIER', accepted: false,
      control_passed: uncaughtFinal.status === 1 && /"final_result":"FAIL"/.test(uncaughtFinal.stdout ?? ''),
      process: compactProcess(uncaughtFinal)
    }
  ];
}

function runVerifier() {
  let report;
  let failed = false;
  try {
  const baselineRun = runTest(repoRoot, 'Batch 1');
  const baseline = {
    accepted: !baselineRun.error && !baselineRun.signal && baselineRun.status === 0,
    process: compactProcess(baselineRun)
  };
  const targetControls = [mutate(cases[0], { targetMode: 'zero' }), mutate(cases[0], { targetMode: 'multiple' })];
  const lifecycleControls = runLifecycleControls();
  const results = cases.map((spec) => mutate(spec));
  const restoration = repositoryRestored() ? 'PASS' : 'FAIL';
  const finalPassed = allGatesPassed({ baseline, targetControls, lifecycleControls, results, restoration });
  report = {
    harness: 'batch1-release-blockers-mutation-verify', baseline, target_controls: targetControls,
    lifecycle_controls: lifecycleControls, results, restoration, cleanup: 'PASS',
    database: 'NOT_USED', container: 'NOT_USED', final_result: finalPassed ? 'PASS' : 'FAIL'
  };
  failed = !finalPassed;
  } catch (error) {
  failed = true;
  report = {
    harness: 'batch1-release-blockers-mutation-verify', final_result: 'FAIL',
    error: error instanceof Error ? error.message : String(error),
    restoration: repositoryRestored() ? 'PASS' : 'FAIL', database: 'NOT_USED', container: 'NOT_USED'
  };
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (failed) process.exitCode = 1;
}

if (process.argv.includes('--control=uncaught-final')) {
  const baseline = { accepted: true };
  const targetControls = [{ control_passed: true }];
  const lifecycleControls = [{ control_passed: true }];
  const results = [{ accepted: false }];
  const restoration = 'PASS';
  const passed = allGatesPassed({ baseline, targetControls, lifecycleControls, results, restoration });
  process.stdout.write(`${JSON.stringify({ control: 'uncaught-final', restoration, final_result: passed ? 'PASS' : 'FAIL' })}\n`);
  if (!passed) process.exitCode = 1;
} else {
  runVerifier();
}
