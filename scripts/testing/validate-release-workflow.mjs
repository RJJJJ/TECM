import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const workflowPath = resolve(repositoryRoot, '.github/workflows/release-validation.yml');
const boundaryPath = resolve(repositoryRoot, 'scripts/testing/verify-local-supabase.sh');
const identityPath = resolve(repositoryRoot, 'admin-web/scripts/test-run-identity.mjs');
const fixtureEnvironmentPath = resolve(repositoryRoot, 'scripts/testing/prepare-admin-e2e-env.mjs');
const databaseVerifyPath = resolve(repositoryRoot, 'scripts/testing/database-verify.ps1');
const batch1MutationPath = resolve(repositoryRoot, 'scripts/testing/batch1-release-blockers-mutation-verify.mjs');
const batch1SqlPath = resolve(repositoryRoot, 'supabase/tests/020_batch1_release_blockers.sql');
const workflow = readFileSync(workflowPath, 'utf8');
const boundary = readFileSync(boundaryPath, 'utf8');
const identity = readFileSync(identityPath, 'utf8');
const fixtureEnvironment = readFileSync(fixtureEnvironmentPath, 'utf8');
const databaseVerify = readFileSync(databaseVerifyPath, 'utf8');
const batch1Mutation = readFileSync(batch1MutationPath, 'utf8');
const batch1Sql = readFileSync(batch1SqlPath, 'utf8');
const failures = [];

const protectedTopologyPaths = [
  databaseVerifyPath,
  workflowPath,
  resolve(repositoryRoot, 'supabase/tests/concurrency/batch1_staff_worker.sql'),
  resolve(repositoryRoot, 'supabase/tests/concurrency/batch1_teacher_worker.sql'),
  resolve(repositoryRoot, 'supabase/tests/concurrency/batch1_payment_worker.sql'),
  resolve(repositoryRoot, 'supabase/tests/concurrency/batch1_intake_worker.sql'),
  resolve(repositoryRoot, 'supabase/tests/concurrency/batch1_race_setup.sql'),
  resolve(repositoryRoot, 'supabase/tests/concurrency/batch1_attendance_assert.sql')
];
const protectedTopologySnapshots = new Map(protectedTopologyPaths.map((path) => [path, readFileSync(path)]));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const staffRaceSpecs = [
  {
    name: 'staff-existing',
    firstFile: '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql',
    secondFile: '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql',
    firstVariables: "@('race_name=staff-existing','worker_name=first','user_id=10000000-0000-4000-8000-000000000001','session_id=1d000000-0000-4000-8000-000000000032','target_status=absent','expected_revision=1','reason=staff existing first','request_id=batch1-staff-existing-first')",
    secondVariables: "@('race_name=staff-existing','worker_name=second','user_id=10000000-0000-4000-8000-000000000002','session_id=1d000000-0000-4000-8000-000000000032','target_status=excused','expected_revision=1','reason=staff existing second','request_id=batch1-staff-existing-second')",
    assertionVariables: [
      "-v 'session_id=1d000000-0000-4000-8000-000000000032' -v 'winner_revision=2'",
      "-v 'first_request=batch1-staff-existing-first' -v 'second_request=batch1-staff-existing-second'",
      "-v 'race_name=staff-existing' -v 'refresh_request=batch1-staff-existing-refresh' -v 'credit_delta=2'"
    ],
    assertionFailure: "if ($LASTEXITCODE -ne 0) { throw 'Existing-row staff attendance race assertion failed.' }"
  },
  {
    name: 'staff-absent',
    firstFile: '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql',
    secondFile: '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql',
    firstVariables: "@('race_name=staff-absent','worker_name=first','user_id=10000000-0000-4000-8000-000000000001','session_id=1d000000-0000-4000-8000-000000000031','target_status=absent','expected_revision=','reason=staff absent first','request_id=batch1-staff-absent-first')",
    secondVariables: "@('race_name=staff-absent','worker_name=second','user_id=10000000-0000-4000-8000-000000000002','session_id=1d000000-0000-4000-8000-000000000031','target_status=excused','expected_revision=','reason=staff absent second','request_id=batch1-staff-absent-second')",
    assertionVariables: [
      "-v 'session_id=1d000000-0000-4000-8000-000000000031' -v 'winner_revision=1'",
      "-v 'first_request=batch1-staff-absent-first' -v 'second_request=batch1-staff-absent-second'",
      "-v 'race_name=staff-absent' -v 'refresh_request=batch1-staff-absent-refresh' -v 'credit_delta=1'"
    ],
    assertionFailure: "if ($LASTEXITCODE -ne 0) { throw 'Initially-absent staff attendance race assertion failed.' }"
  },
  {
    name: 'staff-cross-role',
    firstFile: '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql',
    secondFile: '/workspace/supabase/tests/concurrency/batch1_teacher_worker.sql',
    firstVariables: "@('race_name=staff-cross-role','worker_name=first','user_id=10000000-0000-4000-8000-000000000002','session_id=1d000000-0000-4000-8000-000000000033','target_status=absent','expected_revision=1','reason=cross role staff','request_id=batch1-cross-role-staff')",
    secondVariables: "@('race_name=staff-cross-role','worker_name=second','session_id=1d000000-0000-4000-8000-000000000033','target_status=excused','expected_revision=1','reason=cross role teacher','request_id=batch1-cross-role-teacher')",
    assertionVariables: [
      "-v 'session_id=1d000000-0000-4000-8000-000000000033' -v 'winner_revision=2'",
      "-v 'first_request=batch1-cross-role-staff' -v 'second_request=batch1-cross-role-teacher'",
      "-v 'race_name=staff-cross-role' -v 'refresh_request=batch1-cross-role-refresh' -v 'credit_delta=2'"
    ],
    assertionFailure: "if ($LASTEXITCODE -ne 0) { throw 'Cross-role teacher/staff attendance race assertion failed.' }"
  }
];

function normalizeCommand(lines) {
  return lines.map((line) => line.trim().replace(/`$/, '').trim()).join(' ').replace(/\s+/g, ' ').trim();
}

function hasSingleParameter(command, name, exactFragment) {
  const occurrences = command.match(new RegExp(`(?:^|\\s)-${name}(?=\\s|$)`, 'g')) ?? [];
  return occurrences.length === 1 && command.includes(exactFragment);
}

function commandEnd(lines, start) {
  let end = start;
  while (end < lines.length - 1 && lines[end].trimEnd().endsWith('`')) end += 1;
  return end;
}

function nextNonEmpty(lines, start) {
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index].trim() !== '') return index;
  }
  return -1;
}

function powershellBraceDepths(lines) {
  let depth = 0;
  return lines.map((line) => {
    const before = depth;
    let singleQuoted = false;
    let doubleQuoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (singleQuoted) {
        if (character === "'" && line[index + 1] === "'") index += 1;
        else if (character === "'") singleQuoted = false;
        continue;
      }
      if (doubleQuoted) {
        if (character === '`') index += 1;
        else if (character === '"') doubleQuoted = false;
        continue;
      }
      if (character === '#') break;
      if (character === "'") singleQuoted = true;
      else if (character === '"') doubleQuoted = true;
      else if (character === '{') depth += 1;
      else if (character === '}') depth -= 1;
    }
    return before;
  });
}

function findRaceSegment(text, raceName) {
  const lines = text.split(/\r?\n/);
  const barrierLines = lines.flatMap((line, index) => line.includes(`-BarrierRaceName '${raceName}'`) ? [index] : []);
  if (barrierLines.length !== 1) return { lines, barrierLines };
  let invocationStart = barrierLines[0];
  while (invocationStart >= 0 && !/^  Invoke-DatabaseRace\s*`\s*$/.test(lines[invocationStart])) invocationStart -= 1;
  if (invocationStart < 0) return { lines, barrierLines };
  const invocationEnd = commandEnd(lines, invocationStart);
  const assertionStart = nextNonEmpty(lines, invocationEnd + 1);
  if (assertionStart < 0) return { lines, barrierLines, invocationStart, invocationEnd };
  const assertionEnd = commandEnd(lines, assertionStart);
  const failureIndex = nextNonEmpty(lines, assertionEnd + 1);
  return { lines, barrierLines, invocationStart, invocationEnd, assertionStart, assertionEnd, failureIndex };
}

function extractWorkflowJob(text, jobName) {
  const lines = text.split(/\r?\n/);
  const starts = lines.flatMap((line, index) => line === `  ${jobName}:` ? [index] : []);
  if (starts.length !== 1) return null;
  let end = starts[0] + 1;
  while (end < lines.length && !/^  [A-Za-z0-9_-]+:\s*$/.test(lines[end])) end += 1;
  return lines.slice(starts[0], end);
}

function validateWorkflowStep(jobLines, stepName, exactRun, exactShell, code, issues) {
  if (!jobLines) {
    issues.push({ code, message: `Release workflow job for ${stepName} is missing` });
    return;
  }
  const starts = jobLines.flatMap((line, index) => line.trim() === `- name: ${stepName}` ? [index] : []);
  if (starts.length !== 1) {
    issues.push({ code, message: `Release workflow step ${stepName} must appear exactly once` });
    return;
  }
  let end = starts[0] + 1;
  while (end < jobLines.length && !/^      - /.test(jobLines[end])) end += 1;
  const step = jobLines.slice(starts[0], end);
  if (step.some((line) => /^\s+(?:if|continue-on-error):/.test(line)) ||
      step.filter((line) => line === `        run: ${exactRun}`).length !== 1 ||
      (exactShell && step.filter((line) => line === `        shell: ${exactShell}`).length !== 1)) {
    issues.push({ code, message: `Release workflow step ${stepName} must be unconditional and execute ${exactRun}` });
  }
}

function validateBatch1RaceTopology(databaseText, workflowText) {
  const issues = [];
  const add = (condition, code, message) => { if (!condition) issues.push({ code, message }); };
  const lines = databaseText.split(/\r?\n/);
  const braceDepths = powershellBraceDepths(lines);
  const mainTry = lines.findIndex((line) => line === 'try {');
  const mainCatch = lines.findIndex((line) => line === '} catch {');
  add(mainTry >= 0 && mainCatch > mainTry, 'database.main_try', 'Database verifier must retain its top-level try/catch/finally execution path');
  const mainBodyDepth = mainTry >= 0 ? braceDepths[mainTry] + 1 : -1;

  const setupHits = lines.flatMap((line, index) => line.includes("-f '/workspace/supabase/tests/concurrency/batch1_race_setup.sql'") ? [index] : []);
  add(setupHits.length === 1, 'setup.command_count', 'Batch 1 race setup must execute exactly once');
  if (setupHits.length === 1) {
    const setupStart = setupHits[0] - 1;
    const setupFailure = nextNonEmpty(lines, setupHits[0] + 1);
    add(/^  docker exec \$containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d \$database `\s*$/.test(lines[setupStart] ?? '') &&
      (lines[setupFailure] ?? '').trim() === "if ($LASTEXITCODE -ne 0) { throw 'Could not prepare Batch 1 race fixtures.' }" &&
      braceDepths[setupStart] === mainBodyDepth && braceDepths[setupFailure] === mainBodyDepth,
    'setup.reachable_failure', 'Batch 1 setup must be an unconditional fail-closed database command');
  }

  const invocationOrder = [];
  for (const spec of staffRaceSpecs) {
    const segment = findRaceSegment(databaseText, spec.name);
    add(segment.barrierLines.length === 1 && Number.isInteger(segment.invocationStart), `race.${spec.name}.invocation_count`, `${spec.name} bounded race invocation must appear exactly once`);
    if (!Number.isInteger(segment.invocationStart)) continue;
    invocationOrder.push(segment.invocationStart);
    add(segment.invocationStart > mainTry && segment.invocationStart < mainCatch && braceDepths[segment.invocationStart] === mainBodyDepth,
      `race.${spec.name}.reachable`, `${spec.name} must execute unconditionally inside the database verifier`);
    const invocation = normalizeCommand(segment.lines.slice(segment.invocationStart, segment.invocationEnd + 1));
    add(hasSingleParameter(invocation, 'FirstFile', `-FirstFile '${spec.firstFile}'`), `race.${spec.name}.first_file`, `${spec.name} first worker is incorrect`);
    add(hasSingleParameter(invocation, 'SecondFile', `-SecondFile '${spec.secondFile}'`), `race.${spec.name}.second_file`, `${spec.name} second worker is incorrect`);
    add(hasSingleParameter(invocation, 'ExpectedExitPairs', "-ExpectedExitPairs @('0,3')") &&
      hasSingleParameter(invocation, 'ReleaseFirstBeforeSecond', '-ReleaseFirstBeforeSecond'),
    `race.${spec.name}.exit_pair`, `${spec.name} must require deterministic 0,3 first-before-second completion`);
    add(hasSingleParameter(invocation, 'StartSecondDelayMilliseconds', '-StartSecondDelayMilliseconds 0'),
      `race.${spec.name}.bounded_start`, `${spec.name} must use the established bounded zero-delay barrier start`);
    add(hasSingleParameter(invocation, 'BarrierRaceName', `-BarrierRaceName '${spec.name}'`), `race.${spec.name}.name`, `${spec.name} exact barrier name is required`);
    add(hasSingleParameter(invocation, 'FirstPsqlVariables', `-FirstPsqlVariables ${spec.firstVariables}`), `race.${spec.name}.first_fixture`, `${spec.name} first worker fixture is incorrect`);
    add(hasSingleParameter(invocation, 'SecondPsqlVariables', `-SecondPsqlVariables ${spec.secondVariables}`), `race.${spec.name}.second_fixture`, `${spec.name} second worker fixture is incorrect`);

    const assertionReachable = Number.isInteger(segment.assertionStart) && /^  docker exec \$containerName psql /.test(segment.lines[segment.assertionStart] ?? '') &&
      braceDepths[segment.assertionStart] === mainBodyDepth && braceDepths[segment.failureIndex] === mainBodyDepth;
    add(assertionReachable, `race.${spec.name}.assertion_reachable`, `${spec.name} assertion must execute immediately after both worker results`);
    if (assertionReachable) {
      const assertion = normalizeCommand(segment.lines.slice(segment.assertionStart, segment.assertionEnd + 1));
      add(hasSingleParameter(assertion, 'f', "-f '/workspace/supabase/tests/concurrency/batch1_attendance_assert.sql'"), `race.${spec.name}.assertion_file`, `${spec.name} must execute batch1_attendance_assert.sql`);
      add((assertion.match(/(?:^|\s)-v(?=\s|$)/g) ?? []).length === 8, `race.${spec.name}.assertion_fixture`, `${spec.name} assertion must use only the approved variables`);
      for (const variables of spec.assertionVariables) {
        add(assertion.includes(variables), `race.${spec.name}.assertion_fixture`, `${spec.name} assertion variables are incorrect`);
      }
      add((segment.lines[segment.failureIndex] ?? '').trim() === spec.assertionFailure,
        `race.${spec.name}.assertion_failure`, `${spec.name} assertion failure must propagate`);
    }
  }
  add(invocationOrder.length === 3 && invocationOrder.every((value, index) => index === 0 || invocationOrder[index - 1] < value),
    'race.order', 'Staff existing, absent, and cross-role races must remain in the approved order');

  const helperStart = databaseText.indexOf('  function Invoke-DatabaseRace {');
  const helperEnd = databaseText.indexOf('  function Set-Batch1OperationBaseline {');
  const helper = helperStart >= 0 && helperEnd > helperStart ? databaseText.slice(helperStart, helperEnd) : '';
  add(/Wait-DatabaseRaceJobs -Jobs \$raceJobs -TimeoutSeconds \$ConcurrencyTimeoutSeconds/.test(helper), 'helper.bounded_wait', 'Race helper must wait for all jobs with the bounded timeout');
  add(/if \(\$readyCount -eq '2'\) \{ \$bothReady = \$true; break \}/.test(helper) && /Race workers did not both reach barrier/.test(helper), 'helper.both_ready', 'Race helper must require both workers at the barrier');
  add(/Could not release first race barrier[\s\S]+?if \(\$ReleaseFirstBeforeSecond\)[\s\S]+?First race worker did not finish[\s\S]+?Could not release second race barrier/.test(helper), 'helper.release_order', 'Race helper must release and observe the first worker before the second');
  add(/\$firstExit[\s\S]+?\$secondExit[\s\S]+?\$actualExitPair[\s\S]+?throw "Unexpected race exit pair: \$actualExitPair"/.test(helper), 'helper.exit_failure_propagation', 'Race helper must require both worker results and throw on a wrong pair');
  add(/finally \{[\s\S]+?Stop-Job[\s\S]+?Remove-Job/.test(helper), 'helper.job_cleanup', 'Race helper must finalize every worker job');
  add(/} catch \{\s*\$verificationError = \$_\s*} finally \{[\s\S]+?dropdb[\s\S]+?docker rm -f \$containerName/.test(databaseText) &&
      /if \(\$verificationError\) \{[\s\S]*throw \$verificationError[\s\S]*}\s*if \(\$cleanupError\) \{ throw \$cleanupError \}/.test(databaseText),
  'database.finalization', 'Database verifier must clean database/container resources and propagate verification or cleanup failure');

  const databaseJob = extractWorkflowJob(workflowText, 'database');
  add(databaseJob && !databaseJob.some((line) => /^    if:/.test(line)), 'workflow.database_job', 'Release database job must remain unconditional');
  validateWorkflowStep(databaseJob, 'Verify migrations, repeatable seed, RLS, and SQL suites', './scripts/testing/database-verify.ps1', 'pwsh', 'workflow.database_verifier_step', issues);
  const safetyJob = extractWorkflowJob(workflowText, 'repository-safety');
  const guardStepStarts = safetyJob?.flatMap((line, index) => line === '      - run: node scripts/testing/validate-release-workflow.mjs' ? [index] : []) ?? [];
  let guardStepAccepted = guardStepStarts.length === 1;
  if (guardStepAccepted) {
    let guardStepEnd = guardStepStarts[0] + 1;
    while (guardStepEnd < safetyJob.length && !/^      - /.test(safetyJob[guardStepEnd])) guardStepEnd += 1;
    const guardStep = safetyJob.slice(guardStepStarts[0], guardStepEnd);
    guardStepAccepted = !guardStep.some((line) => /^\s+(?:if|continue-on-error):/.test(line));
  }
  add(guardStepAccepted, 'workflow.guard_step', 'Release workflow must execute this guard unconditionally');
  return issues;
}

function replaceExactly(text, search, replacement) {
  const matches = text.split(search).length - 1;
  if (matches !== 1) throw new Error(`negative control target matched ${matches} times: ${search}`);
  return text.replace(search, replacement);
}

function mutateRaceSegment(text, raceName, mutator, { includeAssertion = true } = {}) {
  const segment = findRaceSegment(text, raceName);
  if (!Number.isInteger(segment.invocationStart)) throw new Error(`negative control could not locate ${raceName}`);
  const end = includeAssertion ? segment.failureIndex : segment.invocationEnd;
  const original = segment.lines.slice(segment.invocationStart, end + 1).join('\n');
  const mutated = mutator(original);
  segment.lines.splice(segment.invocationStart, end - segment.invocationStart + 1, ...mutated.split('\n'));
  return segment.lines.join('\n');
}

function repositoryTopologyRestored() {
  return [...protectedTopologySnapshots].every(([path, bytes]) => {
    const current = readFileSync(path);
    return current.equals(bytes) && sha256(current) === sha256(bytes);
  });
}

function runTopologyControl(spec) {
  const root = mkdtempSync(resolve(tmpdir(), `tecm-batch1-workflow-${spec.id.toLowerCase()}-`));
  const databaseCopy = resolve(root, 'database-verify.ps1');
  const workflowCopy = resolve(root, 'release-validation.yml');
  const databaseBytes = protectedTopologySnapshots.get(databaseVerifyPath);
  const workflowBytes = protectedTopologySnapshots.get(workflowPath);
  let report;
  try {
    writeFileSync(databaseCopy, databaseBytes);
    writeFileSync(workflowCopy, workflowBytes);
    let fixture = { database: databaseBytes.toString('utf8'), workflow: workflowBytes.toString('utf8') };
    fixture = spec.mutate(fixture);
    writeFileSync(databaseCopy, fixture.database);
    writeFileSync(workflowCopy, fixture.workflow);
    const controlIssues = validateBatch1RaceTopology(readFileSync(databaseCopy, 'utf8'), readFileSync(workflowCopy, 'utf8'));
    report = {
      id: spec.id,
      intended_failure: spec.expectedCode,
      observed_failures: controlIssues.map((issue) => issue.code),
      control_passed: controlIssues.some((issue) => issue.code === spec.expectedCode)
    };
    writeFileSync(databaseCopy, databaseBytes);
    writeFileSync(workflowCopy, workflowBytes);
    report.restoration = sha256(readFileSync(databaseCopy)) === sha256(databaseBytes) && sha256(readFileSync(workflowCopy)) === sha256(workflowBytes) ? 'PASS' : 'FAIL';
  } catch (error) {
    report = { id: spec.id, intended_failure: spec.expectedCode, observed_failures: [], control_passed: false, error: error instanceof Error ? error.message : String(error), restoration: 'FAIL' };
  } finally {
    rmSync(root, { recursive: true, force: true });
    report.cleanup = existsSync(root) ? 'FAIL' : 'PASS';
    report.repository_restoration = repositoryTopologyRestored() ? 'PASS' : 'FAIL';
    report.control_passed = report.control_passed && report.restoration === 'PASS' && report.cleanup === 'PASS' && report.repository_restoration === 'PASS';
  }
  return report;
}

const topologyControlSpecs = [
  ...staffRaceSpecs.map((race) => ({
    id: `CONTROL-MISSING-${race.name.toUpperCase()}`,
    expectedCode: `race.${race.name}.invocation_count`,
    mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, race.name, () => '', { includeAssertion: true }) })
  })),
  {
    id: 'CONTROL-WRONG-STAFF-EXISTING-WORKER', expectedCode: 'race.staff-existing.first_file',
    mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, 'staff-existing', (segment) => replaceExactly(segment, "-FirstFile '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql'", "-FirstFile '/workspace/supabase/tests/concurrency/batch1_teacher_worker.sql'"), { includeAssertion: false }) })
  },
  {
    id: 'CONTROL-WRONG-STAFF-ABSENT-WORKER', expectedCode: 'race.staff-absent.second_file',
    mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, 'staff-absent', (segment) => replaceExactly(segment, "-SecondFile '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql'", "-SecondFile '/workspace/supabase/tests/concurrency/batch1_teacher_worker.sql'"), { includeAssertion: false }) })
  },
  {
    id: 'CONTROL-WRONG-CROSS-ROLE-PAIRING', expectedCode: 'race.staff-cross-role.second_file',
    mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, 'staff-cross-role', (segment) => replaceExactly(segment, "-SecondFile '/workspace/supabase/tests/concurrency/batch1_teacher_worker.sql'", "-SecondFile '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql'"), { includeAssertion: false }) })
  },
  {
    id: 'CONTROL-MISSING-SETUP', expectedCode: 'setup.command_count',
    mutate: (fixture) => ({ ...fixture, database: fixture.database.replace(/  docker exec \$containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d \$database `\r?\n    -f '\/workspace\/supabase\/tests\/concurrency\/batch1_race_setup\.sql'\r?\n  if \(\$LASTEXITCODE -ne 0\) \{ throw 'Could not prepare Batch 1 race fixtures\.' \}\r?\n/, '') })
  },
  {
    id: 'CONTROL-WRONG-EXPECTED-PAIR', expectedCode: 'race.staff-existing.exit_pair',
    mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, 'staff-existing', (segment) => replaceExactly(segment, "-ExpectedExitPairs @('0,3')", "-ExpectedExitPairs @('0,0')"), { includeAssertion: false }) })
  },
  {
    id: 'CONTROL-MISSING-ATTENDANCE-ASSERT', expectedCode: 'race.staff-existing.assertion_file',
    mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, 'staff-existing', (segment) => replaceExactly(segment, 'batch1_attendance_assert.sql', 'batch1_payment_assert.sql')) })
  },
  {
    id: 'CONTROL-DISCONNECTED-ASSERTION', expectedCode: 'race.staff-existing.assertion_reachable',
    mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, 'staff-existing', (segment) => replaceExactly(segment, '  docker exec $containerName psql', '  if ($false) {\n    docker exec $containerName psql') + '\n  }') })
  },
  {
    id: 'CONTROL-RACE-FAILURE-NOT-PROPAGATED', expectedCode: 'helper.exit_failure_propagation',
    mutate: (fixture) => ({ ...fixture, database: replaceExactly(fixture.database, 'throw "Unexpected race exit pair: $actualExitPair"', 'Write-Host "Unexpected race exit pair: $actualExitPair"') })
  },
  {
    id: 'CONTROL-RACE-REMOVED-FROM-RELEASE', expectedCode: 'workflow.database_verifier_step',
    mutate: (fixture) => ({ ...fixture, workflow: replaceExactly(fixture.workflow, '        run: ./scripts/testing/database-verify.ps1', '        run: ./scripts/testing/database-smoke.ps1') })
  }
];

function requireMatch(text, pattern, message) {
  if (!pattern.test(text)) failures.push(message);
}

function rejectMatch(text, pattern, message) {
  if (pattern.test(text)) failures.push(message);
}

requireMatch(workflow, /docker network create[\s\S]*com\.docker\.network\.bridge\.host_binding_ipv4=127\.0\.0\.1/, 'Supabase CI network must bind published ports to loopback');
requireMatch(workflow, /supabase start --network-id "\$TECM_SUPABASE_NETWORK"\s+>\/dev\/null\s+2>&1/, 'Supabase must start on the loopback-bound CI network');
requireMatch(workflow, /supabase db reset --network-id "\$TECM_SUPABASE_NETWORK"\s+>\/dev\/null\s+2>&1/, 'Supabase reset must use the loopback-bound CI network');
requireMatch(workflow, /bash scripts\/testing\/verify-local-supabase\.sh/, 'Supabase loopback boundary check is required');
requireMatch(workflow, /\.\/scripts\/testing\/migration-014-session-timeouts-mutation-verify\.ps1/, 'Migration 014 session-timeout mutation verification is required');
requireMatch(workflow, /name: Verify attendance function ACL M36\/M37\/M38 and lifecycle controls\s+run: node scripts\/testing\/attendance-function-acl-mutation-verify\.mjs/, 'Attendance function ACL M36/M37/M38 and lifecycle controls are required');
requireMatch(workflow, /name: Verify Batch 1 release-blocker mutation resistance\s+run: node scripts\/testing\/batch1-release-blockers-mutation-verify\.mjs/, 'Batch 1 release-blocker mutation verification is required');
requireMatch(workflow, /\.\/scripts\/testing\/database-verify\.ps1/, 'Release validation must execute the database verifier');
requireMatch(workflow, /app_path='\$\{\{ runner\.temp \}\}\/TECM-DerivedData\/Build\/Products\/Debug-iphonesimulator\/TECM\.app'/, 'iOS validation must target the Xcode-built TECM.app');
requireMatch(workflow, /bash scripts\/testing\/test-ios-launch-metadata-harness\.sh TECM\/Info\.plist/, 'Portable iOS launch-metadata harness regression is required');
requireMatch(workflow, /bash scripts\/testing\/validate-ios-launch-metadata\.sh "\$app_path"/, 'Built TECM.app launch metadata validation is required');
requireMatch(workflow, /bash scripts\/testing\/test-ios-launch-metadata-mutation\.sh "\$app_path"/, 'Built TECM.app launch metadata mutation is required');
requireMatch(workflow, /status_json="\$\(supabase status -o json\)"/, 'Supabase status must be captured, not printed');
requireMatch(workflow, /name: Prepare non-echoing Admin E2E fixture environment[\s\S]*node scripts\/testing\/prepare-admin-e2e-env\.mjs/, 'Non-echoing Admin E2E fixture helper is required');
requireMatch(workflow, /TECM_E2E_MASK_DESTINATION="\$mask_file"[\s\S]*while IFS= read -r mask; do[\s\S]*::add-mask::\$mask/, 'Fixture values must be masked before the Playwright step');
requireMatch(workflow, /trap 'rm -f "\$mask_file"' EXIT[\s\S]*rm -f "\$mask_file"/, 'Fixture mask material must be cleaned on success and failure');
rejectMatch(workflow, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, 'Release workflow must not echo literal fixture emails');
rejectMatch(workflow, /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])/i, 'Release workflow must not echo a literal fixture URI');
requireMatch(workflow, /TECM_EXPECTED_GITHUB_RUN_ID:\s*\$\{\{\s*github\.run_id\s*\}\}/, 'Workflow must pass authoritative GitHub run ID metadata');
requireMatch(workflow, /TECM_EXPECTED_GITHUB_RUN_ATTEMPT:\s*\$\{\{\s*github\.run_attempt\s*\}\}/, 'Workflow must pass authoritative GitHub attempt metadata');
requireMatch(workflow, /node admin-web\/scripts\/test-run-identity\.mjs/, 'Workflow must establish and re-check canonical test identity');
rejectMatch(workflow, /node scripts\/test-run-identity\.mjs/, 'Root-level workflow steps must use the repository path to the identity helper');
requireMatch(workflow, /TECM_TEST_RUN_ID/, 'Workflow must use one canonical test identity');
requireMatch(workflow, /TECM_SUPABASE_NETWORK=\"tecm-local-only-\$\{TECM_TEST_RUN_ID\}\"/, 'Supabase namespace must use the canonical test identity');
requireMatch(fixtureEnvironment, /PLAYWRIGHT_RUN_ID:\s*runId/, 'Playwright run ID must use canonical test identity');
requireMatch(fixtureEnvironment, /playwright-results-\$\{runId\}\.json/, 'Playwright result path must use canonical test identity');
rejectMatch(workflow, /PLAYWRIGHT_RUN_ID=\"\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}\"/, 'Raw GitHub variables must not bypass canonical identity validation');
rejectMatch(workflow, /playwright-results-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}/, 'Raw GitHub variables must not construct a stale result path');
rejectMatch(workflow, /^\s*supabase start\s*$/m, 'Unredirected supabase start output is forbidden');
rejectMatch(workflow, /^\s*supabase status(?:\s+[^$].*)?$/m, 'Uncaptured supabase status output is forbidden');
if (workflow.split(/\r?\n/).some((line) =>
  /(?:echo|printf|tee|cat)/.test(line) &&
  /(?:ANON_KEY|SERVICE_ROLE_KEY|status_json)/.test(line) &&
  !/::add-mask::/.test(line)
)) {
  failures.push('Credential/status material must not be printed');
}

requireMatch(boundary, /status_json="\$\(supabase status -o json\)"/, 'Boundary script must capture Supabase status');
requireMatch(boundary, /http:\/\/127\.0\.0\.1:\*\|http:\/\/localhost:\*/, 'Boundary script must require loopback API URL');
requireMatch(boundary, /docker inspect --format/, 'Boundary script must inspect published Docker ports');
requireMatch(boundary, /127\.0\.0\.1\|::1/, 'Boundary script must accept only loopback port bindings');
requireMatch(boundary, /Supabase started.*required local endpoints healthy.*project is local-only/s, 'Boundary script must emit sanitized operational evidence');
requireMatch(identity, /GITHUB_RUN_ID/, 'Identity helper must validate GitHub run ID');
requireMatch(identity, /GITHUB_RUN_ATTEMPT/, 'Identity helper must validate GitHub run attempt');
requireMatch(identity, /TECM_EXPECTED_GITHUB_RUN_ATTEMPT/, 'Identity helper must compare runtime attempt with authoritative metadata');
requireMatch(identity, /local-only/, 'Identity helper must make local identity explicit');
requireMatch(fixtureEnvironment, /LOOPBACK_HOSTS[\s\S]*requireLoopbackUrl/, 'Fixture helper must enforce explicit loopback targets');
requireMatch(fixtureEnvironment, /GITHUB_ENV[\s\S]*TECM_E2E_MASK_DESTINATION/, 'Fixture helper must require environment and mask destinations');
requireMatch(fixtureEnvironment, /writeStatus\('E2E_FIXTURE_ENV_READY'\)/, 'Fixture helper must emit only the allowlisted ready label');
rejectMatch(fixtureEnvironment, /console\.log\(|console\.error\(/, 'Fixture helper must not print environment material');

for (const file of [
  '020_batch1_release_blockers.sql',
  'batch1_payment_worker.sql', 'batch1_payment_assert.sql',
  'batch1_intake_worker.sql', 'batch1_intake_assert.sql'
]) {
  requireMatch(databaseVerify, new RegExp(file.replace('.', '\\.')), `Database verifier must execute ${file}`);
}
for (const race of ['batch1-payment-same', 'batch1-payment-different', 'batch1-intake-same', 'batch1-intake-different']) {
  requireMatch(
    databaseVerify,
    new RegExp(`ExpectedExitPairs @\\('0,0'\\) -ReleaseFirstBeforeSecond[^\\n]+BarrierRaceName '${race}'`),
    `Batch 1 race ${race} must deterministically release the first worker before the second`
  );
  requireMatch(databaseVerify, new RegExp(`Assert-Batch1WorkerResultContract -RaceName '${race}'`), `Batch 1 race ${race} needs a structured result assertion`);
}
requireMatch(databaseVerify, /classification -eq 'idempotency_payload_mismatch'[\s\S]+?sqlstate -eq 'P0001'[\s\S]+?error_identifier -eq 'idempotency_key_payload_mismatch'/, 'Changed-payload races must require the exact safe rejection classification');
requireMatch(databaseVerify, /unexpected_sql_failure[\s\S]+?unique_violation[\s\S]+?accepted a negative control/, 'Database race result parser needs unrelated-error and unique-violation controls');
requireMatch(databaseVerify, /timeout negative control did not fail closed/, 'Database race harness needs an executable timeout control');

requireMatch(batch1Sql, /aclexplode[\s\S]+?has_table_privilege\('anon'[\s\S]+?has_table_privilege\('authenticated'[\s\S]+?has_table_privilege\('service_role'[\s\S]+?has_table_privilege\('postgres'/, 'SQL 020 must execute the full root-table privilege matrix');
requireMatch(batch1Sql, /set role authenticated;[\s\S]+?permission denied for table payments[\s\S]+?permission denied for table student_packages[\s\S]+?permission denied for table payment_allocations/, 'SQL 020 must prove authenticated direct writes fail at the object-privilege boundary');
requireMatch(batch1Sql, /request_fingerprint is null and request_fingerprint_version is null[\s\S]+?sqlerrm <> 'legacy idempotency key conflict'/, 'SQL 020 must prove legacy operation keys remain untrusted and fail closed');

requireMatch(batch1Mutation, /return baseline\.accepted && baselineControl\.control_passed && postControlBaseline\.accepted &&[\s\S]+?targetControls\.every[\s\S]+?lifecycleControls\.every[\s\S]+?results\.every[\s\S]+?restoration === 'PASS'/, 'Batch 1 mutation final result must be derived from the complete baseline, mounted-form control, and every mutation/lifecycle/restoration gate');
requireMatch(batch1Mutation, /--test-reporter=tap[\s\S]+?TAP aggregate counts malformed[\s\S]+?required mutation test did not pass exactly once/, 'Batch 1 mutation baseline must parse complete-file structured counts and require every target-associated test');
requireMatch(batch1Mutation, /CONTROL-MOUNTED-FORM-INDEPENDENT-FAILURE[\s\S]+?broken_baseline[\s\S]+?restored_baseline/, 'Batch 1 mutation verifier must execute the independent mounted-form baseline failure control');
requireMatch(batch1Mutation, /CONTROL-TIMEOUT[\s\S]+?CONTROL-SIGNAL[\s\S]+?CONTROL-UNRELATED-EXIT[\s\S]+?CONTROL-SPAWN-FAILURE[\s\S]+?CONTROL-UNCAUGHT-STATUS-0[\s\S]+?CONTROL-RESTORATION-NOT-COMPENSATING[\s\S]+?CONTROL-UNCAUGHT-COMPLETE-VERIFIER/, 'Batch 1 mutation verifier must execute all lifecycle negative controls');
requireMatch(batch1Mutation, /if \(failed\) process\.exitCode = 1;/, 'Batch 1 mutation verifier must return nonzero when any gate fails');

const topologyIssues = validateBatch1RaceTopology(databaseVerify, workflow);
for (const issue of topologyIssues) failures.push(`[${issue.code}] ${issue.message}`);
const topologyControls = topologyControlSpecs.map(runTopologyControl);
for (const control of topologyControls) {
  if (!control.control_passed) failures.push(`[${control.id}] topology negative control did not fail closed and restore cleanly`);
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    guard: 'release-workflow',
    topology: staffRaceSpecs.map((race) => ({
      race: race.name,
      setup: 'batch1_race_setup.sql',
      workers: [race.firstFile, race.secondFile],
      expected_exit_pair: '0,3',
      readiness: 'both-ready, release-first-before-second, bounded-timeout',
      assertion: 'batch1_attendance_assert.sql after both worker results',
      failure_propagation: 'database verifier throw',
      cleanup: 'race jobs plus database/container finalization'
    })),
    negative_controls: topologyControls,
    protected_hashes: Object.fromEntries([...protectedTopologySnapshots].map(([path, bytes]) => [path.slice(repositoryRoot.length + 1).replaceAll('\\', '/'), sha256(bytes)])),
    restoration: repositoryTopologyRestored() ? 'PASS' : 'FAIL',
    cleanup: topologyControls.every((control) => control.cleanup === 'PASS') ? 'PASS' : 'FAIL',
    final_result: 'PASS'
  }));
}
