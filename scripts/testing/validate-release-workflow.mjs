import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.argv.slice(2).length > 0) {
  console.error('validate-release-workflow does not accept source-path or test-only overrides');
  process.exit(2);
}

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
    assertionVariables: ['session_id=1d000000-0000-4000-8000-000000000032', 'winner_revision=2',
      'first_request=batch1-staff-existing-first', 'second_request=batch1-staff-existing-second',
      'race_name=staff-existing', 'refresh_request=batch1-staff-existing-refresh', 'credit_delta=2'],
    assertionFailure: "if ($LASTEXITCODE -ne 0) { throw 'Existing-row staff attendance race assertion failed.' }"
  },
  {
    name: 'staff-absent',
    firstFile: '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql',
    secondFile: '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql',
    firstVariables: "@('race_name=staff-absent','worker_name=first','user_id=10000000-0000-4000-8000-000000000001','session_id=1d000000-0000-4000-8000-000000000031','target_status=absent','expected_revision=','reason=staff absent first','request_id=batch1-staff-absent-first')",
    secondVariables: "@('race_name=staff-absent','worker_name=second','user_id=10000000-0000-4000-8000-000000000002','session_id=1d000000-0000-4000-8000-000000000031','target_status=excused','expected_revision=','reason=staff absent second','request_id=batch1-staff-absent-second')",
    assertionVariables: ['session_id=1d000000-0000-4000-8000-000000000031', 'winner_revision=1',
      'first_request=batch1-staff-absent-first', 'second_request=batch1-staff-absent-second',
      'race_name=staff-absent', 'refresh_request=batch1-staff-absent-refresh', 'credit_delta=1'],
    assertionFailure: "if ($LASTEXITCODE -ne 0) { throw 'Initially-absent staff attendance race assertion failed.' }"
  },
  {
    name: 'staff-cross-role',
    firstFile: '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql',
    secondFile: '/workspace/supabase/tests/concurrency/batch1_teacher_worker.sql',
    firstVariables: "@('race_name=staff-cross-role','worker_name=first','user_id=10000000-0000-4000-8000-000000000002','session_id=1d000000-0000-4000-8000-000000000033','target_status=absent','expected_revision=1','reason=cross role staff','request_id=batch1-cross-role-staff')",
    secondVariables: "@('race_name=staff-cross-role','worker_name=second','session_id=1d000000-0000-4000-8000-000000000033','target_status=excused','expected_revision=1','reason=cross role teacher','request_id=batch1-cross-role-teacher')",
    assertionVariables: ['session_id=1d000000-0000-4000-8000-000000000033', 'winner_revision=2',
      'first_request=batch1-cross-role-staff', 'second_request=batch1-cross-role-teacher',
      'race_name=staff-cross-role', 'refresh_request=batch1-cross-role-refresh', 'credit_delta=2'],
    assertionFailure: "if ($LASTEXITCODE -ne 0) { throw 'Cross-role teacher/staff attendance race assertion failed.' }"
  }
];

// PowerShell topology is extracted through the real parser below.
const powershellAstExtractor = String.raw`
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$TargetPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)

function Convert-Extent([System.Management.Automation.Language.IScriptExtent]$Extent) {
  if ($null -eq $Extent) { return $null }
  [ordered]@{
    text = $Extent.Text
    start_offset = $Extent.StartOffset
    end_offset = $Extent.EndOffset
    start_line = $Extent.StartLineNumber
    start_column = $Extent.StartColumnNumber
    end_line = $Extent.EndLineNumber
    end_column = $Extent.EndColumnNumber
  }
}

function Get-Ancestors([System.Management.Automation.Language.Ast]$Node) {
  $items = @()
  $current = $Node.Parent
  while ($null -ne $current) {
    $items += [ordered]@{
      type = $current.GetType().Name
      start_offset = $current.Extent.StartOffset
      end_offset = $current.Extent.EndOffset
    }
    $current = $current.Parent
  }
  @($items)
}

function Get-NearestFunction([System.Management.Automation.Language.Ast]$Node) {
  $current = $Node.Parent
  while ($null -ne $current) {
    if ($current -is [System.Management.Automation.Language.FunctionDefinitionAst]) { return $current.Name }
    $current = $current.Parent
  }
  return $null
}

function Test-StaticExpression([System.Management.Automation.Language.Ast]$Node) {
  if ($null -eq $Node) { return $false }
  $dynamic = @($Node.FindAll({
    param($child)
    $child -is [System.Management.Automation.Language.VariableExpressionAst] -or
      $child -is [System.Management.Automation.Language.CommandAst] -or
      $child -is [System.Management.Automation.Language.SubExpressionAst] -or
      $child -is [System.Management.Automation.Language.InvokeMemberExpressionAst] -or
      $child -is [System.Management.Automation.Language.MemberExpressionAst] -or
      $child -is [System.Management.Automation.Language.BinaryExpressionAst] -or
      $child -is [System.Management.Automation.Language.UnaryExpressionAst] -or
      $child -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -or
      $child -is [System.Management.Automation.Language.ScriptBlockExpressionAst] -or
      $child -is [System.Management.Automation.Language.HashtableAst]
  }, $true))
  return $dynamic.Count -eq 0
}

function Convert-Element([System.Management.Automation.Language.CommandElementAst]$Element) {
  $value = $null
  if ($Element -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $value = $Element.Value }
  elseif ($Element -is [System.Management.Automation.Language.ConstantExpressionAst]) { $value = [string]$Element.Value }
  $argument = $null
  if ($Element -is [System.Management.Automation.Language.CommandParameterAst] -and $null -ne $Element.Argument) {
    $argument = [ordered]@{
      type = $Element.Argument.GetType().Name
      text = $Element.Argument.Extent.Text
      value = if ($Element.Argument -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $Element.Argument.Value } else { $null }
      static = Test-StaticExpression $Element.Argument
      extent = Convert-Extent $Element.Argument.Extent
    }
  }
  [ordered]@{
    type = $Element.GetType().Name
    text = $Element.Extent.Text
    value = $value
    static = Test-StaticExpression $Element
    parameter_name = if ($Element -is [System.Management.Automation.Language.CommandParameterAst]) { $Element.ParameterName } else { $null }
    splatted = $Element -is [System.Management.Automation.Language.VariableExpressionAst] -and $Element.Splatted
    argument = $argument
    extent = Convert-Extent $Element.Extent
  }
}

try {
  $tokens = $null
  $parseErrors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile(
    [IO.Path]::GetFullPath($TargetPath), [ref]$tokens, [ref]$parseErrors
  )
  $commands = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true) |
    ForEach-Object {
      [ordered]@{
        command_name = $_.GetCommandName()
        invocation_operator = [string]$_.InvocationOperator
        elements = @($_.CommandElements | ForEach-Object { Convert-Element $_ })
        nearest_function = Get-NearestFunction $_
        ancestors = @(Get-Ancestors $_)
        extent = Convert-Extent $_.Extent
      }
    })
  $functions = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) |
    ForEach-Object {
      $functionAst = $_
      $functionParameters = if ($null -ne $functionAst.Body.ParamBlock) { $functionAst.Body.ParamBlock.Parameters } else { $functionAst.Parameters }
      [ordered]@{
        name = $functionAst.Name
        parameters = @($functionParameters | ForEach-Object { $_.Name.VariablePath.UserPath })
        body_extent = Convert-Extent $functionAst.Body.Extent
        extent = Convert-Extent $functionAst.Extent
      }
    })
  $ifs = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.IfStatementAst] }, $true) |
    ForEach-Object {
      [ordered]@{
        clauses = @($_.Clauses | ForEach-Object {
          [ordered]@{ condition = $_.Item1.Extent.Text; body_extent = Convert-Extent $_.Item2.Extent }
        })
        nearest_function = Get-NearestFunction $_
        ancestors = @(Get-Ancestors $_)
        extent = Convert-Extent $_.Extent
      }
    })
  $throws = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.ThrowStatementAst] }, $true) |
    ForEach-Object {
      [ordered]@{
        nearest_function = Get-NearestFunction $_
        ancestors = @(Get-Ancestors $_)
        extent = Convert-Extent $_.Extent
      }
    })
  $assignments = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] }, $true) |
    ForEach-Object {
      [ordered]@{
        left = $_.Left.Extent.Text
        right = $_.Right.Extent.Text
        nearest_function = Get-NearestFunction $_
        ancestors = @(Get-Ancestors $_)
        extent = Convert-Extent $_.Extent
      }
    })
  $tries = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.TryStatementAst] }, $true) |
    ForEach-Object {
      [ordered]@{
        nearest_function = Get-NearestFunction $_
        body_extent = Convert-Extent $_.Body.Extent
        body_statements = @($_.Body.Statements | ForEach-Object {
          [ordered]@{ type = $_.GetType().Name; extent = Convert-Extent $_.Extent }
        })
        catch_count = $_.CatchClauses.Count
        finally_extent = if ($null -ne $_.Finally) { Convert-Extent $_.Finally.Extent } else { $null }
        finally_statements = if ($null -ne $_.Finally) {
          @($_.Finally.Statements | ForEach-Object {
            [ordered]@{ type = $_.GetType().Name; extent = Convert-Extent $_.Extent }
          })
        } else { @() }
        extent = Convert-Extent $_.Extent
      }
    })
  $payload = [ordered]@{
    schema_version = 1
    source_path = [IO.Path]::GetFullPath($TargetPath)
    runtime = [ordered]@{
      edition = $PSVersionTable.PSEdition
      version = $PSVersionTable.PSVersion.ToString()
      parser_type = [System.Management.Automation.Language.Parser].FullName
    }
    parse_errors = @($parseErrors | ForEach-Object {
      [ordered]@{ message = $_.Message; error_id = $_.ErrorId; extent = Convert-Extent $_.Extent }
    })
    commands = $commands
    functions = $functions
    ifs = $ifs
    throws = $throws
    assignments = $assignments
    tries = $tries
    root_extent = Convert-Extent $ast.Extent
  }
  [Console]::Out.Write(($payload | ConvertTo-Json -Depth 24 -Compress))
} catch {
  [Console]::Error.Write('PowerShell AST extraction failed')
  exit 1
}
`;

function compactProcess(result) {
  return {
    status: Number.isInteger(result?.status) ? result.status : null,
    signal: result?.signal ?? null,
    error_code: result?.error?.code ?? null
  };
}

function parseAstProcessResult(result) {
  if (result?.error || result?.signal || !Number.isInteger(result?.status) || result.status !== 0) {
    throw new Error('PowerShell AST subprocess lifecycle rejected');
  }
  if (String(result.stderr ?? '').trim() !== '') throw new Error('PowerShell AST subprocess emitted non-JSON diagnostics');
  const stdout = String(result.stdout ?? '');
  if (!/^\s*\{[\s\S]*\}\s*$/.test(stdout)) throw new Error('PowerShell AST output contains preamble or is not one JSON object');
  let document;
  try {
    document = JSON.parse(stdout);
  } catch {
    throw new Error('PowerShell AST output is malformed JSON');
  }
  for (const key of ['source_path', 'runtime', 'parse_errors', 'commands', 'functions', 'ifs', 'throws', 'assignments', 'tries', 'root_extent']) {
    if (!(key in document)) throw new Error(`PowerShell AST output is incomplete: ${key}`);
  }
  if (document.schema_version !== 1 || document.runtime?.parser_type !== 'System.Management.Automation.Language.Parser' ||
      !Array.isArray(document.parse_errors) || !Array.isArray(document.commands) || !Array.isArray(document.functions) ||
      !Array.isArray(document.ifs) || !Array.isArray(document.throws) || !Array.isArray(document.assignments) ||
      !Array.isArray(document.tries)) {
    throw new Error('PowerShell AST output schema is invalid');
  }
  return document;
}

function extractPowerShellAst(targetPath) {
  const root = mkdtempSync(resolve(tmpdir(), 'tecm-powershell-ast-'));
  const extractorPath = resolve(root, 'extract.ps1');
  let result;
  try {
    writeFileSync(extractorPath, powershellAstExtractor);
    result = spawnSync('pwsh', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-File', extractorPath, '-TargetPath', resolve(targetPath)
    ], { encoding: 'utf8', timeout: 15_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    const document = parseAstProcessResult(result);
    if (resolve(document.source_path) !== resolve(targetPath)) throw new Error('PowerShell AST source identity mismatch');
    return { document, process: compactProcess(result) };
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (existsSync(root)) throw new Error('PowerShell AST extractor cleanup failed');
  }
}

const normalizeAstText = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const inside = (child, parent) => child?.start_offset >= parent?.start_offset && child?.end_offset <= parent?.end_offset;

function bindCommand(command, contract) {
  const byName = new Map(contract.map((parameter, index) => [parameter.name.toLowerCase(), { ...parameter, index }]));
  const bindings = new Map();
  const errors = [];
  let positionalIndex = 0;
  const elements = command.elements.slice(1);
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    if (element.splatted) {
      errors.push('splatting is not statically verifiable');
      continue;
    }
    if (element.type === 'CommandParameterAst') {
      const parameter = byName.get(String(element.parameter_name).toLowerCase());
      if (!parameter || parameter.name !== element.parameter_name) {
        errors.push(`unknown or non-exact parameter: ${element.parameter_name}`);
        continue;
      }
      if (bindings.has(parameter.name)) {
        errors.push(`duplicate parameter: ${parameter.name}`);
        continue;
      }
      if (parameter.switch) {
        if (element.argument) errors.push(`switch parameter has a value: ${parameter.name}`);
        bindings.set(parameter.name, { kind: 'switch', value: null });
        continue;
      }
      let value = element.argument;
      if (!value) {
        const next = elements[index + 1];
        if (!next || next.type === 'CommandParameterAst' || next.splatted) {
          errors.push(`missing value for parameter: ${parameter.name}`);
          continue;
        }
        value = next;
        index += 1;
      }
      bindings.set(parameter.name, { kind: 'value', value });
      continue;
    }
    while (positionalIndex < contract.length && bindings.has(contract[positionalIndex].name)) positionalIndex += 1;
    if (positionalIndex >= contract.length) {
      errors.push('unused extra positional argument');
      continue;
    }
    const parameter = contract[positionalIndex];
    if (parameter.switch) {
      errors.push(`ambiguous positional switch binding: ${parameter.name}`);
      positionalIndex += 1;
      continue;
    }
    bindings.set(parameter.name, { kind: 'value', value: element, positional: true });
    positionalIndex += 1;
  }
  return { bindings, errors };
}

function staticValueMatches(binding, expected) {
  if (!binding || binding.kind !== 'value' || !binding.value?.static) return false;
  if (binding.value.value !== null && binding.value.value !== undefined) return String(binding.value.value) === String(expected);
  return normalizeAstText(binding.value.text) === normalizeAstText(expected);
}

function commandElementKeys(command) {
  return command.elements.slice(1).map((element) => {
    if (element.type === 'CommandParameterAst') return `parameter:${String(element.parameter_name).toLowerCase()}`;
    if (element.splatted) return 'splat';
    if (element.value !== null && element.value !== undefined) return `value:${element.value}`;
    return `expression:${normalizeAstText(element.text)}`;
  });
}

function exactCommandElements(command, expected) {
  const actual = commandElementKeys(command);
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function hasForbiddenReachabilityAncestor(command) {
  const forbidden = new Set([
    'FunctionDefinitionAst', 'IfStatementAst', 'ForEachStatementAst', 'ForStatementAst',
    'WhileStatementAst', 'DoWhileStatementAst', 'DoUntilStatementAst', 'SwitchStatementAst', 'TrapStatementAst'
  ]);
  return command.ancestors.some((ancestor) => forbidden.has(ancestor.type));
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

const invokeRaceContract = [
  'FirstFile', 'SecondFile', 'ExpectedFirstExit', 'ExpectedSecondExit', 'StartSecondDelayMilliseconds',
  'ReleaseOutboxBarrier', 'BarrierRaceName', 'ExpectedFirstExitCodes', 'ExpectedSecondExitCodes',
  'ExpectedExitPairs', 'FirstPsqlVariables', 'SecondPsqlVariables', 'ReleaseFirstBeforeSecond'
].map((name) => ({ name, switch: name === 'ReleaseOutboxBarrier' || name === 'ReleaseFirstBeforeSecond' }));
const approvedRaceBindings = [
  'FirstFile', 'SecondFile', 'StartSecondDelayMilliseconds', 'BarrierRaceName',
  'ExpectedExitPairs', 'FirstPsqlVariables', 'SecondPsqlVariables', 'ReleaseFirstBeforeSecond'
].sort();

function validateBatch1RaceTopology(databasePath, workflowText) {
  const issues = [];
  const add = (condition, code, message) => { if (!condition) issues.push({ code, message }); };
  let extraction;
  try {
    extraction = extractPowerShellAst(databasePath);
  } catch (error) {
    issues.push({ code: 'powershell.runtime_or_output', message: error instanceof Error ? error.message : String(error) });
    return { issues, evidence: { extraction: 'FAIL' } };
  }
  const ast = extraction.document;
  if (ast.parse_errors.length > 0) {
    issues.push({ code: 'powershell.parse', message: `PowerShell parser reported ${ast.parse_errors.length} error(s)` });
    return { issues, evidence: { runtime: ast.runtime, process: extraction.process, parse_errors: ast.parse_errors } };
  }

  const helperParameters = invokeRaceContract.map((parameter) => parameter.name);
  const helperFunctions = ast.functions.filter((fn) => fn.name === 'Invoke-DatabaseRace');
  add(helperFunctions.length === 1 && helperFunctions[0].parameters.length === helperParameters.length &&
    helperFunctions[0].parameters.every((name, index) => name === helperParameters[index]),
  'helper.contract', 'Invoke-DatabaseRace must retain its exact positional and named parameter contract');
  const waitFunctions = ast.functions.filter((fn) => fn.name === 'Wait-DatabaseRaceJobs');
  add(waitFunctions.length === 1 && ['Jobs', 'TimeoutSeconds'].every((name, index) => waitFunctions[0]?.parameters[index] === name) &&
    waitFunctions[0]?.parameters.length === 2, 'helper.wait_contract', 'Wait-DatabaseRaceJobs must retain its exact contract');

  const mainTryCandidates = ast.tries.filter((entry) => entry.nearest_function === null)
    .sort((left, right) => (right.extent.end_offset - right.extent.start_offset) - (left.extent.end_offset - left.extent.start_offset));
  const mainTry = mainTryCandidates[0];
  add(Boolean(mainTry) && mainTry.catch_count === 1 && Boolean(mainTry.finally_extent),
    'database.main_try', 'Database verifier must retain its top-level try/catch/finally execution path');
  if (!mainTry) return { issues, evidence: { runtime: ast.runtime, process: extraction.process } };

  const directMainCommands = ast.commands.filter((command) => command.nearest_function === null &&
    inside(command.extent, mainTry.body_extent) && !hasForbiddenReachabilityAncestor(command))
    .sort((left, right) => left.extent.start_offset - right.extent.start_offset);
  const statementIndexFor = (extent) => mainTry.body_statements.findIndex((statement) => inside(extent, statement.extent));
  const ifForStatement = (statement) => ast.ifs.find((entry) => entry.nearest_function === null &&
    entry.extent.start_offset === statement?.extent.start_offset && entry.extent.end_offset === statement?.extent.end_offset);
  const throwWithin = (extent, nearestFunction, exactText) => ast.throws.some((entry) =>
    entry.nearest_function === nearestFunction && inside(entry.extent, extent) && normalizeAstText(entry.extent.text) === exactText);

  const setupPath = '/workspace/supabase/tests/concurrency/batch1_race_setup.sql';
  const setupExpected = ['value:exec', 'expression:$containerName', 'value:psql', 'parameter:q',
    'parameter:v', 'value:ON_ERROR_STOP=1', 'parameter:u', 'value:postgres',
    'parameter:d', 'expression:$database', 'parameter:f', `value:${setupPath}`];
  const setupCommands = directMainCommands.filter((command) => command.command_name === 'docker' &&
    command.elements.some((element) => element.value === setupPath));
  add(setupCommands.length === 1 && exactCommandElements(setupCommands[0], setupExpected),
    'setup.command_count', 'Batch 1 race setup must be one exact executable docker command');
  if (setupCommands.length === 1) {
    const setupStatementIndex = statementIndexFor(setupCommands[0].extent);
    const failureStatement = mainTry.body_statements[setupStatementIndex + 1];
    const failureIf = ifForStatement(failureStatement);
    add(setupStatementIndex >= 0 && failureIf?.clauses.length === 1 &&
      normalizeAstText(failureIf.clauses[0].condition) === '$LASTEXITCODE -ne 0' &&
      throwWithin(failureIf.extent, null, "throw 'Could not prepare Batch 1 race fixtures.'"),
    'setup.reachable_failure', 'Batch 1 setup must be unconditional and immediately fail closed');
  }

  const directInvocations = directMainCommands.filter((command) => command.command_name === 'Invoke-DatabaseRace')
    .map((command) => ({ command, bound: bindCommand(command, invokeRaceContract) }));
  const invocationOrder = [];
  for (const spec of staffRaceSpecs) {
    const matches = directInvocations.filter(({ bound }) => staticValueMatches(bound.bindings.get('BarrierRaceName'), spec.name));
    add(matches.length === 1, `race.${spec.name}.invocation_count`, `${spec.name} executable race invocation must appear exactly once`);
    if (matches.length !== 1) continue;
    const { command, bound } = matches[0];
    invocationOrder.push(command.extent.start_offset);
    const bindingNames = [...bound.bindings.keys()].sort();
    add(bound.errors.length === 0 && bindingNames.length === approvedRaceBindings.length &&
      bindingNames.every((name, index) => name === approvedRaceBindings[index]),
    `race.${spec.name}.arguments`, `${spec.name} must reject unknown, duplicate, ambiguous, extra, dynamic, or splatted protected arguments`);
    add(staticValueMatches(bound.bindings.get('FirstFile'), spec.firstFile),
      `race.${spec.name}.first_file`, `${spec.name} first worker association is incorrect`);
    add(staticValueMatches(bound.bindings.get('SecondFile'), spec.secondFile),
      `race.${spec.name}.second_file`, `${spec.name} second worker association is incorrect`);
    add(staticValueMatches(bound.bindings.get('ExpectedExitPairs'), "@('0,3')") &&
      bound.bindings.get('ReleaseFirstBeforeSecond')?.kind === 'switch',
    `race.${spec.name}.exit_pair`, `${spec.name} must require deterministic 0,3 first-before-second completion`);
    add(staticValueMatches(bound.bindings.get('StartSecondDelayMilliseconds'), '0'),
      `race.${spec.name}.bounded_start`, `${spec.name} must retain the bounded zero-delay barrier start`);
    add(staticValueMatches(bound.bindings.get('FirstPsqlVariables'), spec.firstVariables),
      `race.${spec.name}.first_fixture`, `${spec.name} first worker fixture association is incorrect`);
    add(staticValueMatches(bound.bindings.get('SecondPsqlVariables'), spec.secondVariables),
      `race.${spec.name}.second_fixture`, `${spec.name} second worker fixture association is incorrect`);

    const invocationStatement = statementIndexFor(command.extent);
    const assertionStatement = mainTry.body_statements[invocationStatement + 1];
    const failureStatement = mainTry.body_statements[invocationStatement + 2];
    const assertionCommands = directMainCommands.filter((candidate) => inside(candidate.extent, assertionStatement?.extent));
    const assertion = assertionCommands.length === 1 ? assertionCommands[0] : null;
    const assertionExpected = ['value:exec', 'expression:$containerName', 'value:psql', 'parameter:q',
      'parameter:v', 'value:ON_ERROR_STOP=1'];
    for (const variable of spec.assertionVariables) assertionExpected.push('parameter:v', `value:${variable}`);
    assertionExpected.push('parameter:u', 'value:postgres', 'parameter:d', 'expression:$database',
      'parameter:f', 'value:/workspace/supabase/tests/concurrency/batch1_attendance_assert.sql');
    add(invocationStatement >= 0 && assertion?.command_name === 'docker' && exactCommandElements(assertion, assertionExpected),
      `race.${spec.name}.assertion_reachable`, `${spec.name} exact assertion command must execute immediately after both worker results`);
    if (assertion) {
      add(assertion.elements.some((element) => element.value === '/workspace/supabase/tests/concurrency/batch1_attendance_assert.sql'),
        `race.${spec.name}.assertion_file`, `${spec.name} must execute batch1_attendance_assert.sql`);
      add(exactCommandElements(assertion, assertionExpected),
        `race.${spec.name}.assertion_fixture`, `${spec.name} assertion must use only the approved variables and associations`);
    }
    const failureIf = ifForStatement(failureStatement);
    add(failureIf?.clauses.length === 1 && normalizeAstText(failureIf.clauses[0].condition) === '$LASTEXITCODE -ne 0' &&
      throwWithin(failureIf.extent, null, normalizeAstText(spec.assertionFailure).replace(/^if \([^)]*\) \{ /, '').replace(/ \}$/, '')),
    `race.${spec.name}.assertion_failure`, `${spec.name} assertion failure must immediately propagate`);
  }
  add(invocationOrder.length === 3 && invocationOrder.every((value, index) => index === 0 || invocationOrder[index - 1] < value),
    'race.order', 'Staff existing, absent, and cross-role races must remain in approved executable order');

  const helperCommands = ast.commands.filter((command) => command.nearest_function === 'Invoke-DatabaseRace');
  const waitCommands = helperCommands.filter((command) => command.command_name === 'Wait-DatabaseRaceJobs');
  const waitBinding = waitCommands.length === 1 ? bindCommand(waitCommands[0], [
    { name: 'Jobs', switch: false }, { name: 'TimeoutSeconds', switch: false }
  ]) : null;
  add(waitCommands.length === 1 && waitBinding.errors.length === 0 &&
    normalizeAstText(waitBinding.bindings.get('Jobs')?.value?.text) === '$raceJobs' &&
    normalizeAstText(waitBinding.bindings.get('TimeoutSeconds')?.value?.text) === '$ConcurrencyTimeoutSeconds',
  'helper.bounded_wait', 'Race helper must wait for every worker through the bounded timeout parameter');
  const helperAssignments = ast.assignments.filter((entry) => entry.nearest_function === 'Invoke-DatabaseRace');
  const assignment = (left) => helperAssignments.find((entry) => normalizeAstText(entry.left) === left);
  const firstExit = assignment('$firstExit');
  const secondExit = assignment('$secondExit');
  const actualExitPair = assignment('$actualExitPair');
  const wrongPairThrow = ast.throws.find((entry) => entry.nearest_function === 'Invoke-DatabaseRace' &&
    normalizeAstText(entry.extent.text) === 'throw "Unexpected race exit pair: $actualExitPair"');
  add(Boolean(firstExit && secondExit && actualExitPair && wrongPairThrow) &&
    waitCommands[0].extent.start_offset < firstExit.extent.start_offset &&
    firstExit.extent.start_offset < secondExit.extent.start_offset &&
    secondExit.extent.start_offset < actualExitPair.extent.start_offset &&
    actualExitPair.extent.start_offset < wrongPairThrow.extent.start_offset,
  'helper.exit_failure_propagation', 'Race helper must finalize both results and throw on the wrong exit pair');

  const helperIfs = ast.ifs.filter((entry) => entry.nearest_function === 'Invoke-DatabaseRace');
  const releaseIf = helperIfs.find((entry) => entry.clauses.length === 1 &&
    normalizeAstText(entry.clauses[0].condition) === '$ReleaseFirstBeforeSecond');
  const readyIf = helperIfs.find((entry) => entry.clauses.length === 1 &&
    normalizeAstText(entry.clauses[0].condition) === "$readyCount -eq '2'" &&
    entry.extent.start_offset < (releaseIf?.extent.start_offset ?? Number.MAX_SAFE_INTEGER));
  add(Boolean(readyIf) && throwWithin(helperFunctions[0]?.extent, 'Invoke-DatabaseRace',
    'throw "Race workers did not both reach barrier: $BarrierRaceName"'),
  'helper.both_ready', 'Race helper must prove both workers reached the barrier');
  const releaseCommands = helperCommands.filter((command) => command.command_name === 'docker' &&
    command.elements.some((element) => normalizeAstText(element.text).includes('__test_race_barrier')));
  const firstRelease = releaseCommands.find((command) => command.elements.some((element) =>
    normalizeAstText(element.text).includes("'$BarrierRaceName','first'")));
  const secondRelease = releaseCommands.find((command) => command.elements.some((element) =>
    normalizeAstText(element.text).includes("'$BarrierRaceName','second'")));
  add(Boolean(firstRelease && secondRelease && releaseIf && waitCommands[0]) &&
    firstRelease.extent.start_offset < releaseIf.extent.start_offset &&
    releaseIf.extent.end_offset < secondRelease.extent.start_offset &&
    secondRelease.extent.start_offset < waitCommands[0].extent.start_offset &&
    throwWithin(releaseIf.extent, 'Invoke-DatabaseRace',
      'throw "First race worker did not finish before stale-client release: $BarrierRaceName"'),
  'helper.release_order', 'Race helper must deliberately release and observe the first worker before the second');

  const helperTry = ast.tries.filter((entry) => entry.nearest_function === 'Invoke-DatabaseRace')
    .sort((left, right) => (right.extent.end_offset - right.extent.start_offset) - (left.extent.end_offset - left.extent.start_offset))[0];
  const stopJobs = helperCommands.filter((command) => command.command_name === 'Stop-Job' && inside(command.extent, helperTry?.finally_extent));
  const removeJobs = helperCommands.filter((command) => command.command_name === 'Remove-Job' && inside(command.extent, helperTry?.finally_extent));
  add(Boolean(helperTry?.finally_extent) && stopJobs.length === 1 && removeJobs.length === 1,
    'helper.job_cleanup', 'Race helper must stop and remove all worker jobs from its executable finally block');

  const finalizationCommands = ast.commands.filter((command) => command.nearest_function === null &&
    inside(command.extent, mainTry.finally_extent));
  const hasDropDatabase = finalizationCommands.some((command) => command.command_name === 'docker' &&
    command.elements.some((element) => element.value === 'dropdb'));
  const hasRemoveContainer = finalizationCommands.some((command) => command.command_name === 'docker' &&
    command.elements.some((element) => element.value === 'rm') &&
    command.elements.some((element) => element.parameter_name === 'f') &&
    command.elements.some((element) => normalizeAstText(element.text) === '$containerName'));
  const verificationAssignment = ast.assignments.some((entry) => entry.nearest_function === null &&
    normalizeAstText(entry.left) === '$verificationError' && normalizeAstText(entry.right) === '$_' &&
    inside(entry.extent, mainTry.extent));
  const verificationThrow = ast.throws.some((entry) => entry.nearest_function === null &&
    normalizeAstText(entry.extent.text) === 'throw $verificationError' &&
    entry.extent.start_offset > mainTry.extent.end_offset);
  const cleanupThrow = ast.throws.some((entry) => entry.nearest_function === null &&
    normalizeAstText(entry.extent.text) === 'throw $cleanupError' &&
    entry.extent.start_offset > mainTry.extent.end_offset);
  add(hasDropDatabase && hasRemoveContainer && verificationAssignment && verificationThrow && cleanupThrow,
    'database.finalization', 'Database verifier must clean database/container resources and propagate verification or cleanup failure');

  const databaseJob = extractWorkflowJob(workflowText, 'database');
  add(databaseJob && databaseJob.filter((line) => line === '    runs-on: ubuntu-latest').length === 1 &&
    !databaseJob.some((line) => /^    if:/.test(line)),
  'workflow.database_job', 'Release database job must be unconditional on the PowerShell-equipped Ubuntu runner');
  validateWorkflowStep(databaseJob, 'Verify migrations, repeatable seed, RLS, and SQL suites',
    './scripts/testing/database-verify.ps1', 'pwsh', 'workflow.database_verifier_step', issues);
  const safetyJob = extractWorkflowJob(workflowText, 'repository-safety');
  const guardStepStarts = safetyJob?.flatMap((line, index) =>
    line === '      - run: node scripts/testing/validate-release-workflow.mjs' ? [index] : []) ?? [];
  let guardStepAccepted = guardStepStarts.length === 1;
  if (guardStepAccepted) {
    let guardStepEnd = guardStepStarts[0] + 1;
    while (guardStepEnd < safetyJob.length && !/^      - /.test(safetyJob[guardStepEnd])) guardStepEnd += 1;
    const guardStep = safetyJob.slice(guardStepStarts[0], guardStepEnd);
    guardStepAccepted = !guardStep.some((line) => /^\s+(?:if|continue-on-error):/.test(line));
  }
  add(guardStepAccepted, 'workflow.guard_step', 'Release workflow must execute this guard unconditionally');
  return {
    issues,
    evidence: {
      runtime: ast.runtime,
      process: extraction.process,
      parse_errors: ast.parse_errors.length,
      commands: ast.commands.length,
      functions: ast.functions.length,
      source_path: ast.source_path
    }
  };
}

function replaceExactly(text, search, replacement) {
  const matches = text.split(search).length - 1;
  if (matches !== 1) throw new Error(`negative control target matched ${matches} times: ${search}`);
  return text.replace(search, replacement);
}

function mutateRaceSegment(text, raceName, mutator, { includeAssertion = true } = {}) {
  const barrierOffset = text.indexOf(`-BarrierRaceName '${raceName}'`);
  if (barrierOffset < 0 || barrierOffset !== text.lastIndexOf(`-BarrierRaceName '${raceName}'`)) {
    throw new Error(`negative control could not uniquely locate ${raceName}`);
  }
  const start = text.lastIndexOf('  Invoke-DatabaseRace `', barrierOffset);
  const assertionStart = text.indexOf('  docker exec $containerName psql', barrierOffset);
  const spec = staffRaceSpecs.find((candidate) => candidate.name === raceName);
  const failureStart = text.indexOf(`  ${spec.assertionFailure}`, assertionStart);
  if (start < 0 || assertionStart < 0 || failureStart < 0) throw new Error(`negative control could not bound ${raceName}`);
  const failureEndCandidate = text.indexOf('\n', failureStart);
  const end = includeAssertion ? (failureEndCandidate < 0 ? text.length : failureEndCandidate) : assertionStart;
  const original = text.slice(start, end);
  const mutated = mutator(original);
  return text.slice(0, start) + mutated + text.slice(end);
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
    const validation = validateBatch1RaceTopology(databaseCopy, readFileSync(workflowCopy, 'utf8'));
    const controlIssues = validation.issues;
    report = {
      id: spec.id,
      intended_failure: spec.expectedCode,
      observed_failures: controlIssues.map((issue) => issue.code),
      parser_valid: validation.evidence?.parse_errors === 0,
      control_passed: controlIssues.some((issue) => issue.code === spec.expectedCode) &&
        (spec.allowParseFailure ? controlIssues.some((issue) => issue.code === 'powershell.parse') :
          validation.evidence?.parse_errors === 0 && !controlIssues.some((issue) => issue.code === 'powershell.runtime_or_output'))
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

function replaceAssertionCommandWith(segment, replacement) {
  const start = segment.indexOf('  docker exec $containerName psql');
  const end = segment.indexOf('  if ($LASTEXITCODE -ne 0)', start);
  if (start < 0 || end < 0) throw new Error('negative control could not locate assertion command');
  return segment.slice(0, start) + replacement + segment.slice(end);
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
  },
  {
    id: 'CONTROL-WRONG-WORKER-LINE-COMMENT', expectedCode: 'race.staff-existing.first_file',
    mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, 'staff-existing', (segment) =>
      replaceExactly(
        replaceExactly(segment,
          "-FirstFile '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql'",
          "-FirstFile '/workspace/supabase/tests/concurrency/batch1_teacher_worker.sql'"),
        '  Invoke-DatabaseRace `', "  # -FirstFile '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql'\n  Invoke-DatabaseRace `"
      ), { includeAssertion: false }) })
  },
  {
    id: 'CONTROL-WRONG-WORKER-BLOCK-COMMENT', expectedCode: 'race.staff-absent.second_file',
    mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, 'staff-absent', (segment) =>
      replaceExactly(
        replaceExactly(segment,
          "-SecondFile '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql'",
          "-SecondFile '/workspace/supabase/tests/concurrency/batch1_teacher_worker.sql'"),
        '  Invoke-DatabaseRace `', "  <# -SecondFile '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql' #>\n  Invoke-DatabaseRace `"
      ), { includeAssertion: false }) })
  },
  {
    id: 'CONTROL-WRONG-WORKER-UNUSED-VARIABLE', expectedCode: 'race.staff-cross-role.second_file',
    mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, 'staff-cross-role', (segment) =>
      replaceExactly(
        replaceExactly(segment, '  Invoke-DatabaseRace `', "  $unusedApprovedWorker = '/workspace/supabase/tests/concurrency/batch1_teacher_worker.sql'\n  Invoke-DatabaseRace `"),
        "-SecondFile '/workspace/supabase/tests/concurrency/batch1_teacher_worker.sql'",
        "-SecondFile '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql'"
      ), { includeAssertion: false }) })
  },
  {
    id: 'CONTROL-WRONG-WORKER-UNRELATED-ARRAY-DIAGNOSTIC', expectedCode: 'race.staff-existing.first_file',
    mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, 'staff-existing', (segment) =>
      replaceExactly(
        replaceExactly(segment, '  Invoke-DatabaseRace `',
          "  $unusedApprovedWorkers = @('/workspace/supabase/tests/concurrency/batch1_staff_worker.sql')\n  Write-Host '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql'\n  Invoke-DatabaseRace `"),
        "-FirstFile '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql'",
        "-FirstFile '/workspace/supabase/tests/concurrency/batch1_teacher_worker.sql'"
      ), { includeAssertion: false }) })
  },
  {
    id: 'CONTROL-WRONG-POSITIONAL-WORKER-ORDER', expectedCode: 'race.staff-cross-role.first_file',
    mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, 'staff-cross-role', (segment) =>
      replaceExactly(
        replaceExactly(segment,
          "-FirstFile '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql' `",
          "'/workspace/supabase/tests/concurrency/batch1_teacher_worker.sql' `"),
        "-SecondFile '/workspace/supabase/tests/concurrency/batch1_teacher_worker.sql' `",
        "'/workspace/supabase/tests/concurrency/batch1_staff_worker.sql' `"
      ), { includeAssertion: false }) })
  },
  {
    id: 'CONTROL-CORRECT-TOKENS-WRONG-NAMED-PARAMETERS', expectedCode: 'race.staff-cross-role.first_file',
    mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, 'staff-cross-role', (segment) =>
      replaceExactly(
        replaceExactly(segment,
          "-FirstFile '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql'",
          "-FirstFile '/workspace/supabase/tests/concurrency/batch1_teacher_worker.sql'"),
        "-SecondFile '/workspace/supabase/tests/concurrency/batch1_teacher_worker.sql'",
        "-SecondFile '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql'"
      ), { includeAssertion: false }) })
  },
  {
    id: 'CONTROL-APPROVED-TOKEN-UNUSED-EXTRA-ARGUMENT', expectedCode: 'race.staff-existing.arguments',
    mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, 'staff-existing', (segment) =>
      replaceExactly(segment,
        "-FirstFile '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql' `",
        "-FirstFile '/workspace/supabase/tests/concurrency/batch1_teacher_worker.sql' `\n    '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql' `"
      ), { includeAssertion: false }) })
  },
  {
    id: 'CONTROL-DYNAMIC-PROTECTED-WORKER', expectedCode: 'race.staff-existing.first_file',
    mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, 'staff-existing', (segment) =>
      replaceExactly(segment,
        "-FirstFile '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql'",
        "-FirstFile ('/workspace/supabase/tests/concurrency/batch1_staff_worker.sql' + $workerSuffix)"
      ), { includeAssertion: false }) })
  },
  {
    id: 'CONTROL-UNVERIFIED-SPLATTING', expectedCode: 'race.staff-existing.arguments',
    mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, 'staff-existing', (segment) => {
      let mutated = replaceExactly(segment.replace(/\r\n/g, '\n'), '  Invoke-DatabaseRace `',
        "  $raceArguments = @{ FirstFile = '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql'; SecondFile = '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql' }\n  Invoke-DatabaseRace @raceArguments `");
      mutated = replaceExactly(mutated, "    -FirstFile '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql' `\n", '');
      return replaceExactly(mutated, "    -SecondFile '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql' `\n", '');
    }, { includeAssertion: false }) })
  },
  {
    id: 'CONTROL-ASSERTION-TOKEN-COMMENT-ONLY', expectedCode: 'race.staff-existing.assertion_reachable',
    mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, 'staff-existing', (segment) =>
      replaceAssertionCommandWith(segment, "  # batch1_attendance_assert.sql\n  $unusedAssertion = 'batch1_attendance_assert.sql'\n")) })
  },
  {
    id: 'CONTROL-SETUP-TOKEN-STRING-ONLY', expectedCode: 'setup.command_count',
    mutate: (fixture) => ({ ...fixture, database: fixture.database.replace(
      /  docker exec \$containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d \$database `\r?\n    -f '\/workspace\/supabase\/tests\/concurrency\/batch1_race_setup\.sql'\r?\n  if \(\$LASTEXITCODE -ne 0\) \{ throw 'Could not prepare Batch 1 race fixtures\.' \}\r?\n/,
      "  $unusedSetup = 'batch1_race_setup.sql'\n  Write-Host 'batch1_race_setup.sql'\n"
    ) })
  },
  {
    id: 'CONTROL-FAILURE-PROPAGATION-TEXT-ONLY', expectedCode: 'helper.exit_failure_propagation',
    mutate: (fixture) => ({ ...fixture, database: replaceExactly(fixture.database,
      'throw "Unexpected race exit pair: $actualExitPair"',
      "Write-Host 'throw \"Unexpected race exit pair: $actualExitPair\"'"
    ) })
  },
  {
    id: 'CONTROL-POWERSHELL-PARSE-ERROR', expectedCode: 'powershell.parse', allowParseFailure: true,
    mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, 'staff-existing', (segment) =>
      replaceExactly(segment, '  Invoke-DatabaseRace `', '  if (\n  Invoke-DatabaseRace `'), { includeAssertion: false }) })
  }
];

function runAstBoundaryControls() {
  const validDocument = JSON.stringify({
    schema_version: 1,
    runtime: { parser_type: 'System.Management.Automation.Language.Parser' },
    parse_errors: [], commands: [], functions: [], ifs: [], throws: [], assignments: [], tries: [],
    root_extent: { start_offset: 0, end_offset: 0 }
  });
  const specs = [
    { id: 'CONTROL-AST-TIMEOUT', result: { status: null, signal: null, error: { code: 'ETIMEDOUT' }, stdout: '', stderr: '' } },
    { id: 'CONTROL-AST-SIGNAL', result: { status: null, signal: 'SIGTERM', stdout: '', stderr: '' } },
    { id: 'CONTROL-AST-MISSING-EXIT', result: { status: null, signal: null, stdout: validDocument, stderr: '' } },
    { id: 'CONTROL-AST-PREAMBLE', result: { status: 0, signal: null, stdout: `preamble\n${validDocument}`, stderr: '' } },
    { id: 'CONTROL-AST-MALFORMED-JSON', result: { status: 0, signal: null, stdout: '{malformed}', stderr: '' } },
    { id: 'CONTROL-AST-INCOMPLETE-JSON', result: { status: 0, signal: null, stdout: '{}', stderr: '' } },
    { id: 'CONTROL-AST-STDERR', result: { status: 0, signal: null, stdout: validDocument, stderr: 'unexpected' } }
  ];
  return specs.map((spec) => {
    let rejected = false;
    try {
      parseAstProcessResult(spec.result);
    } catch {
      rejected = true;
    }
    return { id: spec.id, control_passed: rejected };
  });
}

function runSourceOverrideControl() {
  const result = spawnSync(process.execPath, [import.meta.filename, '--database-verify-path=untrusted.ps1'], {
    encoding: 'utf8', timeout: 5_000, windowsHide: true
  });
  return {
    id: 'CONTROL-NO-SOURCE-PATH-OVERRIDE',
    control_passed: result.status === 2 && !result.signal && !result.error &&
      /does not accept source-path or test-only overrides/.test(result.stderr ?? ''),
    process: compactProcess(result)
  };
}

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
requireMatch(batch1Mutation, /counts\.tests !== 7[\s\S]+?runMutationCase[\s\S]+?classification: 'baseline_failure'[\s\S]+?mutation_body_executed: false/, 'Every production mutation lifecycle must require its own exact 7-test pristine baseline and skip the mutation body on failure');
requireMatch(batch1Mutation, /CONTROL-POISONED-LATER-BASELINE-NO-MUTATION[\s\S]+?poisoned_lifecycle[\s\S]+?mutation_marker_absent[\s\S]+?pristine_rerun/, 'Batch 1 mutation verifier must prove a later poisoned baseline prevents the real mutation body and then recovers');
requireMatch(batch1Mutation, /CONTROL-TIMEOUT[\s\S]+?CONTROL-SIGNAL[\s\S]+?CONTROL-UNRELATED-EXIT[\s\S]+?CONTROL-SPAWN-FAILURE[\s\S]+?CONTROL-UNCAUGHT-STATUS-0[\s\S]+?CONTROL-RESTORATION-NOT-COMPENSATING[\s\S]+?CONTROL-UNCAUGHT-COMPLETE-VERIFIER/, 'Batch 1 mutation verifier must execute all lifecycle negative controls');
requireMatch(batch1Mutation, /if \(failed\) process\.exitCode = 1;/, 'Batch 1 mutation verifier must return nonzero when any gate fails');

const topologyValidation = validateBatch1RaceTopology(databaseVerifyPath, workflow);
for (const issue of topologyValidation.issues) failures.push(`[${issue.code}] ${issue.message}`);
const topologyControls = topologyControlSpecs.map(runTopologyControl);
for (const control of topologyControls) {
  if (!control.control_passed) failures.push(
    `[${control.id}] topology negative control failed: observed=${JSON.stringify(control.observed_failures)} error=${control.error ?? 'none'} restoration=${control.restoration} cleanup=${control.cleanup}`
  );
}
const astBoundaryControls = runAstBoundaryControls();
for (const control of astBoundaryControls) {
  if (!control.control_passed) failures.push(`[${control.id}] AST output boundary did not fail closed`);
}
const sourceOverrideControl = runSourceOverrideControl();
if (!sourceOverrideControl.control_passed) failures.push('[CONTROL-NO-SOURCE-PATH-OVERRIDE] normal invocation accepted an override');
const allControlsPassed = topologyControls.every((control) => control.control_passed) &&
  astBoundaryControls.every((control) => control.control_passed) && sourceOverrideControl.control_passed;
const restorationPassed = repositoryTopologyRestored();
const cleanupPassed = topologyControls.every((control) => control.cleanup === 'PASS');
if (!restorationPassed) failures.push('Protected topology files were not restored');
if (!cleanupPassed) failures.push('Topology control cleanup failed');

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
    ast_extraction: topologyValidation.evidence,
    ast_boundary_controls: astBoundaryControls,
    source_override_control: sourceOverrideControl,
    protected_hashes: Object.fromEntries([...protectedTopologySnapshots].map(([path, bytes]) => [path.slice(repositoryRoot.length + 1).replaceAll('\\', '/'), sha256(bytes)])),
    aggregation: allControlsPassed && restorationPassed && cleanupPassed ? 'PASS' : 'FAIL',
    restoration: restorationPassed ? 'PASS' : 'FAIL',
    cleanup: cleanupPassed ? 'PASS' : 'FAIL',
    final_result: allControlsPassed && restorationPassed && cleanupPassed ? 'PASS' : 'FAIL'
  }));
}
