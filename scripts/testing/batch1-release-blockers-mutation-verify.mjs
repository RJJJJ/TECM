import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { TextDecoder } from 'node:util';

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
const fatalUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

function decodeUtf8(bytes) {
  const source = Buffer.from(bytes);
  const hasBom = source.length >= 3 && source[0] === 0xef && source[1] === 0xbb && source[2] === 0xbf;
  const payload = hasBom ? source.subarray(3) : source;
  return { text: fatalUtf8Decoder.decode(payload), has_bom: hasBom };
}

function encodeUtf8(text, hasBom) {
  const payload = Buffer.from(text, 'utf8');
  return hasBom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), payload]) : payload;
}

function inspectSourceBytes(bytes) {
  const source = Buffer.from(bytes);
  let decoded;
  try {
    decoded = decodeUtf8(source);
  } catch {
    return {
      accepted: false, classification: 'invalid_utf8', style: null, valid_utf8: false,
      has_bom: false, sha256: sha256(source), byte_length: source.length,
      crlf_count: null, bare_lf_count: null, bare_cr_count: null
    };
  }
  const crlfCount = count(decoded.text, '\r\n');
  const withoutCrlf = decoded.text.replaceAll('\r\n', '');
  const bareLfCount = count(withoutCrlf, '\n');
  const bareCrCount = count(withoutCrlf, '\r');
  let classification = 'accepted';
  let style = null;
  if (bareCrCount > 0) classification = 'unexpected_newline_shape';
  else if (crlfCount > 0 && bareLfCount > 0) classification = 'mixed_eol';
  else if (crlfCount > 0) style = 'CRLF';
  else if (bareLfCount > 0) style = 'LF';
  else classification = 'ambiguous_eol';
  return {
    accepted: classification === 'accepted', classification, style, valid_utf8: true,
    has_bom: decoded.has_bom, sha256: sha256(source), byte_length: source.length,
    crlf_count: crlfCount, bare_lf_count: bareLfCount, bare_cr_count: bareCrCount,
    text: decoded.text
  };
}

function materializeCanonicalEol(canonicalText, style) {
  if (typeof canonicalText !== 'string' || canonicalText.length === 0 || canonicalText.includes('\r')) {
    throw new Error('canonical mutation text must be non-empty LF text without carriage returns');
  }
  if (style !== 'LF' && style !== 'CRLF') throw new Error(`unsupported source EOL style: ${style}`);
  return style === 'CRLF' ? canonicalText.replaceAll('\n', '\r\n') : canonicalText;
}

function prepareMutationBytes(sourceBytes, spec, { targetMode = 'one', neutral = false } = {}) {
  const source = inspectSourceBytes(sourceBytes);
  if (!source.accepted) {
    return {
      accepted: false, classification: source.classification, matches: null,
      mutation_body_executed: false, source: withoutSourceText(source)
    };
  }
  const canonicalSearch = targetMode === 'zero' ? '__BATCH1_ZERO_MATCH__' : spec.search;
  const search = materializeCanonicalEol(canonicalSearch, source.style);
  const eol = source.style === 'CRLF' ? '\r\n' : '\n';
  const candidateSource = targetMode === 'multiple' ? `${source.text}${eol}${search}${eol}` : source.text;
  const matches = count(candidateSource, search);
  if (matches !== 1) {
    return {
      accepted: false,
      classification: matches === 0 ? 'ZERO_MATCH_FAIL_CLOSED' : 'MULTIPLE_MATCH_FAIL_CLOSED',
      matches, mutation_body_executed: false, source: withoutSourceText(source),
      materialized_target_eol: source.style
    };
  }
  const canonicalReplacement = neutral ? `${spec.search} ` : spec.replacement;
  const replacement = materializeCanonicalEol(canonicalReplacement, source.style);
  const replacementCountBefore = count(candidateSource, replacement);
  const candidateText = candidateSource.replace(search, replacement);
  const replacementCountAfter = count(candidateText, replacement);
  const targetCountAfter = count(candidateText, search);
  const candidateBytes = encodeUtf8(candidateText, source.has_bom);
  const candidateSourceShape = inspectSourceBytes(candidateBytes);
  const candidateChanged = !candidateBytes.equals(Buffer.from(sourceBytes));
  const replacementInvariant = replacementCountAfter === replacementCountBefore + 1;
  const targetInvariant = targetCountAfter === (neutral ? 1 : 0);
  const eolInvariant = candidateSourceShape.accepted && candidateSourceShape.style === source.style;
  if (!candidateChanged || !replacementInvariant || !targetInvariant || !eolInvariant) {
    return {
      accepted: false, classification: 'REPLACEMENT_INVARIANT_FAIL_CLOSED', matches,
      mutation_body_executed: false, source: withoutSourceText(source),
      materialized_target_eol: source.style, candidate_changed: candidateChanged,
      replacement_count_before: replacementCountBefore, replacement_count_after: replacementCountAfter,
      replacement_delta: replacementCountAfter - replacementCountBefore,
      target_count_after: targetCountAfter, target_invariant: targetInvariant, eol_invariant: eolInvariant
    };
  }
  return {
    accepted: true, classification: 'MUTATION_READY', matches, mutation_body_executed: false,
    source: withoutSourceText(source), materialized_target_eol: source.style,
    candidate_bytes: candidateBytes, candidate_changed: true,
    replacement_count_before: replacementCountBefore, replacement_count_after: replacementCountAfter,
    replacement_delta: replacementCountAfter - replacementCountBefore,
    target_count_after: targetCountAfter, target_invariant: true, eol_invariant: true,
    candidate_sha256: sha256(candidateBytes), candidate_byte_length: candidateBytes.length
  };
}

function withoutSourceText(source) {
  const { text: _text, ...safe } = source;
  return safe;
}

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

function runCompleteTestFile(root, timeout = 30_000) {
  return spawnSync(process.execPath, [
    '--experimental-strip-types', '--test', '--test-reporter=tap', resolve(root, testPath)
  ], { cwd: root, encoding: 'utf8', timeout, windowsHide: true });
}

function compactProcess(result) {
  return {
    status: Number.isInteger(result?.status) ? result.status : null,
    signal: result?.signal ?? null,
    error_code: result?.error?.code ?? null
  };
}

function parseTapCount(lines, label) {
  const matches = lines.flatMap((line) => {
    const match = line.match(new RegExp(`^# ${label} (\\d+)$`));
    return match ? [Number(match[1])] : [];
  });
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0])) {
    throw new Error(`malformed TAP summary: expected one ${label} count`);
  }
  return matches[0];
}

function classifyCompleteBaseline(result) {
  const processAccepted = !result?.error && !result?.signal && Number.isInteger(result?.status) && result.status === 0;
  const reasons = [];
  let counts = null;
  let passedTests = [];
  try {
    const lines = String(result?.stdout ?? '').split(/\r?\n/);
    const plans = lines.flatMap((line) => {
      const match = line.match(/^1\.\.(\d+)$/);
      return match ? [Number(match[1])] : [];
    });
    if (plans.length !== 1 || !Number.isSafeInteger(plans[0])) {
      throw new Error('malformed TAP summary: expected one top-level plan');
    }
    counts = Object.fromEntries(
      ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']
        .map((label) => [label, parseTapCount(lines, label)])
    );
    const results = lines.flatMap((line) => {
      const match = line.match(/^(ok|not ok) (\d+) - (.*?)(?: # (?:SKIP|TODO).*)?$/);
      return match ? [{ ok: match[1] === 'ok', index: Number(match[2]), name: match[3] }] : [];
    });
    passedTests = results.filter((entry) => entry.ok).map((entry) => entry.name);
    if (counts.tests === 0) reasons.push('zero discovered tests');
    if (counts.tests !== 7 || counts.pass !== 7) reasons.push('complete unit file must execute exactly 7 passing tests');
    if (plans[0] !== counts.tests || results.length !== counts.tests) reasons.push('TAP plan/result count mismatch');
    if (!results.every((entry, index) => entry.index === index + 1)) reasons.push('TAP result indices malformed');
    if (counts.pass + counts.fail + counts.cancelled + counts.skipped + counts.todo !== counts.tests) {
      reasons.push('TAP aggregate counts malformed');
    }
    if (counts.fail !== 0 || counts.cancelled !== 0 || counts.skipped !== 0 || counts.todo !== 0) {
      reasons.push('complete unit file contains a failed, cancelled, skipped, or todo test');
    }
    if (counts.pass !== counts.tests || !results.every((entry) => entry.ok)) reasons.push('not every discovered test passed');
    const requiredTests = [...new Set(cases.map((spec) => spec.test))];
    for (const name of requiredTests) {
      if (passedTests.filter((candidate) => candidate === name).length !== 1) reasons.push(`required mutation test did not pass exactly once: ${name}`);
    }
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error));
  }
  if (!processAccepted) reasons.push('test process lifecycle rejected');
  return {
    accepted: processAccepted && reasons.length === 0,
    counts,
    mounted_form_test: passedTests.includes(cases.find((spec) => spec.id === 'B1-M7').test) ? 'PASS' : 'FAIL',
    required_mutation_tests: [...new Set(cases.map((spec) => spec.test))].map((name) => ({ name, passed: passedTests.includes(name) })),
    reasons,
    process: compactProcess(result)
  };
}

function runCompleteBaseline(root) {
  return classifyCompleteBaseline(runCompleteTestFile(root));
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

function workspaceFiles(root, relative = '') {
  const directory = resolve(root, relative);
  return readdirSync(directory).flatMap((name) => {
    const childRelative = relative ? `${relative}/${name}` : name;
    const child = resolve(root, childRelative);
    return statSync(child).isDirectory() ? workspaceFiles(root, childRelative) : [childRelative.replaceAll('\\', '/')];
  }).sort();
}

function captureWorkspaceSnapshots(root) {
  return new Map([...snapshots.keys()].map((file) => [file, readFileSync(resolve(root, file))]));
}

function workspaceState(root, expectedSnapshots = snapshots) {
  const expectedFiles = [...expectedSnapshots.keys()].map((file) => file.replaceAll('\\', '/')).sort();
  const actualFiles = workspaceFiles(root);
  const hashes = Object.fromEntries([...expectedSnapshots].map(([file, bytes]) => {
    const current = readFileSync(resolve(root, file));
    return [file, {
      expected: sha256(bytes), actual: sha256(current), matches: current.equals(bytes),
      expected_byte_length: bytes.length, actual_byte_length: current.length
    }];
  }));
  return {
    pristine: actualFiles.length === expectedFiles.length && actualFiles.every((file, index) => file === expectedFiles[index]) &&
      Object.values(hashes).every((entry) => entry.matches),
    expected_files: expectedFiles,
    actual_files: actualFiles,
    hashes
  };
}

function restoreWorkspace(root, expectedSnapshots = snapshots) {
  for (const [file, bytes] of expectedSnapshots) writeFileSync(resolve(root, file), bytes);
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

function runMutationCase(root, spec, {
  targetMode = 'one', neutral = false, beforeBaseline, onMutationBody, expectedSnapshots = snapshots
} = {}) {
  const initial = workspaceState(root, expectedSnapshots);
  let baseline;
  let report;
  try {
    if (!initial.pristine) {
      baseline = {
        accepted: false, counts: null, mounted_form_test: 'NOT_RUN', required_mutation_tests: [],
        reasons: ['protected workspace precondition or residue check failed'], process: null
      };
    } else {
      beforeBaseline?.(root);
      baseline = runCompleteBaseline(root);
    }
    if (!baseline.accepted) {
      report = {
        id: spec.id, accepted: false, classification: 'baseline_failure', baseline,
        mutation_body_executed: false, matches: null, process: null
      };
    } else {
      const targetPath = resolve(root, spec.file);
      const mutation = prepareMutationBytes(readFileSync(targetPath), spec, { targetMode, neutral });
      if (!mutation.accepted) {
        report = {
          id: spec.id, accepted: false, baseline, matches: mutation.matches,
          classification: mutation.classification,
          control_passed: targetMode === 'zero'
            ? mutation.classification === 'ZERO_MATCH_FAIL_CLOSED' && mutation.matches === 0
            : targetMode === 'multiple'
              ? mutation.classification === 'MULTIPLE_MATCH_FAIL_CLOSED' && mutation.matches > 1
              : false,
          mutation_body_executed: false, process: null, mutation
        };
      } else {
        onMutationBody?.(root);
        writeFileSync(targetPath, mutation.candidate_bytes);
        const written = readFileSync(targetPath);
        if (!written.equals(mutation.candidate_bytes) || sha256(written) !== mutation.candidate_sha256) {
          report = {
            id: spec.id, accepted: false, baseline, matches: mutation.matches,
            classification: 'MUTATION_WRITE_VERIFICATION_FAILED', mutation_body_executed: true,
            process: null, mutation: { ...mutation, candidate_bytes: undefined }
          };
        } else {
          const classified = classifyMutationRun(runTest(root, spec.test), spec);
          report = {
            id: spec.id, baseline, matches: mutation.matches,
            classification: classified.accepted ? 'SEMANTIC_ASSERTION' : 'REJECTED',
            mutation_body_executed: true, mutation: { ...mutation, candidate_bytes: undefined }, ...classified
          };
        }
      }
    }
  } finally {
    restoreWorkspace(root, expectedSnapshots);
  }
  const restored = workspaceState(root, expectedSnapshots);
  report.restoration = restored.pristine ? 'PASS' : 'FAIL';
  report.cleanup = restored.pristine ? 'PASS' : 'FAIL';
  report.precondition = initial;
  if (report.accepted && !restored.pristine) report.accepted = false;
  if (report.control_passed && !restored.pristine) report.control_passed = false;
  return report;
}

function mutate(spec, options = {}) {
  return withWorkspace(spec.id, (root) => {
    return runMutationCase(root, spec, options);
  });
}

function writeConsistentEolVariant(root, style) {
  const sourcePath = resolve(root, migrationPath);
  const before = inspectSourceBytes(readFileSync(sourcePath));
  if (!before.accepted) throw new Error(`protected migration source EOL rejected: ${before.classification}`);
  const canonicalLf = before.style === 'CRLF' ? before.text.replaceAll('\r\n', '\n') : before.text;
  const variantText = style === 'CRLF' ? canonicalLf.replaceAll('\n', '\r\n') : canonicalLf;
  writeFileSync(sourcePath, encodeUtf8(variantText, before.has_bom));
  const after = inspectSourceBytes(readFileSync(sourcePath));
  if (!after.accepted || after.style !== style) throw new Error(`could not create consistent ${style} disposable source`);
  return withoutSourceText(after);
}

function sameSourceShape(left, right) {
  return left.sha256 === right.sha256 && left.byte_length === right.byte_length &&
    left.style === right.style && left.crlf_count === right.crlf_count &&
    left.bare_lf_count === right.bare_lf_count && left.bare_cr_count === right.bare_cr_count;
}

function compactEolMutation(result) {
  return {
    accepted: result.accepted, classification: result.classification, matches: result.matches,
    mutation_body_executed: result.mutation_body_executed,
    baseline_accepted: result.baseline?.accepted ?? null,
    lifecycle: result.lifecycle ?? null, assertion: result.assertion ?? null,
    process: result.process, mutation: result.mutation,
    restoration: result.restoration, cleanup: result.cleanup
  };
}

function runEolPositiveControl(id, style) {
  return withWorkspace(id, (root) => {
    writeConsistentEolVariant(root, style);
    const expectedSnapshots = captureWorkspaceSnapshots(root);
    const sourcePath = resolve(root, migrationPath);
    const before = withoutSourceText(inspectSourceBytes(readFileSync(sourcePath)));
    const mutation = runMutationCase(root, cases[0], { expectedSnapshots });
    const after = withoutSourceText(inspectSourceBytes(readFileSync(sourcePath)));
    return {
      id,
      control_passed: mutation.accepted && mutation.classification === 'SEMANTIC_ASSERTION' &&
        mutation.matches === 1 && mutation.mutation_body_executed && mutation.baseline?.accepted &&
        mutation.mutation?.candidate_changed === true && mutation.mutation?.replacement_delta === 1 &&
        mutation.mutation?.materialized_target_eol === style && mutation.restoration === 'PASS' &&
        mutation.cleanup === 'PASS' && sameSourceShape(before, after),
      source_eol: style, before, after, mutation: compactEolMutation(mutation),
      restoration: sameSourceShape(before, after) ? 'PASS' : 'FAIL', cleanup: 'PASS'
    };
  });
}

function runEolTargetBoundaryVariant(id, style, targetMode) {
  return withWorkspace(`${id}-${style}`, (root) => {
    writeConsistentEolVariant(root, style);
    const expectedSnapshots = captureWorkspaceSnapshots(root);
    const sourcePath = resolve(root, migrationPath);
    const before = withoutSourceText(inspectSourceBytes(readFileSync(sourcePath)));
    let mutationBodyObserved = false;
    const mutation = runMutationCase(root, cases[0], {
      targetMode, expectedSnapshots, onMutationBody: () => { mutationBodyObserved = true; }
    });
    const after = withoutSourceText(inspectSourceBytes(readFileSync(sourcePath)));
    const expectedClassification = targetMode === 'zero' ? 'ZERO_MATCH_FAIL_CLOSED' : 'MULTIPLE_MATCH_FAIL_CLOSED';
    const expectedCount = targetMode === 'zero' ? mutation.matches === 0 : mutation.matches > 1;
    return {
      id: `${id}-${style}`,
      control_passed: !mutation.accepted && mutation.classification === expectedClassification && expectedCount &&
        mutation.mutation_body_executed === false && !mutationBodyObserved && mutation.baseline?.accepted &&
        mutation.restoration === 'PASS' && mutation.cleanup === 'PASS' && sameSourceShape(before, after),
      source_eol: style, before, after, mutation_body_callback_observed: mutationBodyObserved,
      mutation: compactEolMutation(mutation),
      restoration: sameSourceShape(before, after) ? 'PASS' : 'FAIL', cleanup: 'PASS'
    };
  });
}

function runMixedEolControl() {
  return withWorkspace('eol-control-e-mixed', (root) => {
    writeConsistentEolVariant(root, 'CRLF');
    const sourcePath = resolve(root, migrationPath);
    const consistent = inspectSourceBytes(readFileSync(sourcePath));
    const mixedText = consistent.text.replace('\r\n', '\n');
    if (mixedText === consistent.text) throw new Error('mixed EOL control could not replace one CRLF');
    writeFileSync(sourcePath, encodeUtf8(mixedText, consistent.has_bom));
    const expectedSnapshots = captureWorkspaceSnapshots(root);
    const before = withoutSourceText(inspectSourceBytes(readFileSync(sourcePath)));
    let mutationBodyObserved = false;
    const mutation = runMutationCase(root, cases[0], {
      expectedSnapshots, onMutationBody: () => { mutationBodyObserved = true; }
    });
    const after = withoutSourceText(inspectSourceBytes(readFileSync(sourcePath)));
    return {
      id: 'EOL-CONTROL-E-MIXED',
      control_passed: before.classification === 'mixed_eol' && !mutation.accepted &&
        mutation.classification === 'mixed_eol' && mutation.matches === null &&
        mutation.mutation_body_executed === false && !mutationBodyObserved && mutation.baseline?.accepted &&
        mutation.restoration === 'PASS' && mutation.cleanup === 'PASS' && sameSourceShape(before, after),
      source_eol: 'mixed', before, after, mutation_body_callback_observed: mutationBodyObserved,
      mutation: compactEolMutation(mutation),
      restoration: sameSourceShape(before, after) ? 'PASS' : 'FAIL', cleanup: 'PASS'
    };
  });
}

function runProtectedMigrationRegressionControl(productionB1M1, poisonedBaselineControl) {
  const expected = snapshots.get(migrationPath);
  const current = readFileSync(resolve(repoRoot, migrationPath));
  const before = withoutSourceText(inspectSourceBytes(expected));
  const after = withoutSourceText(inspectSourceBytes(current));
  const targetProbe = prepareMutationBytes(current, cases[0]);
  const gitDiff = spawnSync('git', ['diff', '--quiet', '--', migrationPath], {
    cwd: repoRoot, encoding: 'utf8', windowsHide: true
  });
  const unchanged = current.equals(expected) && sameSourceShape(before, after);
  return {
    id: 'EOL-CONTROL-F-PROTECTED-MIGRATION-REGRESSION',
    control_passed: before.style === 'CRLF' && before.bare_lf_count === 0 && before.bare_cr_count === 0 &&
      targetProbe.accepted && targetProbe.matches === 1 && targetProbe.materialized_target_eol === 'CRLF' &&
      productionB1M1?.accepted && productionB1M1?.classification === 'SEMANTIC_ASSERTION' &&
      poisonedBaselineControl?.control_passed && unchanged && gitDiff.status === 0 &&
      !gitDiff.error && !gitDiff.signal && !(gitDiff.stdout ?? '') && !(gitDiff.stderr ?? ''),
    before, after,
    canonical_target_probe: {
      accepted: targetProbe.accepted, classification: targetProbe.classification,
      matches: targetProbe.matches, materialized_target_eol: targetProbe.materialized_target_eol,
      candidate_changed: targetProbe.candidate_changed, replacement_delta: targetProbe.replacement_delta
    },
    production_b1_m1: compactEolMutation(productionB1M1),
    poisoned_later_baseline: {
      control_passed: poisonedBaselineControl?.control_passed ?? false,
      restoration: poisonedBaselineControl?.restoration ?? null,
      cleanup: poisonedBaselineControl?.cleanup ?? null
    },
    git_diff: compactProcess(gitDiff),
    restoration: unchanged ? 'PASS' : 'FAIL', cleanup: 'PASS'
  };
}

function runSourceShapeBoundaryControl(id, bytes, expectedClassification) {
  return withWorkspace(id, (root) => {
    const sourcePath = resolve(root, migrationPath);
    writeFileSync(sourcePath, bytes);
    const before = readFileSync(sourcePath);
    const mutation = prepareMutationBytes(before, cases[0]);
    const after = readFileSync(sourcePath);
    return {
      id,
      control_passed: !mutation.accepted && mutation.classification === expectedClassification &&
        mutation.matches === null && mutation.mutation_body_executed === false && after.equals(before),
      expected_classification: expectedClassification,
      observed_classification: mutation.classification,
      mutation_body_executed: mutation.mutation_body_executed,
      source_unchanged: after.equals(before),
      before_sha256: sha256(before), after_sha256: sha256(after),
      before_byte_length: before.length, after_byte_length: after.length,
      restoration: after.equals(before) ? 'PASS' : 'FAIL', cleanup: 'PASS'
    };
  });
}

function runSourceShapeBoundaryControls() {
  const controls = [
    runSourceShapeBoundaryControl('EOL-BOUNDARY-INVALID-UTF8', Buffer.from([0xc3, 0x28, 0x0a]), 'invalid_utf8'),
    runSourceShapeBoundaryControl('EOL-BOUNDARY-AMBIGUOUS-NO-NEWLINE', Buffer.from('single line', 'utf8'), 'ambiguous_eol'),
    runSourceShapeBoundaryControl('EOL-BOUNDARY-UNEXPECTED-BARE-CR', Buffer.from('first\rsecond', 'utf8'), 'unexpected_newline_shape')
  ];
  return {
    id: 'EOL-BOUNDARY-INVALID-AMBIGUOUS-NEWLINE-SHAPES',
    control_passed: controls.every((control) => control.control_passed),
    controls,
    restoration: controls.every((control) => control.restoration === 'PASS') ? 'PASS' : 'FAIL',
    cleanup: controls.every((control) => control.cleanup === 'PASS') ? 'PASS' : 'FAIL'
  };
}

function runEolControls(productionB1M1, poisonedBaselineControl) {
  const lfPositive = runEolPositiveControl('EOL-CONTROL-A-LF-POSITIVE', 'LF');
  const crlfPositive = runEolPositiveControl('EOL-CONTROL-B-CRLF-POSITIVE', 'CRLF');
  const zeroVariants = ['LF', 'CRLF'].map((style) => runEolTargetBoundaryVariant('EOL-CONTROL-C-ZERO', style, 'zero'));
  const multipleVariants = ['LF', 'CRLF'].map((style) => runEolTargetBoundaryVariant('EOL-CONTROL-D-MULTIPLE', style, 'multiple'));
  const mixed = runMixedEolControl();
  const protectedRegression = runProtectedMigrationRegressionControl(productionB1M1, poisonedBaselineControl);
  const sourceShapeBoundaries = runSourceShapeBoundaryControls();
  return [
    lfPositive,
    crlfPositive,
    {
      id: 'EOL-CONTROL-C-ZERO-LF-AND-CRLF',
      control_passed: zeroVariants.every((control) => control.control_passed),
      variants: zeroVariants,
      restoration: zeroVariants.every((control) => control.restoration === 'PASS') ? 'PASS' : 'FAIL',
      cleanup: zeroVariants.every((control) => control.cleanup === 'PASS') ? 'PASS' : 'FAIL'
    },
    {
      id: 'EOL-CONTROL-D-MULTIPLE-LF-AND-CRLF',
      control_passed: multipleVariants.every((control) => control.control_passed),
      variants: multipleVariants,
      restoration: multipleVariants.every((control) => control.restoration === 'PASS') ? 'PASS' : 'FAIL',
      cleanup: multipleVariants.every((control) => control.cleanup === 'PASS') ? 'PASS' : 'FAIL'
    },
    mixed,
    protectedRegression,
    sourceShapeBoundaries
  ];
}

function runPoisonedLaterBaselineControl() {
  return withWorkspace('poisoned-later-baseline-control', (root) => {
    const firstLifecycle = runMutationCase(root, cases[0]);
    const markerPath = resolve(root, '.tecm-batch1-mutation-body-executed');
    const unitPath = resolve(root, testPath);
    const original = readFileSync(unitPath);
    const originalHash = sha256(original);
    const search = '    assert.match(errors, /LEGACY_IDEMPOTENCY_ERROR_MESSAGE/);';
    const replacement = '    assert.match(errors, /__BATCH1_POISONED_LATER_BASELINE__/);';
    const poisonedLifecycle = runMutationCase(root, cases[1], {
      beforeBaseline: () => {
        const text = readFileSync(unitPath, 'utf8');
        if (count(text, search) !== 1) throw new Error('poisoned later-baseline target must match exactly once');
        writeFileSync(unitPath, text.replace(search, replacement));
      },
      onMutationBody: () => writeFileSync(markerPath, 'executed')
    });
    const markerAbsent = !existsSync(markerPath);
    const restored = readFileSync(unitPath);
    const restoredHash = sha256(restored);
    const pristineRerun = runMutationCase(root, cases[1]);
    const finalState = workspaceState(root);
    return {
      id: 'CONTROL-POISONED-LATER-BASELINE-NO-MUTATION',
      control_passed: firstLifecycle.accepted && !poisonedLifecycle.accepted &&
        poisonedLifecycle.classification === 'baseline_failure' &&
        poisonedLifecycle.baseline?.counts?.fail === 1 &&
        poisonedLifecycle.mutation_body_executed === false && markerAbsent &&
        restored.equals(original) && restoredHash === originalHash &&
        pristineRerun.accepted && pristineRerun.baseline?.accepted && finalState.pristine,
      first_lifecycle: firstLifecycle,
      poisoned_lifecycle: poisonedLifecycle,
      mutation_marker_absent: markerAbsent,
      pristine_rerun: pristineRerun,
      original_hash: originalHash,
      restored_hash: restoredHash,
      restoration: restored.equals(original) && restoredHash === originalHash ? 'PASS' : 'FAIL',
      cleanup: markerAbsent && finalState.pristine ? 'PASS' : 'FAIL'
    };
  });
}

function runMountedFormBaselineControl() {
  return withWorkspace('mounted-form-baseline-control', (root) => {
    const controlTestPath = resolve(root, testPath);
    const original = readFileSync(controlTestPath);
    const originalHash = sha256(original);
    const search = '  assert.match(actions, /completionToken: crypto\\.randomUUID\\(\\)/);';
    const replacement = '  assert.match(actions, /__BATCH1_MOUNTED_FORM_BASELINE_CONTROL__/);';
    const text = original.toString('utf8');
    if (count(text, search) !== 1) throw new Error('mounted-form baseline control target must match exactly once');
    writeFileSync(controlTestPath, text.replace(search, replacement));
    const brokenBaseline = runCompleteBaseline(root);
    writeFileSync(controlTestPath, original);
    const restored = readFileSync(controlTestPath);
    const restoredHash = sha256(restored);
    const restoredBaseline = runCompleteBaseline(root);
    return {
      id: 'CONTROL-MOUNTED-FORM-INDEPENDENT-FAILURE',
      control_passed: !brokenBaseline.accepted && brokenBaseline.counts?.fail === 1 &&
        restored.equals(original) && restoredHash === originalHash && restoredBaseline.accepted,
      broken_baseline: brokenBaseline,
      restoration: restored.equals(original) && restoredHash === originalHash ? 'PASS' : 'FAIL',
      restored_baseline: restoredBaseline,
      original_hash: originalHash,
      restored_hash: restoredHash,
      cleanup: 'PASS'
    };
  });
}

function allGatesPassed({
  baseline, baselineControl, postControlBaseline, poisonedBaselineControl,
  targetControls, lifecycleControls, eolControls, results, restoration
}) {
  return baseline.accepted && baselineControl.control_passed && postControlBaseline.accepted && poisonedBaselineControl.control_passed &&
    targetControls.every((control) => control.control_passed) &&
    lifecycleControls.every((control) => control.control_passed) &&
    eolControls.every((control) => control.control_passed && control.restoration === 'PASS' && control.cleanup === 'PASS') &&
    results.length === cases.length && results.every((result) => result.accepted && result.baseline?.accepted &&
      result.mutation_body_executed && result.restoration === 'PASS' && result.cleanup === 'PASS') && restoration === 'PASS';
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
  const baseline = runCompleteBaseline(repoRoot);
  if (!baseline.accepted) {
    report = {
      harness: 'batch1-release-blockers-mutation-verify', baseline,
      baseline_control: 'NOT_RUN', post_control_baseline: 'NOT_RUN', poisoned_baseline_control: 'NOT_RUN', target_controls: 'NOT_RUN',
      lifecycle_controls: 'NOT_RUN', eol_controls: 'NOT_RUN', results: 'NOT_RUN', restoration: repositoryRestored() ? 'PASS' : 'FAIL',
      cleanup: 'PASS', database: 'NOT_USED', container: 'NOT_USED', final_result: 'FAIL'
    };
    failed = true;
  } else {
  const baselineControl = runMountedFormBaselineControl();
  const postControlBaseline = runCompleteBaseline(repoRoot);
  if (!baselineControl.control_passed || !postControlBaseline.accepted) {
    report = {
      harness: 'batch1-release-blockers-mutation-verify', baseline, baseline_control: baselineControl,
      post_control_baseline: postControlBaseline, poisoned_baseline_control: 'NOT_RUN', target_controls: 'NOT_RUN', lifecycle_controls: 'NOT_RUN', eol_controls: 'NOT_RUN',
      results: 'NOT_RUN', restoration: repositoryRestored() ? 'PASS' : 'FAIL', cleanup: 'PASS',
      database: 'NOT_USED', container: 'NOT_USED', final_result: 'FAIL'
    };
    failed = true;
  } else {
    const poisonedBaselineControl = runPoisonedLaterBaselineControl();
    const targetControls = [mutate(cases[0], { targetMode: 'zero' }), mutate(cases[0], { targetMode: 'multiple' })];
    const lifecycleControls = runLifecycleControls();
    const results = cases.map((spec) => mutate(spec));
    const eolControls = runEolControls(results.find((result) => result.id === 'B1-M1'), poisonedBaselineControl);
    const restoration = repositoryRestored() ? 'PASS' : 'FAIL';
    const finalPassed = allGatesPassed({
      baseline, baselineControl, postControlBaseline, poisonedBaselineControl,
      targetControls, lifecycleControls, eolControls, results, restoration
    });
    report = {
      harness: 'batch1-release-blockers-mutation-verify', baseline, baseline_control: baselineControl,
      post_control_baseline: postControlBaseline, poisoned_baseline_control: poisonedBaselineControl, target_controls: targetControls,
      lifecycle_controls: lifecycleControls, eol_controls: eolControls, results, restoration, cleanup: 'PASS',
      database: 'NOT_USED', container: 'NOT_USED', final_result: finalPassed ? 'PASS' : 'FAIL'
    };
    failed = !finalPassed;
  }
  }
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

function runFocusedEolControls() {
  let report;
  let failed = false;
  try {
    const baseline = runCompleteBaseline(repoRoot);
    const productionB1M1 = baseline.accepted ? mutate(cases[0]) : null;
    const poisonedBaselineControl = baseline.accepted ? runPoisonedLaterBaselineControl() : null;
    const eolControls = baseline.accepted && productionB1M1?.accepted && poisonedBaselineControl?.control_passed
      ? runEolControls(productionB1M1, poisonedBaselineControl)
      : 'NOT_RUN';
    const restoration = repositoryRestored() ? 'PASS' : 'FAIL';
    const passed = baseline.accepted && productionB1M1?.accepted && poisonedBaselineControl?.control_passed &&
      Array.isArray(eolControls) && eolControls.every((control) =>
        control.control_passed && control.restoration === 'PASS' && control.cleanup === 'PASS') && restoration === 'PASS';
    report = {
      harness: 'batch1-release-blockers-eol-controls', baseline,
      production_b1_m1: productionB1M1 ? compactEolMutation(productionB1M1) : 'NOT_RUN',
      poisoned_baseline_control: poisonedBaselineControl ?? 'NOT_RUN',
      eol_controls: eolControls, restoration, cleanup: 'PASS', final_result: passed ? 'PASS' : 'FAIL'
    };
    failed = !passed;
  } catch (error) {
    failed = true;
    report = {
      harness: 'batch1-release-blockers-eol-controls', final_result: 'FAIL',
      error: error instanceof Error ? error.message : String(error),
      restoration: repositoryRestored() ? 'PASS' : 'FAIL', cleanup: 'PASS'
    };
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (failed) process.exitCode = 1;
}

if (process.argv.includes('--control=uncaught-final')) {
  const baseline = { accepted: true };
  const baselineControl = { control_passed: true };
  const postControlBaseline = { accepted: true };
  const poisonedBaselineControl = { control_passed: true };
  const targetControls = [{ control_passed: true }];
  const lifecycleControls = [{ control_passed: true }];
  const eolControls = [{ control_passed: true, restoration: 'PASS', cleanup: 'PASS' }];
  const results = [{ accepted: false }];
  const restoration = 'PASS';
  const passed = allGatesPassed({
    baseline, baselineControl, postControlBaseline, poisonedBaselineControl,
    targetControls, lifecycleControls, eolControls, results, restoration
  });
  process.stdout.write(`${JSON.stringify({ control: 'uncaught-final', restoration, final_result: passed ? 'PASS' : 'FAIL' })}\n`);
  if (!passed) process.exitCode = 1;
} else if (process.argv.includes('--eol-controls')) {
  runFocusedEolControls();
} else {
  runVerifier();
}
