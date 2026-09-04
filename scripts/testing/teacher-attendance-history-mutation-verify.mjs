import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '../..');
const databaseProbeTimeoutMilliseconds = 1_200_000;
const testPath = 'admin-web/tests/unit/teacher-attendance-history.test.ts';
const verifierPath = 'scripts/testing/teacher-attendance-history-mutation-verify.mjs';
const databaseVerifierPath = 'scripts/testing/database-verify.ps1';
const contentionCompetitorPath = 'supabase/tests/concurrency/teacher_attendance_contention_competitor.sql';
const m40SemanticPrefix = '@@TECM_M40_SEMANTIC@@';
const m40SemanticSchema = 'tecm.m40.semantic.v1';
const m40SemanticProducer = 'database-verify.ps1/Invoke-TeacherAttendanceContention';
const sourceFiles = [
  testPath,
  'supabase/migrations/202608140014_teacher_attendance_history_access.sql',
  'supabase/migrations/20260825150954_teacher_attendance_revision_guard.sql',
  'admin-web/app/admin/attendance/page.tsx',
  'admin-web/components/teacher-attendance-form.tsx',
  'admin-web/components/admin-shell.tsx',
  'admin-web/lib/operations/actions.ts',
  'admin-web/lib/operations/errors.ts',
  'scripts/testing/database-verify.ps1',
  'supabase/tests/concurrency/teacher_attendance_contention_setup.sql',
  'supabase/tests/concurrency/teacher_attendance_contention_holder.sql',
  'supabase/tests/concurrency/teacher_attendance_contention_competitor.sql',
  'supabase/tests/concurrency/teacher_attendance_contention_assert.sql',
  'supabase/tests/concurrency/teacher_attendance_contention_retry_cleanup.sql'
];

const cases = [
  {
    id: 'M30',
    file: 'supabase/migrations/20260825150954_teacher_attendance_revision_guard.sql',
    search: '  if not exists (\n    select 1 from public.teacher_profiles tp',
    replacement: '  if false and not exists (\n    select 1 from public.teacher_profiles tp',
    expectedTest: 'teacher attendance history has server-enforced assignment, tenant, and write boundaries',
    expectedFailure: 'M30 assignment guard missing'
  },
  {
    id: 'M31',
    file: 'supabase/migrations/202608140014_teacher_attendance_history_access.sql',
    search: 'for each row execute function public.capture_attendance_history_audit();',
    replacement: 'for each row execute function public.capture_audit_log();',
    expectedTest: 'teacher history corrections are guarded, idempotent, auditable, and concurrency-safe',
    expectedFailure: 'M31 attendance history audit trigger missing',
    semanticMapping: {
      originalProperty: 'The attendance trigger must call capture_attendance_history_audit() so reason, request ID, actor, and status history are retained.',
      currentTarget: 'Migration 014 remains the effective trigger definition; the T8 revision migration does not replace this audit boundary.'
    }
  },
  {
    id: 'M32',
    file: 'supabase/migrations/20260825150954_teacher_attendance_revision_guard.sql',
    search: "if session_row.starts_at > now() then raise exception 'future session attendance is not allowed'; end if;",
    replacement: "if false then raise exception 'future session attendance is not allowed'; end if;",
    expectedTest: 'teacher history corrections are guarded, idempotent, auditable, and concurrency-safe',
    expectedFailure: 'M32 future-session denial missing'
  },
  {
    id: 'M33',
    file: 'supabase/migrations/20260825150954_teacher_attendance_revision_guard.sql',
    search: '    new.revision := old.revision + 1;',
    replacement: '    new.revision := old.revision;',
    expectedTest: 'teacher history corrections are guarded, idempotent, auditable, and concurrency-safe',
    expectedFailure: 'M33 monotonic revision increment missing'
  },
  {
    id: 'M39',
    file: 'supabase/migrations/20260825150954_teacher_attendance_revision_guard.sql',
    search: '        or target_expected_revision <> attendance_row.revision then',
    replacement: '        or false then',
    expectedTest: 'teacher history corrections are guarded, idempotent, auditable, and concurrency-safe',
    expectedFailure: 'M39 stale revision equality guard missing'
  },
  {
    id: 'M40',
    file: 'supabase/migrations/20260825150954_teacher_attendance_revision_guard.sql',
    search: "  if not pg_try_advisory_xact_lock(hashtextextended(\n    'teacher-attendance:' || session_row.organization_id::text || ':' || target_session_id::text || ':' || target_student_id::text,\n    0\n  )) then\n    raise exception 'attendance update is already in progress';\n  end if;",
    replacement: "  perform pg_advisory_xact_lock(hashtextextended(\n    'teacher-attendance:' || session_row.organization_id::text || ':' || target_session_id::text || ':' || target_student_id::text,\n    0\n  ));",
    expectedTest: 'database existing/absent attendance contention proof',
    expectedFailure: 'm40_blocking_contention',
    databaseProbe: true,
    mutationTarget: 'non-blocking identity-scoped pg_try_advisory_xact_lock guard'
  }
];

class VerifierError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'VerifierError';
    this.code = code;
    this.details = details;
    this.cleanup = 'UNKNOWN';
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function rawGitBlob(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`);
  return createHash('sha1').update(header).update(bytes).digest('hex');
}

function filteredGitBlob(bytes, relative) {
  const result = spawnSync('git', ['hash-object', `--path=${relative}`, '--stdin'], {
    cwd: repoRoot,
    input: bytes,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5_000
  });
  const blob = result.stdout?.trim();
  if (result.status !== 0 || !/^[0-9a-f]{40}$/.test(blob)) {
    throw new VerifierError('GIT_BLOB_FAILED', `Could not hash protected source: ${relative}`);
  }
  return blob;
}

function snapshot(bytes, relative) {
  return {
    bytes: Buffer.from(bytes),
    sha256: sha256(bytes),
    gitBlob: filteredGitBlob(bytes, relative),
    rawGitBlob: rawGitBlob(bytes)
  };
}

const sourceSnapshots = new Map(sourceFiles.map((relative) => {
  const bytes = readFileSync(resolve(repoRoot, relative));
  return [relative, snapshot(bytes, relative)];
}));

function repoRestorationEvidence() {
  const files = sourceFiles.map((relative) => {
    const current = readFileSync(resolve(repoRoot, relative));
    const original = sourceSnapshots.get(relative);
    const currentSha256 = sha256(current);
    const currentGitBlob = filteredGitBlob(current, relative);
    const currentRawGitBlob = rawGitBlob(current);
    return {
      file: relative,
      sha256: currentSha256,
      git_blob: currentGitBlob,
      raw_git_blob: currentRawGitBlob,
      restored: current.equals(original.bytes)
        && currentSha256 === original.sha256
        && currentGitBlob === original.gitBlob
        && currentRawGitBlob === original.rawGitBlob
    };
  });
  return { status: files.every(({ restored }) => restored) ? 'PASS' : 'FAIL', files };
}

function copyFixture(destination) {
  for (const relative of sourceFiles) {
    const from = resolve(repoRoot, relative);
    if (!existsSync(from)) throw new VerifierError('MISSING_INPUT', `missing mutation input: ${relative}`);
    const to = resolve(destination, relative);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
  }
}

function countOccurrences(text, search) {
  if (!search) throw new VerifierError('INVALID_MUTATION', 'mutation search text must not be empty');
  let count = 0;
  let offset = 0;
  while (true) {
    const index = text.indexOf(search, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + search.length;
  }
}

function textShape(bytes) {
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const decoded = bytes.toString('utf8');
  const text = hasBom ? decoded.slice(1) : decoded;
  const crlfCount = (text.match(/\r\n/g) ?? []).length;
  const lfCount = (text.match(/(?<!\r)\n/g) ?? []).length;
  const eol = crlfCount > 0 && lfCount === 0 ? 'CRLF' : 'LF';
  return { hasBom, text, eol, crlfCount, lfCount };
}

function encodeText(text, { hasBom, eol }) {
  const encodedText = eol === 'CRLF' ? text.replace(/\n/g, '\r\n') : text;
  const encoded = Buffer.from(encodedText, 'utf8');
  return hasBom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), encoded]) : encoded;
}

function mutateBytes(originalBytes, mutation) {
  const shape = textShape(originalBytes);
  const normalized = shape.text.replace(/\r\n/g, '\n');
  const matches = countOccurrences(normalized, mutation.search);
  if (matches !== 1) {
    throw new VerifierError(
      'MATCH_COUNT',
      `${mutation.id} mutation matched ${matches} times`,
      { mutation: mutation.id, matches }
    );
  }
  const mutated = normalized.replace(mutation.search, mutation.replacement);
  return {
    bytes: encodeText(mutated, shape),
    matches,
    eol: shape.eol,
    utf8_bom: shape.hasBom
  };
}

function runTest(root, testNamePattern) {
  const args = ['--experimental-strip-types', '--test'];
  if (testNamePattern) args.push('--test-name-pattern', testNamePattern);
  args.push(resolve(root, testPath));
  return spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    timeout: 30_000,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024
  });
}

function runDatabaseProbe(root = repoRoot) {
  return spawnSync('pwsh', [
    '-NoLogo', '-NoProfile', '-File', resolve(root, 'scripts/testing/database-verify.ps1')
  ], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    timeout: databaseProbeTimeoutMilliseconds,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });
}

function outputOf(result) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function isM40SemanticRecord(record) {
  return exactKeys(record, ['schema', 'producer', 'race', 'classification', 'sql', 'worker', 'readiness'])
    && record.schema === m40SemanticSchema
    && record.producer === m40SemanticProducer
    && typeof record.race === 'string'
    && typeof record.classification === 'string'
    && exactKeys(record.sql, ['classification', 'sqlstate', 'error_identifier', 'elapsed_milliseconds', 'unauthorized_marker_observed'])
    && (record.sql.classification === null || typeof record.sql.classification === 'string')
    && (record.sql.sqlstate === null || /^[0-9A-Z]{5}$/.test(record.sql.sqlstate))
    && (record.sql.error_identifier === null || typeof record.sql.error_identifier === 'string')
    && (record.sql.elapsed_milliseconds === null
      || (typeof record.sql.elapsed_milliseconds === 'number' && Number.isFinite(record.sql.elapsed_milliseconds)))
    && typeof record.sql.unauthorized_marker_observed === 'boolean'
    && exactKeys(record.worker, ['state', 'exit_code', 'timed_out', 'signal', 'process_error'])
    && typeof record.worker.state === 'string'
    && (record.worker.exit_code === null || Number.isInteger(record.worker.exit_code))
    && typeof record.worker.timed_out === 'boolean'
    && (record.worker.signal === null || typeof record.worker.signal === 'string')
    && (record.worker.process_error === null || typeof record.worker.process_error === 'string')
    && typeof record.readiness === 'string';
}

function semanticSignature(record) {
  return [
    record.classification,
    record.sql.classification ?? 'null',
    record.sql.sqlstate ?? 'null',
    record.sql.error_identifier ?? 'null',
    String(record.sql.unauthorized_marker_observed)
  ].join('|');
}

function parseM40SemanticRecords(output) {
  const candidateLines = output.split(/\r?\n/).filter((line) => line.includes(m40SemanticPrefix));
  const records = [];
  const malformed = [];
  for (const line of candidateLines) {
    if (!line.startsWith(m40SemanticPrefix)
        || countOccurrences(line, m40SemanticPrefix) !== 1) {
      malformed.push('invalid_prefix_or_occurrence');
      continue;
    }
    try {
      const record = JSON.parse(line.slice(m40SemanticPrefix.length));
      if (!isM40SemanticRecord(record)) {
        malformed.push('invalid_schema');
        continue;
      }
      records.push(record);
    } catch {
      malformed.push('invalid_json');
    }
  }
  return {
    records,
    malformed,
    signatures: records.map(semanticSignature).sort(),
    occurrence_count: candidateLines.length
  };
}

function isExpectedM40Record(record) {
  return record.race === 'teacher-attendance-contention-existing'
    && record.classification === 'm40_blocking_contention'
    && record.sql.classification === 'm40_blocking_statement_timeout_v1'
    && record.sql.sqlstate === '57014'
    && record.sql.error_identifier === 'statement_timeout'
    && record.sql.elapsed_milliseconds >= 2500
    && record.sql.elapsed_milliseconds < 5000
    && record.sql.unauthorized_marker_observed === false
    && record.worker.state === 'Completed'
    && record.worker.exit_code === 0
    && record.worker.timed_out === false
    && record.worker.signal === null
    && record.worker.process_error === null
    && record.readiness === 'PASS';
}

function cleanupClassification(output) {
  const records = output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\[CLEANUP\] database=(PASS|FAIL) container=(PASS|FAIL)$/);
    return match ? [{ database: match[1], container: match[2] }] : [];
  });
  return {
    occurrence_count: records.length,
    database: records.length === 1 ? records[0].database : 'FAIL',
    container: records.length === 1 ? records[0].container : 'FAIL'
  };
}

function testFailureClassification(result, mutation) {
  const output = outputOf(result);
  const escapedName = mutation.expectedTest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const namedFailure = new RegExp(`not ok \\d+ - ${escapedName}(?:\\r?\\n|$)`).test(output);
  const assertionFailure = /AssertionError/.test(output);
  const expectedSafetyFailure = output.includes(mutation.expectedFailure);
  const summary = /# fail 1(?:\r?\n|$)/.test(output) && /# cancelled 0(?:\r?\n|$)/.test(output);
  const timedOut = result.error?.code === 'ETIMEDOUT';
  return {
    caught: result.status !== 0 && !timedOut && !result.signal
      && namedFailure && assertionFailure && expectedSafetyFailure && summary,
    exit_code: result.status,
    timed_out: timedOut,
    signal: result.signal ?? null,
    named_failure: namedFailure,
    assertion_failure: assertionFailure,
    expected_safety_failure: expectedSafetyFailure,
    exact_summary: summary
  };
}

function databaseFailureClassification(result, mutation) {
  const output = outputOf(result);
  const timedOut = result.error?.code === 'ETIMEDOUT';
  const semantic = parseM40SemanticRecords(output);
  const cleanup = cleanupClassification(output);
  const expectedRecords = semantic.records.filter(isExpectedM40Record);
  const unexpectedRecords = semantic.records.filter((record) => !isExpectedM40Record(record));
  const exactSemanticClassification = semantic.occurrence_count === 1
    && semantic.malformed.length === 0
    && expectedRecords.length === 1
    && unexpectedRecords.length === 0;
  const exactProcessFailure = result.status === 1 && !result.error && !result.signal;
  const lifecycleFailure = timedOut || Boolean(result.error) || Boolean(result.signal) || result.status === null
    || /Docker Desktop is not available|Could not start PostgreSQL|PostgreSQL did not become ready|cleanup failed/i.test(output)
    || cleanup.database !== 'PASS' || cleanup.container !== 'PASS';
  return {
    caught: exactProcessFailure && exactSemanticClassification && !lifecycleFailure,
    exit_code: result.status,
    timed_out: timedOut,
    signal: result.signal ?? null,
    process_error: result.error ? { code: result.error.code ?? null, message: result.error.message ?? String(result.error) } : null,
    exact_process_failure: exactProcessFailure,
    exact_semantic_classification: exactSemanticClassification,
    semantic_occurrence_count: semantic.occurrence_count,
    semantic_malformed: semantic.malformed,
    semantic_signatures: semantic.signatures,
    expected_semantic_records: expectedRecords.length,
    unexpected_semantic_records: unexpectedRecords.length,
    unrelated_sql_classification: semantic.records.some(({ classification }) => classification === 'unrelated_sql_error'),
    lifecycle_failure: lifecycleFailure,
    database_cleanup: cleanup.database,
    container_cleanup: cleanup.container,
    cleanup_occurrence_count: cleanup.occurrence_count
  };
}

function evaluateM40Caught({
  baselinePassed,
  mutationMatches,
  intendedMutationApplied,
  completeNoArgumentVerifierRan,
  classification,
  sourceRestoration,
  worktreeCleanup,
  workspaceCleanup
}) {
  const caught = baselinePassed === true
    && mutationMatches === 1
    && intendedMutationApplied === true
    && completeNoArgumentVerifierRan === true
    && classification.exact_semantic_classification === true
    && classification.unrelated_sql_classification === false
    && classification.timed_out === false
    && classification.signal === null
    && classification.process_error === null
    && classification.exit_code === 1
    && sourceRestoration === 'PASS'
    && classification.database_cleanup === 'PASS'
    && classification.container_cleanup === 'PASS'
    && worktreeCleanup === 'PASS'
    && workspaceCleanup === 'PASS';
  return { caught };
}

function runBaseline() {
  const result = runTest(repoRoot);
  if (result.status !== 0 || result.error?.code === 'ETIMEDOUT' || result.signal) {
    throw new VerifierError('BASELINE_FAILED', 'Teacher attendance mutation baseline must pass before mutation', {
      exit_code: result.status,
      timed_out: result.error?.code === 'ETIMEDOUT',
      signal: result.signal ?? null
    });
  }
}

function runDatabaseBaseline() {
  const result = runDatabaseProbe();
  const output = outputOf(result);
  if (result.status !== 0 || result.error || result.signal
      || !/\[PASS\] repeatable migrations, negative preflight, repeatable seed, RLS, SQL suites 001-020,/.test(output)
      || !/\[CLEANUP\] database=PASS container=PASS/.test(output)) {
    throw new VerifierError('DATABASE_BASELINE_FAILED', 'M40 database baseline must prove the complete verifier and cleanup', {
      exit_code: result.status,
      timed_out: result.error?.code === 'ETIMEDOUT',
      signal: result.signal ?? null,
      process_error: result.error ? { code: result.error.code ?? null, message: result.error.message ?? String(result.error) } : null,
      complete_verifier: /\[PASS\] repeatable migrations, negative preflight, repeatable seed, RLS, SQL suites 001-020,/.test(output),
      database_cleanup: /\[CLEANUP\] database=PASS/.test(output),
      container_cleanup: /container=PASS/.test(output)
    });
  }
  return {
    passed: true,
    exit_code: result.status,
    timed_out: false,
    signal: null,
    process_error: null,
    complete_verifier: true,
    database_cleanup: 'PASS',
    container_cleanup: 'PASS'
  };
}

function transformLineEndings(bytes, eol, withBom = false) {
  const shape = textShape(bytes);
  const normalized = shape.text.replace(/\r\n/g, '\n');
  return encodeText(normalized, { hasBom: withBom, eol });
}

function makeM40Record(overrides = {}) {
  const record = {
    schema: m40SemanticSchema,
    producer: m40SemanticProducer,
    race: 'teacher-attendance-contention-existing',
    classification: 'm40_blocking_contention',
    sql: {
      classification: 'm40_blocking_statement_timeout_v1',
      sqlstate: '57014',
      error_identifier: 'statement_timeout',
      elapsed_milliseconds: 3000,
      unauthorized_marker_observed: false
    },
    worker: { state: 'Completed', exit_code: 0, timed_out: false, signal: null, process_error: null },
    readiness: 'PASS'
  };
  return {
    ...record,
    ...overrides,
    sql: { ...record.sql, ...(overrides.sql ?? {}) },
    worker: { ...record.worker, ...(overrides.worker ?? {}) }
  };
}

function semanticLine(record) {
  return `${m40SemanticPrefix}${JSON.stringify(record)}`;
}

function runDatabaseClassificationControls(mutation, baselineEvidence) {
  const expectedLine = semanticLine(makeM40Record());
  const expectedSignature = semanticSignature(makeM40Record());
  const cleanupPass = '[CLEANUP] database=PASS container=PASS';
  const unrelated = makeM40Record({
    classification: 'unrelated_sql_error',
    sql: {
      classification: 'unexpected_sql_failure',
      sqlstate: 'P0001',
      error_identifier: 'UNRELATED_M40_SQL_PROBE',
      elapsed_milliseconds: null
    }
  });
  const unrelatedSignature = semanticSignature(unrelated);
  const specs = [
    { id: 'CONTROL-M40-EXPECTED-SEMANTIC', expectedCaught: true, expectedSignatures: [expectedSignature], output: `${expectedLine}\n${cleanupPass}` },
    { id: 'CONTROL-M40-DUPLICATED-SEMANTIC', expectedCaught: false, expectedSignatures: [expectedSignature, expectedSignature], output: `${expectedLine}\n${expectedLine}\n${cleanupPass}` },
    { id: 'CONTROL-M40-MALFORMED-SEMANTIC', expectedCaught: false, expectedSignatures: [], expectedMalformed: ['invalid_json'], expectedOccurrences: 1, output: `${m40SemanticPrefix}{\"schema\":\n${cleanupPass}` },
    { id: 'CONTROL-M40-EXPECTED-PLUS-UNRELATED', expectedCaught: false, expectedSignatures: [expectedSignature, unrelatedSignature].sort(), output: `${expectedLine}\n${semanticLine(unrelated)}\n${cleanupPass}` },
    { id: 'CONTROL-M40-UNAUTHORIZED-HUMAN-MARKER', expectedCaught: false, expectedSignatures: [], expectedOccurrences: 0, output: `M40 bounded contention classification missing\n${cleanupPass}` },
    { id: 'CONTROL-M40-TIMEOUT', expectedCaught: false, expectedSignatures: [expectedSignature], output: `${expectedLine}\n${cleanupPass}`, status: null, error: { code: 'ETIMEDOUT', message: 'timed out' } },
    { id: 'CONTROL-M40-SIGNAL', expectedCaught: false, expectedSignatures: [expectedSignature], output: `${expectedLine}\n${cleanupPass}`, status: null, signal: 'SIGTERM' },
    { id: 'CONTROL-M40-PROCESS-ERROR', expectedCaught: false, expectedSignatures: [expectedSignature], output: `${expectedLine}\n${cleanupPass}`, status: null, error: { code: 'ENOENT', message: 'spawn failed' } },
    { id: 'CONTROL-M40-DATABASE-CLEANUP-FAILURE', expectedCaught: false, expectedSignatures: [expectedSignature], output: `${expectedLine}\n[CLEANUP] database=FAIL container=PASS` },
    { id: 'CONTROL-M40-CONTAINER-CLEANUP-FAILURE', expectedCaught: false, expectedSignatures: [expectedSignature], output: `${expectedLine}\n[CLEANUP] database=PASS container=FAIL` },
    { id: 'CONTROL-M40-SOURCE-RESTORATION-FAILURE', expectedCaught: false, expectedSignatures: [expectedSignature], output: `${expectedLine}\n${cleanupPass}`, sourceRestoration: 'FAIL' },
    { id: 'CONTROL-M40-WORKTREE-CLEANUP-FAILURE', expectedCaught: false, expectedSignatures: [expectedSignature], output: `${expectedLine}\n${cleanupPass}`, worktreeCleanup: 'FAIL' },
    { id: 'CONTROL-M40-WORKSPACE-CLEANUP-FAILURE', expectedCaught: false, expectedSignatures: [expectedSignature], output: `${expectedLine}\n${cleanupPass}`, workspaceCleanup: 'FAIL' },
    { id: 'CONTROL-M40-BASELINE-FAILURE', expectedCaught: false, expectedSignatures: [expectedSignature], output: `${expectedLine}\n${cleanupPass}`, baselinePassed: false },
    { id: 'CONTROL-M40-INCOMPLETE-VERIFIER', expectedCaught: false, expectedSignatures: [expectedSignature], output: `${expectedLine}\n${cleanupPass}`, completeNoArgumentVerifierRan: false },
    { id: 'CONTROL-M40-WRONG-MUTATION', expectedCaught: false, expectedSignatures: [expectedSignature], output: `${expectedLine}\n${cleanupPass}`, intendedMutationApplied: false },
    { id: 'CONTROL-M40-STATUS-ZERO', expectedCaught: false, expectedSignatures: [expectedSignature], output: `${expectedLine}\n${cleanupPass}`, status: 0 }
  ];
  return specs.map((spec) => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), `tecm-m40-classifier-${spec.id.toLowerCase()}-`));
    const target = resolve(tempRoot, 'classifier-control.txt');
    const sentinel = `UNIQUE_${spec.id}_TARGET`;
    const original = Buffer.from(`${sentinel}\n`, 'utf8');
    let restored = false;
    let cleaned = false;
    let classification;
    let observed;
    try {
      writeFileSync(target, original);
      const mutated = mutateBytes(original, { id: spec.id, search: sentinel, replacement: `${sentinel}_MUTATED` });
      writeFileSync(target, mutated.bytes);
      classification = databaseFailureClassification({
        status: spec.status === undefined ? 1 : spec.status,
        signal: spec.signal ?? null,
        error: spec.error,
        stdout: spec.output,
        stderr: ''
      }, mutation);
      observed = evaluateM40Caught({
        baselinePassed: spec.baselinePassed ?? baselineEvidence.passed,
        mutationMatches: mutated.matches,
        intendedMutationApplied: spec.intendedMutationApplied ?? true,
        completeNoArgumentVerifierRan: spec.completeNoArgumentVerifierRan ?? true,
        classification,
        sourceRestoration: spec.sourceRestoration ?? 'PASS',
        worktreeCleanup: spec.worktreeCleanup ?? 'PASS',
        workspaceCleanup: spec.workspaceCleanup ?? 'PASS'
      }).caught;
      writeFileSync(target, original);
      restored = readFileSync(target).equals(original);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
      cleaned = !existsSync(tempRoot);
    }
    const signaturesMatch = classification.semantic_signatures.length === spec.expectedSignatures.length
      && classification.semantic_signatures.every((value, index) => value === spec.expectedSignatures[index]);
    const expectedMalformed = spec.expectedMalformed ?? [];
    const malformedMatch = classification.semantic_malformed.length === expectedMalformed.length
      && classification.semantic_malformed.every((value, index) => value === expectedMalformed[index]);
    const expectedOccurrences = spec.expectedOccurrences ?? spec.expectedSignatures.length;
    const occurrencesMatch = classification.semantic_occurrence_count === expectedOccurrences;
    if (observed !== spec.expectedCaught || !signaturesMatch || !malformedMatch
        || !occurrencesMatch || !restored || !cleaned) {
      throw new VerifierError('DATABASE_CLASSIFICATION_CONTROL_FAILED', `${spec.id} did not fail closed`, {
        control: spec.id,
        expected_caught: spec.expectedCaught,
        observed_caught: observed,
        expected_semantic_classifications: spec.expectedSignatures,
        observed_semantic_classifications: classification.semantic_signatures,
        expected_malformed_classifications: expectedMalformed,
        observed_malformed_classifications: classification.semantic_malformed,
        expected_occurrences: expectedOccurrences,
        observed_occurrences: classification.semantic_occurrence_count,
        classification,
        restoration: restored ? 'PASS' : 'FAIL',
        cleanup: cleaned ? 'PASS' : 'FAIL'
      });
    }
    return {
      id: spec.id,
      expected_caught: spec.expectedCaught,
      observed_caught: observed,
      expected_classifications: spec.expectedSignatures,
      observed_classifications: classification.semantic_signatures,
      expected_malformed_classifications: expectedMalformed,
      observed_malformed_classifications: classification.semantic_malformed,
      expected_occurrences: expectedOccurrences,
      observed_occurrences: classification.semantic_occurrence_count,
      contract_override: {
        baseline_passed: spec.baselinePassed ?? baselineEvidence.passed,
        intended_mutation_applied: spec.intendedMutationApplied ?? true,
        complete_no_argument_verifier_ran: spec.completeNoArgumentVerifierRan ?? true,
        source_restoration: spec.sourceRestoration ?? 'PASS',
        worktree_cleanup: spec.worktreeCleanup ?? 'PASS',
        workspace_cleanup: spec.workspaceCleanup ?? 'PASS'
      },
      restoration: 'PASS',
      cleanup: 'PASS',
      result: 'PASS'
    };
  });
}

function runDatabaseMutation(mutation, options = {}) {
  const controlId = options.controlId ?? mutation.id;
  const parentRoot = mkdtempSync(resolve(tmpdir(), `tecm-teacher-attendance-${controlId.toLowerCase()}-`));
  const worktreeRoot = resolve(parentRoot, 'repository');
  let worktreeAdded = false;
  let worktreeRemoved = false;
  let protectedSnapshots = new Map();
  let failure;
  let result;
  let classification;
  let mutationEvidence;
  let controlMutationEvidence = null;
  let restored = false;
  let cleaned = false;
  try {
    const addResult = spawnSync('git', ['worktree', 'add', '--detach', worktreeRoot, 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    });
    if (addResult.status !== 0 || addResult.error || addResult.signal) {
      throw new VerifierError('WORKTREE_CREATE_FAILED', `${mutation.id} could not create an isolated complete-verifier worktree`, {
        exit_code: addResult.status,
        signal: addResult.signal ?? null,
        process_error: addResult.error?.message ?? null,
        output: outputOf(addResult)
      });
    }
    worktreeAdded = true;

    const protectedRelatives = [...new Set([databaseVerifierPath, contentionCompetitorPath, mutation.file])];
    for (const relative of protectedRelatives) {
      const destination = resolve(worktreeRoot, relative);
      writeFileSync(destination, readFileSync(resolve(repoRoot, relative)));
      protectedSnapshots.set(relative, snapshot(readFileSync(destination), relative));
    }

    const target = resolve(worktreeRoot, mutation.file);
    if (options.fixtureTransform) {
      writeFileSync(target, options.fixtureTransform(readFileSync(target), mutation));
      protectedSnapshots.set(mutation.file, snapshot(readFileSync(target), mutation.file));
    }
    const original = protectedSnapshots.get(mutation.file);
    const mutated = mutateBytes(original.bytes, mutation);
    writeFileSync(target, mutated.bytes);
    const normalizedMutated = textShape(mutated.bytes).text.replace(/\r\n/g, '\n');
    mutationEvidence = {
      matches: mutated.matches,
      intended_applied: !mutated.bytes.equals(original.bytes)
        && countOccurrences(normalizedMutated, mutation.search) === 0
        && countOccurrences(normalizedMutated, mutation.replacement) === 1,
      input_eol: mutated.eol,
      input_utf8_bom: mutated.utf8_bom,
      source_sha256: original.sha256,
      source_git_blob: original.gitBlob,
      source_raw_git_blob: original.rawGitBlob
    };

    if (options.competitorMutation) {
      const competitor = resolve(worktreeRoot, contentionCompetitorPath);
      const competitorOriginal = protectedSnapshots.get(contentionCompetitorPath);
      const controlMutation = mutateBytes(competitorOriginal.bytes, options.competitorMutation);
      writeFileSync(competitor, controlMutation.bytes);
      controlMutationEvidence = {
        id: options.competitorMutation.id,
        file: contentionCompetitorPath,
        matches: controlMutation.matches,
        intended_applied: !controlMutation.bytes.equals(competitorOriginal.bytes)
      };
    }

    result = runDatabaseProbe(worktreeRoot);
    classification = databaseFailureClassification(result, mutation);
  } catch (error) {
    failure = error instanceof VerifierError
      ? error
      : new VerifierError('UNEXPECTED_VERIFIER_FAILURE', String(error));
  } finally {
    if (worktreeAdded && protectedSnapshots.size > 0) {
      try {
        for (const [relative, original] of protectedSnapshots) {
          writeFileSync(resolve(worktreeRoot, relative), original.bytes);
        }
        if (options.injectRestorationMismatch) {
          const original = protectedSnapshots.get(mutation.file);
          writeFileSync(resolve(worktreeRoot, mutation.file), Buffer.concat([original.bytes, Buffer.from('mismatch')]));
        }
        restored = [...protectedSnapshots].every(([relative, original]) => {
          const restoredBytes = readFileSync(resolve(worktreeRoot, relative));
          return restoredBytes.equals(original.bytes)
            && sha256(restoredBytes) === original.sha256
            && filteredGitBlob(restoredBytes, relative) === original.gitBlob
            && rawGitBlob(restoredBytes) === original.rawGitBlob;
        });
        if (!restored && !failure) {
          failure = new VerifierError('RESTORATION_MISMATCH', `${controlId} isolated worktree restoration mismatch`);
        }
      } catch (error) {
        if (!failure) failure = new VerifierError('RESTORATION_FAILED', `${controlId} isolated worktree restoration failed`, { error: String(error) });
      }
    }
    if (worktreeAdded) {
      const removeResult = spawnSync('git', ['worktree', 'remove', '--force', worktreeRoot], {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 60_000,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024
      });
      worktreeRemoved = removeResult.status === 0 && !removeResult.error && !removeResult.signal;
      if (!worktreeRemoved && !failure) {
        failure = new VerifierError('WORKTREE_CLEANUP_FAILED', `${mutation.id} isolated worktree could not be removed`, {
          exit_code: removeResult.status,
          signal: removeResult.signal ?? null,
          process_error: removeResult.error?.message ?? null,
          output: outputOf(removeResult)
        });
      }
    }
    rmSync(parentRoot, { recursive: true, force: true });
    cleaned = !existsSync(parentRoot) && (!worktreeAdded || worktreeRemoved);
    const repository = repoRestorationEvidence();
    if (!cleaned && !failure) failure = new VerifierError('CLEANUP_FAILED', `${mutation.id} workspace cleanup failed`);
    if (repository.status !== 'PASS' && !failure) {
      failure = new VerifierError('SOURCE_RESTORATION_FAILED', `${mutation.id} protected repository source changed`, { repository });
    }
    if (failure) {
      failure.cleanup = cleaned ? 'PASS' : 'FAIL';
      failure.details = { ...failure.details, repository_restoration: repository.status, worktree_removed: worktreeRemoved };
    }
  }
  if (failure) throw failure;

  const sourceRestoration = restored ? 'PASS' : 'FAIL';
  const worktreeCleanup = worktreeRemoved ? 'PASS' : 'FAIL';
  const workspaceCleanup = cleaned ? 'PASS' : 'FAIL';
  const caught = evaluateM40Caught({
    baselinePassed: options.baselineEvidence?.passed === true,
    mutationMatches: mutationEvidence.matches,
    intendedMutationApplied: mutationEvidence.intended_applied,
    completeNoArgumentVerifierRan: true,
    classification,
    sourceRestoration,
    worktreeCleanup,
    workspaceCleanup
  }).caught;
  const expectedCaught = options.expectedCaught ?? true;
  const observedSignatures = [...classification.semantic_signatures].sort();
  const expectedSignatures = [...(options.expectedSemanticSignatures ?? [
    'm40_blocking_contention|m40_blocking_statement_timeout_v1|57014|statement_timeout|false'
  ])].sort();
  const signaturesMatch = observedSignatures.length === expectedSignatures.length
    && observedSignatures.every((value, index) => value === expectedSignatures[index]);
  const completeProcessContract = classification.exit_code === 1
    && classification.timed_out === false
    && classification.signal === null
    && classification.process_error === null
    && classification.database_cleanup === 'PASS'
    && classification.container_cleanup === 'PASS';
  if (caught !== expectedCaught || !signaturesMatch || !completeProcessContract
      || sourceRestoration !== 'PASS' || worktreeCleanup !== 'PASS' || workspaceCleanup !== 'PASS') {
    throw new VerifierError('M40_CONTROL_CONTRACT_FAILED', `${controlId} did not satisfy the complete M40 contract`, {
      control: controlId,
      expected_caught: expectedCaught,
      observed_caught: caught,
      expected_semantic_classifications: expectedSignatures,
      observed_semantic_classifications: observedSignatures,
      classification,
      source_restoration: sourceRestoration,
      worktree_cleanup: worktreeCleanup,
      workspace_cleanup: workspaceCleanup
    });
  }
  return {
    id: controlId,
    file: mutation.file,
    matches: mutationEvidence.matches,
    intended_mutation_applied: mutationEvidence.intended_applied,
    expected_test: mutation.expectedTest,
    expected_failure: mutation.expectedFailure,
    caught,
    expected_caught: expectedCaught,
    input_eol: mutationEvidence.input_eol,
    input_utf8_bom: mutationEvidence.input_utf8_bom,
    source_sha256: mutationEvidence.source_sha256,
    source_git_blob: mutationEvidence.source_git_blob,
    source_raw_git_blob: mutationEvidence.source_raw_git_blob,
    semantic_mapping: mutation.semanticMapping ?? null,
    mutation_target: mutation.mutationTarget ?? mutation.file,
    control_mutation: controlMutationEvidence,
    expected_semantic_classifications: expectedSignatures,
    observed_semantic_classifications: observedSignatures,
    lifecycle_failure: classification.lifecycle_failure,
    database_cleanup: classification.database_cleanup,
    container_cleanup: classification.container_cleanup,
    process_contract: classification,
    restoration: sourceRestoration,
    worktree_cleanup: worktreeCleanup,
    workspace_cleanup: workspaceCleanup,
    cleanup: cleaned ? 'PASS' : 'FAIL',
    final_result: 'PASS'
  };
}

function runM40SqlControls(mutation, baselineEvidence) {
  const callTarget = '    perform public.submit_teacher_attendance(';
  const unauthorizedRecordText = semanticLine(makeM40Record());
  const controls = [
    {
      id: 'M40-REAL-UNRELATED-SQL',
      error: 'UNRELATED_M40_SQL_PROBE',
      unauthorizedMarker: false,
      expectedSignature: 'unrelated_sql_error|unexpected_sql_failure|P0001|UNRELATED_M40_SQL_PROBE|false'
    },
    {
      id: 'M40-REAL-OLD-HUMAN-TEXT',
      error: 'M40 bounded contention classification missing',
      unauthorizedMarker: false,
      expectedSignature: 'unrelated_sql_error|unexpected_sql_failure|P0001|redacted_unexpected_sql_error|false'
    },
    {
      id: 'M40-REAL-GENERIC-P0001',
      error: 'GENERIC_P0001_M40_PROBE',
      unauthorizedMarker: false,
      expectedSignature: 'unrelated_sql_error|unexpected_sql_failure|P0001|GENERIC_P0001_M40_PROBE|false'
    },
    {
      id: 'M40-REAL-UNAUTHORIZED-MARKER',
      error: 'UNAUTHORIZED_M40_MARKER_PROBE',
      unauthorizedMarker: true,
      expectedSignature: 'unrelated_sql_error|unexpected_sql_failure|P0001|UNAUTHORIZED_M40_MARKER_PROBE|true'
    }
  ];
  return controls.map((control) => {
    const notice = control.unauthorizedMarker
      ? `    raise notice '${unauthorizedRecordText}';\n`
      : '';
    return runDatabaseMutation(mutation, {
      controlId: control.id,
      baselineEvidence,
      expectedCaught: false,
      expectedSemanticSignatures: [control.expectedSignature],
      competitorMutation: {
        id: control.id,
        search: callTarget,
        replacement: `${notice}    raise exception '${control.error}';\n${callTarget}`
      }
    });
  });
}

function runM40TargetCountControls(baselineEvidence) {
  const controls = [
    { name: 'm40-zero-match', expectedMatches: 0 },
    { name: 'm40-multiple-match', expectedMatches: 2 }
  ];
  return controls.map((control) => {
    const child = spawnSync(process.execPath, [resolve(repoRoot, verifierPath), `--control=${control.name}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: process.env,
      timeout: 60_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    });
    const result = parseJsonLine(outputOf(child));
    const passed = baselineEvidence.passed
      && child.status === 1
      && !child.error
      && !child.signal
      && result?.code === 'MATCH_COUNT'
      && result?.details?.matches === control.expectedMatches
      && result?.details?.repository_restoration === 'PASS'
      && result?.details?.worktree_removed === true
      && result?.cleanup === 'PASS';
    if (!passed) {
      throw new VerifierError('M40_TARGET_COUNT_CONTROL_FAILED', `${control.name} did not fail closed`, {
        control: control.name,
        expected_matches: control.expectedMatches,
        exit_code: child.status,
        timed_out: child.error?.code === 'ETIMEDOUT',
        signal: child.signal ?? null,
        result
      });
    }
    return {
      control: control.name,
      expected_matches: control.expectedMatches,
      observed_matches: result.details.matches,
      expected_classifications: ['MATCH_COUNT'],
      observed_classifications: [result.code],
      restoration: 'PASS',
      worktree_cleanup: 'PASS',
      workspace_cleanup: result.cleanup,
      result: 'PASS'
    };
  });
}

function runMutation(mutation, options = {}) {
  if (mutation.databaseProbe) return runDatabaseMutation(mutation, options);
  const tempRoot = mkdtempSync(resolve(tmpdir(), `tecm-teacher-attendance-${mutation.id.toLowerCase()}-`));
  let failure;
  let evidence;
  let restored = false;
  let cleaned = false;
  try {
    copyFixture(tempRoot);
    const target = resolve(tempRoot, mutation.file);
    if (options.fixtureTransform) {
      writeFileSync(target, options.fixtureTransform(readFileSync(target), mutation));
    }
    const original = snapshot(readFileSync(target), mutation.file);
    const mutated = mutateBytes(original.bytes, mutation);
    writeFileSync(target, mutated.bytes);
    const result = runTest(tempRoot, mutation.expectedTest);
    const classification = testFailureClassification(result, mutation);
    if (!classification.caught) {
      throw new VerifierError(
        'WRONG_FAILURE_CLASSIFICATION',
        `${mutation.id} was not caught for the intended safety assertion`,
        { mutation: mutation.id, classification }
      );
    }
    evidence = {
      id: mutation.id,
      file: mutation.file,
      matches: mutated.matches,
      expected_test: mutation.expectedTest,
      expected_failure: mutation.expectedFailure,
      caught: true,
      input_eol: mutated.eol,
      input_utf8_bom: mutated.utf8_bom,
      source_sha256: original.sha256,
      source_git_blob: original.gitBlob,
      source_raw_git_blob: original.rawGitBlob,
      semantic_mapping: mutation.semanticMapping ?? null,
      mutation_target: mutation.mutationTarget ?? mutation.file,
      lifecycle_failure: classification.lifecycle_failure ?? false,
      database_cleanup: classification.database_cleanup ?? 'NOT_APPLICABLE',
      container_cleanup: classification.container_cleanup ?? 'NOT_APPLICABLE'
    };

    writeFileSync(target, original.bytes);
    if (options.injectRestorationMismatch) writeFileSync(target, Buffer.concat([original.bytes, Buffer.from('mismatch')]));
    const restoredBytes = readFileSync(target);
    restored = restoredBytes.equals(original.bytes)
      && sha256(restoredBytes) === original.sha256
      && filteredGitBlob(restoredBytes, mutation.file) === original.gitBlob
      && rawGitBlob(restoredBytes) === original.rawGitBlob;
    if (!restored) {
      throw new VerifierError('RESTORATION_MISMATCH', `${mutation.id} fixture restoration mismatch`, {
        mutation: mutation.id,
        expected_sha256: original.sha256,
        actual_sha256: sha256(restoredBytes),
        expected_git_blob: original.gitBlob,
        actual_git_blob: filteredGitBlob(restoredBytes, mutation.file),
        expected_raw_git_blob: original.rawGitBlob,
        actual_raw_git_blob: rawGitBlob(restoredBytes)
      });
    }
  } catch (error) {
    failure = error instanceof VerifierError
      ? error
      : new VerifierError('UNEXPECTED_VERIFIER_FAILURE', String(error));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    cleaned = !existsSync(tempRoot);
    const repository = repoRestorationEvidence();
    if (!cleaned && !failure) failure = new VerifierError('CLEANUP_FAILED', `${mutation.id} workspace cleanup failed`);
    if (repository.status !== 'PASS' && !failure) {
      failure = new VerifierError('SOURCE_RESTORATION_FAILED', `${mutation.id} protected repository source changed`, { repository });
    }
    if (failure) {
      failure.cleanup = cleaned ? 'PASS' : 'FAIL';
      failure.details = { ...failure.details, repository_restoration: repository.status };
    }
  }
  if (failure) throw failure;
  return {
    ...evidence,
    restoration: restored ? 'PASS' : 'FAIL',
    workspace_cleanup: cleaned ? 'PASS' : 'FAIL',
    cleanup: cleaned ? 'PASS' : 'FAIL',
    final_result: restored && cleaned ? 'PASS' : 'FAIL'
  };
}

function runUnrelatedFailureControl(m31) {
  const tempRoot = mkdtempSync(resolve(tmpdir(), 'tecm-teacher-attendance-unrelated-'));
  let failure;
  let cleaned = false;
  try {
    copyFixture(tempRoot);
    const testFile = resolve(tempRoot, testPath);
    const original = readFileSync(testFile);
    const shape = textShape(original);
    const normalized = shape.text.replace(/\r\n/g, '\n');
    writeFileSync(testFile, encodeText(
      `${normalized}\ntest('unrelated mutation control', () => { throw new Error('UNRELATED_CONTROL_FAILURE'); });\n`,
      shape
    ));
    const result = runTest(tempRoot);
    const classification = testFailureClassification(result, m31);
    if (classification.caught) {
      throw new VerifierError('UNRELATED_FAILURE_COUNTED', 'An unrelated failure was incorrectly counted as M31 CAUGHT', { classification });
    }
    throw new VerifierError('WRONG_FAILURE_CLASSIFICATION', 'Unrelated failure correctly rejected as M31 evidence', { classification });
  } catch (error) {
    failure = error instanceof VerifierError ? error : new VerifierError('UNEXPECTED_VERIFIER_FAILURE', String(error));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    cleaned = !existsSync(tempRoot);
    if (failure) failure.cleanup = cleaned ? 'PASS' : 'FAIL';
  }
  throw failure;
}

function controlMode(name) {
  const m31 = cases.find(({ id }) => id === 'M31');
  const m40 = cases.find(({ id }) => id === 'M40');
  runBaseline();
  if (name === 'zero-match') {
    return runMutation({ ...m31, search: '__M31_ZERO_MATCH_CONTROL__' });
  }
  if (name === 'multiple-match') {
    return runMutation(m31, {
      fixtureTransform: (bytes, mutation) => {
        const shape = textShape(bytes);
        const normalized = shape.text.replace(/\r\n/g, '\n');
        return encodeText(`${normalized}\n${mutation.search}\n`, shape);
      }
    });
  }
  if (name === 'unrelated-failure') return runUnrelatedFailureControl(m31);
  if (name === 'lf') return runMutation(m31, { fixtureTransform: (bytes) => transformLineEndings(bytes, 'LF') });
  if (name === 'crlf') return runMutation(m31, { fixtureTransform: (bytes) => transformLineEndings(bytes, 'CRLF') });
  if (name === 'utf8-bom') return runMutation(m31, { fixtureTransform: (bytes) => transformLineEndings(bytes, 'LF', true) });
  if (name === 'restoration-mismatch') return runMutation(m31, { injectRestorationMismatch: true });
  if (name === 'm40-zero-match') {
    return runMutation({ ...m40, search: '__M40_ZERO_MATCH_CONTROL__' });
  }
  if (name === 'm40-multiple-match') {
    return runMutation(m40, {
      fixtureTransform: (bytes, mutation) => {
        const shape = textShape(bytes);
        const normalized = shape.text.replace(/\r\n/g, '\n');
        return encodeText(`${normalized}\n${mutation.search}\n`, shape);
      }
    });
  }
  throw new VerifierError('UNKNOWN_CONTROL', `Unknown M31 control: ${name}`);
}

function parseJsonLine(output) {
  const lines = output.split(/\r?\n/).filter(Boolean).reverse();
  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    try { return JSON.parse(line); } catch { /* continue */ }
  }
  return null;
}

function runM31Controls() {
  const controls = [
    { name: 'zero-match', exit: 'nonzero', code: 'MATCH_COUNT' },
    { name: 'multiple-match', exit: 'nonzero', code: 'MATCH_COUNT' },
    { name: 'unrelated-failure', exit: 'nonzero', code: 'WRONG_FAILURE_CLASSIFICATION' },
    { name: 'lf', exit: 'zero' },
    { name: 'crlf', exit: 'zero' },
    { name: 'utf8-bom', exit: 'zero' },
    { name: 'restoration-mismatch', exit: 'nonzero', code: 'RESTORATION_MISMATCH' },
    { name: 'm40-zero-match', exit: 'nonzero', code: 'MATCH_COUNT' },
    { name: 'm40-multiple-match', exit: 'nonzero', code: 'MATCH_COUNT' }
  ];
  return controls.map((control) => {
    const child = spawnSync(process.execPath, [resolve(repoRoot, verifierPath), `--control=${control.name}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: process.env,
      timeout: 45_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    });
    const result = parseJsonLine(outputOf(child));
    const timedOut = child.error?.code === 'ETIMEDOUT';
    const exitCorrect = control.exit === 'zero' ? child.status === 0 : child.status !== 0;
    const codeCorrect = control.code ? result?.code === control.code : result?.result === 'passed';
    const cleanupCorrect = result?.cleanup === 'PASS';
    if (timedOut || child.signal || !exitCorrect || !codeCorrect || !cleanupCorrect) {
      throw new VerifierError('NEGATIVE_CONTROL_FAILED', `M31 ${control.name} control did not fail closed`, {
        control: control.name,
        exit_code: child.status,
        timed_out: timedOut,
        signal: child.signal ?? null,
        result
      });
    }
    return {
      control: control.name,
      result: 'PASS',
      observed_exit: child.status,
      observed_code: result.code ?? null,
      cleanup: result.cleanup
    };
  });
}

function successOutput(payload) {
  const restoration = repoRestorationEvidence();
  if (restoration.status !== 'PASS') {
    throw new VerifierError('SOURCE_RESTORATION_FAILED', 'Protected repository source changed', { restoration });
  }
  const usedDatabaseVerifier = payload.cases?.some((entry) => entry.database_cleanup === 'PASS') ?? false;
  process.stdout.write(`${JSON.stringify({
    result: 'passed',
    ...payload,
    restoration,
    cleanup: 'PASS',
    resources: {
      databases: usedDatabaseVerifier ? 'REMOVED' : 'NOT_CREATED',
      containers: usedDatabaseVerifier ? 'REMOVED' : 'NOT_CREATED',
      volumes: 'NOT_CREATED',
      workspaces: 'REMOVED'
    }
  })}\n`);
}

function main() {
  const control = process.argv.find((argument) => argument.startsWith('--control='))?.split('=')[1];
  if (control) {
    const evidence = controlMode(control);
    successOutput({ control, evidence });
    return;
  }
  if (process.argv.includes('--m31-controls')) {
    successOutput({ controls: runM31Controls() });
    return;
  }
  const focused = process.argv.find((argument) => argument.startsWith('--case='))?.split('=')[1];
  runBaseline();
  const selected = focused ? cases.filter(({ id }) => id === focused) : cases;
  if (selected.length === 0) throw new VerifierError('UNKNOWN_MUTATION', `Unknown mutation case: ${focused}`);
  const needsDatabase = selected.some(({ databaseProbe }) => databaseProbe);
  const databaseBaseline = needsDatabase ? runDatabaseBaseline() : null;
  const databaseControls = needsDatabase
    ? runDatabaseClassificationControls(cases.find(({ id }) => id === 'M40'), databaseBaseline)
    : null;
  const m40TargetCountControls = needsDatabase ? runM40TargetCountControls(databaseBaseline) : null;
  const m40SqlControls = needsDatabase
    ? runM40SqlControls(cases.find(({ id }) => id === 'M40'), databaseBaseline)
    : null;
  const controls = focused ? null : runM31Controls();
  const evidence = selected.map((mutation) => runMutation(
    mutation,
    mutation.databaseProbe ? { baselineEvidence: databaseBaseline } : {}
  ));
  successOutput({
    cases: evidence,
    controls,
    database_baseline: databaseBaseline,
    database_controls: databaseControls,
    m40_target_count_controls: m40TargetCountControls,
    m40_sql_controls: m40SqlControls
  });
}

try {
  main();
} catch (error) {
  const failure = error instanceof VerifierError
    ? error
    : new VerifierError('UNEXPECTED_VERIFIER_FAILURE', String(error));
  process.stderr.write(`${JSON.stringify({
    result: 'failed',
    code: failure.code,
    message: failure.message,
    details: failure.details,
    cleanup: failure.cleanup
  })}\n`);
  process.exitCode = 1;
}
