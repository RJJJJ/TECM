import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '../..');
const migrationPath = 'supabase/migrations/202608240015_attendance_function_execute_hardening.sql';
const assertionPath = 'supabase/tests/018_attendance_function_execute_hardening.sql';
const database = 'tecm_m36';
const containerName = `tecm-m36-attendance-acl-${process.pid}`;
const tempRoot = mkdtempSync(resolve(tmpdir(), 'tecm-m36-attendance-acl-'));
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
const migrationFiles = sourceFiles.filter((file) => file !== assertionPath);
const sourceBytes = readFileSync(resolve(repoRoot, migrationPath));
const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
const result = {
  mutation: 'M36',
  caught: false,
  restoration: 'FAIL',
  cleanup: { container: 'PENDING', temporary_workspace: 'PENDING' },
  final_result: 'FAIL'
};
let failure;

function run(command, args) {
  return spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8' });
}

function outputOf(process) {
  return `${process.stdout ?? ''}${process.stderr ?? ''}`;
}

function copyFixture(relative) {
  const source = resolve(repoRoot, relative);
  const destination = resolve(tempRoot, relative);
  if (!existsSync(source)) throw new Error(`M36 missing mutation input: ${relative}`);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination);
}

function runPsqlFile(relative) {
  return run('docker', [
    'exec', containerName, 'psql', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', database, '-f', `/workspace/${relative}`
  ]);
}

function pause(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

try {
  const docker = run('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (docker.status !== 0) throw new Error('M36 requires Docker Desktop.');

  for (const file of sourceFiles) copyFixture(file);
  const fixtureMigration = resolve(tempRoot, migrationPath);
  const fixtureSource = readFileSync(fixtureMigration, 'utf8');
  const revoke = 'revoke all on function public.get_teacher_attendance_sessions() from anon;';
  const grant = 'grant execute on function public.get_teacher_attendance_sessions() to anon;';
  const matches = fixtureSource.split(revoke).length - 1;
  if (matches !== 1) throw new Error(`M36 expected one anon revoke target, found ${matches}.`);
  writeFileSync(fixtureMigration, fixtureSource.replace(revoke, grant));
  if (createHash('sha256').update(readFileSync(fixtureMigration)).digest('hex') === sourceHash) {
    throw new Error('M36 mutation did not change the disposable migration bytes.');
  }

  const start = run('docker', [
    'run', '--name', containerName,
    '-e', 'POSTGRES_PASSWORD=postgres',
    '-e', `POSTGRES_DB=${database}`,
    '-v', `${tempRoot}:/workspace:ro`,
    '-d', 'postgres:15-alpine'
  ]);
  if (start.status !== 0) throw new Error(`M36 could not start PostgreSQL: ${outputOf(start)}`);

  let ready = false;
  let stableReadyChecks = 0;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (run('docker', ['exec', containerName, 'pg_isready', '-q', '-U', 'postgres', '-d', database]).status === 0) {
      stableReadyChecks += 1;
      if (stableReadyChecks >= 2) {
        ready = true;
        break;
      }
    } else {
      stableReadyChecks = 0;
    }
    pause(250);
  }
  if (!ready) throw new Error('M36 PostgreSQL container did not become ready.');

  for (const file of migrationFiles) {
    const setup = runPsqlFile(file);
    if (setup.status !== 0) throw new Error(`M36 prerequisite failed: ${file}\n${outputOf(setup)}`);
  }
  // The production verifier repeats seed application before SQL suites.
  const repeatSeed = runPsqlFile('supabase/seed.sql');
  if (repeatSeed.status !== 0) throw new Error(`M36 repeat seed failed.\n${outputOf(repeatSeed)}`);

  const assertion = runPsqlFile(assertionPath);
  const assertionOutput = outputOf(assertion);
  const expectedFailure = '018 attendance function ACL: anon EXECUTE must be false for get_teacher_attendance_sessions()';
  if (assertion.status === 0 || !assertionOutput.includes(expectedFailure)) {
    throw new Error(`M36 was not caught by its targeted anon EXECUTE assertion (exit=${assertion.status}).\n${assertionOutput}`);
  }
  result.caught = true;
  result.assertion = expectedFailure;
  process.stdout.write('M36 CAUGHT\n');
} catch (error) {
  failure = error;
} finally {
  const remove = run('docker', ['rm', '-f', containerName]);
  const remaining = run('docker', ['ps', '-a', '--format', '{{.Names}}']);
  result.cleanup.container = remove.status === 0 && remaining.status === 0 && !remaining.stdout.split(/\r?\n/).includes(containerName)
    ? 'PASS'
    : 'FAIL';

  const restoredHash = createHash('sha256').update(readFileSync(resolve(repoRoot, migrationPath))).digest('hex');
  result.restoration = restoredHash === sourceHash ? 'PASS' : 'FAIL';

  rmSync(tempRoot, { recursive: true, force: true });
  result.cleanup.temporary_workspace = existsSync(tempRoot) ? 'FAIL' : 'PASS';
  result.final_result = result.caught && result.restoration === 'PASS'
    && result.cleanup.container === 'PASS' && result.cleanup.temporary_workspace === 'PASS'
    ? 'PASS'
    : 'FAIL';
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (failure) {
  process.stderr.write(`${failure.message}\n`);
  process.exit(1);
}
if (result.final_result !== 'PASS') process.exit(1);
