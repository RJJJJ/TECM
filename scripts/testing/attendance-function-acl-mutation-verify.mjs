import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '../..');
const migrationPath = 'supabase/migrations/202608240015_attendance_function_execute_hardening.sql';
const assertionPath = 'supabase/tests/018_attendance_function_execute_hardening.sql';
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
const sourceBytes = readFileSync(resolve(repoRoot, migrationPath));
const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');

function run(command, args, cwd = repoRoot) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' });
}

function outputOf(process) {
  return `${process.stdout ?? ''}${process.stderr ?? ''}`;
}

const sourceGitBlob = outputOf(run('git', ['hash-object', '--', migrationPath])).trim();
if (!/^[0-9a-f]{40}$/.test(sourceGitBlob)) {
  throw new Error('M36/M37 could not resolve the source migration Git blob.');
}

const serviceRoleGrants = [
  'grant execute on function public.capture_attendance_history_audit() to service_role;',
  'grant execute on function public.get_teacher_attendance_sessions() to service_role;',
  'grant execute on function public.submit_teacher_attendance(uuid,uuid,text,timestamptz,text,text) to service_role;',
  'grant execute on function public.submit_attendance(uuid,jsonb) to service_role;'
].join(' ');

const scenarios = [
  {
    name: 'UPGRADE-STATE',
    database: 'tecm_acl_upgrade',
    pregrantServiceRole: true,
    expectedSuccess: true
  },
  {
    name: 'M36',
    database: 'tecm_m36',
    target: 'revoke all on function public.get_teacher_attendance_sessions() from anon;',
    replacement: 'grant execute on function public.get_teacher_attendance_sessions() to anon;',
    expectedFailure: '018 attendance function ACL: anon EXECUTE must be false for get_teacher_attendance_sessions()'
  },
  {
    name: 'M37',
    database: 'tecm_m37',
    target: 'revoke all on function public.get_teacher_attendance_sessions() from service_role;',
    replacement: '',
    targetSignature: 'public.get_teacher_attendance_sessions()',
    pregrantServiceRole: true,
    expectedFailure: '018 attendance function ACL: service_role EXECUTE expanded for get_teacher_attendance_sessions()'
  }
];

function pause(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function executeScenario(spec) {
  const label = spec.name;
  const containerName = `tecm-${label.toLowerCase()}-attendance-acl-${process.pid}`;
  const tempRoot = mkdtempSync(resolve(tmpdir(), `tecm-${label.toLowerCase()}-attendance-acl-`));
  const result = {
    mutation: label,
    caught: false,
    target: spec.targetSignature ?? null,
    expected_failure: spec.name === 'M37' ? 'service_role EXECUTE' : spec.expectedFailure ?? null,
    source_sha256: sourceHash,
    git_blob: sourceGitBlob,
    restoration: 'FAIL',
    cleanup: { container: 'PENDING', temporary_workspace: 'PENDING' },
    final_result: 'FAIL'
  };
  let failure;

  function copyFixture(relative) {
    const source = resolve(repoRoot, relative);
    const destination = resolve(tempRoot, relative);
    if (!existsSync(source)) throw new Error(`${label} missing mutation input: ${relative}`);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination);
  }

  function runPsqlFile(relative) {
    return run('docker', [
      'exec', containerName, 'psql', '-q', '-v', 'ON_ERROR_STOP=1',
      '-U', 'postgres', '-d', spec.database, '-f', `/workspace/${relative}`
    ]);
  }

  function runPsqlSql(sql) {
    return run('docker', [
      'exec', containerName, 'psql', '-q', '-v', 'ON_ERROR_STOP=1',
      '-U', 'postgres', '-d', spec.database, '-c', sql
    ]);
  }

  try {
    const docker = run('docker', ['info', '--format', '{{.ServerVersion}}']);
    if (docker.status !== 0) throw new Error(`${label} requires Docker Desktop.`);

    for (const file of sourceFiles) copyFixture(file);
    const fixtureMigration = resolve(tempRoot, migrationPath);
    if (spec.target) {
      const fixtureSource = readFileSync(fixtureMigration, 'utf8');
      const matches = fixtureSource.split(spec.target).length - 1;
      if (matches !== 1) throw new Error(`${label} expected one mutation target, found ${matches}.`);
      writeFileSync(fixtureMigration, fixtureSource.replace(spec.target, spec.replacement));
      if (createHash('sha256').update(readFileSync(fixtureMigration)).digest('hex') === sourceHash) {
        throw new Error(`${label} mutation did not change the disposable migration bytes.`);
      }
    }

    const start = run('docker', [
      'run', '--name', containerName,
      '-e', 'POSTGRES_PASSWORD=postgres',
      '-e', `POSTGRES_DB=${spec.database}`,
      '-v', `${tempRoot}:/workspace:ro`,
      '-d', 'postgres:15-alpine'
    ]);
    if (start.status !== 0) throw new Error(`${label} could not start PostgreSQL: ${outputOf(start)}`);

    let ready = false;
    let stableReadyChecks = 0;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (run('docker', ['exec', containerName, 'pg_isready', '-q', '-U', 'postgres', '-d', spec.database]).status === 0) {
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
    if (!ready) throw new Error(`${label} PostgreSQL container did not become ready.`);

    for (const file of pre015Files) {
      const setup = runPsqlFile(file);
      if (setup.status !== 0) throw new Error(`${label} prerequisite failed: ${file}\n${outputOf(setup)}`);
    }
    if (spec.pregrantServiceRole) {
      const grants = runPsqlSql(serviceRoleGrants);
      if (grants.status !== 0) throw new Error(`${label} could not seed direct service_role grants.\n${outputOf(grants)}`);
    }
    const migration = runPsqlFile(migrationPath);
    if (migration.status !== 0) throw new Error(`${label} migration 015 failed.\n${outputOf(migration)}`);
    const repeatSeed = runPsqlFile('supabase/seed.sql');
    if (repeatSeed.status !== 0) throw new Error(`${label} repeat seed failed.\n${outputOf(repeatSeed)}`);

    const assertion = runPsqlFile(assertionPath);
    const assertionOutput = outputOf(assertion);
    if (spec.expectedSuccess) {
      if (assertion.status !== 0) throw new Error(`${label} ACL assertions failed.\n${assertionOutput}`);
      result.caught = true;
      process.stdout.write('UPGRADE-STATE PASS\n');
    } else {
      if (assertion.status === 0 || !assertionOutput.includes(spec.expectedFailure)) {
        throw new Error(`${label} was not caught by its targeted ACL assertion (exit=${assertion.status}).\n${assertionOutput}`);
      }
      result.caught = true;
      process.stdout.write(`${label} CAUGHT\n`);
    }
  } catch (error) {
    failure = error;
  } finally {
    const remove = run('docker', ['rm', '-f', containerName]);
    const remaining = run('docker', ['ps', '-a', '--format', '{{.Names}}']);
    result.cleanup.container = remove.status === 0 && remaining.status === 0 && !remaining.stdout.split(/\r?\n/).includes(containerName)
      ? 'PASS'
      : 'FAIL';

    const restoredBytes = readFileSync(resolve(repoRoot, migrationPath));
    const restoredHash = createHash('sha256').update(restoredBytes).digest('hex');
    const restoredGitBlob = outputOf(run('git', ['hash-object', '--', migrationPath])).trim();
    result.restoration = restoredBytes.equals(sourceBytes) && restoredHash === sourceHash && restoredGitBlob === sourceGitBlob
      ? 'PASS'
      : 'FAIL';

    rmSync(tempRoot, { recursive: true, force: true });
    result.cleanup.temporary_workspace = existsSync(tempRoot) ? 'FAIL' : 'PASS';
    result.final_result = result.caught && result.restoration === 'PASS'
      && result.cleanup.container === 'PASS' && result.cleanup.temporary_workspace === 'PASS'
      ? 'PASS'
      : 'FAIL';
    if (label === 'M37') {
      process.stdout.write(`caught=${result.caught}\ntarget=${result.target}\nexpected_failure=${result.expected_failure}\nrestoration=${result.restoration}\ncleanup=${result.cleanup.container === 'PASS' && result.cleanup.temporary_workspace === 'PASS' ? 'PASS' : 'FAIL'}\nfinal_result=${result.final_result}\n`);
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }

  if (failure) throw failure;
  if (result.final_result !== 'PASS') throw new Error(`${label} final result was not PASS.`);
}

try {
  for (const scenario of scenarios) executeScenario(scenario);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
