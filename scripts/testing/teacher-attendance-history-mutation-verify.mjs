import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '../..');
const databaseProbeTimeoutMilliseconds = 1_200_000;
const testPath = 'admin-web/tests/unit/teacher-attendance-history.test.ts';
const verifierPath = 'scripts/testing/teacher-attendance-history-mutation-verify.mjs';
const databaseVerifierPath = 'scripts/testing/database-verify.ps1';
const contentionCompetitorPath = 'supabase/tests/concurrency/teacher_attendance_contention_competitor.sql';
const m40SemanticPrefix = '@@TECM_M40_SEMANTIC@@';
const m40SemanticSchema = 'tecm.m40.semantic.v2';
const m40SemanticProducer = 'database-verify.ps1/Invoke-TeacherAttendanceContention';
const m40SidecarPathEnvironment = 'TECM_M40_SEMANTIC_RECORD_PATH';
const m40SidecarCorrelationEnvironment = 'TECM_M40_SEMANTIC_CORRELATION';
const m40SidecarMaximumBytes = 16 * 1024;
const m40LifecycleCandidateLine = '[M40 LIFECYCLE] SEMANTIC_CANDIDATE_READY';
const m40LifecycleFinalizationLine = '[M40 LIFECYCLE] FINALIZATION_PASS';
const m40LifecycleSidecarLine = '[M40 LIFECYCLE] SIDECAR_COMMITTED';
const m40ExpectedTermination = 'M40_BLOCKING_CONTENTION_CAUGHT';
const m40ExpectedTerminationLine = `[M40 EXPECTED TERMINATION] ${m40ExpectedTermination}`;
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

function databaseProbeEnvironment(overrides = {}) {
  const environment = { ...process.env };
  delete environment[m40SidecarPathEnvironment];
  delete environment[m40SidecarCorrelationEnvironment];
  return { ...environment, ...overrides };
}

function spawnDatabaseProbe(root, environment) {
  return spawnSync('pwsh', [
    '-NoLogo', '-NoProfile', '-File', resolve(root, 'scripts/testing/database-verify.ps1')
  ], {
    cwd: root,
    encoding: 'utf8',
    env: environment,
    timeout: databaseProbeTimeoutMilliseconds,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });
}

function pathIsInside(parent, candidate) {
  const relation = relative(parent, candidate);
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

function inspectM40Sidecar({
  path,
  expectedCorrelation,
  preexisting,
  startedAt,
  finishedAt,
  cleanup = 'UNKNOWN'
}) {
  const validationCodes = new Set();
  const records = [];
  const malformed = [];
  let occurrenceCount = 0;
  let present = false;
  let sizeBytes = null;
  let stale = false;
  let late = false;

  if (preexisting) validationCodes.add('M40_SIDECAR_PREEXISTING');
  if (!existsSync(path)) {
    validationCodes.add('M40_SIDECAR_MISSING');
    return {
      records,
      malformed,
      validation_codes: [...validationCodes].sort(),
      signatures: [],
      occurrence_count: occurrenceCount,
      present,
      preexisting,
      size_bytes: sizeBytes,
      stale,
      late,
      cleanup
    };
  }

  present = true;
  let bytes;
  let stats;
  try {
    stats = statSync(path);
    if (!stats.isFile()) {
      validationCodes.add('M40_SIDECAR_NOT_FILE');
      return {
        records,
        malformed,
        validation_codes: [...validationCodes].sort(),
        signatures: [],
        occurrence_count: occurrenceCount,
        present,
        preexisting,
        size_bytes: sizeBytes,
        stale,
        late,
        cleanup
      };
    }
    bytes = readFileSync(path);
    sizeBytes = bytes.length;
  } catch {
    validationCodes.add('M40_SIDECAR_READ_FAILED');
    return {
      records,
      malformed,
      validation_codes: [...validationCodes].sort(),
      signatures: [],
      occurrence_count: occurrenceCount,
      present,
      preexisting,
      size_bytes: sizeBytes,
      stale,
      late,
      cleanup
    };
  }

  stale = stats.mtimeMs < startedAt;
  late = stats.mtimeMs > finishedAt;
  if (stale) validationCodes.add('M40_SIDECAR_STALE');
  if (late) validationCodes.add('M40_SIDECAR_LATE');
  if (bytes.length === 0) {
    validationCodes.add('M40_SIDECAR_EMPTY');
  } else if (bytes.length > m40SidecarMaximumBytes) {
    validationCodes.add('M40_SIDECAR_OVERSIZED');
  } else {
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      validationCodes.add('M40_SIDECAR_ENCODING_INVALID');
    }
    if (text !== undefined) {
      const candidates = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
      occurrenceCount = candidates.length;
      if (occurrenceCount !== 1) validationCodes.add('M40_SIDECAR_RECORD_COUNT_INVALID');
      for (const candidate of candidates) {
        try {
          const record = JSON.parse(candidate);
          const recordValidationCodes = m40SemanticRecordValidationCodes(record, expectedCorrelation);
          if (recordValidationCodes.length > 0) {
            malformed.push('invalid_schema');
            for (const code of recordValidationCodes) validationCodes.add(code);
          } else {
            records.push(record);
          }
        } catch {
          malformed.push('invalid_json');
          validationCodes.add('M40_SIDECAR_JSON_INVALID');
        }
      }
    }
  }

  return {
    records,
    malformed,
    validation_codes: [...validationCodes].sort(),
    signatures: records.map(semanticSignature).sort(),
    occurrence_count: occurrenceCount,
    present,
    preexisting,
    size_bytes: sizeBytes,
    stale,
    late,
    cleanup
  };
}

function runDatabaseProbe(root = repoRoot, { m40Sidecar = false } = {}) {
  if (!m40Sidecar) return spawnDatabaseProbe(root, databaseProbeEnvironment());

  const sidecarRoot = mkdtempSync(resolve(tmpdir(), 'tecm-m40-sidecar-'));
  const sidecarPath = resolve(sidecarRoot, 'semantic-record.json');
  const correlation = randomUUID();
  if (pathIsInside(repoRoot, sidecarRoot) || existsSync(sidecarPath)) {
    rmSync(sidecarRoot, { recursive: true, force: true });
    throw new VerifierError('M40_SIDECAR_SETUP_FAILED', 'M40 sidecar must begin outside the repository at a nonexistent path');
  }

  const startedAt = Date.now();
  const preexisting = existsSync(sidecarPath);
  let result;
  let observation;
  let cleanup = 'FAIL';
  try {
    result = spawnDatabaseProbe(root, databaseProbeEnvironment({
      [m40SidecarPathEnvironment]: sidecarPath,
      [m40SidecarCorrelationEnvironment]: correlation
    }));
    const finishedAt = Date.now();
    observation = inspectM40Sidecar({
      path: sidecarPath,
      expectedCorrelation: correlation,
      preexisting,
      startedAt,
      finishedAt
    });
  } finally {
    try {
      rmSync(sidecarRoot, { recursive: true, force: false });
      cleanup = existsSync(sidecarRoot) ? 'FAIL' : 'PASS';
    } catch {
      cleanup = 'FAIL';
    }
  }
  if (!observation) {
    observation = {
      records: [],
      malformed: ['inspection_unavailable'],
      validation_codes: ['M40_SIDECAR_READ_FAILED'],
      signatures: [],
      occurrence_count: 0,
      present: false,
      preexisting,
      size_bytes: null,
      stale: false,
      late: false,
      cleanup
    };
  }
  observation.cleanup = cleanup;
  return { ...result, m40_sidecar: observation };
}

function outputOf(result) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function m40SemanticRecordValidationCodes(record, expectedCorrelation) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return ['M40_RECORD_TYPE_INVALID'];
  }
  if (!exactKeys(record, ['schema', 'producer', 'correlation', 'race', 'classification', 'sql', 'worker', 'readiness', 'lifecycle'])) {
    return ['M40_RECORD_TOP_LEVEL_FIELDS_INVALID'];
  }

  const codes = [];
  if (record.schema !== m40SemanticSchema) codes.push('M40_RECORD_SCHEMA_VERSION_INVALID');
  if (record.producer !== m40SemanticProducer) codes.push('M40_RECORD_PRODUCER_INVALID');
  if (record.correlation !== expectedCorrelation) codes.push('M40_RECORD_CORRELATION_INVALID');
  if (typeof record.correlation !== 'string'
      || typeof record.race !== 'string'
      || typeof record.classification !== 'string'
      || typeof record.readiness !== 'string') {
    codes.push('M40_RECORD_TOP_LEVEL_TYPES_INVALID');
  }

  if (!exactKeys(record.sql, ['classification', 'sqlstate', 'error_identifier', 'elapsed_milliseconds', 'unauthorized_marker_observed'])) {
    codes.push('M40_RECORD_SQL_FIELDS_INVALID');
  } else if (!(
    (record.sql.classification === null || typeof record.sql.classification === 'string')
    && (record.sql.sqlstate === null || /^[0-9A-Z]{5}$/.test(record.sql.sqlstate))
    && (record.sql.error_identifier === null || typeof record.sql.error_identifier === 'string')
    && (record.sql.elapsed_milliseconds === null
      || (typeof record.sql.elapsed_milliseconds === 'number' && Number.isFinite(record.sql.elapsed_milliseconds)))
    && typeof record.sql.unauthorized_marker_observed === 'boolean'
  )) {
    codes.push('M40_RECORD_SQL_TYPES_INVALID');
  }

  if (!exactKeys(record.worker, ['state', 'exit_code', 'timed_out', 'signal', 'process_error'])) {
    codes.push('M40_RECORD_WORKER_FIELDS_INVALID');
  } else if (!(
    typeof record.worker.state === 'string'
    && (record.worker.exit_code === null || Number.isInteger(record.worker.exit_code))
    && typeof record.worker.timed_out === 'boolean'
    && (record.worker.signal === null || typeof record.worker.signal === 'string')
    && (record.worker.process_error === null || typeof record.worker.process_error === 'string')
  )) {
    codes.push('M40_RECORD_WORKER_TYPES_INVALID');
  }

  if (!exactKeys(record.lifecycle, [
    'semantic_candidate',
    'post_candidate_assertion',
    'holder_release',
    'holder_terminal',
    'competitor_terminal',
    'jobs_stopped',
    'jobs_removed',
    'barrier_cleanup',
    'finalization',
    'rejection_codes',
    'failure_sqlstate'
  ])) {
    codes.push('M40_RECORD_LIFECYCLE_FIELDS_INVALID');
  } else {
    const lifecycle = record.lifecycle;
    const lifecycleStatesValid = ['PASS', 'REJECTED', 'FAIL'].includes(lifecycle.semantic_candidate)
      && ['PASS', 'FAIL', 'NOT_REQUIRED'].includes(lifecycle.post_candidate_assertion)
      && ['PASS', 'FAIL', 'NOT_REQUIRED'].includes(lifecycle.holder_release)
      && ['PASS', 'FAIL', 'NOT_STARTED'].includes(lifecycle.holder_terminal)
      && ['PASS', 'FAIL', 'NOT_STARTED'].includes(lifecycle.competitor_terminal)
      && ['PASS', 'FAIL', 'NOT_REQUIRED'].includes(lifecycle.jobs_stopped)
      && ['PASS', 'FAIL', 'NOT_RUN'].includes(lifecycle.jobs_removed)
      && ['PASS', 'FAIL', 'NOT_RUN'].includes(lifecycle.barrier_cleanup)
      && ['PASS', 'FAIL'].includes(lifecycle.finalization);
    const rejectionCodesValid = Array.isArray(lifecycle.rejection_codes)
      && lifecycle.rejection_codes.every((code) => typeof code === 'string' && /^M40_[A-Z0-9_]+$/.test(code))
      && new Set(lifecycle.rejection_codes).size === lifecycle.rejection_codes.length
      && lifecycle.rejection_codes.every((code, index) => index === 0 || lifecycle.rejection_codes[index - 1] < code);
    const failureSqlStateValid = lifecycle.failure_sqlstate === null
      || (typeof lifecycle.failure_sqlstate === 'string' && /^[0-9A-Z]{5}$/.test(lifecycle.failure_sqlstate));
    if (!lifecycleStatesValid || !rejectionCodesValid || !failureSqlStateValid) {
      codes.push('M40_RECORD_LIFECYCLE_TYPES_INVALID');
    } else {
      const successfulFinalization = lifecycle.post_candidate_assertion !== 'FAIL'
        && lifecycle.holder_release === 'PASS'
        && lifecycle.holder_terminal === 'PASS'
        && lifecycle.competitor_terminal === 'PASS'
        && ['PASS', 'NOT_REQUIRED'].includes(lifecycle.jobs_stopped)
        && lifecycle.jobs_removed === 'PASS'
        && lifecycle.barrier_cleanup === 'PASS';
      if ((lifecycle.finalization === 'PASS' && !successfulFinalization)
          || (lifecycle.finalization === 'FAIL' && lifecycle.rejection_codes.length === 0)) {
        codes.push('M40_RECORD_LIFECYCLE_INCONSISTENT');
      }
    }
  }
  return codes.sort();
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

function lifecycleSignature(record) {
  return [
    record.lifecycle.semantic_candidate,
    record.lifecycle.post_candidate_assertion,
    record.lifecycle.holder_release,
    record.lifecycle.holder_terminal,
    record.lifecycle.competitor_terminal,
    record.lifecycle.jobs_stopped,
    record.lifecycle.jobs_removed,
    record.lifecycle.barrier_cleanup,
    record.lifecycle.finalization,
    record.lifecycle.rejection_codes.join(','),
    record.lifecycle.failure_sqlstate ?? 'null'
  ].join('|');
}

function isM40SemanticCandidateRecord(record) {
  return record.race === 'teacher-attendance-contention-existing'
    && record.classification === 'm40_blocking_contention'
    && record.sql.classification === 'm40_blocking_statement_timeout_v1'
    && record.sql.sqlstate === '57014'
    && record.sql.error_identifier === 'statement_timeout'
    && record.sql.elapsed_milliseconds >= 2500
    && record.sql.elapsed_milliseconds < 5000
    && record.worker.state === 'Completed'
    && record.worker.exit_code === 0
    && record.worker.timed_out === false
    && record.worker.signal === null
    && record.worker.process_error === null
    && record.readiness === 'PASS';
}

function isExpectedM40Record(record) {
  return isM40SemanticCandidateRecord(record)
    && record.sql.unauthorized_marker_observed === false
    && record.lifecycle.semantic_candidate === 'PASS'
    && record.lifecycle.post_candidate_assertion === 'PASS'
    && record.lifecycle.holder_release === 'PASS'
    && record.lifecycle.holder_terminal === 'PASS'
    && record.lifecycle.competitor_terminal === 'PASS'
    && ['PASS', 'NOT_REQUIRED'].includes(record.lifecycle.jobs_stopped)
    && record.lifecycle.jobs_removed === 'PASS'
    && record.lifecycle.barrier_cleanup === 'PASS'
    && record.lifecycle.finalization === 'PASS'
    && record.lifecycle.rejection_codes.length === 0
    && record.lifecycle.failure_sqlstate === null;
}

function m40ProcessProtocol(result) {
  const lines = (result.stdout ?? '').split(/\r?\n/);
  const indices = (expected) => lines.flatMap((line, index) => line === expected ? [index] : []);
  const candidate = indices(m40LifecycleCandidateLine);
  const finalization = indices(m40LifecycleFinalizationLine);
  const sidecar = indices(m40LifecycleSidecarLine);
  const termination = indices(m40ExpectedTerminationLine);
  const cleanup = lines.flatMap((line, index) => /^\[CLEANUP\] database=(PASS|FAIL) container=(PASS|FAIL)$/.test(line) ? [index] : []);
  const rejectionCodes = lines.flatMap((line) => {
    const match = line.match(/^\[M40 REJECT\] (M40_[A-Z0-9_]+)$/);
    return match ? [match[1]] : [];
  });
  const exactPositiveSequence = candidate.length === 1
    && finalization.length === 1
    && sidecar.length === 1
    && termination.length === 1
    && cleanup.length === 1
    && candidate[0] < finalization[0]
    && finalization[0] < sidecar[0]
    && sidecar[0] < termination[0]
    && termination[0] < cleanup[0];
  return {
    exact_positive_sequence: exactPositiveSequence,
    semantic_candidate_occurrences: candidate.length,
    finalization_occurrences: finalization.length,
    sidecar_commit_occurrences: sidecar.length,
    termination_occurrences: termination.length,
    cleanup_occurrences: cleanup.length,
    rejection_codes: [...new Set(rejectionCodes)].sort()
  };
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
  const semantic = result.m40_sidecar ?? {
    records: [],
    malformed: ['missing_sidecar_observation'],
    validation_codes: ['M40_SIDECAR_MISSING'],
    signatures: [],
    occurrence_count: 0,
    present: false,
    preexisting: false,
    size_bytes: null,
    stale: false,
    late: false,
    cleanup: 'FAIL'
  };
  const cleanup = cleanupClassification(output);
  const processProtocol = m40ProcessProtocol(result);
  const unauthorizedProcessOutput = output.includes(m40SemanticPrefix);
  const expectedRecords = semantic.records.filter(isExpectedM40Record);
  const unexpectedRecords = semantic.records.filter((record) => !isExpectedM40Record(record));
  const exactSemanticClassification = semantic.occurrence_count === 1
    && semantic.malformed.length === 0
    && semantic.validation_codes.length === 0
    && expectedRecords.length === 1
    && unexpectedRecords.length === 0;
  const exactProcessFailure = result.status === 1 && !result.error && !result.signal;
  const authoritativeFinalizationSuccess = exactSemanticClassification
    && expectedRecords[0]?.lifecycle.finalization === 'PASS';
  const terminationProtocolFailure = expectedRecords.length > 0 && !processProtocol.exact_positive_sequence;
  const recordLifecycleFailure = semantic.records.some(({ lifecycle }) => lifecycle.finalization !== 'PASS');
  const lifecycleFailure = timedOut || Boolean(result.error) || Boolean(result.signal) || result.status === null
    || /Docker Desktop is not available|Could not start PostgreSQL|PostgreSQL did not become ready|cleanup failed|\[M40 SIDECAR WRITE FAILURE\]/i.test(output)
    || cleanup.database !== 'PASS' || cleanup.container !== 'PASS' || semantic.cleanup !== 'PASS'
    || recordLifecycleFailure || terminationProtocolFailure
    || processProtocol.rejection_codes.includes('M40_SIDECAR_WRITE_FAILED')
    || (expectedRecords.length > 0 && processProtocol.rejection_codes.length > 0);
  const rejectionCodes = new Set(semantic.validation_codes);
  for (const code of processProtocol.rejection_codes) rejectionCodes.add(code);
  if (unauthorizedProcessOutput) rejectionCodes.add('M40_UNAUTHORIZED_PROCESS_OUTPUT');
  if (processProtocol.rejection_codes.includes('M40_SIDECAR_WRITE_FAILED')) rejectionCodes.add('M40_SIDECAR_WRITE_FAILED');
  if (terminationProtocolFailure) rejectionCodes.add('M40_TERMINATION_PROTOCOL_INVALID');
  for (const record of unexpectedRecords) {
    for (const code of record.lifecycle.rejection_codes) rejectionCodes.add(code);
    if (record.race !== 'teacher-attendance-contention-existing') {
      rejectionCodes.add('M40_RECORD_RACE_INVALID');
    }
    if (record.sql.unauthorized_marker_observed === true) {
      rejectionCodes.add('M40_UNAUTHORIZED_MARKER_OBSERVED');
    }
    if (record.classification === 'unrelated_sql_error') {
      rejectionCodes.add('M40_UNRELATED_SQL_FAILURE');
    }
    if (record.race === 'teacher-attendance-contention-existing'
        && record.sql.unauthorized_marker_observed !== true
        && record.classification !== 'unrelated_sql_error'
        && !isM40SemanticCandidateRecord(record)) {
      rejectionCodes.add('M40_SEMANTIC_RECORD_UNEXPECTED');
    }
  }
  if (result.status !== 1) rejectionCodes.add('M40_PROCESS_STATUS_INVALID');
  if (timedOut) rejectionCodes.add('M40_PROCESS_TIMEOUT');
  if (result.error && !timedOut) rejectionCodes.add('M40_PROCESS_ERROR');
  if (result.signal) rejectionCodes.add('M40_PROCESS_SIGNAL');
  if (cleanup.occurrence_count !== 1) rejectionCodes.add('M40_CLEANUP_RECORD_COUNT_INVALID');
  if (cleanup.database !== 'PASS') rejectionCodes.add('M40_DATABASE_CLEANUP_FAILED');
  if (cleanup.container !== 'PASS') rejectionCodes.add('M40_CONTAINER_CLEANUP_FAILED');
  if (semantic.cleanup !== 'PASS') rejectionCodes.add('M40_SIDECAR_CLEANUP_FAILED');
  if (lifecycleFailure) rejectionCodes.add('M40_LIFECYCLE_FAILURE_OBSERVED');
  return {
    caught: exactProcessFailure && exactSemanticClassification && authoritativeFinalizationSuccess
      && processProtocol.exact_positive_sequence && processProtocol.rejection_codes.length === 0
      && !unauthorizedProcessOutput && !lifecycleFailure,
    exit_code: result.status,
    timed_out: timedOut,
    signal: result.signal ?? null,
    process_error: result.error ? { code: result.error.code ?? null, message: result.error.message ?? String(result.error) } : null,
    exact_process_failure: exactProcessFailure,
    exact_semantic_classification: exactSemanticClassification,
    authoritative_finalization_success: authoritativeFinalizationSuccess,
    exact_termination_protocol: processProtocol.exact_positive_sequence,
    process_protocol: processProtocol,
    semantic_occurrence_count: semantic.occurrence_count,
    semantic_malformed: semantic.malformed,
    semantic_validation_codes: semantic.validation_codes,
    semantic_signatures: semantic.signatures,
    lifecycle_signatures: semantic.records.map(lifecycleSignature).sort(),
    lifecycle_records: semantic.records.map(({ lifecycle }) => lifecycle),
    lifecycle_rejection_codes: [...new Set(semantic.records.flatMap(({ lifecycle }) => lifecycle.rejection_codes))].sort(),
    lifecycle_failure_sqlstates: semantic.records.flatMap(({ lifecycle }) => lifecycle.failure_sqlstate ? [lifecycle.failure_sqlstate] : []).sort(),
    semantic_candidate_records: semantic.records.filter((record) => (
      record.lifecycle.semantic_candidate === 'PASS' && isM40SemanticCandidateRecord(record)
    )).length,
    semantic_sqlstates: semantic.records.map(({ sql }) => sql.sqlstate).sort(),
    expected_semantic_records: expectedRecords.length,
    unexpected_semantic_records: unexpectedRecords.length,
    unrelated_sql_classification: semantic.records.some(({ classification }) => classification === 'unrelated_sql_error'),
    unauthorized_process_output: unauthorizedProcessOutput,
    lifecycle_failure: lifecycleFailure,
    database_cleanup: cleanup.database,
    container_cleanup: cleanup.container,
    cleanup_occurrence_count: cleanup.occurrence_count,
    sidecar_present: semantic.present,
    sidecar_preexisting: semantic.preexisting,
    sidecar_size_bytes: semantic.size_bytes,
    sidecar_stale: semantic.stale,
    sidecar_late: semantic.late,
    sidecar_cleanup: semantic.cleanup,
    rejection_codes: [...rejectionCodes].sort()
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
  const classifierRejectionCodes = classification.rejection_codes ?? [];
  const caught = baselinePassed === true
    && mutationMatches === 1
    && intendedMutationApplied === true
    && completeNoArgumentVerifierRan === true
    && classification.caught === true
    && classification.lifecycle_failure === false
    && classifierRejectionCodes.length === 0
    && classification.exact_semantic_classification === true
    && classification.authoritative_finalization_success === true
    && classification.exact_termination_protocol === true
    && classification.unrelated_sql_classification === false
    && classification.unauthorized_process_output === false
    && classification.timed_out === false
    && classification.signal === null
    && classification.process_error === null
    && classification.exit_code === 1
    && sourceRestoration === 'PASS'
    && classification.database_cleanup === 'PASS'
    && classification.container_cleanup === 'PASS'
    && worktreeCleanup === 'PASS'
    && workspaceCleanup === 'PASS';
  const rejectionCodes = new Set(classifierRejectionCodes);
  if (classification.caught !== true) rejectionCodes.add('M40_LOWER_CLASSIFIER_REJECTED');
  if (classification.lifecycle_failure !== false) rejectionCodes.add('M40_LIFECYCLE_FAILURE_OBSERVED');
  if (baselinePassed !== true) rejectionCodes.add('M40_BASELINE_INCOMPLETE');
  if (mutationMatches !== 1) rejectionCodes.add('M40_MUTATION_TARGET_COUNT_INVALID');
  if (intendedMutationApplied !== true) rejectionCodes.add('M40_INTENDED_MUTATION_NOT_APPLIED');
  if (completeNoArgumentVerifierRan !== true) rejectionCodes.add('M40_COMPLETE_VERIFIER_NOT_RUN');
  if (sourceRestoration !== 'PASS') rejectionCodes.add('M40_SOURCE_RESTORATION_FAILED');
  if (worktreeCleanup !== 'PASS') rejectionCodes.add('M40_WORKTREE_CLEANUP_FAILED');
  if (workspaceCleanup !== 'PASS') rejectionCodes.add('M40_WORKSPACE_CLEANUP_FAILED');
  return { caught, rejection_codes: [...rejectionCodes].sort() };
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
    correlation: '00000000-0000-4000-8000-000000000040',
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
    readiness: 'PASS',
    lifecycle: {
      semantic_candidate: 'PASS',
      post_candidate_assertion: 'PASS',
      holder_release: 'PASS',
      holder_terminal: 'PASS',
      competitor_terminal: 'PASS',
      jobs_stopped: 'NOT_REQUIRED',
      jobs_removed: 'PASS',
      barrier_cleanup: 'PASS',
      finalization: 'PASS',
      rejection_codes: [],
      failure_sqlstate: null
    }
  };
  return {
    ...record,
    ...overrides,
    sql: { ...record.sql, ...(overrides.sql ?? {}) },
    worker: { ...record.worker, ...(overrides.worker ?? {}) },
    lifecycle: { ...record.lifecycle, ...(overrides.lifecycle ?? {}) }
  };
}

function semanticLine(record) {
  return `${m40SemanticPrefix}${JSON.stringify(record)}`;
}

function runDatabaseClassificationControls(mutation, baselineEvidence) {
  const expectedRecord = makeM40Record();
  const expectedSidecar = JSON.stringify(expectedRecord);
  const expectedLine = semanticLine(expectedRecord);
  const expectedSignature = semanticSignature(expectedRecord);
  const cleanupPass = '[CLEANUP] database=PASS container=PASS';
  const positiveOutput = [
    m40LifecycleCandidateLine,
    m40LifecycleFinalizationLine,
    m40LifecycleSidecarLine,
    m40ExpectedTerminationLine,
    cleanupPass
  ].join('\n');
  const lowerRejected = 'M40_LOWER_CLASSIFIER_REJECTED';
  const lifecycleRejected = 'M40_LIFECYCLE_FAILURE_OBSERVED';
  const wrongSchema = makeM40Record({ schema: 'tecm.m40.semantic.v1' });
  const wrongCorrelation = makeM40Record({ correlation: '00000000-0000-4000-8000-000000000041' });
  const missingTopLevel = makeM40Record();
  delete missingTopLevel.readiness;
  const missingSqlField = makeM40Record();
  delete missingSqlField.sql.error_identifier;
  const missingWorkerField = makeM40Record();
  delete missingWorkerField.worker.timed_out;
  const missingLifecycleField = makeM40Record();
  delete missingLifecycleField.lifecycle.jobs_removed;
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
  const unauthorized = makeM40Record({ sql: { unauthorized_marker_observed: true } });
  const unauthorizedSignature = semanticSignature(unauthorized);
  const specs = [
    { id: 'CONTROL-M40-EXPECTED-SIDECAR', expectedCaught: true, expectedCodes: [], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveOutput },
    { id: 'CONTROL-M40-SIDECAR-MISSING', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_MISSING'], expectedSignatures: [], expectedOccurrences: 0, output: positiveOutput },
    { id: 'CONTROL-M40-SIDECAR-PREEXISTING', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_PREEXISTING'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, preexisting: true, output: positiveOutput },
    { id: 'CONTROL-M40-SIDECAR-EMPTY', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_EMPTY'], expectedSignatures: [], expectedOccurrences: 0, sidecarContent: '', output: positiveOutput },
    { id: 'CONTROL-M40-MALFORMED-SEMANTIC', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_JSON_INVALID'], expectedSignatures: [], expectedOccurrences: 1, sidecarContent: '{"schema":', output: positiveOutput },
    { id: 'CONTROL-M40-INCOMPLETE-WRITE', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_JSON_INVALID'], expectedSignatures: [], expectedOccurrences: 1, sidecarContent: expectedSidecar.slice(0, -1), output: positiveOutput },
    { id: 'CONTROL-M40-DUPLICATED-SEMANTIC', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_RECORD_COUNT_INVALID'], expectedSignatures: [expectedSignature, expectedSignature], expectedOccurrences: 2, sidecarContent: `${expectedSidecar}\n${expectedSidecar}`, output: positiveOutput },
    { id: 'CONTROL-M40-WRONG-SCHEMA-VERSION', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_RECORD_SCHEMA_VERSION_INVALID'], expectedSignatures: [], expectedOccurrences: 1, sidecarContent: JSON.stringify(wrongSchema), output: positiveOutput },
    { id: 'CONTROL-M40-WRONG-CORRELATION', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_RECORD_CORRELATION_INVALID'], expectedSignatures: [], expectedOccurrences: 1, sidecarContent: JSON.stringify(wrongCorrelation), output: positiveOutput },
    { id: 'CONTROL-M40-MISSING-TOP-LEVEL-FIELD', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_RECORD_TOP_LEVEL_FIELDS_INVALID'], expectedSignatures: [], expectedOccurrences: 1, sidecarContent: JSON.stringify(missingTopLevel), output: positiveOutput },
    { id: 'CONTROL-M40-MISSING-SQL-FIELD', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_RECORD_SQL_FIELDS_INVALID'], expectedSignatures: [], expectedOccurrences: 1, sidecarContent: JSON.stringify(missingSqlField), output: positiveOutput },
    { id: 'CONTROL-M40-MISSING-WORKER-FIELD', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_RECORD_WORKER_FIELDS_INVALID'], expectedSignatures: [], expectedOccurrences: 1, sidecarContent: JSON.stringify(missingWorkerField), output: positiveOutput },
    { id: 'CONTROL-M40-MISSING-LIFECYCLE-FIELD', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_RECORD_LIFECYCLE_FIELDS_INVALID'], expectedSignatures: [], expectedOccurrences: 1, sidecarContent: JSON.stringify(missingLifecycleField), output: positiveOutput },
    { id: 'CONTROL-M40-WRONG-RACE', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_RECORD_RACE_INVALID'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: JSON.stringify(makeM40Record({ race: 'teacher-attendance-contention-absent' })), output: positiveOutput },
    { id: 'CONTROL-M40-WRONG-PRODUCER', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_RECORD_PRODUCER_INVALID'], expectedSignatures: [], expectedOccurrences: 1, sidecarContent: JSON.stringify(makeM40Record({ producer: 'sql-worker/forged-producer' })), output: positiveOutput },
    { id: 'CONTROL-M40-EXPECTED-PLUS-UNRELATED', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_RECORD_COUNT_INVALID', 'M40_UNRELATED_SQL_FAILURE'], expectedSignatures: [expectedSignature, unrelatedSignature].sort(), expectedOccurrences: 2, sidecarContent: `${expectedSidecar}\n${JSON.stringify(unrelated)}`, output: positiveOutput },
    { id: 'CONTROL-M40-SIDECAR-OVERSIZED', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_OVERSIZED'], expectedSignatures: [], expectedOccurrences: 0, sidecarContent: 'x'.repeat(m40SidecarMaximumBytes + 1), output: positiveOutput },
    { id: 'CONTROL-M40-RECORD-ONLY-IN-STDOUT', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_MISSING', 'M40_UNAUTHORIZED_PROCESS_OUTPUT'], expectedSignatures: [], expectedOccurrences: 0, output: `${expectedLine}\n${positiveOutput}` },
    { id: 'CONTROL-M40-VALID-SIDECAR-UNAUTHORIZED-STDOUT', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_UNAUTHORIZED_MARKER_OBSERVED', 'M40_UNAUTHORIZED_PROCESS_OUTPUT'], expectedSignatures: [unauthorizedSignature], expectedOccurrences: 1, sidecarContent: JSON.stringify(unauthorized), output: `${expectedLine}\n${positiveOutput}` },
    { id: 'CONTROL-M40-SIDECAR-WRITE-FAILURE', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_SIDECAR_MISSING', 'M40_SIDECAR_WRITE_FAILED'], expectedSignatures: [], expectedOccurrences: 0, output: `${m40LifecycleCandidateLine}\n${m40LifecycleFinalizationLine}\n[M40 REJECT] M40_SIDECAR_WRITE_FAILED\n${cleanupPass}` },
    { id: 'CONTROL-M40-SIDECAR-CLEANUP-FAILURE', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_SIDECAR_CLEANUP_FAILED'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, sidecarCleanup: 'FAIL', output: positiveOutput },
    { id: 'CONTROL-M40-STALE-OTHER-EXECUTION', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_RECORD_CORRELATION_INVALID', 'M40_SIDECAR_STALE'], expectedSignatures: [], expectedOccurrences: 1, sidecarContent: JSON.stringify(wrongCorrelation), stale: true, output: positiveOutput },
    { id: 'CONTROL-M40-LATE-SIDECAR', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_LATE'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, late: true, output: positiveOutput },
    { id: 'CONTROL-M40-EXPECTED-FREE-TEXT', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_SIDECAR_MISSING'], expectedSignatures: [], expectedOccurrences: 0, output: `M40 bounded contention classification missing\n${cleanupPass}` },
    { id: 'CONTROL-M40-STATUS-ZERO', expectedCaught: false, expectedCodes: [lowerRejected, 'M40_PROCESS_STATUS_INVALID'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveOutput, status: 0 },
    { id: 'CONTROL-M40-TIMEOUT', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_PROCESS_STATUS_INVALID', 'M40_PROCESS_TIMEOUT'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveOutput, status: null, error: { code: 'ETIMEDOUT', message: 'timed out' } },
    { id: 'CONTROL-M40-SIGNAL', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_PROCESS_SIGNAL', 'M40_PROCESS_STATUS_INVALID'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveOutput, status: null, signal: 'SIGTERM' },
    { id: 'CONTROL-M40-PROCESS-ERROR', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_PROCESS_ERROR', 'M40_PROCESS_STATUS_INVALID'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveOutput, status: null, error: { code: 'ENOENT', message: 'spawn failed' } },
    { id: 'CONTROL-M40-DATABASE-CLEANUP-FAILURE', expectedCaught: false, expectedCodes: ['M40_DATABASE_CLEANUP_FAILED', lifecycleRejected, lowerRejected], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveOutput.replace(cleanupPass, '[CLEANUP] database=FAIL container=PASS') },
    { id: 'CONTROL-M40-CONTAINER-CLEANUP-FAILURE', expectedCaught: false, expectedCodes: ['M40_CONTAINER_CLEANUP_FAILED', lifecycleRejected, lowerRejected], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveOutput.replace(cleanupPass, '[CLEANUP] database=PASS container=FAIL') },
    { id: 'CONTROL-M40-LIFECYCLE-VALID-RECORD', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: `Docker Desktop is not available\n${positiveOutput}` },
    { id: 'CONTROL-M40-UNEXPECTED-POST-SIDECAR-FAILURE', expectedCaught: false, expectedCodes: [lifecycleRejected, lowerRejected, 'M40_UNEXPECTED_POST_SIDECAR_FAILURE'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: `${positiveOutput}\n[M40 REJECT] M40_UNEXPECTED_POST_SIDECAR_FAILURE` },
    { id: 'CONTROL-M40-SOURCE-RESTORATION-FAILURE', expectedCaught: false, expectedCodes: ['M40_SOURCE_RESTORATION_FAILED'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveOutput, sourceRestoration: 'FAIL' },
    { id: 'CONTROL-M40-WORKTREE-CLEANUP-FAILURE', expectedCaught: false, expectedCodes: ['M40_WORKTREE_CLEANUP_FAILED'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveOutput, worktreeCleanup: 'FAIL' },
    { id: 'CONTROL-M40-WORKSPACE-CLEANUP-FAILURE', expectedCaught: false, expectedCodes: ['M40_WORKSPACE_CLEANUP_FAILED'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveOutput, workspaceCleanup: 'FAIL' },
    { id: 'CONTROL-M40-BASELINE-FAILURE', expectedCaught: false, expectedCodes: ['M40_BASELINE_INCOMPLETE'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveOutput, baselinePassed: false },
    { id: 'CONTROL-M40-INCOMPLETE-VERIFIER', expectedCaught: false, expectedCodes: ['M40_COMPLETE_VERIFIER_NOT_RUN'], expectedSignatures: [expectedSignature], expectedOccurrences: 1, sidecarContent: expectedSidecar, output: positiveOutput, completeNoArgumentVerifierRan: false }
  ];
  return specs.map((spec) => {
    const uniqueExpectedCodes = new Set(spec.expectedCodes);
    if ((!spec.expectedCaught && spec.expectedCodes.length === 0)
        || uniqueExpectedCodes.size !== spec.expectedCodes.length) {
      throw new VerifierError('DATABASE_CLASSIFICATION_CONTROL_INVALID', `${spec.id} must define expected rejection codes`);
    }
    const tempRoot = mkdtempSync(resolve(tmpdir(), `tecm-m40-classifier-${spec.id.toLowerCase()}-`));
    const target = resolve(tempRoot, 'classifier-control.txt');
    const sidecar = resolve(tempRoot, 'semantic-record.json');
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
      const now = Date.now();
      if (spec.sidecarContent !== undefined) writeFileSync(sidecar, spec.sidecarContent);
      let startedAt = now - 2_000;
      let finishedAt = now + 2_000;
      if (spec.stale) {
        const staleTime = new Date(now - 10_000);
        utimesSync(sidecar, staleTime, staleTime);
        startedAt = now - 5_000;
      }
      if (spec.late) {
        startedAt = now - 10_000;
        finishedAt = now - 5_000;
      }
      const sidecarObservation = inspectM40Sidecar({
        path: sidecar,
        expectedCorrelation: expectedRecord.correlation,
        preexisting: spec.preexisting ?? false,
        startedAt,
        finishedAt,
        cleanup: spec.sidecarCleanup ?? 'PASS'
      });
      classification = databaseFailureClassification({
        status: spec.status === undefined ? 1 : spec.status,
        signal: spec.signal ?? null,
        error: spec.error,
        stdout: spec.output,
        stderr: '',
        m40_sidecar: sidecarObservation
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
      });
      writeFileSync(target, original);
      restored = readFileSync(target).equals(original);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
      cleaned = !existsSync(tempRoot);
    }
    const signaturesMatch = classification.semantic_signatures.length === spec.expectedSignatures.length
      && classification.semantic_signatures.every((value, index) => value === spec.expectedSignatures[index]);
    const expectedOccurrences = spec.expectedOccurrences;
    const occurrencesMatch = classification.semantic_occurrence_count === expectedOccurrences;
    const expectedCodes = [...spec.expectedCodes].sort();
    const codesMatch = observed.rejection_codes.length === expectedCodes.length
      && observed.rejection_codes.every((value, index) => value === expectedCodes[index]);
    if (observed.caught !== spec.expectedCaught || !codesMatch || !signaturesMatch
        || !occurrencesMatch || !restored || !cleaned) {
      throw new VerifierError('DATABASE_CLASSIFICATION_CONTROL_FAILED', `${spec.id} did not fail closed`, {
        control: spec.id,
        expected_caught: spec.expectedCaught,
        observed_caught: observed.caught,
        expected_rejection_codes: expectedCodes,
        observed_rejection_codes: observed.rejection_codes,
        expected_semantic_classifications: spec.expectedSignatures,
        observed_semantic_classifications: classification.semantic_signatures,
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
      observed_caught: observed.caught,
      expected_rejection_codes: expectedCodes,
      observed_rejection_codes: observed.rejection_codes,
      expected_classifications: spec.expectedSignatures,
      observed_classifications: classification.semantic_signatures,
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

    if (options.verifierMutation) {
      if (controlMutationEvidence) {
        throw new VerifierError('M40_CONTROL_MUTATION_INVALID', `${controlId} may use only one auxiliary source mutation`);
      }
      const verifier = resolve(worktreeRoot, databaseVerifierPath);
      const verifierOriginal = protectedSnapshots.get(databaseVerifierPath);
      const controlMutation = mutateBytes(verifierOriginal.bytes, options.verifierMutation);
      writeFileSync(verifier, controlMutation.bytes);
      controlMutationEvidence = {
        id: options.verifierMutation.id,
        file: databaseVerifierPath,
        matches: controlMutation.matches,
        intended_applied: !controlMutation.bytes.equals(verifierOriginal.bytes)
      };
    }

    result = runDatabaseProbe(worktreeRoot, { m40Sidecar: true });
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
  const evaluation = evaluateM40Caught({
    baselinePassed: options.baselineEvidence?.passed === true,
    mutationMatches: mutationEvidence.matches,
    intendedMutationApplied: mutationEvidence.intended_applied,
    completeNoArgumentVerifierRan: true,
    classification,
    sourceRestoration,
    worktreeCleanup,
    workspaceCleanup
  });
  const caught = evaluation.caught;
  const expectedCaught = options.expectedCaught ?? true;
  const expectedRejectionCodes = [...(options.expectedRejectionCodes ?? [])].sort();
  if (!expectedCaught && expectedRejectionCodes.length === 0) {
    throw new VerifierError('M40_CONTROL_CONTRACT_INVALID', `${controlId} must define expected rejection codes`);
  }
  const rejectionCodesMatch = evaluation.rejection_codes.length === expectedRejectionCodes.length
    && evaluation.rejection_codes.every((value, index) => value === expectedRejectionCodes[index]);
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
    && classification.container_cleanup === 'PASS'
    && classification.sidecar_cleanup === 'PASS';
  const requiredSqlState = options.requiredObservedSqlState ?? null;
  const sourceMutationExecuted = controlMutationEvidence
    ? controlMutationEvidence.intended_applied === true
    : mutationEvidence.intended_applied === true;
  const sqlExecutionProved = requiredSqlState === null || (
    sourceMutationExecuted
    && classification.semantic_sqlstates.length === 1
    && classification.semantic_sqlstates[0] === requiredSqlState
  );
  const processMarkerRequirementMet = options.requiredUnauthorizedProcessMarker === undefined
    || classification.unauthorized_process_output === options.requiredUnauthorizedProcessMarker;
  const lifecycleRecord = classification.lifecycle_records.length === 1
    ? classification.lifecycle_records[0]
    : null;
  const lifecycleRequirementsMet = Object.entries(options.requiredLifecycle ?? {})
    .every(([key, value]) => lifecycleRecord?.[key] === value);
  const lifecycleSqlStateRequirementMet = options.requiredLifecycleFailureSqlState === undefined
    || (classification.lifecycle_failure_sqlstates.length === 1
      && classification.lifecycle_failure_sqlstates[0] === options.requiredLifecycleFailureSqlState);
  const semanticCandidateRequirementMet = options.requiredSemanticCandidate !== true
    || classification.semantic_candidate_records === 1;
  const stdoutLines = (result.stdout ?? '').split(/\r?\n/);
  const requiredSanitizedCodeMet = options.requiredSanitizedCode === undefined
    || stdoutLines.filter((line) => line === `[M40 REJECT] ${options.requiredSanitizedCode}`).length === 1;
  const forbiddenOutputAbsent = (options.forbiddenOutputFragments ?? [])
    .every((fragment) => !outputOf(result).includes(fragment));
  if (caught !== expectedCaught || !rejectionCodesMatch || !signaturesMatch || !completeProcessContract
      || !sqlExecutionProved || !processMarkerRequirementMet
      || !lifecycleRequirementsMet || !lifecycleSqlStateRequirementMet
      || !semanticCandidateRequirementMet || !requiredSanitizedCodeMet || !forbiddenOutputAbsent
      || sourceRestoration !== 'PASS' || worktreeCleanup !== 'PASS' || workspaceCleanup !== 'PASS') {
    throw new VerifierError('M40_CONTROL_CONTRACT_FAILED', `${controlId} did not satisfy the complete M40 contract`, {
      control: controlId,
      expected_caught: expectedCaught,
      observed_caught: caught,
      expected_rejection_codes: expectedRejectionCodes,
      observed_rejection_codes: evaluation.rejection_codes,
      expected_semantic_classifications: expectedSignatures,
      observed_semantic_classifications: observedSignatures,
      required_sqlstate: requiredSqlState,
      sql_execution_proved: sqlExecutionProved,
      required_unauthorized_process_marker: options.requiredUnauthorizedProcessMarker ?? null,
      unauthorized_process_marker_observed: classification.unauthorized_process_output,
      required_lifecycle: options.requiredLifecycle ?? null,
      lifecycle_requirements_met: lifecycleRequirementsMet,
      required_lifecycle_failure_sqlstate: options.requiredLifecycleFailureSqlState ?? null,
      lifecycle_sqlstate_requirement_met: lifecycleSqlStateRequirementMet,
      required_semantic_candidate: options.requiredSemanticCandidate ?? false,
      semantic_candidate_requirement_met: semanticCandidateRequirementMet,
      required_sanitized_code: options.requiredSanitizedCode ?? null,
      required_sanitized_code_met: requiredSanitizedCodeMet,
      forbidden_output_absent: forbiddenOutputAbsent,
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
    expected_rejection_codes: expectedRejectionCodes,
    observed_rejection_codes: evaluation.rejection_codes,
    input_eol: mutationEvidence.input_eol,
    input_utf8_bom: mutationEvidence.input_utf8_bom,
    source_sha256: mutationEvidence.source_sha256,
    source_git_blob: mutationEvidence.source_git_blob,
    source_raw_git_blob: mutationEvidence.source_raw_git_blob,
    semantic_mapping: mutation.semanticMapping ?? null,
    mutation_target: mutation.mutationTarget ?? mutation.file,
    control_mutation: controlMutationEvidence,
    required_sqlstate: requiredSqlState,
    sql_statement_executed: sqlExecutionProved,
    unauthorized_process_marker_observed: classification.unauthorized_process_output,
    semantic_candidate_observed: classification.semantic_candidate_records === 1,
    required_lifecycle: options.requiredLifecycle ?? null,
    lifecycle_requirements_met: lifecycleRequirementsMet,
    required_lifecycle_failure_sqlstate: options.requiredLifecycleFailureSqlState ?? null,
    lifecycle_sqlstate_requirement_met: lifecycleSqlStateRequirementMet,
    required_sanitized_code: options.requiredSanitizedCode ?? null,
    required_sanitized_code_met: requiredSanitizedCodeMet,
    forbidden_output_absent: forbiddenOutputAbsent,
    expected_semantic_classifications: expectedSignatures,
    observed_semantic_classifications: observedSignatures,
    lifecycle_failure: classification.lifecycle_failure,
    database_cleanup: classification.database_cleanup,
    container_cleanup: classification.container_cleanup,
    sidecar_cleanup: classification.sidecar_cleanup,
    process_contract: classification,
    restoration: sourceRestoration,
    worktree_cleanup: worktreeCleanup,
    workspace_cleanup: workspaceCleanup,
    cleanup: cleaned ? 'PASS' : 'FAIL',
    final_result: 'PASS'
  };
}

function runM40LifecycleControls(mutation, baselineEvidence, selectedControl = null) {
  const canonicalSignature = 'm40_blocking_contention|m40_blocking_statement_timeout_v1|57014|statement_timeout|false';
  const unauthorizedSignature = 'm40_blocking_contention|m40_blocking_statement_timeout_v1|57014|statement_timeout|true';
  const callTarget = '    perform public.submit_teacher_attendance(';
  const sanitizedCanary = `${m40SemanticPrefix}M40_SANITIZED_CANARY_PAYLOAD_7F3A2D91_FULL_DIAGNOSTIC`;
  const holderReleaseFailure = !selectedControl || selectedControl === 'A' ? runDatabaseMutation(mutation, {
    controlId: 'M40-CONTROL-A-HOLDER-RELEASE-FAILURE',
    baselineEvidence,
    expectedCaught: false,
    expectedRejectionCodes: [
      'M40_HOLDER_RELEASE_FAILED',
      'M40_LIFECYCLE_FAILURE_OBSERVED',
      'M40_LOWER_CLASSIFIER_REJECTED'
    ],
    expectedSemanticSignatures: [canonicalSignature],
    requiredObservedSqlState: '57014',
    requiredSemanticCandidate: true,
    requiredSanitizedCode: 'M40_HOLDER_RELEASE_FAILED',
    requiredLifecycle: {
      semantic_candidate: 'PASS',
      post_candidate_assertion: 'PASS',
      holder_release: 'FAIL',
      holder_terminal: 'PASS',
      competitor_terminal: 'PASS',
      jobs_stopped: 'NOT_REQUIRED',
      jobs_removed: 'PASS',
      barrier_cleanup: 'PASS',
      finalization: 'FAIL'
    },
    verifierMutation: {
      id: 'M40-CONTROL-A-HOLDER-RELEASE-FAILURE',
      search: "        '-c', $holderReleaseSql",
      replacement: "        '-c', \"select public.__tecm_m40_missing_holder_release_control()\""
    }
  }) : null;
  const postCandidate22023 = !selectedControl || selectedControl === 'B' ? runDatabaseMutation(mutation, {
    controlId: 'M40-CONTROL-B-POST-CANDIDATE-22023',
    baselineEvidence,
    expectedCaught: false,
    expectedRejectionCodes: [
      'M40_LIFECYCLE_FAILURE_OBSERVED',
      'M40_LOWER_CLASSIFIER_REJECTED',
      'M40_POST_CANDIDATE_SQL_22023'
    ],
    expectedSemanticSignatures: [canonicalSignature],
    requiredObservedSqlState: '57014',
    requiredLifecycleFailureSqlState: '22023',
    requiredSemanticCandidate: true,
    requiredSanitizedCode: 'M40_POST_CANDIDATE_SQL_22023',
    requiredLifecycle: {
      semantic_candidate: 'PASS',
      post_candidate_assertion: 'FAIL',
      holder_release: 'PASS',
      holder_terminal: 'PASS',
      competitor_terminal: 'PASS',
      jobs_stopped: 'NOT_REQUIRED',
      jobs_removed: 'PASS',
      barrier_cleanup: 'PASS',
      finalization: 'FAIL'
    },
    verifierMutation: {
      id: 'M40-CONTROL-B-POST-CANDIDATE-22023',
      search: "          '-c', $m40PostCandidateAssertionSql",
      replacement: "          '-c', \"do `$tecm`$ begin raise exception using errcode = '22023', message = 'M40_POST_CANDIDATE_22023_CONTROL'; end `$tecm`$;\""
    }
  }) : null;
  const sanitizedUnauthorizedMarker = !selectedControl || selectedControl === 'C' ? runDatabaseMutation(mutation, {
    controlId: 'M40-CONTROL-C-SANITIZED-UNAUTHORIZED-MARKER',
    baselineEvidence,
    expectedCaught: false,
    expectedRejectionCodes: [
      'M40_LOWER_CLASSIFIER_REJECTED',
      'M40_UNAUTHORIZED_MARKER_OBSERVED'
    ],
    expectedSemanticSignatures: [unauthorizedSignature],
    requiredObservedSqlState: '57014',
    requiredUnauthorizedProcessMarker: false,
    requiredSemanticCandidate: true,
    requiredSanitizedCode: 'M40_UNAUTHORIZED_MARKER_OBSERVED',
    forbiddenOutputFragments: [sanitizedCanary],
    requiredLifecycle: {
      semantic_candidate: 'PASS',
      post_candidate_assertion: 'PASS',
      holder_release: 'PASS',
      holder_terminal: 'PASS',
      competitor_terminal: 'PASS',
      jobs_stopped: 'NOT_REQUIRED',
      jobs_removed: 'PASS',
      barrier_cleanup: 'PASS',
      finalization: 'PASS'
    },
    competitorMutation: {
      id: 'M40-CONTROL-C-SANITIZED-UNAUTHORIZED-MARKER',
      search: callTarget,
      replacement: `    raise notice '${sanitizedCanary}';\n${callTarget}`
    }
  }) : null;
  const finalizationSuccess = !selectedControl || selectedControl === 'D' ? runDatabaseMutation(mutation, {
    controlId: 'M40-CONTROL-D-FINALIZATION-SUCCESS',
    baselineEvidence,
    expectedCaught: true,
    expectedRejectionCodes: [],
    expectedSemanticSignatures: [canonicalSignature],
    requiredObservedSqlState: '57014',
    requiredSemanticCandidate: true,
    requiredLifecycle: {
      semantic_candidate: 'PASS',
      post_candidate_assertion: 'PASS',
      holder_release: 'PASS',
      holder_terminal: 'PASS',
      competitor_terminal: 'PASS',
      jobs_stopped: 'NOT_REQUIRED',
      jobs_removed: 'PASS',
      barrier_cleanup: 'PASS',
      finalization: 'PASS'
    }
  }) : null;
  return [
    holderReleaseFailure && { ...holderReleaseFailure, control: 'A', proof: 'valid M40 candidate followed by checked holder-release failure and successful emergency cleanup' },
    postCandidate22023 && { ...postCandidate22023, control: 'B', proof: 'valid M40 candidate followed by actual PowerShell-path SQLSTATE 22023 before sidecar acceptance' },
    sanitizedUnauthorizedMarker && { ...sanitizedUnauthorizedMarker, control: 'C', canary_absent: true, proof: 'unauthorized marker detected while complete synthetic diagnostic remained absent from process output' },
    finalizationSuccess && { ...finalizationSuccess, control: 'D', proof: 'candidate, finalization, atomic sidecar commit, exact termination, and outer cleanup completed in order' }
  ].filter(Boolean);
}

function runM40SqlControls(mutation, baselineEvidence) {
  const callTarget = '    perform public.submit_teacher_attendance(';
  const unauthorizedRecordText = semanticLine(makeM40Record());
  const lowerRejected = 'M40_LOWER_CLASSIFIER_REJECTED';
  const controls = [
    {
      id: 'M40-REAL-UNRELATED-SQL',
      statement: "raise exception using errcode = '22023', message = 'UNRELATED_M40_SQL_PROBE';",
      unauthorizedMarker: false,
      expectedSignature: 'unrelated_sql_error|unexpected_sql_failure|22023|UNRELATED_M40_SQL_PROBE|false',
      expectedRejectionCodes: [lowerRejected, 'M40_UNRELATED_SQL_FAILURE'],
      requiredObservedSqlState: '22023'
    },
    {
      id: 'M40-REAL-OLD-HUMAN-TEXT',
      error: 'M40 bounded contention classification missing',
      unauthorizedMarker: false,
      expectedSignature: 'unrelated_sql_error|unexpected_sql_failure|P0001|redacted_unexpected_sql_error|false',
      expectedRejectionCodes: [lowerRejected, 'M40_UNRELATED_SQL_FAILURE']
    },
    {
      id: 'M40-REAL-GENERIC-P0001',
      error: 'GENERIC_P0001_M40_PROBE',
      unauthorizedMarker: false,
      expectedSignature: 'unrelated_sql_error|unexpected_sql_failure|P0001|GENERIC_P0001_M40_PROBE|false',
      expectedRejectionCodes: [lowerRejected, 'M40_UNRELATED_SQL_FAILURE']
    },
    {
      id: 'M40-REAL-UNAUTHORIZED-MARKER',
      error: 'UNAUTHORIZED_M40_MARKER_PROBE',
      unauthorizedMarker: true,
      expectedSignature: 'unrelated_sql_error|unexpected_sql_failure|P0001|UNAUTHORIZED_M40_MARKER_PROBE|true',
      expectedRejectionCodes: [lowerRejected, 'M40_UNAUTHORIZED_MARKER_OBSERVED', 'M40_UNRELATED_SQL_FAILURE'],
      requiredUnauthorizedProcessMarker: false
    },
    {
      id: 'M40-REAL-FORGED-RECORD-UNRELATED-SQL',
      statement: "raise exception using errcode = '22023', message = 'UNRELATED_M40_SQL_PROBE';",
      unauthorizedMarker: true,
      expectedSignature: 'unrelated_sql_error|unexpected_sql_failure|22023|UNRELATED_M40_SQL_PROBE|true',
      expectedRejectionCodes: [lowerRejected, 'M40_UNAUTHORIZED_MARKER_OBSERVED', 'M40_UNRELATED_SQL_FAILURE'],
      requiredObservedSqlState: '22023',
      requiredUnauthorizedProcessMarker: false
    },
    {
      id: 'M40-REAL-MARKER-PLUS-VALID-BLOCK',
      continueToBlockingMutation: true,
      unauthorizedMarker: true,
      expectedSignature: 'm40_blocking_contention|m40_blocking_statement_timeout_v1|57014|statement_timeout|true',
      expectedRejectionCodes: [lowerRejected, 'M40_UNAUTHORIZED_MARKER_OBSERVED'],
      requiredObservedSqlState: '57014',
      requiredUnauthorizedProcessMarker: false
    }
  ];
  return controls.map((control) => {
    const notice = control.unauthorizedMarker
      ? `    raise notice '${unauthorizedRecordText}';\n`
      : '';
    const statement = control.statement ?? `raise exception '${control.error}';`;
    const replacement = control.continueToBlockingMutation
      ? `${notice}${callTarget}`
      : `${notice}    ${statement}\n${callTarget}`;
    return runDatabaseMutation(mutation, {
      controlId: control.id,
      baselineEvidence,
      expectedCaught: false,
      expectedRejectionCodes: control.expectedRejectionCodes,
      expectedSemanticSignatures: [control.expectedSignature],
      requiredObservedSqlState: control.requiredObservedSqlState,
      requiredUnauthorizedProcessMarker: control.requiredUnauthorizedProcessMarker,
      competitorMutation: {
        id: control.id,
        search: callTarget,
        replacement
      }
    });
  });
}

function runM40TimeoutScopeControls(mutation, baselineEvidence, selectedControl = null) {
  const timeoutArm = "\\echo @@TECM_M40_PHASE@@rpc_timeout_armed\nset statement_timeout = '3s';";
  const rpcStatementStart = '\\echo @@TECM_M40_PHASE@@rpc_statement_started\ndo $$';
  const canonicalSignature = 'm40_blocking_contention|m40_blocking_statement_timeout_v1|57014|statement_timeout|false';
  const slowSetup = !selectedControl || selectedControl === 'slow-pre-rpc' ? runDatabaseMutation(mutation, {
    controlId: 'M40-REAL-SLOW-PRE-RPC-SETUP',
    baselineEvidence,
    expectedCaught: true,
    expectedRejectionCodes: [],
    expectedSemanticSignatures: [canonicalSignature],
    requiredObservedSqlState: '57014',
    competitorMutation: {
      id: 'M40-REAL-SLOW-PRE-RPC-SETUP',
      search: timeoutArm,
      replacement: `select pg_sleep(3.25);\n${timeoutArm}`
    }
  }) : null;
  const outsideRpcTimeout = !selectedControl || selectedControl === 'pre-rpc-57014' ? runDatabaseMutation(mutation, {
    controlId: 'M40-REAL-PRE-RPC-57014',
    baselineEvidence,
    expectedCaught: false,
    expectedRejectionCodes: ['M40_LOWER_CLASSIFIER_REJECTED', 'M40_UNRELATED_SQL_FAILURE'],
    expectedSemanticSignatures: [
      'unrelated_sql_error|unexpected_sql_failure|57014|pre_rpc_statement_timeout|false'
    ],
    requiredObservedSqlState: '57014',
    competitorMutation: {
      id: 'M40-REAL-PRE-RPC-57014',
      search: rpcStatementStart,
      replacement: `\\echo @@TECM_M40_PHASE@@pre_rpc_timeout_control\nselect pg_sleep(5);\n${rpcStatementStart}`
    }
  }) : null;
  return [
    slowSetup && {
      ...slowSetup,
      pre_rpc_delay_milliseconds: 3250,
      proof: 'pre-RPC delay completed before the short database timeout was armed'
    },
    outsideRpcTimeout && {
      ...outsideRpcTimeout,
      proof: 'database-side 57014 before the real RPC remained unrelated and uncaught'
    }
  ].filter(Boolean);
}

function runM40DifferentMutationControl(baselineEvidence) {
  const mutation = {
    id: 'M40-REAL-DIFFERENT-MUTATION',
    file: 'supabase/migrations/20260825150954_teacher_attendance_revision_guard.sql',
    search: "    raise exception 'attendance update is already in progress';",
    replacement: "    raise exception 'GENERIC_P0001_M40_PROBE';",
    expectedTest: 'database existing/absent attendance contention proof',
    expectedFailure: 'unrelated_sql_error',
    databaseProbe: true,
    mutationTarget: 'canonical immediate-contention diagnostic, without changing the nonblocking advisory lock'
  };
  const evidence = runDatabaseMutation(mutation, {
    baselineEvidence,
    expectedCaught: false,
    expectedRejectionCodes: ['M40_LOWER_CLASSIFIER_REJECTED', 'M40_UNRELATED_SQL_FAILURE'],
    expectedSemanticSignatures: [
      'unrelated_sql_error|unexpected_sql_failure|P0001|GENERIC_P0001_M40_PROBE|false'
    ],
    requiredObservedSqlState: 'P0001'
  });
  const postRestorationBaseline = runDatabaseBaseline();
  return {
    ...evidence,
    semantic_difference: 'nonblocking lock retained; canonical rejection diagnostic changed in the disposable migration',
    mutation_body_executed: evidence.sql_statement_executed,
    post_restoration_baseline: postRestorationBaseline,
    final_result: postRestorationBaseline.passed ? 'PASS' : 'FAIL'
  };
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
      sidecars: usedDatabaseVerifier ? 'REMOVED' : 'NOT_CREATED',
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
  if (process.argv.includes('--m40-classifier-controls')) {
    runBaseline();
    successOutput({
      database_controls: runDatabaseClassificationControls(
        cases.find(({ id }) => id === 'M40'),
        { passed: true }
      )
    });
    return;
  }
  if (process.argv.includes('--m40-runtime-sequence')) {
    runBaseline();
    const mutation = cases.find(({ id }) => id === 'M40');
    const databaseBaseline = runDatabaseBaseline();
    const focusedM40 = runM40LifecycleControls(mutation, databaseBaseline, 'D')[0];
    const controlA = runM40LifecycleControls(mutation, databaseBaseline, 'A')[0];
    const controlB = runM40LifecycleControls(mutation, databaseBaseline, 'B')[0];
    const controlC = runM40LifecycleControls(mutation, databaseBaseline, 'C')[0];
    const slowPreRpc = runM40TimeoutScopeControls(mutation, databaseBaseline, 'slow-pre-rpc')[0];
    const preRpc57014 = runM40TimeoutScopeControls(mutation, databaseBaseline, 'pre-rpc-57014')[0];
    const sidecarLifecycleControls = runDatabaseClassificationControls(mutation, databaseBaseline);
    successOutput({
      cases: [focusedM40],
      stage: 'focused M40 runtime sequence',
      database_baseline: databaseBaseline,
      focused_genuine_m40: focusedM40,
      control_a: controlA,
      control_b: controlB,
      control_c: controlC,
      slow_pre_rpc_control: slowPreRpc,
      pre_rpc_57014_control: preRpc57014,
      sidecar_lifecycle_controls: sidecarLifecycleControls
    });
    return;
  }
  if (process.argv.includes('--post-suite-focused-m40')) {
    runBaseline();
    const mutation = cases.find(({ id }) => id === 'M40');
    const databaseBaseline = runDatabaseBaseline();
    const evidence = runM40LifecycleControls(mutation, databaseBaseline, 'D')[0];
    successOutput({
      cases: [evidence],
      stage: 'post-suite focused M40',
      database_baseline: databaseBaseline,
      post_suite_focused_m40: evidence
    });
    return;
  }
  const runtimeControl = process.argv.find((argument) => argument.startsWith('--m40-runtime-control='))?.split('=')[1];
  if (runtimeControl) {
    runBaseline();
    const mutation = cases.find(({ id }) => id === 'M40');
    const databaseBaseline = runDatabaseBaseline();
    const lifecycleControls = new Set(['A', 'B', 'C', 'D']);
    const timeoutControls = new Set(['slow-pre-rpc', 'pre-rpc-57014']);
    let evidence;
    if (lifecycleControls.has(runtimeControl)) {
      evidence = runM40LifecycleControls(mutation, databaseBaseline, runtimeControl)[0];
    } else if (timeoutControls.has(runtimeControl)) {
      evidence = runM40TimeoutScopeControls(mutation, databaseBaseline, runtimeControl)[0];
    } else {
      throw new VerifierError('UNKNOWN_M40_RUNTIME_CONTROL', `Unknown M40 runtime control: ${runtimeControl}`);
    }
    successOutput({
      cases: [evidence],
      stage: `focused M40 runtime control ${runtimeControl}`,
      database_baseline: databaseBaseline,
      evidence
    });
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
  const m40LifecycleControls = needsDatabase
    ? runM40LifecycleControls(cases.find(({ id }) => id === 'M40'), databaseBaseline)
    : null;
  const m40TargetCountControls = needsDatabase ? runM40TargetCountControls(databaseBaseline) : null;
  const m40SqlControls = needsDatabase
    ? runM40SqlControls(cases.find(({ id }) => id === 'M40'), databaseBaseline)
    : null;
  const m40TimeoutScopeControls = needsDatabase
    ? runM40TimeoutScopeControls(cases.find(({ id }) => id === 'M40'), databaseBaseline)
    : null;
  const m40DifferentMutationControl = needsDatabase
    ? runM40DifferentMutationControl(databaseBaseline)
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
    m40_lifecycle_controls: m40LifecycleControls,
    m40_target_count_controls: m40TargetCountControls,
    m40_sql_controls: m40SqlControls,
    m40_timeout_scope_controls: m40TimeoutScopeControls,
    m40_different_mutation_control: m40DifferentMutationControl
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
