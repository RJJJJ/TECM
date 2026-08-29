import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '../..');
const migrationPath = 'supabase/migrations/202608240015_attendance_function_execute_hardening.sql';
const revisionMigrationPath = 'supabase/migrations/20260825150954_teacher_attendance_revision_guard.sql';
const assertionPath = 'supabase/tests/018_attendance_function_execute_hardening.sql';
const raceAssertionPath = 'supabase/tests/concurrency/teacher_attendance_assert.sql';
const existingRaceAssertionPath = 'supabase/tests/concurrency/teacher_attendance_existing_assert.sql';
const immutablePaths = [migrationPath, revisionMigrationPath, assertionPath, raceAssertionPath, existingRaceAssertionPath];
const sourceFiles = [
  'supabase/tests/000_bootstrap.sql',
  'supabase/migrations/202607110000_legacy_baseline.sql',
  'supabase/migrations/202607110001_tenant_operations_finance.sql',
  'supabase/migrations/202607110002_invariants_rls_rpcs.sql',
  'supabase/migrations/202607110003_release_blockers.sql',
  'supabase/tests/000_legacy_parent_fixture.sql',
  'supabase/migrations/202607150004_parent_notifications.sql',
  'supabase/seed.sql',
  'supabase/tests/000_foundation_security_fixture.sql',
  'supabase/migrations/202607180005_foundation_security.sql',
  'supabase/tests/000_apns_outbox_reliability_legacy_fixture.sql',
  'supabase/migrations/202607180006_apns_outbox_reliability.sql',
  'supabase/migrations/202607180007_apns_dispatch_ambiguity.sql',
  'supabase/migrations/202607180008_apns_completion_outcome.sql',
  'supabase/migrations/202608020009_admin_operations_integrity.sql',
  'supabase/migrations/202608020010_admin_operations_release_gate.sql',
  'supabase/migrations/202608020011_makeup_partial_state_recovery.sql',
  'supabase/migrations/202608050012_uat_core_workflows.sql',
  'supabase/migrations/202608130013_course_cohort_enrollment_model.sql',
  'supabase/migrations/202608140014_teacher_attendance_history_access.sql',
  migrationPath,
  revisionMigrationPath,
  assertionPath
];
const pre015Files = sourceFiles.slice(0, sourceFiles.indexOf(migrationPath));

const timeouts = Object.freeze({
  git: 5_000,
  dockerInspect: 5_000,
  dockerLifecycle: 30_000,
  psqlProbe: 10_000,
  psqlFile: 120_000,
  childControl: 240_000,
  timeoutControl: 75
});

const lifecyclePhrases = [
  'database system is shutting down',
  'database system is shut down',
  'server closed the connection unexpectedly',
  'terminating connection',
  'received fast shutdown request'
];

function run(command, args, { category, timeout, cwd = repoRoot, env = process.env } = {}) {
  if (!category || !Number.isInteger(timeout) || timeout <= 0) {
    throw new Error('Every external command requires a category and positive timeout.');
  }
  const processResult = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout,
    killSignal: 'SIGKILL',
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true
  });
  processResult.category = category;
  processResult.timedOut = processResult.error?.code === 'ETIMEDOUT';
  return processResult;
}

function outputOf(processResult) {
  return `${processResult.stdout ?? ''}${processResult.stderr ?? ''}`;
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sanitize(value) {
  return String(value)
    .replace(/\b(?:[A-Z0-9_]*(?:PASSWORD|TOKEN|SECRET|API_KEY|SERVICE_ROLE_KEY|DATABASE_URL)[A-Z0-9_]*)\s*=\s*[^\s]+/gi, '[CREDENTIAL ASSIGNMENT REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[JWT REDACTED]')
    .replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s]+/gi, '[URI REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL REDACTED]')
    .replace(/password\s*[:=]\s*[^\s,;]+/gi, 'password=[REDACTED]')
    .replace(/\binsert\s+into\b[\s\S]*?(?:;|$)/gi, '[SQL INSERT REDACTED]')
    .slice(-1600);
}

function runSanitizationSelfTest() {
  const fixtures = {
    password: 'fake-password-value-9274',
    bearer: 'fakeBearerToken_9274.value',
    jwt: 'eyJmYWtlSGVhZGVyOTI3NA.eyJmYWtlUGF5bG9hZDkyNzQ.ZmFrZVNpZ25hdHVyZTkyNzQ',
    uri: 'postgresql://fake-user:fake-pass@db.invalid/example',
    email: 'fake-person-9274@example.invalid',
    sqlValue: 'fake-row-secret-9274',
    envValue: 'fake-service-key-9274'
  };
  const raw = [
    `password=${fixtures.password}`,
    `Authorization: Bearer ${fixtures.bearer}`,
    fixtures.jwt,
    fixtures.uri,
    fixtures.email,
    `SUPABASE_SERVICE_ROLE_KEY=${fixtures.envValue}`,
    `INSERT INTO audit(email, payload) VALUES ('${fixtures.email}', '${fixtures.sqlValue}');`
  ].join('\n');
  const redacted = sanitize(raw);
  for (const secret of Object.values(fixtures)) {
    if (redacted.includes(secret)) throw verifierError('SANITIZATION_SELF_TEST_FAILED', 'sanitization_failure');
  }
  if (/\bBearer\s+(?!\[REDACTED\])|\beyJ[A-Za-z0-9_-]{8,}\.|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(redacted)) {
    throw verifierError('SANITIZATION_SHAPE_REMAINED', 'sanitization_failure');
  }
  process.stdout.write('DIAGNOSTIC SANITIZATION PASS\n');
}

function processDiagnostic(processResult) {
  const output = outputOf(processResult).toLowerCase();
  return {
    command_category: processResult.category,
    exit_code: Number.isInteger(processResult.status) ? processResult.status : null,
    timed_out: Boolean(processResult.timedOut),
    signal: processResult.signal ?? null,
    lifecycle_phrase: lifecyclePhrases.find((phrase) => output.includes(phrase)) ?? null
  };
}

function verifierError(code, classification, diagnostic = {}, flags = {}) {
  const error = new Error(code);
  error.code = code;
  error.classification = classification;
  error.diagnostic = diagnostic;
  error.lifecycle = Boolean(flags.lifecycle);
  error.timeout = Boolean(flags.timeout);
  return error;
}

function timeoutError(code, processResult, flags = {}) {
  return verifierError(code, 'command_timeout', processDiagnostic(processResult), {
    lifecycle: Boolean(flags.lifecycle),
    timeout: true
  });
}

function commandError(code, processResult, classification = 'test_or_setup_failure', flags = {}) {
  if (processResult.timedOut) return timeoutError(code, processResult, flags);
  return verifierError(code, classification, processDiagnostic(processResult), flags);
}

function lifecycleError(code, diagnostic = {}) {
  return verifierError(code, 'lifecycle_or_prerequisite_failure', diagnostic, { lifecycle: true });
}

function gitBlob(path) {
  const result = run('git', ['hash-object', '--', path], { category: 'git_hash', timeout: timeouts.git });
  if (result.timedOut) throw timeoutError('GIT_HASH_TIMEOUT', result);
  const blob = result.stdout?.trim();
  if (result.status !== 0 || !/^[0-9a-f]{40}$/.test(blob)) {
    throw commandError('GIT_HASH_FAILED', result);
  }
  return blob;
}

let immutableSnapshots;
let migrationSnapshot;

function initializeSnapshots() {
  immutableSnapshots = new Map(immutablePaths.map((path) => {
    const bytes = readFileSync(resolve(repoRoot, path));
    return [path, { bytes, sha256: hash(bytes), git_blob: gitBlob(path) }];
  }));
  migrationSnapshot = immutableSnapshots.get(migrationPath);
}

function immutableStatus() {
  const entries = {};
  let passed = true;
  try {
    for (const [path, snapshot] of immutableSnapshots) {
      const bytes = readFileSync(resolve(repoRoot, path));
      const current = { sha256: hash(bytes), git_blob: gitBlob(path) };
      const match = bytes.equals(snapshot.bytes) && current.sha256 === snapshot.sha256 && current.git_blob === snapshot.git_blob;
      entries[path] = { ...current, status: match ? 'PASS' : 'FAIL' };
      passed &&= match;
    }
  } catch (error) {
    return { status: 'FAIL', entries, error };
  }
  return { status: passed ? 'PASS' : 'FAIL', entries };
}

const serviceRoleGrants = [
  'grant execute on function public.capture_attendance_history_audit() to service_role;',
  'grant execute on function public.get_teacher_attendance_sessions() to service_role;',
  'grant execute on function public.submit_teacher_attendance(uuid,uuid,text,timestamptz,text,text) to service_role;',
  'grant execute on function public.submit_attendance(uuid,jsonb) to service_role;'
].join(' ');

const authenticatedGrantOptionGrants = [
  'grant execute on function public.get_teacher_attendance_sessions() to authenticated with grant option;',
  'grant execute on function public.submit_teacher_attendance(uuid,uuid,text,timestamptz,text,text) to authenticated with grant option;',
  'grant execute on function public.submit_attendance(uuid,jsonb) to authenticated with grant option;'
].join(' ');

const m36 = {
  id: 'M36',
  database: 'tecm_m36',
  expected: 'assertion',
  target: 'revoke all on function public.get_teacher_attendance_sessions() from anon;',
  replacement: 'grant execute on function public.get_teacher_attendance_sessions() to anon;',
  targetSignature: 'public.get_teacher_attendance_sessions()',
  expectedFailure: '018 attendance function ACL: anon EXECUTE must be false for get_teacher_attendance_sessions()',
  expectedFailureLabel: 'anon EXECUTE',
  passLabel: 'M36 CAUGHT'
};

const scenarios = [
  {
    id: 'UPGRADE-STATE',
    database: 'tecm_acl_upgrade',
    expected: 'success',
    pregrantServiceRole: true,
    passLabel: 'UPGRADE-STATE PASS'
  },
  {
    id: 'GRANT-OPTION-UPGRADE-STATE',
    database: 'tecm_acl_grant_upgrade',
    expected: 'success',
    pregrantAuthenticatedGrantOption: 'all',
    passLabel: 'GRANT-OPTION UPGRADE-STATE PASS'
  },
  m36,
  {
    id: 'M37',
    database: 'tecm_m37',
    expected: 'assertion',
    target: 'revoke all on function public.get_teacher_attendance_sessions() from service_role;',
    replacement: '',
    targetSignature: 'public.get_teacher_attendance_sessions()',
    pregrantServiceRole: true,
    expectedFailure: '018 attendance function ACL: service_role EXECUTE expanded for get_teacher_attendance_sessions()',
    expectedFailureLabel: 'service_role EXECUTE',
    passLabel: 'M37 CAUGHT'
  },
  {
    id: 'M38',
    database: 'tecm_m38',
    expected: 'assertion',
    target: 'revoke all on function public.get_teacher_attendance_sessions() from authenticated;',
    replacement: '',
    targetSignature: 'public.get_teacher_attendance_sessions()',
    pregrantAuthenticatedGrantOption: 'target',
    expectedFailure: '018 attendance function ACL: authenticated grant option must be false for get_teacher_attendance_sessions()',
    expectedFailureLabel: 'authenticated grant option',
    passLabel: 'M38 CAUGHT'
  }
];

function pause(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function inspectContainer(containerName) {
  const inspect = run('docker', [
    'inspect', '--format', '{{.State.Status}} {{.State.Running}} {{.State.ExitCode}}', containerName
  ], { category: 'docker_inspect', timeout: timeouts.dockerInspect });
  if (inspect.timedOut) return { exists: null, running: false, state: 'inspection_timeout', process: inspect };
  if (inspect.status !== 0) return { exists: false, running: false, state: 'missing', process: inspect };
  const state = inspect.stdout.trim();
  const match = /^(created|running|paused|restarting|removing|exited|dead) (true|false) (-?\d+)$/.exec(state);
  if (!match) return { exists: null, running: false, state: 'unrecognized', process: inspect };
  return { exists: true, running: match[2] === 'true', state, process: inspect };
}

function lifecycleDiagnostics(containerName) {
  const state = inspectContainer(containerName);
  const logs = run('docker', ['logs', '--tail', '40', containerName], {
    category: 'docker_logs',
    timeout: timeouts.dockerInspect
  });
  const output = outputOf(logs).toLowerCase();
  return {
    container_state: state.state,
    inspection_timeout: state.process?.timedOut ?? false,
    log_timeout: logs.timedOut,
    lifecycle_phrases: lifecyclePhrases.filter((phrase) => output.includes(phrase))
  };
}

function failureForProcess(code, processResult, containerName) {
  if (processResult.timedOut) return timeoutError(code, processResult);
  const state = inspectContainer(containerName);
  if (state.process?.timedOut) return timeoutError(`${code}_INSPECTION_TIMEOUT`, state.process, { lifecycle: true });
  const phrase = lifecyclePhrases.find((candidate) => outputOf(processResult).toLowerCase().includes(candidate));
  if (!state.exists || !state.running || phrase) {
    return lifecycleError(code, {
      ...processDiagnostic(processResult),
      container_state: state.state,
      lifecycle_phrase: phrase ?? null
    });
  }
  return commandError(code, processResult);
}

function probeOnce(containerName, database, phase) {
  const state = inspectContainer(containerName);
  if (state.process?.timedOut) throw timeoutError(`${phase}_CONTAINER_INSPECTION_TIMEOUT`, state.process, { lifecycle: true });
  if (!state.exists || !state.running) {
    throw lifecycleError(`${phase}_CONTAINER_NOT_RUNNING`, { container_state: state.state, database_identity_match: false });
  }

  const ready = run('docker', ['exec', containerName, 'pg_isready', '-q', '-U', 'postgres', '-d', database], {
    category: 'postgres_readiness',
    timeout: timeouts.psqlProbe
  });
  if (ready.timedOut) throw timeoutError(`${phase}_READINESS_TIMEOUT`, ready, { lifecycle: true });
  if (ready.status !== 0) throw lifecycleError(`${phase}_READINESS_FAILED`, processDiagnostic(ready));

  const selectOne = run('docker', [
    'exec', containerName, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database, '-Atc', 'select 1'
  ], { category: 'postgres_select_one', timeout: timeouts.psqlProbe });
  if (selectOne.timedOut) throw timeoutError(`${phase}_SELECT_ONE_TIMEOUT`, selectOne, { lifecycle: true });
  if (selectOne.status !== 0 || selectOne.stdout.trim() !== '1') {
    throw lifecycleError(`${phase}_SELECT_ONE_FAILED`, processDiagnostic(selectOne));
  }

  const identity = run('docker', [
    'exec', containerName, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database,
    '-Atc', 'select current_database()'
  ], { category: 'postgres_database_identity', timeout: timeouts.psqlProbe });
  if (identity.timedOut) throw timeoutError(`${phase}_IDENTITY_TIMEOUT`, identity, { lifecycle: true });
  if (identity.status !== 0 || identity.stdout.trim() !== database) {
    throw lifecycleError(`${phase}_IDENTITY_MISMATCH`, {
      ...processDiagnostic(identity),
      database_identity_match: false
    });
  }
  return { container_state: state.state, database_identity_match: true };
}

function ensureScenarioReady(containerName, database) {
  let stableChecks = 0;
  let lastFailure;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      probeOnce(containerName, database, 'STARTUP');
      stableChecks += 1;
      if (stableChecks >= 2) return;
    } catch (error) {
      if (error.timeout || error.code === 'STARTUP_CONTAINER_NOT_RUNNING') throw error;
      stableChecks = 0;
      lastFailure = error;
    }
    pause(250);
  }
  throw lifecycleError('BOUNDED_STARTUP_READINESS_FAILED', {
    last_failure: lastFailure?.code ?? 'none',
    ...lifecycleDiagnostics(containerName)
  });
}

function copyFixture(workspace, relative) {
  const source = resolve(repoRoot, relative);
  const destination = resolve(workspace, relative);
  if (!existsSync(source)) throw verifierError('MISSING_VERIFIER_INPUT', 'test_or_setup_failure');
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination);
}

function scenarioResult(spec, volumeName) {
  return {
    mutation: spec.id,
    caught: false,
    target: spec.targetSignature ?? null,
    expected_failure: spec.expectedFailureLabel ?? null,
    source_sha256: migrationSnapshot.sha256,
    git_blob: migrationSnapshot.git_blob,
    lifecycle_failure: false,
    timeout_failure: false,
    final_probe: 'PENDING',
    volume_identity: volumeName,
    restoration: 'PENDING',
    cleanup: {
      container: 'PENDING',
      database: 'PENDING',
      volume: 'PENDING',
      temporary_workspace: 'PENDING'
    },
    final_result: 'FAIL'
  };
}

function applyFailure(result, error) {
  result.lifecycle_failure ||= Boolean(error.lifecycle);
  result.timeout_failure ||= Boolean(error.timeout);
  if (error.lifecycle) result.error_classification = 'lifecycle_or_prerequisite_failure';
  else if (error.timeout && !result.lifecycle_failure) result.error_classification = 'command_timeout';
  else result.error_classification ??= error.classification ?? 'test_or_setup_failure';
  result.error_code ??= error.code ?? 'VERIFIER_FAILURE';
  if (error.diagnostic) result.diagnostic = error.diagnostic;
}

function assertionFailureWasExact(processResult, expectedFailure) {
  return outputOf(processResult).split(/\r?\n/).some((line) => {
    const match = /ERROR:\s+(.+?)\s*$/.exec(line);
    return match?.[1] === expectedFailure;
  });
}

function executeScenario(spec, context) {
  const result = scenarioResult(spec, context.volumeName);
  const workspace = resolve(context.workspaceRoot, spec.id.toLowerCase());
  let failure;
  let databaseCreated = false;
  const rememberFailure = (error) => {
    failure ??= error;
    applyFailure(result, error);
  };

  const runPsqlFile = (relative) => run('docker', [
    'exec', context.containerName, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', spec.database,
    '-f', `/workspace/${spec.id.toLowerCase()}/${relative}`
  ], { category: 'psql_file', timeout: timeouts.psqlFile });
  const runPsqlSql = (sql) => run('docker', [
    'exec', context.containerName, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', spec.database, '-c', sql
  ], { category: 'psql_sql', timeout: timeouts.psqlFile });

  try {
    mkdirSync(workspace, { recursive: true });
    for (const file of sourceFiles) copyFixture(workspace, file);
    const fixtureMigration = resolve(workspace, migrationPath);
    if (spec.target) {
      const fixtureSource = readFileSync(fixtureMigration, 'utf8');
      const matches = fixtureSource.split(spec.target).length - 1;
      if (matches !== 1) throw verifierError('MUTATION_TARGET_COUNT_FAILED', 'mutation_setup_failure', {
        scenario: spec.id,
        target_match_count: matches
      });
      writeFileSync(fixtureMigration, fixtureSource.replace(spec.target, spec.replacement));
      if (hash(readFileSync(fixtureMigration)) === migrationSnapshot.sha256) {
        throw verifierError('MUTATION_BYTES_UNCHANGED', 'mutation_setup_failure');
      }
    }

    const create = run('docker', ['exec', context.containerName, 'createdb', '-U', 'postgres', spec.database], {
      category: 'database_create',
      timeout: timeouts.dockerLifecycle
    });
    if (create.status !== 0) throw failureForProcess('DATABASE_CREATE_FAILED', create, context.containerName);
    databaseCreated = true;
    ensureScenarioReady(context.containerName, spec.database);

    if (context.controlMode === 'lifecycle_shutdown') {
      const stop = run('docker', ['stop', '--time', '0', context.containerName], {
        category: 'docker_stop_control',
        timeout: timeouts.dockerLifecycle
      });
      if (stop.status !== 0) throw commandError('LIFECYCLE_CONTROL_STOP_FAILED', stop);
      probeOnce(context.containerName, spec.database, 'PRE_PREREQUISITE');
    }

    if (context.controlMode === 'command_timeout') {
      const timeoutControl = run(process.execPath, [
        '-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10000)'
      ], { category: 'timeout_control', timeout: timeouts.timeoutControl });
      if (!timeoutControl.timedOut) throw verifierError('TIMEOUT_CONTROL_DID_NOT_TIMEOUT', 'test_or_setup_failure');
      throw timeoutError('COMMAND_TIMEOUT_CONTROL_CAUGHT', timeoutControl);
    }

    for (const file of pre015Files) {
      const setup = runPsqlFile(file);
      if (setup.status !== 0) throw failureForProcess('PREREQUISITE_SQL_FAILED', setup, context.containerName);
    }

    if (spec.pregrantServiceRole) {
      const grants = runPsqlSql(serviceRoleGrants);
      if (grants.status !== 0) throw failureForProcess('SERVICE_ROLE_PREGRANT_FAILED', grants, context.containerName);
    }

    if (spec.pregrantAuthenticatedGrantOption) {
      const grantSql = spec.pregrantAuthenticatedGrantOption === 'all'
        ? authenticatedGrantOptionGrants
        : 'grant execute on function public.get_teacher_attendance_sessions() to authenticated with grant option;';
      const grants = runPsqlSql(grantSql);
      if (grants.status !== 0) throw failureForProcess('AUTHENTICATED_GRANT_OPTION_PREGRANT_FAILED', grants, context.containerName);
    }

    const migration = runPsqlFile(migrationPath);
    if (migration.status !== 0) throw failureForProcess('MIGRATION_015_FAILED', migration, context.containerName);

    const revisionMigration = runPsqlFile(revisionMigrationPath);
    if (revisionMigration.status !== 0) throw failureForProcess('ATTENDANCE_REVISION_MIGRATION_FAILED', revisionMigration, context.containerName);

    const repeatSeed = runPsqlFile('supabase/seed.sql');
    if (repeatSeed.status !== 0) throw failureForProcess('REPEAT_SEED_FAILED', repeatSeed, context.containerName);

    const assertion = runPsqlFile(assertionPath);
    if (assertion.timedOut) throw timeoutError('SQL018_TIMEOUT', assertion);
    if (spec.expected === 'success') {
      if (assertion.status !== 0) throw failureForProcess('SQL018_POSITIVE_ASSERTION_FAILED', assertion, context.containerName);
      result.caught = true;
    } else {
      if (assertion.status === 0 || !assertionFailureWasExact(assertion, spec.expectedFailure)) {
        throw failureForProcess('TARGETED_SQL018_ASSERTION_NOT_CAUGHT', assertion, context.containerName);
      }
      const state = inspectContainer(context.containerName);
      if (state.process?.timedOut) throw timeoutError('POST_ASSERTION_INSPECTION_TIMEOUT', state.process, { lifecycle: true });
      if (!state.exists || !state.running) throw lifecycleError('POST_ASSERTION_CONTAINER_NOT_RUNNING', {
        container_state: state.state
      });
      result.caught = true;
    }

    if (context.controlMode === 'late_shutdown') {
      const stop = run('docker', ['stop', '--time', '0', context.containerName], {
        category: 'docker_stop_control',
        timeout: timeouts.dockerLifecycle
      });
      if (stop.status !== 0) throw commandError('LATE_SHUTDOWN_CONTROL_STOP_FAILED', stop);
    }

    result.final_probe_evidence = probeOnce(context.containerName, spec.database, 'FINAL');
    result.final_probe = 'PASS';
  } catch (error) {
    rememberFailure(error);
  } finally {
    const state = inspectContainer(context.containerName);
    if (state.process?.timedOut) {
      result.cleanup.database = 'FAIL';
      rememberFailure(timeoutError('DATABASE_CLEANUP_INSPECTION_TIMEOUT', state.process, { lifecycle: true }));
    } else if (state.exists && state.running) {
      let dropPassed = true;
      if (databaseCreated) {
        const drop = run('docker', ['exec', context.containerName, 'dropdb', '-U', 'postgres', '--if-exists', spec.database], {
          category: 'database_drop',
          timeout: timeouts.dockerLifecycle
        });
        dropPassed = drop.status === 0;
        if (!dropPassed) rememberFailure(commandError('DATABASE_DROP_FAILED', drop, 'cleanup_failure'));
      }
      const absent = run('docker', [
        'exec', context.containerName, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
        '-Atc', `select count(*) from pg_database where datname = '${spec.database}'`
      ], { category: 'database_cleanup_verify', timeout: timeouts.psqlProbe });
      if (absent.timedOut) rememberFailure(timeoutError('DATABASE_CLEANUP_VERIFY_TIMEOUT', absent));
      const absentPassed = absent.status === 0 && absent.stdout.trim() === '0';
      result.cleanup.database = dropPassed && absentPassed ? 'PASS' : 'FAIL';
      if (!absentPassed) rememberFailure(commandError('DATABASE_CLEANUP_VERIFY_FAILED', absent, 'cleanup_failure'));
    } else if (context.controlMode === 'lifecycle_shutdown') {
      result.cleanup.database = 'PENDING_VOLUME_REMOVAL';
    } else {
      result.cleanup.database = 'FAIL';
      if (!result.lifecycle_failure) rememberFailure(lifecycleError('DATABASE_CLEANUP_CONTAINER_NOT_RUNNING', {
        container_state: state.state
      }));
    }

    try {
      rmSync(workspace, { recursive: true, force: true });
      result.cleanup.temporary_workspace = existsSync(workspace) ? 'FAIL' : 'PASS';
    } catch {
      result.cleanup.temporary_workspace = 'FAIL';
    }
    if (result.cleanup.temporary_workspace !== 'PASS') {
      rememberFailure(verifierError('SCENARIO_WORKSPACE_CLEANUP_FAILED', 'cleanup_failure'));
    }
  }
  return { result, failure };
}

function controlScenario(controlMode) {
  if (controlMode === 'lifecycle_shutdown') {
    return { id: 'LIFECYCLE-CONTROL', database: 'tecm_acl_lifecycle', expected: 'success' };
  }
  if (controlMode === 'late_shutdown') {
    return { ...m36, id: 'LATE-SHUTDOWN-CONTROL', database: 'tecm_acl_late_shutdown', passLabel: null };
  }
  if (controlMode === 'command_timeout') {
    return { id: 'TIMEOUT-CONTROL', database: 'tecm_acl_timeout', expected: 'success' };
  }
  return null;
}

function inspectVolumeIdentity(volumeName) {
  const inspect = run('docker', ['volume', 'inspect', '--format', '{{.Name}}', volumeName], {
    category: 'docker_volume_inspect',
    timeout: timeouts.dockerInspect
  });
  return {
    process: inspect,
    exact: inspect.status === 0 && inspect.stdout.trim() === volumeName,
    missing: inspect.status !== 0 && !inspect.timedOut
  };
}

function verifyContainerVolumeMount(containerName, volumeName) {
  const inspect = run('docker', [
    'inspect', '--format', '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}',
    containerName
  ], { category: 'docker_mount_inspect', timeout: timeouts.dockerInspect });
  if (inspect.timedOut) throw timeoutError('VOLUME_MOUNT_INSPECTION_TIMEOUT', inspect);
  if (inspect.status !== 0 || inspect.stdout.trim() !== volumeName) {
    throw commandError('VOLUME_MOUNT_IDENTITY_MISMATCH', inspect, 'cleanup_architecture_failure');
  }
}

function cleanupContainerAndVolume(containerName, volumeName, containerCreated, volumeCreated) {
  let container = 'FAIL';
  let volume = 'FAIL';
  let error;

  if (containerCreated) {
    const remove = run('docker', ['rm', '-f', containerName], {
      category: 'docker_container_remove',
      timeout: timeouts.dockerLifecycle
    });
    const absent = inspectContainer(containerName);
    container = remove.status === 0 && !remove.timedOut && absent.exists === false ? 'PASS' : 'FAIL';
    if (container !== 'PASS') error ??= remove.timedOut
      ? timeoutError('CONTAINER_CLEANUP_TIMEOUT', remove)
      : verifierError('CONTAINER_CLEANUP_FAILED', 'cleanup_failure', {
        removal: processDiagnostic(remove),
        inspection_state: absent.state
      });
  } else {
    const absent = inspectContainer(containerName);
    container = absent.exists === false ? 'PASS' : 'FAIL';
  }

  if (volumeCreated) {
    const remove = run('docker', ['volume', 'rm', '-f', volumeName], {
      category: 'docker_volume_remove',
      timeout: timeouts.dockerLifecycle
    });
    const absent = inspectVolumeIdentity(volumeName);
    volume = remove.status === 0 && !remove.timedOut && absent.missing ? 'PASS' : 'FAIL';
    if (volume !== 'PASS') error ??= remove.timedOut
      ? timeoutError('VOLUME_CLEANUP_TIMEOUT', remove)
      : verifierError('VOLUME_CLEANUP_FAILED', 'cleanup_failure', {
        removal: processDiagnostic(remove),
        volume_remaining: absent.exact,
        inspection_timeout: absent.process.timedOut
      });
  } else {
    const absent = inspectVolumeIdentity(volumeName);
    volume = absent.missing ? 'PASS' : 'FAIL';
  }

  return { container, volume, error };
}

function finalizeResultOutput(result, passLabel, controlMode) {
  if (controlMode === 'none' && result.final_result === 'PASS' && passLabel) {
    process.stdout.write(`${passLabel}\n`);
  }
  if (controlMode === 'none' && ['M37', 'M38'].includes(result.mutation) && result.final_result === 'PASS') {
    process.stdout.write(
      `caught=${result.caught}\n` +
      `target=${result.target}\n` +
      `expected_failure=${result.expected_failure}\n` +
      `lifecycle_failure=${result.lifecycle_failure}\n` +
      `restoration=${result.restoration}\n` +
      `container_cleanup=${result.cleanup.container}\n` +
      `database_cleanup=${result.cleanup.database}\n` +
      `volume_cleanup=${result.cleanup.volume}\n` +
      `workspace_cleanup=${result.cleanup.temporary_workspace}\n` +
      `final_result=${result.final_result}\n`
    );
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function runVerifier({ controlMode = 'none' } = {}) {
  const unique = `${process.pid}-${randomBytes(5).toString('hex')}`;
  const workspaceRoot = mkdtempSync(resolve(tmpdir(), 'tecm-attendance-acl-shared-'));
  const containerName = `tecm-attendance-acl-${unique}`;
  const volumeName = `tecm-attendance-acl-data-${unique}`;
  const activeScenarios = controlMode === 'none' ? scenarios : [controlScenario(controlMode)];
  const results = [];
  let runnerFailure;
  let containerCreated = false;
  let volumeCreated = false;

  try {
    const docker = run('docker', ['info', '--format', '{{.ServerVersion}}'], {
      category: 'docker_info',
      timeout: timeouts.dockerInspect
    });
    if (docker.status !== 0) throw commandError('DOCKER_UNAVAILABLE', docker, 'lifecycle_or_prerequisite_failure', { lifecycle: true });

    const volumeCreate = run('docker', ['volume', 'create', '--name', volumeName], {
      category: 'docker_volume_create',
      timeout: timeouts.dockerLifecycle
    });
    if (volumeCreate.status !== 0 || volumeCreate.stdout.trim() !== volumeName) {
      throw commandError('VOLUME_CREATE_FAILED', volumeCreate, 'cleanup_architecture_failure');
    }
    volumeCreated = true;
    const volumeIdentity = inspectVolumeIdentity(volumeName);
    if (volumeIdentity.process.timedOut) throw timeoutError('VOLUME_IDENTITY_TIMEOUT', volumeIdentity.process);
    if (!volumeIdentity.exact) throw verifierError('VOLUME_IDENTITY_MISSING_OR_AMBIGUOUS', 'cleanup_architecture_failure');

    const start = run('docker', [
      'run', '--name', containerName,
      '-e', 'POSTGRES_PASSWORD=postgres',
      '-v', `${volumeName}:/var/lib/postgresql/data`,
      '-v', `${workspaceRoot}:/workspace:ro`,
      '-d', 'postgres:15-alpine'
    ], { category: 'docker_container_start', timeout: timeouts.dockerLifecycle });
    if (start.status !== 0) throw commandError('CONTAINER_START_FAILED', start, 'lifecycle_or_prerequisite_failure', { lifecycle: true });
    containerCreated = true;
    verifyContainerVolumeMount(containerName, volumeName);
    ensureScenarioReady(containerName, 'postgres');

    for (const spec of activeScenarios) {
      const scenario = executeScenario(spec, { containerName, volumeName, workspaceRoot, controlMode });
      results.push(scenario.result);
      if (scenario.failure) {
        runnerFailure = scenario.failure;
        break;
      }
    }
  } catch (error) {
    runnerFailure = error;
  } finally {
    const cleanup = cleanupContainerAndVolume(containerName, volumeName, containerCreated, volumeCreated);
    runnerFailure ??= cleanup.error;
    const immutable = immutableStatus();
    if (immutable.status !== 'PASS') runnerFailure ??= immutable.error ?? verifierError('IMMUTABLE_RESTORATION_FAILED', 'restoration_failure');

    let sharedWorkspaceClean = false;
    try {
      rmSync(workspaceRoot, { recursive: true, force: true });
      sharedWorkspaceClean = !existsSync(workspaceRoot);
    } catch {
      sharedWorkspaceClean = false;
    }
    if (!sharedWorkspaceClean) runnerFailure ??= verifierError('SHARED_WORKSPACE_CLEANUP_FAILED', 'cleanup_failure');

    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      result.cleanup.container = cleanup.container;
      result.cleanup.volume = cleanup.volume;
      if (result.cleanup.database === 'PENDING_VOLUME_REMOVAL' && controlMode === 'lifecycle_shutdown') {
        result.cleanup.database = cleanup.volume === 'PASS' ? 'PASS' : 'FAIL';
      }
      if (!sharedWorkspaceClean) result.cleanup.temporary_workspace = 'FAIL';
      result.restoration = immutable.status;
      result.final_result = result.caught && !result.lifecycle_failure && !result.timeout_failure
        && result.final_probe === 'PASS' && result.restoration === 'PASS'
        && Object.values(result.cleanup).every((value) => value === 'PASS') ? 'PASS' : 'FAIL';
      finalizeResultOutput(result, activeScenarios[index]?.passLabel, controlMode);
    }
  }

  return {
    passed: !runnerFailure && results.length === activeScenarios.length
      && results.every((result) => result.final_result === 'PASS'),
    results,
    error: runnerFailure
  };
}

function parseControlResult(child, mutation) {
  const resultLine = outputOf(child).split(/\r?\n/).find((line) => {
    if (!line.startsWith('{')) return false;
    try { return JSON.parse(line).mutation === mutation; } catch { return false; }
  });
  if (!resultLine) throw verifierError('CONTROL_RESULT_MISSING', 'control_failure', processDiagnostic(child));
  try { return JSON.parse(resultLine); } catch { throw verifierError('CONTROL_RESULT_INVALID', 'control_failure'); }
}

function runChildControl(controlMode, mutation) {
  const child = run(process.execPath, [process.argv[1]], {
    category: 'verifier_child_control',
    timeout: timeouts.childControl,
    env: { ...process.env, TECM_ATTENDANCE_ACL_CONTROL: controlMode }
  });
  if (child.timedOut) throw timeoutError('CHILD_CONTROL_TIMEOUT', child);
  return { child, result: parseControlResult(child, mutation) };
}

function runLifecycleNegativeControl() {
  const { child, result } = runChildControl('lifecycle_shutdown', 'LIFECYCLE-CONTROL');
  const cleanupPass = Object.values(result.cleanup ?? {}).every((value) => value === 'PASS');
  if (child.status === 0 || result.caught || !result.lifecycle_failure || result.timeout_failure
    || result.restoration !== 'PASS' || !cleanupPass || result.final_result !== 'FAIL') {
    throw verifierError('LIFECYCLE_CONTROL_NOT_FAIL_CLOSED', 'control_failure', {
      exit_nonzero: child.status !== 0,
      caught: result.caught,
      lifecycle_failure: result.lifecycle_failure,
      restoration: result.restoration,
      cleanup_pass: cleanupPass,
      final_result: result.final_result
    });
  }
  process.stdout.write('LIFECYCLE NEGATIVE CONTROL PASS\n');
  process.stdout.write(`${JSON.stringify({
    lifecycle_negative_control: 'PASS',
    caught: false,
    lifecycle_failure: true,
    classification: result.error_classification,
    restoration: result.restoration,
    volume_identity: result.volume_identity,
    cleanup: result.cleanup,
    exit_nonzero: true
  })}\n`);
}

function runLateShutdownNegativeControl() {
  const { child, result } = runChildControl('late_shutdown', 'LATE-SHUTDOWN-CONTROL');
  const resourceCleanupPass = result.cleanup?.container === 'PASS'
    && result.cleanup?.volume === 'PASS' && result.cleanup?.temporary_workspace === 'PASS';
  if (child.status === 0 || !result.caught || !result.lifecycle_failure || result.final_result !== 'FAIL'
    || result.restoration !== 'PASS' || !resourceCleanupPass || result.cleanup?.database === 'PASS') {
    throw verifierError('LATE_SHUTDOWN_CONTROL_NOT_FAIL_CLOSED', 'control_failure', {
      exit_nonzero: child.status !== 0,
      caught: result.caught,
      lifecycle_failure: result.lifecycle_failure,
      database_cleanup_nonpassing: result.cleanup?.database !== 'PASS',
      resource_cleanup_pass: resourceCleanupPass,
      final_result: result.final_result
    });
  }
  process.stdout.write('LATE SHUTDOWN NEGATIVE CONTROL PASS\n');
  process.stdout.write(`${JSON.stringify({
    late_shutdown_negative_control: 'PASS',
    caught: true,
    lifecycle_failure: true,
    classification: result.error_classification,
    final_result: 'FAIL',
    exit_nonzero: true,
    restoration: result.restoration,
    volume_identity: result.volume_identity,
    cleanup: result.cleanup
  })}\n`);
}

function runCommandTimeoutNegativeControl() {
  const { child, result } = runChildControl('command_timeout', 'TIMEOUT-CONTROL');
  const cleanupPass = Object.values(result.cleanup ?? {}).every((value) => value === 'PASS');
  if (child.status === 0 || result.caught || !result.timeout_failure || result.lifecycle_failure
    || result.error_classification !== 'command_timeout' || result.final_result !== 'FAIL'
    || result.restoration !== 'PASS' || !cleanupPass) {
    throw verifierError('COMMAND_TIMEOUT_CONTROL_NOT_FAIL_CLOSED', 'control_failure', {
      exit_nonzero: child.status !== 0,
      caught: result.caught,
      timeout_failure: result.timeout_failure,
      lifecycle_failure: result.lifecycle_failure,
      classification: result.error_classification,
      cleanup_pass: cleanupPass,
      final_result: result.final_result
    });
  }
  process.stdout.write('COMMAND TIMEOUT NEGATIVE CONTROL PASS\n');
  process.stdout.write(`${JSON.stringify({
    command_timeout_negative_control: 'PASS',
    caught: false,
    timeout_failure: true,
    lifecycle_failure: false,
    classification: 'command_timeout',
    final_result: 'FAIL',
    exit_nonzero: true,
    restoration: result.restoration,
    volume_identity: result.volume_identity,
    cleanup: result.cleanup
  })}\n`);
}

function safeTopLevelError(error) {
  return {
    verifier_error: error.code ?? 'VERIFIER_FAILURE',
    classification: error.classification ?? 'test_or_setup_failure',
    lifecycle_failure: Boolean(error.lifecycle),
    timeout_failure: Boolean(error.timeout),
    diagnostic: error.diagnostic ?? null
  };
}

function main() {
  initializeSnapshots();
  const childControl = process.env.TECM_ATTENDANCE_ACL_CONTROL;
  if (childControl) {
    const outcome = runVerifier({ controlMode: childControl });
    if (outcome.passed) throw verifierError('NEGATIVE_CONTROL_UNEXPECTEDLY_PASSED', 'control_failure');
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes('--sanitization-self-test')) {
    runSanitizationSelfTest();
    return;
  }
  if (process.argv.includes('--lifecycle-negative-control')) {
    runLifecycleNegativeControl();
    return;
  }
  if (process.argv.includes('--late-shutdown-negative-control')) {
    runLateShutdownNegativeControl();
    return;
  }
  if (process.argv.includes('--command-timeout-negative-control')) {
    runCommandTimeoutNegativeControl();
    return;
  }

  runSanitizationSelfTest();
  runLifecycleNegativeControl();
  runLateShutdownNegativeControl();
  runCommandTimeoutNegativeControl();
  const outcome = runVerifier();
  if (!outcome.passed) throw outcome.error ?? verifierError('ATTENDANCE_ACL_VERIFIER_FAILED', 'test_or_setup_failure');
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify(safeTopLevelError(error))}\n`);
  process.exitCode = 1;
}
