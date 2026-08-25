import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '../..');
const migrationPath = 'supabase/migrations/202608240015_attendance_function_execute_hardening.sql';
const assertionPath = 'supabase/tests/018_attendance_function_execute_hardening.sql';
const raceAssertionPath = 'supabase/tests/concurrency/teacher_attendance_assert.sql';
const immutablePaths = [migrationPath, assertionPath, raceAssertionPath];
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
  assertionPath
];
const pre015Files = sourceFiles.slice(0, sourceFiles.indexOf(migrationPath));

function run(command, args, cwd = repoRoot, options = {}) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', ...options });
}

function outputOf(process) {
  return `${process.stdout ?? ''}${process.stderr ?? ''}`;
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function gitBlob(path) {
  return outputOf(run('git', ['hash-object', '--', path])).trim();
}

const immutableSnapshots = new Map(immutablePaths.map((path) => {
  const bytes = readFileSync(resolve(repoRoot, path));
  return [path, { bytes, sha256: hash(bytes), git_blob: gitBlob(path) }];
}));
const migrationSnapshot = immutableSnapshots.get(migrationPath);
if (!/^[0-9a-f]{40}$/.test(migrationSnapshot.git_blob)) {
  throw new Error('Attendance ACL verifier could not resolve migration 015 Git blob.');
}

const serviceRoleGrants = [
  'grant execute on function public.capture_attendance_history_audit() to service_role;',
  'grant execute on function public.get_teacher_attendance_sessions() to service_role;',
  'grant execute on function public.submit_teacher_attendance(uuid,uuid,text,timestamptz,text,text) to service_role;',
  'grant execute on function public.submit_attendance(uuid,jsonb) to service_role;'
].join(' ');

const scenarios = [
  { id: 'UPGRADE-STATE', database: 'tecm_acl_upgrade', expected: 'success', pregrantServiceRole: true },
  {
    id: 'M36', database: 'tecm_m36', expected: 'assertion',
    target: 'revoke all on function public.get_teacher_attendance_sessions() from anon;',
    replacement: 'grant execute on function public.get_teacher_attendance_sessions() to anon;',
    expectedFailure: '018 attendance function ACL: anon EXECUTE must be false for get_teacher_attendance_sessions()'
  },
  {
    id: 'M37', database: 'tecm_m37', expected: 'assertion',
    target: 'revoke all on function public.get_teacher_attendance_sessions() from service_role;',
    replacement: '', targetSignature: 'public.get_teacher_attendance_sessions()', pregrantServiceRole: true,
    expectedFailure: '018 attendance function ACL: service_role EXECUTE expanded for get_teacher_attendance_sessions()'
  }
];

function pause(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function lifecycleError(message) {
  const error = new Error(`LIFECYCLE FAILURE: ${message}`);
  error.lifecycle = true;
  return error;
}

function immutableStatus() {
  const entries = {};
  let passed = true;
  for (const [path, snapshot] of immutableSnapshots) {
    const bytes = readFileSync(resolve(repoRoot, path));
    const current = { sha256: hash(bytes), git_blob: gitBlob(path) };
    const match = bytes.equals(snapshot.bytes) && current.sha256 === snapshot.sha256 && current.git_blob === snapshot.git_blob;
    entries[path] = { ...current, status: match ? 'PASS' : 'FAIL' };
    passed &&= match;
  }
  return { status: passed ? 'PASS' : 'FAIL', entries };
}

function sanitize(value) {
  return String(value).replace(/password=[^\s]+/gi, 'password=[REDACTED]').slice(-1600);
}

function containerState(containerName) {
  const inspect = run('docker', ['inspect', '--format', '{{.State.Status}} {{.State.Running}} {{.State.ExitCode}}', containerName]);
  return inspect.status === 0 ? inspect.stdout.trim() : 'missing';
}

function lifecycleDiagnostics(containerName) {
  const logs = run('docker', ['logs', '--tail', '40', containerName]);
  return { state: containerState(containerName), logs: sanitize(outputOf(logs)) };
}

function lifecycleWasLost(containerName, process) {
  return !containerState(containerName).startsWith('running true')
    || /database system is shutting down|server closed the connection unexpectedly|terminating connection/i.test(outputOf(process));
}

function ensureScenarioReady(containerName, database) {
  let lastDiagnostic = 'readiness did not begin';
  let stableChecks = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = containerState(containerName);
    if (!state.startsWith('running true')) {
      throw lifecycleError(`container is not running before ${database}: ${state}; ${JSON.stringify(lifecycleDiagnostics(containerName))}`);
    }
    const ready = run('docker', ['exec', containerName, 'pg_isready', '-q', '-U', 'postgres', '-d', database]);
    const probe = run('docker', ['exec', containerName, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database, '-Atc', 'select 1']);
    const identity = run('docker', ['exec', containerName, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database, '-Atc', 'select current_database()']);
    if (ready.status === 0 && probe.status === 0 && probe.stdout.trim() === '1' && identity.status === 0 && identity.stdout.trim() === database) {
      stableChecks += 1;
      if (stableChecks >= 2) return;
    } else {
      stableChecks = 0;
      lastDiagnostic = `state=${state}; pg_isready=${ready.status}; probe=${probe.status}:${sanitize(outputOf(probe))}; identity=${identity.status}:${sanitize(outputOf(identity))}`;
    }
    pause(250);
  }
  throw lifecycleError(`bounded readiness failed for ${database}: ${lastDiagnostic}; ${JSON.stringify(lifecycleDiagnostics(containerName))}`);
}

function copyFixture(workspace, relative) {
  const source = resolve(repoRoot, relative);
  const destination = resolve(workspace, relative);
  if (!existsSync(source)) throw new Error(`Missing attendance ACL verifier input: ${relative}`);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination);
}

function scenarioResult(spec) {
  return {
    mutation: spec.id,
    caught: false,
    target: spec.targetSignature ?? null,
    expected_failure: spec.id === 'M37' ? 'service_role EXECUTE' : spec.expectedFailure ?? null,
    source_sha256: migrationSnapshot.sha256,
    git_blob: migrationSnapshot.git_blob,
    lifecycle_failure: false,
    restoration: 'PENDING',
    cleanup: { container: 'PENDING', database: 'PENDING', temporary_workspace: 'PENDING' },
    final_result: 'FAIL'
  };
}

function executeScenario(spec, context) {
  const result = scenarioResult(spec);
  const workspace = resolve(context.workspaceRoot, spec.id.toLowerCase());
  let failure;
  let databaseCreated = false;
  try {
    mkdirSync(workspace, { recursive: true });
    for (const file of sourceFiles) copyFixture(workspace, file);
    const fixtureMigration = resolve(workspace, migrationPath);
    if (spec.target) {
      const fixtureSource = readFileSync(fixtureMigration, 'utf8');
      const matches = fixtureSource.split(spec.target).length - 1;
      if (matches !== 1) throw new Error(`${spec.id} expected one mutation target, found ${matches}.`);
      writeFileSync(fixtureMigration, fixtureSource.replace(spec.target, spec.replacement));
      if (hash(readFileSync(fixtureMigration)) === migrationSnapshot.sha256) {
        throw new Error(`${spec.id} mutation did not change disposable migration bytes.`);
      }
    }

    const create = run('docker', ['exec', context.containerName, 'createdb', '-U', 'postgres', spec.database]);
    if (create.status !== 0) throw lifecycleError(`could not create ${spec.database}: ${sanitize(outputOf(create))}`);
    databaseCreated = true;
    ensureScenarioReady(context.containerName, spec.database);

    if (context.injectLifecycleShutdown) {
      const stop = run('docker', ['stop', '--time', '0', context.containerName]);
      if (stop.status !== 0) throw lifecycleError(`could not deliberately stop lifecycle-control container: ${sanitize(outputOf(stop))}`);
      ensureScenarioReady(context.containerName, spec.database);
    }

    const runPsqlFile = (relative) => run('docker', [
      'exec', context.containerName, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', spec.database,
      '-f', `/workspace/${spec.id.toLowerCase()}/${relative}`
    ]);
    const runPsqlSql = (sql) => run('docker', [
      'exec', context.containerName, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', spec.database, '-c', sql
    ]);
    for (const file of pre015Files) {
      const setup = runPsqlFile(file);
      if (setup.status !== 0) {
        if (lifecycleWasLost(context.containerName, setup)) {
          throw lifecycleError(`${spec.id} prerequisite ${file} lost container lifecycle; ${JSON.stringify(lifecycleDiagnostics(context.containerName))}`);
        }
        throw new Error(`${spec.id} prerequisite failed: ${file}\n${sanitize(outputOf(setup))}`);
      }
    }
    if (spec.pregrantServiceRole) {
      const grants = runPsqlSql(serviceRoleGrants);
      if (grants.status !== 0 && lifecycleWasLost(context.containerName, grants)) {
        throw lifecycleError(`${spec.id} direct service_role grant lost container lifecycle; ${JSON.stringify(lifecycleDiagnostics(context.containerName))}`);
      }
      if (grants.status !== 0) throw new Error(`${spec.id} could not seed direct service_role grants.\n${sanitize(outputOf(grants))}`);
    }
    const migration = runPsqlFile(migrationPath);
    if (migration.status !== 0 && lifecycleWasLost(context.containerName, migration)) {
      throw lifecycleError(`${spec.id} migration 015 lost container lifecycle; ${JSON.stringify(lifecycleDiagnostics(context.containerName))}`);
    }
    if (migration.status !== 0) throw new Error(`${spec.id} migration 015 failed.\n${sanitize(outputOf(migration))}`);
    const repeatSeed = runPsqlFile('supabase/seed.sql');
    if (repeatSeed.status !== 0 && lifecycleWasLost(context.containerName, repeatSeed)) {
      throw lifecycleError(`${spec.id} repeat seed lost container lifecycle; ${JSON.stringify(lifecycleDiagnostics(context.containerName))}`);
    }
    if (repeatSeed.status !== 0) throw new Error(`${spec.id} repeat seed failed.\n${sanitize(outputOf(repeatSeed))}`);
    const assertion = runPsqlFile(assertionPath);
    if (assertion.status !== 0 && lifecycleWasLost(context.containerName, assertion)) {
      throw lifecycleError(`${spec.id} SQL018 lost container lifecycle; ${JSON.stringify(lifecycleDiagnostics(context.containerName))}`);
    }
    const assertionOutput = sanitize(outputOf(assertion));
    if (spec.expected === 'success') {
      if (assertion.status !== 0) throw new Error(`${spec.id} ACL assertions failed.\n${assertionOutput}`);
      result.caught = true;
      process.stdout.write('UPGRADE-STATE PASS\n');
    } else if (assertion.status !== 0 && assertionOutput.includes(spec.expectedFailure)) {
      result.caught = true;
      process.stdout.write(`${spec.id} CAUGHT\n`);
    } else {
      throw new Error(`${spec.id} was not caught by its targeted ACL assertion (exit=${assertion.status}).\n${assertionOutput}`);
    }
  } catch (error) {
    failure = error;
    result.lifecycle_failure = Boolean(error.lifecycle);
    result.error_classification = error.lifecycle ? 'lifecycle_or_prerequisite_failure' : 'test_or_setup_failure';
    if (error.lifecycle) result.lifecycle_diagnostics = lifecycleDiagnostics(context.containerName);
    result.error = sanitize(error.message);
  } finally {
    if (databaseCreated && containerState(context.containerName).startsWith('running true')) {
      const drop = run('docker', ['exec', context.containerName, 'dropdb', '-U', 'postgres', '--if-exists', spec.database]);
      const exists = run('docker', ['exec', context.containerName, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-Atc', `select count(*) from pg_database where datname = '${spec.database}'`]);
      result.cleanup.database = drop.status === 0 && exists.status === 0 && exists.stdout.trim() === '0' ? 'PASS' : 'FAIL';
    }
    rmSync(workspace, { recursive: true, force: true });
    result.cleanup.temporary_workspace = existsSync(workspace) ? 'FAIL' : 'PASS';
  }
  return { result, failure };
}

function runVerifier({ injectLifecycleShutdown = false } = {}) {
  const workspaceRoot = mkdtempSync(resolve(tmpdir(), 'tecm-attendance-acl-shared-'));
  const containerName = `tecm-attendance-acl-${process.pid}`;
  const activeScenarios = injectLifecycleShutdown
    ? [{ id: 'LIFECYCLE-CONTROL', database: 'tecm_acl_lifecycle', expected: 'success' }]
    : scenarios;
  const results = [];
  let runnerFailure;
  try {
    const docker = run('docker', ['info', '--format', '{{.ServerVersion}}']);
    if (docker.status !== 0) throw lifecycleError('Docker Desktop is unavailable.');
    const start = run('docker', [
      'run', '--name', containerName, '-e', 'POSTGRES_PASSWORD=postgres', '-v', `${workspaceRoot}:/workspace:ro`, '-d', 'postgres:15-alpine'
    ]);
    if (start.status !== 0) throw lifecycleError(`could not start shared PostgreSQL container: ${sanitize(outputOf(start))}`);
    ensureScenarioReady(containerName, 'postgres');
    for (const spec of activeScenarios) {
      const scenario = executeScenario(spec, { containerName, workspaceRoot, injectLifecycleShutdown });
      results.push(scenario.result);
      if (scenario.failure) {
        runnerFailure = scenario.failure;
        break;
      }
    }
  } catch (error) {
    runnerFailure = error;
  } finally {
    const remove = run('docker', ['rm', '-f', containerName]);
    const remaining = run('docker', ['ps', '-a', '--format', '{{.Names}}']);
    const containerClean = remove.status === 0 && remaining.status === 0 && !remaining.stdout.split(/\r?\n/).includes(containerName);
    const immutable = immutableStatus();
    for (const result of results) {
      result.cleanup.container = containerClean ? 'PASS' : 'FAIL';
      if (result.cleanup.database === 'PENDING') result.cleanup.database = containerClean ? 'PASS' : 'FAIL';
      result.restoration = immutable.status;
      result.final_result = result.caught && !result.lifecycle_failure && result.restoration === 'PASS'
        && Object.values(result.cleanup).every((value) => value === 'PASS') ? 'PASS' : 'FAIL';
      if (result.mutation === 'M37') {
        process.stdout.write(`caught=${result.caught}\ntarget=${result.target}\nexpected_failure=${result.expected_failure}\nrestoration=${result.restoration}\ncleanup=${Object.values(result.cleanup).every((value) => value === 'PASS') ? 'PASS' : 'FAIL'}\nfinal_result=${result.final_result}\n`);
      }
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }
    rmSync(workspaceRoot, { recursive: true, force: true });
    if (existsSync(workspaceRoot)) runnerFailure ??= new Error('Attendance ACL shared temporary workspace was not removed.');
    if (!containerClean) runnerFailure ??= new Error('Attendance ACL shared PostgreSQL container cleanup failed.');
    if (immutable.status !== 'PASS') runnerFailure ??= new Error('Attendance ACL immutable security artifact changed.');
  }
  return { passed: !runnerFailure && results.length === activeScenarios.length && results.every((result) => result.final_result === 'PASS'), results, error: runnerFailure };
}

function runLifecycleNegativeControl() {
  const child = run(process.execPath, [process.argv[1]], repoRoot, {
    env: { ...process.env, TECM_ATTENDANCE_ACL_LIFECYCLE_CONTROL: 'shutdown-after-readiness' }
  });
  const childOutput = outputOf(child);
  const resultLine = childOutput.split(/\r?\n/).find((line) => line.includes('"mutation":"LIFECYCLE-CONTROL"'));
  let result;
  try { result = JSON.parse(resultLine); } catch { throw new Error('Lifecycle negative control did not emit machine-readable result.'); }
  const cleanupPass = Object.values(result.cleanup ?? {}).every((value) => value === 'PASS');
  if (child.status === 0 || result.caught || !result.lifecycle_failure || result.restoration !== 'PASS' || !cleanupPass
    || /M36 CAUGHT|M37 CAUGHT/.test(childOutput)) {
    throw new Error(`Lifecycle negative control was not fail-closed: exit=${child.status}; ${sanitize(childOutput)}`);
  }
  process.stdout.write('LIFECYCLE NEGATIVE CONTROL PASS\n');
  process.stdout.write(`${JSON.stringify({
    lifecycle_negative_control: 'PASS',
    caught: false,
    lifecycle_failure: result.lifecycle_failure,
    classification: result.error_classification,
    diagnostic: result.lifecycle_diagnostics,
    restoration: result.restoration,
    cleanup: result.cleanup
  })}\n`);
}

try {
  if (process.env.TECM_ATTENDANCE_ACL_LIFECYCLE_CONTROL === 'shutdown-after-readiness') {
    const outcome = runVerifier({ injectLifecycleShutdown: true });
    if (outcome.passed) throw new Error('Lifecycle control unexpectedly passed.');
    process.exitCode = 1;
  } else if (process.argv.includes('--lifecycle-negative-control')) {
    runLifecycleNegativeControl();
  } else {
    runLifecycleNegativeControl();
    const outcome = runVerifier();
    if (!outcome.passed) throw outcome.error ?? new Error('Attendance ACL verifier failed.');
  }
} catch (error) {
  process.stderr.write(`${sanitize(error.message)}\n`);
  process.exitCode = 1;
}
