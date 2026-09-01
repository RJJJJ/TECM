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

function Get-EnclosingPipeline([System.Management.Automation.Language.Ast]$Node) {
  $current = $Node.Parent
  while ($null -ne $current) {
    if ($current -is [System.Management.Automation.Language.PipelineAst]) {
      return [ordered]@{
        type = $current.GetType().Name
        extent = Convert-Extent $current.Extent
      }
    }
    $current = $current.Parent
  }
  return $null
}

function Get-NearestFunction([System.Management.Automation.Language.Ast]$Node) {
  $current = $Node.Parent
  while ($null -ne $current) {
    if ($current -is [System.Management.Automation.Language.FunctionDefinitionAst]) { return $current.Name }
    $current = $current.Parent
  }
  return $null
}

function Convert-Condition([System.Management.Automation.Language.Ast]$Condition) {
  $pipelineElements = if ($Condition -is [System.Management.Automation.Language.PipelineAst]) {
    @($Condition.PipelineElements)
  } else { @() }
  $expression = if ($pipelineElements.Count -eq 1 -and
      $pipelineElements[0] -is [System.Management.Automation.Language.CommandExpressionAst]) {
    $pipelineElements[0].Expression
  } else { $null }
  [ordered]@{
    type = $Condition.GetType().Name
    pipeline_element_count = $pipelineElements.Count
    pipeline_element_types = @($pipelineElements | ForEach-Object { $_.GetType().Name })
    expression_type = if ($null -ne $expression) { $expression.GetType().Name } else { $null }
    variable_path = if ($expression -is [System.Management.Automation.Language.VariableExpressionAst]) {
      $expression.VariablePath.UserPath
    } else { $null }
    extent = Convert-Extent $Condition.Extent
  }
}

function Convert-Parameter([System.Management.Automation.Language.ParameterAst]$Parameter) {
  [ordered]@{
    name = $Parameter.Name.VariablePath.UserPath
    static_type = if ($null -ne $Parameter.StaticType) { $Parameter.StaticType.FullName } else { $null }
    attributes = @($Parameter.Attributes | ForEach-Object {
      [ordered]@{
        type = $_.GetType().Name
        type_name = if ($_ -is [System.Management.Automation.Language.TypeConstraintAst] -or
          $_ -is [System.Management.Automation.Language.AttributeAst]) { $_.TypeName.FullName } else { $null }
        positional_arguments = @(if ($_ -is [System.Management.Automation.Language.AttributeAst]) {
          $_.PositionalArguments | ForEach-Object {
            [ordered]@{
              type = $_.GetType().Name
              value = if ($_ -is [System.Management.Automation.Language.StringConstantExpressionAst] -or
                $_ -is [System.Management.Automation.Language.ConstantExpressionAst]) { [string]$_.Value } else { $null }
              static = Test-StaticExpression $_
              extent = Convert-Extent $_.Extent
            }
          }
        })
        extent = Convert-Extent $_.Extent
      }
    })
    default_value = if ($null -ne $Parameter.DefaultValue) {
      [ordered]@{ type = $Parameter.DefaultValue.GetType().Name; extent = Convert-Extent $Parameter.DefaultValue.Extent }
    } else { $null }
    nearest_function = Get-NearestFunction $Parameter
    ancestors = @(Get-Ancestors $Parameter)
    extent = Convert-Extent $Parameter.Extent
  }
}

function Convert-Terminal([System.Management.Automation.Language.Ast]$Node) {
  [ordered]@{
    type = $Node.GetType().Name
    nearest_function = Get-NearestFunction $Node
    parent_type = if ($null -ne $Node.Parent) { $Node.Parent.GetType().Name } else { $null }
    ancestors = @(Get-Ancestors $Node)
    extent = Convert-Extent $Node.Extent
  }
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
        enclosing_pipeline = Get-EnclosingPipeline $_
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
        end_block_extent = if ($null -ne $functionAst.Body.EndBlock) { Convert-Extent $functionAst.Body.EndBlock.Extent } else { $null }
        end_block_statements = @(if ($null -ne $functionAst.Body.EndBlock) {
          $functionAst.Body.EndBlock.Statements | ForEach-Object {
            [ordered]@{ type = $_.GetType().Name; extent = Convert-Extent $_.Extent }
          }
        })
        end_block_traps = @(if ($null -ne $functionAst.Body.EndBlock) {
          $functionAst.Body.EndBlock.Traps | Where-Object { $null -ne $_ } | ForEach-Object {
            [ordered]@{ type = $_.GetType().Name; extent = Convert-Extent $_.Extent }
          }
        })
        ancestors = @(Get-Ancestors $functionAst)
        extent = Convert-Extent $functionAst.Extent
      }
    })
  $ifs = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.IfStatementAst] }, $true) |
    ForEach-Object {
      [ordered]@{
        clauses = @($_.Clauses | ForEach-Object {
          [ordered]@{
            condition = $_.Item1.Extent.Text
            condition_ast = Convert-Condition $_.Item1
            body_extent = Convert-Extent $_.Item2.Extent
            body_statements = @($_.Item2.Statements | ForEach-Object {
              [ordered]@{ type = $_.GetType().Name; extent = Convert-Extent $_.Extent }
            })
            body_traps = @($_.Item2.Traps | Where-Object { $null -ne $_ } | ForEach-Object {
              [ordered]@{ type = $_.GetType().Name; extent = Convert-Extent $_.Extent }
            })
          }
        })
        else_extent = if ($null -ne $_.ElseClause) { Convert-Extent $_.ElseClause.Extent } else { $null }
        else_statements = @(if ($null -ne $_.ElseClause) {
          $_.ElseClause.Statements | ForEach-Object {
            [ordered]@{ type = $_.GetType().Name; extent = Convert-Extent $_.Extent }
          }
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
        parent_type = if ($null -ne $_.Parent) { $_.Parent.GetType().Name } else { $null }
        ancestors = @(Get-Ancestors $_)
        extent = Convert-Extent $_.Extent
      }
    })
  $assignments = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] }, $true) |
    ForEach-Object {
      [ordered]@{
        left = $_.Left.Extent.Text
        right = $_.Right.Extent.Text
        operator = [string]$_.Operator
        left_variables = @($_.Left.FindAll({
          param($child) $child -is [System.Management.Automation.Language.VariableExpressionAst]
        }, $true) | ForEach-Object { $_.VariablePath.UserPath })
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
        finally_statements = @(if ($null -ne $_.Finally) {
          $_.Finally.Statements | ForEach-Object {
            [ordered]@{ type = $_.GetType().Name; extent = Convert-Extent $_.Extent }
          }
        })
        ancestors = @(Get-Ancestors $_)
        extent = Convert-Extent $_.Extent
      }
    })
  $invokeMembers = @($ast.FindAll({
    param($node) $node -is [System.Management.Automation.Language.InvokeMemberExpressionAst]
  }, $true) | ForEach-Object {
    [ordered]@{
      expression = $_.Expression.Extent.Text
      member = $_.Member.Extent.Text
      argument_count = $_.Arguments.Count
      nearest_function = Get-NearestFunction $_
      ancestors = @(Get-Ancestors $_)
      extent = Convert-Extent $_.Extent
    }
  })
  $parameters = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.ParameterAst] }, $true) |
    ForEach-Object { Convert-Parameter $_ })
  $rootParameters = if ($null -ne $ast.ParamBlock) {
    @($ast.ParamBlock.Parameters | ForEach-Object { Convert-Parameter $_ })
  } else { @() }
  $targetVariableReferences = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.VariableExpressionAst] -and
      $node.VariablePath.UserPath -ieq 'TeacherAttendanceContentionOnly'
  }, $true) | ForEach-Object {
    [ordered]@{
      variable_path = $_.VariablePath.UserPath
      splatted = $_.Splatted
      parent_type = if ($null -ne $_.Parent) { $_.Parent.GetType().Name } else { $null }
      nearest_function = Get-NearestFunction $_
      ancestors = @(Get-Ancestors $_)
      extent = Convert-Extent $_.Extent
    }
  })
  $unaryExpressions = @($ast.FindAll({
    param($node) $node -is [System.Management.Automation.Language.UnaryExpressionAst]
  }, $true) | Where-Object {
    @($_.FindAll({
      param($child) $child -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $child.VariablePath.UserPath -ieq 'TeacherAttendanceContentionOnly'
    }, $true)).Count -gt 0
  } | ForEach-Object {
    [ordered]@{
      token_kind = [string]$_.TokenKind
      nearest_function = Get-NearestFunction $_
      ancestors = @(Get-Ancestors $_)
      extent = Convert-Extent $_.Extent
    }
  })
  $foreachVariables = @($ast.FindAll({
    param($node) $node -is [System.Management.Automation.Language.ForEachStatementAst]
  }, $true) | Where-Object {
    $null -ne $_.Variable -and $_.Variable.VariablePath.UserPath -ieq 'TeacherAttendanceContentionOnly'
  } | ForEach-Object {
    [ordered]@{
      variable_path = $_.Variable.VariablePath.UserPath
      nearest_function = Get-NearestFunction $_
      ancestors = @(Get-Ancestors $_)
      extent = Convert-Extent $_.Extent
    }
  })
  $returns = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.ReturnStatementAst] }, $true) |
    ForEach-Object { Convert-Terminal $_ })
  $exits = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.ExitStatementAst] }, $true) |
    ForEach-Object { Convert-Terminal $_ })
  $payload = [ordered]@{
    schema_version = 3
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
    parameters = $parameters
    root_parameters = $rootParameters
    target_variable_references = $targetVariableReferences
    target_unary_expressions = $unaryExpressions
    target_foreach_variables = $foreachVariables
    returns = $returns
    exits = $exits
    invoke_members = $invokeMembers
    root_body_extent = if ($null -ne $ast.EndBlock) { Convert-Extent $ast.EndBlock.Extent } else { $null }
    root_statements = @(if ($null -ne $ast.EndBlock) {
      $ast.EndBlock.Statements | ForEach-Object {
        [ordered]@{ type = $_.GetType().Name; extent = Convert-Extent $_.Extent }
      }
    })
    root_traps = @(if ($null -ne $ast.EndBlock) {
      $ast.EndBlock.Traps | Where-Object { $null -ne $_ } | ForEach-Object {
        [ordered]@{ type = $_.GetType().Name; extent = Convert-Extent $_.Extent }
      }
    })
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

class AstBoundaryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AstBoundaryError';
    this.code = code;
  }
}

function rejectAstBoundary(code, message) {
  throw new AstBoundaryError(code, message);
}

function parseAstProcessResult(result) {
  if (result?.error?.code === 'ETIMEDOUT') rejectAstBoundary('ast.timeout', 'PowerShell AST subprocess timed out');
  if (result?.error) rejectAstBoundary('ast.spawn_error', 'PowerShell AST subprocess failed to spawn');
  if (result?.signal) rejectAstBoundary('ast.signal', 'PowerShell AST subprocess was signalled');
  if (!Number.isInteger(result?.status)) rejectAstBoundary('ast.missing_exit', 'PowerShell AST subprocess has no integer exit status');
  if (result.status !== 0) rejectAstBoundary('ast.nonzero_exit', 'PowerShell AST subprocess returned nonzero');
  if (String(result.stderr ?? '').trim() !== '') rejectAstBoundary('ast.stderr', 'PowerShell AST subprocess emitted non-JSON diagnostics');
  const stdout = String(result.stdout ?? '');
  if (!/^\s*\{[\s\S]*\}\s*$/.test(stdout)) rejectAstBoundary('ast.output_shape', 'PowerShell AST output contains preamble or is not one JSON object');
  let document;
  try {
    document = JSON.parse(stdout);
  } catch {
    rejectAstBoundary('ast.malformed_json', 'PowerShell AST output is malformed JSON');
  }
  for (const key of ['source_path', 'runtime', 'parse_errors', 'commands', 'functions', 'ifs', 'throws', 'assignments',
    'tries', 'parameters', 'root_parameters', 'target_variable_references', 'target_unary_expressions',
    'target_foreach_variables', 'returns', 'exits', 'invoke_members', 'root_body_extent', 'root_statements',
    'root_traps', 'root_extent']) {
    if (!(key in document)) rejectAstBoundary('ast.incomplete_schema', `PowerShell AST output is incomplete: ${key}`);
  }
  if (document.runtime?.parser_type !== 'System.Management.Automation.Language.Parser') {
    rejectAstBoundary('ast.parser_identity', 'PowerShell AST parser identity is invalid');
  }
  if (document.schema_version !== 3 ||
      !Array.isArray(document.parse_errors) || !Array.isArray(document.commands) || !Array.isArray(document.functions) ||
      !Array.isArray(document.ifs) || !Array.isArray(document.throws) || !Array.isArray(document.assignments) ||
      !Array.isArray(document.tries) || !Array.isArray(document.parameters) || !Array.isArray(document.root_parameters) ||
      !Array.isArray(document.target_variable_references) || !Array.isArray(document.target_unary_expressions) ||
      !Array.isArray(document.target_foreach_variables) || !Array.isArray(document.returns) || !Array.isArray(document.exits) ||
      !Array.isArray(document.invoke_members) || !Array.isArray(document.root_statements) ||
      !Array.isArray(document.root_traps) || !document.root_body_extent ||
      document.functions.some((fn) => !Array.isArray(fn?.ancestors) || !Array.isArray(fn?.end_block_statements) ||
        !Array.isArray(fn?.end_block_traps) || !fn?.body_extent || !fn?.end_block_extent || !fn?.extent) ||
      document.tries.some((entry) => !Array.isArray(entry?.ancestors) || !Array.isArray(entry?.body_statements) || !entry?.extent) ||
      document.parameters.some((parameter) => !Array.isArray(parameter?.attributes) || parameter.attributes.some((attribute) =>
        !Array.isArray(attribute?.positional_arguments))) ||
      document.commands.some((command) =>
        !Array.isArray(command?.ancestors) || command?.enclosing_pipeline?.type !== 'PipelineAst' ||
        !command?.enclosing_pipeline?.extent || !command?.extent) || document.ifs.some((entry) =>
        !Array.isArray(entry?.clauses) || !Array.isArray(entry?.else_statements) || entry.clauses.some((clause) =>
          !clause?.condition_ast || !Array.isArray(clause?.body_statements) || !Array.isArray(clause?.body_traps))) ||
      [...document.returns, ...document.exits, ...document.throws].some((entry) =>
        !Array.isArray(entry?.ancestors) || !entry?.extent)) {
    rejectAstBoundary('ast.invalid_schema', 'PowerShell AST output schema is invalid');
  }
  return document;
}

function assertAstSourceIdentity(document, targetPath) {
  if (resolve(document.source_path) !== resolve(targetPath)) {
    rejectAstBoundary('ast.source_identity', 'PowerShell AST source identity mismatch');
  }
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
    assertAstSourceIdentity(document, targetPath);
    return { document, process: compactProcess(result) };
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (existsSync(root)) throw new Error('PowerShell AST extractor cleanup failed');
  }
}

const normalizeAstText = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const inside = (child, parent) => child?.start_offset >= parent?.start_offset && child?.end_offset <= parent?.end_offset;
const sameExtent = (left, right) => left?.start_offset === right?.start_offset && left?.end_offset === right?.end_offset;
const ancestorStep = (type, extent, role) => ({ type, extent, role });

function exactAncestorChain(actual, expected) {
  const normalizedActual = (actual ?? []).map((entry) => ({
    type: entry.type,
    start_offset: entry.start_offset,
    end_offset: entry.end_offset
  }));
  const normalizedExpected = expected.map((entry) => ({
    type: entry.type,
    start_offset: entry.extent?.start_offset,
    end_offset: entry.extent?.end_offset,
    role: entry.role
  }));
  const accepted = normalizedActual.length === normalizedExpected.length && normalizedActual.every((entry, index) =>
    entry.type === normalizedExpected[index].type && entry.start_offset === normalizedExpected[index].start_offset &&
    entry.end_offset === normalizedExpected[index].end_offset);
  return { accepted, actual: normalizedActual, expected: normalizedExpected };
}

function withCompleteThrowAncestry(ownership, expectedAncestors) {
  const ancestry = exactAncestorChain(ownership?.throw_entry?.ancestors, expectedAncestors);
  return {
    ...ownership,
    complete_ancestry_accepted: ownership?.accepted === true && ancestry.accepted,
    ancestry
  };
}

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

function directMainStatementOwnership(command, mainTry) {
  const forbidden = new Set([
    'ScriptBlockExpressionAst', 'ScriptBlockAst', 'TryStatementAst', 'CatchClauseAst',
    'FunctionDefinitionAst', 'IfStatementAst', 'ForEachStatementAst', 'ForStatementAst',
    'WhileStatementAst', 'DoWhileStatementAst', 'DoUntilStatementAst', 'SwitchStatementAst',
    'TrapStatementAst', 'SubExpressionAst', 'ParenExpressionAst', 'ArrayExpressionAst', 'HashtableAst'
  ]);
  const owners = mainTry.body_statements.flatMap((statement, index) =>
    inside(command.extent, statement.extent) ? [{ statement, index }] : []);
  const owner = owners.length === 1 ? owners[0] : null;
  const forbiddenAncestors = command.ancestors.filter((ancestor) =>
    forbidden.has(ancestor.type) && inside(ancestor, mainTry.body_extent));
  const pipelineMatchesDirectStatement = owner?.statement.type === 'PipelineAst' &&
    command.enclosing_pipeline?.type === 'PipelineAst' &&
    sameExtent(command.enclosing_pipeline.extent, owner.statement.extent);
  return {
    accepted: command.nearest_function === null && inside(command.extent, mainTry.body_extent) &&
      owners.length === 1 && pipelineMatchesDirectStatement && forbiddenAncestors.length === 0,
    statement_index: owner?.index ?? -1,
    statement_type: owner?.statement.type ?? null,
    owner_count: owners.length,
    pipeline_type: command.enclosing_pipeline?.type ?? null,
    pipeline_matches_direct_statement: pipelineMatchesDirectStatement,
    forbidden_ancestors: [...new Set(forbiddenAncestors.map((ancestor) => ancestor.type))]
  };
}

function directIfStatementOwnership(entry, mainTry) {
  const owners = mainTry.body_statements.flatMap((statement, index) =>
    statement.type === 'IfStatementAst' && sameExtent(statement.extent, entry?.extent) ? [{ statement, index }] : []);
  return {
    accepted: entry?.nearest_function === null && owners.length === 1,
    statement_index: owners.length === 1 ? owners[0].index : -1,
    owner_count: owners.length
  };
}

function directThrowOwnership(ast, entry, nearestFunction, exactCondition, exactThrow) {
  const clause = entry?.clauses?.length === 1 ? entry.clauses[0] : null;
  const matchingThrows = clause ? ast.throws.filter((candidate) =>
    candidate.nearest_function === nearestFunction && inside(candidate.extent, clause.body_extent) &&
      normalizeAstText(candidate.extent.text) === exactThrow) : [];
  const directThrows = matchingThrows.filter((candidate) => {
    const directStatement = clause.body_statements.filter((statement) =>
      statement.type === 'ThrowStatementAst' && sameExtent(statement.extent, candidate.extent));
    return directStatement.length === 1 && candidate.parent_type === 'StatementBlockAst' &&
      candidate.ancestors[0]?.type === 'StatementBlockAst' && sameExtent(candidate.ancestors[0], clause.body_extent) &&
      candidate.ancestors[1]?.type === 'IfStatementAst' && sameExtent(candidate.ancestors[1], entry.extent);
  });
  const accepted = entry?.nearest_function === nearestFunction && entry?.clauses?.length === 1 &&
    entry.else_extent === null && normalizeAstText(clause?.condition) === exactCondition &&
    clause?.body_traps?.length === 0 && matchingThrows.length === 1 && directThrows.length === 1;
  return {
    accepted,
    condition: normalizeAstText(clause?.condition),
    exact_throw_count: matchingThrows.length,
    direct_throw_count: directThrows.length,
    if_extent: entry?.extent ?? null,
    clause_extent: clause?.body_extent ?? null,
    throw_extent: directThrows[0]?.extent ?? matchingThrows[0]?.extent ?? null,
    throw_entry: directThrows[0] ?? matchingThrows[0] ?? null
  };
}

function findDirectThrowOwnership(ast, nearestFunction, exactCondition, exactThrow) {
  const matchingThrows = ast.throws.filter((candidate) => candidate.nearest_function === nearestFunction &&
    normalizeAstText(candidate.extent.text) === exactThrow);
  const nearestIfExtents = matchingThrows.map((candidate) => candidate.ancestors.find((ancestor) => ancestor.type === 'IfStatementAst'))
    .filter(Boolean);
  const candidates = ast.ifs.filter((entry) => entry.nearest_function === nearestFunction &&
    nearestIfExtents.some((extent) => sameExtent(entry.extent, extent)));
  if (candidates.length !== 1) {
    return { accepted: false, candidate_count: candidates.length, exact_throw_count: matchingThrows.length, direct_throw_count: 0 };
  }
  return { candidate_count: 1, ...directThrowOwnership(ast, candidates[0], nearestFunction, exactCondition, exactThrow) };
}

function exactVariableCondition(clause, variableName) {
  const condition = clause?.condition_ast;
  return condition?.type === 'PipelineAst' && condition.pipeline_element_count === 1 &&
    condition.pipeline_element_types?.length === 1 && condition.pipeline_element_types[0] === 'CommandExpressionAst' &&
    condition.expression_type === 'VariableExpressionAst' && condition.variable_path === variableName &&
    normalizeAstText(condition.extent?.text) === `$${variableName}`;
}

function extractWorkflowJob(text, jobName) {
  const lines = text.split(/\r?\n/);
  const starts = lines.flatMap((line, index) => line === `  ${jobName}:` ? [index] : []);
  if (starts.length !== 1) return null;
  let end = starts[0] + 1;
  while (end < lines.length && !/^  [A-Za-z0-9_-]+:\s*$/.test(lines[end])) end += 1;
  return lines.slice(starts[0], end);
}

function inspectWorkflowStep(jobLines, stepName) {
  if (!jobLines) return { found: false, starts: [], lines: [] };
  const starts = jobLines.flatMap((line, index) => line.trim() === `- name: ${stepName}` ? [index] : []);
  if (starts.length !== 1) return { found: false, starts, lines: [] };
  let end = starts[0] + 1;
  while (end < jobLines.length && !/^      - /.test(jobLines[end])) end += 1;
  return { found: true, starts, lines: jobLines.slice(starts[0], end), start: starts[0], end };
}

function validateWorkflowStep(jobLines, stepName, exactRun, exactShell, code, issues, { suppressRunMismatch = false } = {}) {
  if (!jobLines) {
    issues.push({ code, message: `Release workflow job for ${stepName} is missing` });
    return null;
  }
  const inspected = inspectWorkflowStep(jobLines, stepName);
  if (!inspected.found) {
    issues.push({ code, message: `Release workflow step ${stepName} must appear exactly once` });
    return inspected;
  }
  const step = inspected.lines;
  const runMismatch = step.filter((line) => line === `        run: ${exactRun}`).length !== 1;
  if (step.some((line) => /^\s+(?:if|continue-on-error):/.test(line)) ||
      (!suppressRunMismatch && runMismatch) ||
      (exactShell && step.filter((line) => line === `        shell: ${exactShell}`).length !== 1)) {
    issues.push({ code, message: `Release workflow step ${stepName} must be unconditional and execute ${exactRun}` });
  }
  return { ...inspected, runMismatch };
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
const protectedCommandNames = [
  'docker', 'Invoke-DatabaseRace', 'Wait-DatabaseRaceJobs', 'Start-Job', 'Receive-Job', 'Stop-Job', 'Remove-Job'
];
const protectedCommandNameSet = new Set(protectedCommandNames.map((name) => name.toLowerCase()));

function validateBatch1RaceTopology(databasePath, workflowText) {
  const issues = [];
  const add = (condition, code, message) => { if (!condition) issues.push({ code, message }); };
  const databaseText = readFileSync(databasePath, 'utf8');
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

  const commandName = (command) => String(command.command_name ?? '').toLowerCase();
  const commandText = (command) => normalizeAstText(command.extent?.text).toLowerCase();
  const aliasDefinitions = ast.commands.filter((command) => ['set-alias', 'new-alias'].includes(commandName(command)));
  const aliasImports = ast.commands.filter((command) => commandName(command) === 'import-alias');
  const providerMutations = ast.commands.filter((command) => ['set-item', 'new-item'].includes(commandName(command)));
  const aliasProviderMutations = providerMutations.filter((command) => commandText(command).includes('alias:'));
  const functionProviderMutations = providerMutations.filter((command) => commandText(command).includes('function:'));
  const dynamicProviderMutations = providerMutations.filter((command) =>
    !commandText(command).includes('alias:') && !commandText(command).includes('function:'));
  const invokeExpressions = ast.commands.filter((command) => ['invoke-expression', 'iex'].includes(commandName(command)));
  const scriptBlockCreates = ast.invoke_members.filter((entry) =>
    normalizeAstText(entry.member).toLowerCase() === 'create' &&
    normalizeAstText(entry.expression).toLowerCase().includes('scriptblock'));
  const rootDotSources = ast.commands.filter((command) => command.nearest_function === null && command.invocation_operator === 'Dot');
  const dynamicInvocations = ast.commands.filter((command) => command.command_name === null);
  const protectedSplats = ast.commands.filter((command) => commandName(command) === 'invoke-databaserace' &&
    command.elements.some((element) => element.splatted));
  const protectedFunctionShadows = ast.functions.filter((fn) => {
    const lower = fn.name.toLowerCase();
    if (!protectedCommandNameSet.has(lower)) return false;
    if (lower === 'invoke-databaserace') return helperFunctions.length !== 1;
    if (lower === 'wait-databaseracejobs') return waitFunctions.length !== 1;
    return true;
  });
  add(aliasDefinitions.length === 0, 'command.alias_definition', 'Database verifier must not define aliases');
  add(aliasImports.length === 0, 'command.alias_import', 'Database verifier must not import aliases');
  add(aliasProviderMutations.length === 0, 'command.alias_provider_mutation', 'Database verifier must not mutate the Alias provider');
  add(functionProviderMutations.length === 0, 'command.function_provider_mutation', 'Database verifier must not mutate the Function provider');
  add(dynamicProviderMutations.length === 0, 'command.dynamic_provider_mutation', 'Database verifier must not use dynamic provider mutation');
  add(invokeExpressions.length === 0, 'command.invoke_expression', 'Database verifier must not construct commands through Invoke-Expression');
  add(scriptBlockCreates.length === 0, 'command.scriptblock_create', 'Database verifier must not construct protected commands through ScriptBlock.Create');
  add(rootDotSources.length === 0, 'command.root_dot_source', 'Database verifier must not dot-source at root scope');
  add(dynamicInvocations.length === 0, 'command.dynamic_invocation', 'Database verifier must not use a dynamic command name');
  add(protectedSplats.length === 0, 'command.protected_splat', 'Invoke-DatabaseRace must not be invoked through splatting');
  add(protectedFunctionShadows.length === 0, 'command.protected_function_shadow', 'Protected commands must not be shadowed by source-defined functions');
  const commandResolutionEvidence = {
    protected_commands: protectedCommandNames,
    alias_definition_count: aliasDefinitions.length,
    alias_import_count: aliasImports.length,
    alias_provider_mutation_count: aliasProviderMutations.length,
    function_provider_mutation_count: functionProviderMutations.length,
    dynamic_provider_mutation_count: dynamicProviderMutations.length,
    invoke_expression_count: invokeExpressions.length,
    scriptblock_create_count: scriptBlockCreates.length,
    root_dot_source_count: rootDotSources.length,
    dynamic_invocation_count: dynamicInvocations.length,
    protected_splat_count: protectedSplats.length,
    protected_function_shadow_count: protectedFunctionShadows.length
  };

  const mainTryCandidates = ast.tries.filter((entry) => entry.nearest_function === null)
    .sort((left, right) => (right.extent.end_offset - right.extent.start_offset) - (left.extent.end_offset - left.extent.start_offset));
  const mainTry = mainTryCandidates[0];
  add(Boolean(mainTry) && mainTry.catch_count === 1 && Boolean(mainTry.finally_extent),
    'database.main_try', 'Database verifier must retain its top-level try/catch/finally execution path');
  if (!mainTry) return { issues, evidence: { runtime: ast.runtime, process: extraction.process } };
  const mainTryRootOwners = ast.root_statements.flatMap((statement, index) =>
    statement.type === 'TryStatementAst' && sameExtent(statement.extent, mainTry.extent) ? [{ statement, index }] : []);
  const mainTryRootIndex = mainTryRootOwners.length === 1 ? mainTryRootOwners[0].index : -1;
  const mainTryAncestors = exactAncestorChain(mainTry.ancestors, [
    ancestorStep('NamedBlockAst', ast.root_body_extent, 'root executable body'),
    ancestorStep('ScriptBlockAst', ast.root_extent, 'root script')
  ]);
  add(mainTryRootOwners.length === 1 && mainTryAncestors.accepted && ast.root_traps.length === 0,
    'database.main_try_path', 'Database verifier main try must be one direct root statement with no wrapper or trap');

  const mainBodyCommands = ast.commands.filter((command) => command.nearest_function === null &&
    inside(command.extent, mainTry.body_extent))
    .sort((left, right) => left.extent.start_offset - right.extent.start_offset);
  const ifForStatement = (statement) => ast.ifs.find((entry) => entry.nearest_function === null &&
    entry.extent.start_offset === statement?.extent.start_offset && entry.extent.end_offset === statement?.extent.end_offset);
  const ownershipEvidence = { setup: null, races: [], safety_throws: {} };

  const setupPath = '/workspace/supabase/tests/concurrency/batch1_race_setup.sql';
  const setupExpected = ['value:exec', 'expression:$containerName', 'value:psql', 'parameter:q',
    'parameter:v', 'value:ON_ERROR_STOP=1', 'parameter:u', 'value:postgres',
    'parameter:d', 'expression:$database', 'parameter:f', `value:${setupPath}`];
  const setupCommands = mainBodyCommands.filter((command) => command.command_name === 'docker' &&
    command.elements.some((element) => element.value === setupPath));
  add(setupCommands.length === 1 && exactCommandElements(setupCommands[0], setupExpected),
    'setup.command_count', 'Batch 1 race setup must be one exact executable docker command');
  if (setupCommands.length === 1) {
    const setupOwnership = directMainStatementOwnership(setupCommands[0], mainTry);
    ownershipEvidence.setup = setupOwnership;
    add(setupOwnership.accepted, 'setup.executable_reachability',
      'Batch 1 setup command must directly own one top-level main-try PipelineAst statement');
    const setupStatementIndex = setupOwnership.statement_index;
    const failureStatement = mainTry.body_statements[setupStatementIndex + 1];
    const failureIf = ifForStatement(failureStatement);
    const setupThrow = withCompleteThrowAncestry(
      directThrowOwnership(ast, failureIf, null, '$LASTEXITCODE -ne 0',
        "throw 'Could not prepare Batch 1 race fixtures.'"),
      [
        ancestorStep('StatementBlockAst', failureIf?.clauses?.[0]?.body_extent, 'approved setup failure clause'),
        ancestorStep('IfStatementAst', failureIf?.extent, 'approved setup failure condition'),
        ancestorStep('StatementBlockAst', mainTry.body_extent, 'main try executable body'),
        ancestorStep('TryStatementAst', mainTry.extent, 'authoritative main try'),
        ancestorStep('NamedBlockAst', ast.root_body_extent, 'root executable body'),
        ancestorStep('ScriptBlockAst', ast.root_extent, 'root script')
      ]
    );
    ownershipEvidence.safety_throws.setup = setupThrow;
    add(setupStatementIndex >= 0 && setupThrow.complete_ancestry_accepted,
    'setup.reachable_failure', 'Batch 1 setup must be unconditional and immediately fail closed');
  }

  const directInvocations = mainBodyCommands.filter((command) => command.command_name === 'Invoke-DatabaseRace')
    .map((command) => ({ command, bound: bindCommand(command, invokeRaceContract) }));
  const invocationOrder = [];
  for (const spec of staffRaceSpecs) {
    const matches = directInvocations.filter(({ bound }) => staticValueMatches(bound.bindings.get('BarrierRaceName'), spec.name));
    add(matches.length === 1, `race.${spec.name}.invocation_count`, `${spec.name} executable race invocation must appear exactly once`);
    if (matches.length !== 1) continue;
    const { command, bound } = matches[0];
    invocationOrder.push(command.extent.start_offset);
    const invocationOwnership = directMainStatementOwnership(command, mainTry);
    add(invocationOwnership.accepted, `race.${spec.name}.executable_reachability`,
      `${spec.name} race invocation must directly own one top-level main-try PipelineAst statement`);
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

    const invocationStatement = invocationOwnership.statement_index;
    const assertionStatement = mainTry.body_statements[invocationStatement + 1];
    const failureStatement = mainTry.body_statements[invocationStatement + 2];
    const assertionCommands = mainBodyCommands.filter((candidate) => inside(candidate.extent, assertionStatement?.extent));
    const assertion = assertionCommands.length === 1 ? assertionCommands[0] : null;
    const assertionExpected = ['value:exec', 'expression:$containerName', 'value:psql', 'parameter:q',
      'parameter:v', 'value:ON_ERROR_STOP=1'];
    for (const variable of spec.assertionVariables) assertionExpected.push('parameter:v', `value:${variable}`);
    assertionExpected.push('parameter:u', 'value:postgres', 'parameter:d', 'expression:$database',
      'parameter:f', 'value:/workspace/supabase/tests/concurrency/batch1_attendance_assert.sql');
    add(invocationStatement >= 0 && assertion?.command_name === 'docker' && exactCommandElements(assertion, assertionExpected),
      `race.${spec.name}.assertion_reachable`, `${spec.name} exact assertion command must execute immediately after both worker results`);
    const assertionOwnership = assertion ? directMainStatementOwnership(assertion, mainTry) : null;
    if (assertion) {
      add(assertionOwnership.accepted && assertionOwnership.statement_index === invocationStatement + 1,
        `race.${spec.name}.assertion_executable_reachability`,
        `${spec.name} assertion must directly own the next top-level main-try PipelineAst statement`);
      add(assertion.elements.some((element) => element.value === '/workspace/supabase/tests/concurrency/batch1_attendance_assert.sql'),
        `race.${spec.name}.assertion_file`, `${spec.name} must execute batch1_attendance_assert.sql`);
      add(exactCommandElements(assertion, assertionExpected),
        `race.${spec.name}.assertion_fixture`, `${spec.name} assertion must use only the approved variables and associations`);
    }
    const failureIf = ifForStatement(failureStatement);
    const assertionThrow = withCompleteThrowAncestry(
      directThrowOwnership(ast, failureIf, null, '$LASTEXITCODE -ne 0',
        normalizeAstText(spec.assertionFailure).replace(/^if \([^)]*\) \{ /, '').replace(/ \}$/, '')),
      [
        ancestorStep('StatementBlockAst', failureIf?.clauses?.[0]?.body_extent, `approved ${spec.name} assertion failure clause`),
        ancestorStep('IfStatementAst', failureIf?.extent, `approved ${spec.name} assertion failure condition`),
        ancestorStep('StatementBlockAst', mainTry.body_extent, 'main try executable body'),
        ancestorStep('TryStatementAst', mainTry.extent, 'authoritative main try'),
        ancestorStep('NamedBlockAst', ast.root_body_extent, 'root executable body'),
        ancestorStep('ScriptBlockAst', ast.root_extent, 'root script')
      ]
    );
    ownershipEvidence.safety_throws[`assertion_${spec.name}`] = assertionThrow;
    add(assertionThrow.complete_ancestry_accepted,
    `race.${spec.name}.assertion_failure`, `${spec.name} assertion failure must immediately propagate`);
    ownershipEvidence.races.push({
      race: spec.name,
      invocation: invocationOwnership,
      assertion: assertionOwnership
    });
  }
  add(invocationOrder.length === 3 && invocationOrder.every((value, index) => index === 0 || invocationOrder[index - 1] < value),
    'race.order', 'Staff existing, absent, and cross-role races must remain in approved executable order');

  const helperCommands = ast.commands.filter((command) => command.nearest_function === 'Invoke-DatabaseRace');
  const helperFunction = helperFunctions.length === 1 ? helperFunctions[0] : null;
  const helperTry = ast.tries.filter((entry) => entry.nearest_function === 'Invoke-DatabaseRace')
    .sort((left, right) => (right.extent.end_offset - right.extent.start_offset) - (left.extent.end_offset - left.extent.start_offset))[0];
  const helperTail = [
    ancestorStep('StatementBlockAst', helperTry?.body_extent, 'Invoke-DatabaseRace try body'),
    ancestorStep('TryStatementAst', helperTry?.extent, 'Invoke-DatabaseRace authoritative try'),
    ancestorStep('NamedBlockAst', helperFunction?.end_block_extent, 'Invoke-DatabaseRace executable body'),
    ancestorStep('ScriptBlockAst', helperFunction?.body_extent, 'Invoke-DatabaseRace script block'),
    ancestorStep('FunctionDefinitionAst', helperFunction?.extent, 'authoritative Invoke-DatabaseRace function'),
    ancestorStep('StatementBlockAst', mainTry.body_extent, 'main try executable body'),
    ancestorStep('TryStatementAst', mainTry.extent, 'authoritative main try'),
    ancestorStep('NamedBlockAst', ast.root_body_extent, 'root executable body'),
    ancestorStep('ScriptBlockAst', ast.root_extent, 'root script')
  ];
  const helperFunctionOwners = mainTry.body_statements.filter((statement) =>
    statement.type === 'FunctionDefinitionAst' && sameExtent(statement.extent, helperFunction?.extent));
  add(Boolean(helperFunction && helperTry) && helperFunctionOwners.length === 1 && helperFunction.end_block_traps.length === 0,
    'helper.executable_scope', 'Invoke-DatabaseRace must be one direct function on the main execution path with no trap');
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
  const rawWrongPairThrow = findDirectThrowOwnership(ast, 'Invoke-DatabaseRace',
    '-not $pairAccepted -and -not $individualExitsAccepted', 'throw "Unexpected race exit pair: $actualExitPair"');
  const wrongPairIf = ast.ifs.find((entry) => sameExtent(entry.extent, rawWrongPairThrow.if_extent));
  const wrongPairThrow = withCompleteThrowAncestry(rawWrongPairThrow, [
    ancestorStep('StatementBlockAst', wrongPairIf?.clauses?.[0]?.body_extent, 'unexpected exit-pair failure clause'),
    ancestorStep('IfStatementAst', wrongPairIf?.extent, 'unexpected exit-pair condition'),
    ...helperTail
  ]);
  ownershipEvidence.safety_throws.unexpected_exit_pair = wrongPairThrow;
  add(Boolean(firstExit && secondExit && actualExitPair) && wrongPairThrow.complete_ancestry_accepted &&
    waitCommands[0].extent.start_offset < firstExit.extent.start_offset &&
    firstExit.extent.start_offset < secondExit.extent.start_offset &&
    secondExit.extent.start_offset < actualExitPair.extent.start_offset &&
    actualExitPair.extent.start_offset < wrongPairThrow.throw_extent.start_offset,
  'helper.exit_failure_propagation', 'Race helper must finalize both results and throw on the wrong exit pair');

  const helperIfs = ast.ifs.filter((entry) => entry.nearest_function === 'Invoke-DatabaseRace');
  const releaseIf = helperIfs.find((entry) => entry.clauses.length === 1 &&
    normalizeAstText(entry.clauses[0].condition) === '$ReleaseFirstBeforeSecond');
  const rawReadyThrow = findDirectThrowOwnership(ast, 'Invoke-DatabaseRace', '-not $bothReady',
    'throw "Race workers did not both reach barrier: $BarrierRaceName"');
  const barrierIf = helperIfs.find((entry) => entry.clauses.length === 1 &&
    normalizeAstText(entry.clauses[0].condition) === '$BarrierRaceName' && inside(rawReadyThrow.if_extent, entry.extent));
  const readyIf = helperIfs.find((entry) => sameExtent(entry.extent, rawReadyThrow.if_extent));
  const readyThrow = withCompleteThrowAncestry(rawReadyThrow, [
    ancestorStep('StatementBlockAst', readyIf?.clauses?.[0]?.body_extent, 'both-workers-ready failure clause'),
    ancestorStep('IfStatementAst', readyIf?.extent, 'both-workers-ready condition'),
    ancestorStep('StatementBlockAst', barrierIf?.clauses?.[0]?.body_extent, 'approved barrier branch body'),
    ancestorStep('IfStatementAst', barrierIf?.extent, 'approved barrier branch'),
    ...helperTail
  ]);
  ownershipEvidence.safety_throws.both_workers_ready = readyThrow;
  add(readyThrow.complete_ancestry_accepted && Boolean(barrierIf) &&
    readyThrow.if_extent.start_offset < (releaseIf?.extent.start_offset ?? Number.MAX_SAFE_INTEGER),
  'helper.both_ready', 'Race helper must prove both workers reached the barrier');
  const releaseCommands = helperCommands.filter((command) => command.command_name === 'docker' &&
    command.elements.some((element) => normalizeAstText(element.text).includes('__test_race_barrier')));
  const firstRelease = releaseCommands.find((command) => command.elements.some((element) =>
    normalizeAstText(element.text).includes("'$BarrierRaceName','first'")));
  const secondRelease = releaseCommands.find((command) => command.elements.some((element) =>
    normalizeAstText(element.text).includes("'$BarrierRaceName','second'")));
  const rawReleaseThrow = findDirectThrowOwnership(ast, 'Invoke-DatabaseRace', '-not $firstCompleted',
    'throw "First race worker did not finish before stale-client release: $BarrierRaceName"');
  const releaseFailureIf = helperIfs.find((entry) => sameExtent(entry.extent, rawReleaseThrow.if_extent));
  const releaseThrow = withCompleteThrowAncestry(rawReleaseThrow, [
    ancestorStep('StatementBlockAst', releaseFailureIf?.clauses?.[0]?.body_extent, 'first-before-second failure clause'),
    ancestorStep('IfStatementAst', releaseFailureIf?.extent, 'first-before-second condition'),
    ancestorStep('StatementBlockAst', releaseIf?.clauses?.[0]?.body_extent, 'approved first-before-second branch body'),
    ancestorStep('IfStatementAst', releaseIf?.extent, 'approved first-before-second branch'),
    ancestorStep('StatementBlockAst', barrierIf?.clauses?.[0]?.body_extent, 'approved barrier branch body'),
    ancestorStep('IfStatementAst', barrierIf?.extent, 'approved barrier branch'),
    ...helperTail
  ]);
  ownershipEvidence.safety_throws.first_before_second = releaseThrow;
  add(Boolean(firstRelease && secondRelease && releaseIf && waitCommands[0]) &&
    Boolean(barrierIf) && inside(releaseIf.extent, barrierIf.extent) &&
    firstRelease.extent.start_offset < releaseIf.extent.start_offset &&
    releaseIf.extent.end_offset < secondRelease.extent.start_offset &&
    secondRelease.extent.start_offset < waitCommands[0].extent.start_offset &&
    releaseThrow.complete_ancestry_accepted && inside(releaseThrow.if_extent, releaseIf.extent),
  'helper.release_order', 'Race helper must deliberately release and observe the first worker before the second');

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
  const rawVerificationThrow = findDirectThrowOwnership(ast, null, '$verificationError', 'throw $verificationError');
  const rawCleanupThrow = findDirectThrowOwnership(ast, null, '$cleanupError', 'throw $cleanupError');
  const verificationIf = ast.ifs.find((entry) => sameExtent(entry.extent, rawVerificationThrow.if_extent));
  const cleanupIf = ast.ifs.find((entry) => sameExtent(entry.extent, rawCleanupThrow.if_extent));
  const verificationThrow = withCompleteThrowAncestry(rawVerificationThrow, [
    ancestorStep('StatementBlockAst', verificationIf?.clauses?.[0]?.body_extent, 'verification rethrow clause'),
    ancestorStep('IfStatementAst', verificationIf?.extent, 'verification rethrow condition'),
    ancestorStep('NamedBlockAst', ast.root_body_extent, 'root executable body'),
    ancestorStep('ScriptBlockAst', ast.root_extent, 'root script')
  ]);
  const cleanupThrow = withCompleteThrowAncestry(rawCleanupThrow, [
    ancestorStep('StatementBlockAst', cleanupIf?.clauses?.[0]?.body_extent, 'cleanup rethrow clause'),
    ancestorStep('IfStatementAst', cleanupIf?.extent, 'cleanup rethrow condition'),
    ancestorStep('NamedBlockAst', ast.root_body_extent, 'root executable body'),
    ancestorStep('ScriptBlockAst', ast.root_extent, 'root script')
  ]);
  ownershipEvidence.safety_throws.verification_error = verificationThrow;
  ownershipEvidence.safety_throws.cleanup_error = cleanupThrow;
  add(hasDropDatabase && hasRemoveContainer && verificationAssignment,
    'database.finalization', 'Database verifier must retain database/container cleanup and verification error capture');
  add(verificationThrow.complete_ancestry_accepted && mainTryRootIndex >= 0 &&
    sameExtent(ast.root_statements[mainTryRootIndex + 1]?.extent, verificationIf?.extent),
    'database.verification_rethrow', 'Verification errors must be directly rethrown after cleanup');
  add(cleanupThrow.complete_ancestry_accepted && mainTryRootIndex >= 0 &&
    sameExtent(ast.root_statements[mainTryRootIndex + 2]?.extent, cleanupIf?.extent),
    'database.cleanup_rethrow', 'Cleanup errors must be directly rethrown after verification handling');

  const rootReturns = ast.returns.filter((entry) => entry.nearest_function === null);
  const rootExits = ast.exits.filter((entry) => entry.nearest_function === null);
  const targetParameterName = 'TeacherAttendanceContentionOnly';
  const targetRootParameters = ast.root_parameters.filter((parameter) =>
    parameter.name.toLowerCase() === targetParameterName.toLowerCase());
  const targetParameters = ast.parameters.filter((parameter) =>
    parameter.name.toLowerCase() === targetParameterName.toLowerCase());
  const targetNameTextMentions = databaseText.match(/TeacherAttendanceContentionOnly/gi) ?? [];
  if (rootExits.length > 0) issues.push({ code: 'terminal.unauthorized_exit', message: 'Root execution must not contain ExitStatementAst' });
  if (rootReturns.length > 0) issues.push({ code: 'terminal.unauthorized_return', message: 'Root execution must not contain ReturnStatementAst' });
  if (targetNameTextMentions.length > 0) {
    issues.push({ code: 'terminal.contention_mode_present', message: 'Database verifier must not contain a contention-only mode, alias, activation, or reference' });
  }

  const controlFlowEvidence = {
    complete_verifier: {
      accepted: rootReturns.length === 0 && rootExits.length === 0 && targetNameTextMentions.length === 0,
      root_count: targetRootParameters.length,
      all_parameter_count: targetParameters.length,
      reference_count: ast.target_variable_references.length,
      text_mention_count: targetNameTextMentions.length
    },
    root_exit_count: rootExits.length,
    root_return_count: rootReturns.length
  };

  const databaseJob = extractWorkflowJob(workflowText, 'database');
  const verifierStepName = 'Verify migrations, repeatable seed, RLS, and SQL suites';
  const verifierStepInspection = inspectWorkflowStep(databaseJob, verifierStepName);
  const modeMentions = databaseJob?.filter((line) => /TeacherAttendanceContentionOnly/i.test(line)) ?? [];
  const verifierMentions = databaseJob?.filter((line) => /scripts\/testing\/database-verify\.ps1/i.test(line)) ?? [];
  const expectedDatabaseRuns = [
    'run: bash scripts/testing/verify-ci-checkout.sh',
    'run: ./scripts/testing/database-verify.ps1',
    'run: ./scripts/testing/admin-operations-mutation-verify.ps1',
    'run: ./scripts/testing/migration-014-session-timeouts-mutation-verify.ps1',
    'run: node scripts/testing/attendance-function-acl-mutation-verify.mjs',
    'run: node scripts/testing/batch1-release-blockers-mutation-verify.mjs'
  ];
  const databaseRuns = databaseJob?.filter((line) => /^\s+run:/.test(line)).map((line) => line.trim()) ?? [];
  const databaseRunContract = databaseRuns.length === expectedDatabaseRuns.length &&
    databaseRuns.every((line, index) => line === expectedDatabaseRuns[index]);
  add(databaseJob && databaseJob.filter((line) => line === '    runs-on: ubuntu-latest').length === 1 &&
    !databaseJob.some((line) => /^\s+(?:if|continue-on-error):/.test(line)) && databaseRunContract,
  'workflow.database_job', 'Release database job must be unconditional, wrapper-free, fallback-free, and exact on Ubuntu');
  if (modeMentions.length > 0) {
    issues.push({ code: 'workflow.contention_mode_activation', message: 'Release database job must not activate contention-only mode' });
  }
  const verifierStep = validateWorkflowStep(databaseJob, verifierStepName,
    './scripts/testing/database-verify.ps1', 'pwsh', 'workflow.database_verifier_step', issues);
  if (verifierMentions.length !== 1 &&
      !issues.some((issue) => issue.code === 'workflow.database_verifier_step')) {
    issues.push({ code: 'workflow.database_verifier_step', message: 'Release database job must contain exactly one database verifier invocation' });
  }
  const workflowEvidence = {
    database_job_present: Boolean(databaseJob),
    verifier_step_present: verifierStepInspection.found,
    exact_run_count: verifierStep?.lines?.filter((line) => line === '        run: ./scripts/testing/database-verify.ps1').length ?? 0,
    exact_shell_count: verifierStep?.lines?.filter((line) => line === '        shell: pwsh').length ?? 0,
    verifier_mention_count: verifierMentions.length,
    contention_mode_mention_count: modeMentions.length,
    run_contract_accepted: databaseRunContract,
    run_lines: databaseRuns,
    has_job_condition: databaseJob?.some((line) => /^\s+if:/.test(line)) ?? false,
    has_continue_on_error: databaseJob?.some((line) => /^\s+continue-on-error:/.test(line)) ?? false,
    has_step_condition_or_continue: verifierStep?.lines?.some((line) => /^\s+(?:if|continue-on-error):/.test(line)) ?? false
  };
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
      source_path: ast.source_path,
      command_resolution: commandResolutionEvidence,
      direct_statement_ownership: ownershipEvidence,
      control_flow: controlFlowEvidence,
      workflow_invocation: workflowEvidence
    }
  };
}

let activeMutationProofs = null;

function recordMutationProof(kind, target, matches) {
  if (activeMutationProofs) activeMutationProofs.push({ kind, target: String(target), matches });
}

function replaceExactly(text, search, replacement) {
  const matches = text.split(search).length - 1;
  recordMutationProof('literal', search, matches);
  if (matches !== 1) throw new Error(`negative control target matched ${matches} times: ${search}`);
  return text.replace(search, replacement);
}

function matchPatternExactly(text, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matches = [...text.matchAll(new RegExp(pattern.source, flags))];
  recordMutationProof('pattern', pattern, matches.length);
  if (matches.length !== 1) throw new Error(`negative control target matched ${matches.length} times: ${pattern}`);
  return matches[0];
}

function replacePatternExactly(text, pattern, replacement) {
  const match = matchPatternExactly(text, pattern);
  return text.slice(0, match.index) + replacement + text.slice(match.index + match[0].length);
}

function insertBeforeBatch1Setup(text, insertion) {
  const pathToken = "    -f '/workspace/supabase/tests/concurrency/batch1_race_setup.sql'";
  const pathOffset = text.indexOf(pathToken);
  const pathMatches = text.split(pathToken).length - 1;
  recordMutationProof('batch1-setup', pathToken, pathMatches);
  if (pathOffset < 0 || pathMatches !== 1) {
    throw new Error('negative control could not uniquely locate Batch 1 setup path');
  }
  const commandOffset = text.lastIndexOf('  docker exec $containerName psql', pathOffset);
  if (commandOffset < 0) throw new Error('negative control could not locate Batch 1 setup pipeline');
  return text.slice(0, commandOffset) + insertion + text.slice(commandOffset);
}

function hideThrowInScriptBlock(text, exactThrow) {
  return replaceExactly(text, exactThrow, `$unusedSafetyThrow = { ${exactThrow} }`);
}

function mutateRaceSegment(text, raceName, mutator, { includeAssertion = true } = {}) {
  const barrierOffset = text.indexOf(`-BarrierRaceName '${raceName}'`);
  const barrierToken = `-BarrierRaceName '${raceName}'`;
  const barrierMatches = text.split(barrierToken).length - 1;
  recordMutationProof('race-segment', barrierToken, barrierMatches);
  if (barrierOffset < 0 || barrierMatches !== 1) {
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

function exactCodeSetMatch(expected, observed) {
  if (!Array.isArray(expected) || expected.length === 0 || !Array.isArray(observed) || observed.length === 0) return false;
  const normalizedExpected = [...expected].sort();
  const normalizedObserved = [...observed].sort();
  if (new Set(normalizedExpected).size !== normalizedExpected.length ||
      new Set(normalizedObserved).size !== normalizedObserved.length) return false;
  return normalizedObserved.length === normalizedExpected.length &&
    normalizedObserved.every((code, index) => code === normalizedExpected[index]);
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
    activeMutationProofs = [];
    fixture = spec.mutate(fixture);
    const mutationProofs = activeMutationProofs;
    activeMutationProofs = null;
    if (!Array.isArray(spec.expectedCodes) || spec.expectedCodes.length === 0) {
      throw new Error('negative control must declare a non-empty expectedCodes set');
    }
    const expectedCodes = [...spec.expectedCodes].sort();
    if (new Set(expectedCodes).size !== expectedCodes.length) throw new Error('negative control expectedCodes contains duplicates');
    const databaseChanged = fixture.database !== databaseBytes.toString('utf8');
    const workflowChanged = fixture.workflow !== workflowBytes.toString('utf8');
    const candidateChanged = databaseChanged || workflowChanged;
    const mutationProven = mutationProofs.length > 0 && mutationProofs.every((proof) => proof.matches === 1);
    const tokensRetained = (spec.requiredTokens ?? []).every((token) => fixture.database.includes(token));
    writeFileSync(databaseCopy, fixture.database);
    writeFileSync(workflowCopy, fixture.workflow);
    const validation = validateBatch1RaceTopology(databaseCopy, readFileSync(workflowCopy, 'utf8'));
    const controlIssues = validation.issues;
    const observedCodes = controlIssues.map((issue) => issue.code).sort();
    const exactCodeSet = exactCodeSetMatch(expectedCodes, observedCodes);
    report = {
      id: spec.id,
      expected_failures: expectedCodes,
      observed_failures: observedCodes,
      exact_code_set_match: exactCodeSet,
      parser_valid: validation.evidence?.parse_errors === 0,
      approved_tokens_retained: tokensRetained,
      candidate_changed: candidateChanged,
      mutation_proof: mutationProofs,
      control_passed: exactCodeSet && tokensRetained && candidateChanged && mutationProven &&
        (spec.allowParseFailure ? controlIssues.some((issue) => issue.code === 'powershell.parse') :
          validation.evidence?.parse_errors === 0 && !controlIssues.some((issue) => issue.code === 'powershell.runtime_or_output'))
    };
    writeFileSync(databaseCopy, databaseBytes);
    writeFileSync(workflowCopy, workflowBytes);
    report.restoration = sha256(readFileSync(databaseCopy)) === sha256(databaseBytes) && sha256(readFileSync(workflowCopy)) === sha256(workflowBytes) ? 'PASS' : 'FAIL';
  } catch (error) {
    activeMutationProofs = null;
    report = { id: spec.id, expected_failures: spec.expectedCodes ?? [], observed_failures: [], control_passed: false, error: error instanceof Error ? error.message : String(error), restoration: 'FAIL' };
  } finally {
    rmSync(root, { recursive: true, force: true });
    report.cleanup = existsSync(root) ? 'FAIL' : 'PASS';
    report.repository_restoration = repositoryTopologyRestored() ? 'PASS' : 'FAIL';
    report.control_passed = report.control_passed && report.restoration === 'PASS' && report.cleanup === 'PASS' && report.repository_restoration === 'PASS';
  }
  return report;
}

function replaceAssertionCommandWith(segment, replacement) {
  return mutateAssertionCommand(segment, () => replacement);
}

function mutateAssertionCommand(segment, mutator) {
  const start = segment.indexOf('  docker exec $containerName psql');
  const end = segment.indexOf('  if ($LASTEXITCODE -ne 0)', start);
  if (start < 0 || end < 0) throw new Error('negative control could not locate assertion command');
  return segment.slice(0, start) + mutator(segment.slice(start, end)) + segment.slice(end);
}

const indentPowerShell = (text, spaces = 2) => text.split(/\r?\n/)
  .map((line) => `${' '.repeat(spaces)}${line}`)
  .join('\n');

const staffExistingSpec = staffRaceSpecs[0];
const staffExistingRaceTokens = [
  'Invoke-DatabaseRace',
  `-FirstFile '${staffExistingSpec.firstFile}'`,
  `-SecondFile '${staffExistingSpec.secondFile}'`,
  "-ExpectedExitPairs @('0,3') -ReleaseFirstBeforeSecond",
  '-StartSecondDelayMilliseconds 0',
  "-BarrierRaceName 'staff-existing'",
  `-FirstPsqlVariables ${staffExistingSpec.firstVariables}`,
  `-SecondPsqlVariables ${staffExistingSpec.secondVariables}`
];
const staffExistingAssertionTokens = [
  'docker exec $containerName psql',
  ...staffExistingSpec.assertionVariables.map((variable) => `-v '${variable}'`),
  "-f '/workspace/supabase/tests/concurrency/batch1_attendance_assert.sql'"
];
const setupReachabilityTokens = [
  'docker exec $containerName psql', '-q -v ON_ERROR_STOP=1', '-U postgres -d $database',
  "-f '/workspace/supabase/tests/concurrency/batch1_race_setup.sql'"
];
const mandatoryBatch1Tokens = [
  ...setupReachabilityTokens,
  "throw 'Could not prepare Batch 1 race fixtures.'",
  ...staffRaceSpecs.flatMap((race) => [
    `-FirstFile '${race.firstFile}'`, `-SecondFile '${race.secondFile}'`,
    "-ExpectedExitPairs @('0,3') -ReleaseFirstBeforeSecond", '-StartSecondDelayMilliseconds 0',
    `-BarrierRaceName '${race.name}'`, `-FirstPsqlVariables ${race.firstVariables}`,
    `-SecondPsqlVariables ${race.secondVariables}`,
    ...race.assertionVariables.map((variable) => `-v '${variable}'`)
  ]),
  "-f '/workspace/supabase/tests/concurrency/000_setup.sql'",
  "-f '/workspace/supabase/tests/concurrency/teacher_attendance_contention_setup.sql'",
  "-RaceName 'teacher-attendance-contention-existing'",
  "-RaceName 'teacher-attendance-contention-absent'",
  "-f '/workspace/supabase/tests/concurrency/teacher_attendance_contention_retry_cleanup.sql'"
];

const legacyTopologyControlSpecs = [
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
    mutate: (fixture) => ({ ...fixture, database: replacePatternExactly(fixture.database, /  docker exec \$containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d \$database `\r?\n    -f '\/workspace\/supabase\/tests\/concurrency\/batch1_race_setup\.sql'\r?\n  if \(\$LASTEXITCODE -ne 0\) \{ throw 'Could not prepare Batch 1 race fixtures\.' \}\r?\n/, '') })
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
    id: 'CONTROL-DISCONNECTED-ASSERTION', expectedCode: 'race.staff-existing.assertion_executable_reachability',
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
    mutate: (fixture) => ({ ...fixture, database: replacePatternExactly(fixture.database,
      /  docker exec \$containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d \$database `\r?\n    -f '\/workspace\/supabase\/tests\/concurrency\/batch1_race_setup\.sql'\r?\n  if \(\$LASTEXITCODE -ne 0\) \{ throw 'Could not prepare Batch 1 race fixtures\.' \}\r?\n/,
      "  $unusedSetup = 'batch1_race_setup.sql'\n  Write-Host 'batch1_race_setup.sql'\n"
    ) })
  },
  {
    id: 'CONTROL-STAFF-EXISTING-RACE-UNINVOKED-SCRIPTBLOCK',
    expectedCode: 'race.staff-existing.executable_reachability', exactFailure: true,
    requiredTokens: staffExistingRaceTokens,
    mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, 'staff-existing', (segment) =>
      `  $unusedRace = {\n${indentPowerShell(segment.trimEnd())}\n  }\n`, { includeAssertion: false }) })
  },
  {
    id: 'CONTROL-STAFF-EXISTING-ASSERTION-UNINVOKED-SCRIPTBLOCK',
    expectedCode: 'race.staff-existing.assertion_executable_reachability', exactFailure: true,
    requiredTokens: staffExistingAssertionTokens,
    mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, 'staff-existing', (segment) =>
      mutateAssertionCommand(segment, (command) =>
        `  $unusedAssertion = {\n${indentPowerShell(command.trimEnd())}\n  }\n`)) })
  },
  {
    id: 'CONTROL-STAFF-EXISTING-RACE-UNREACHED-NESTED-CATCH',
    expectedCode: 'race.staff-existing.executable_reachability', exactFailure: true,
    requiredTokens: staffExistingRaceTokens,
    mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, 'staff-existing', (segment) =>
      `  try {\n    Write-Host 'reachability control non-throwing body'\n  } catch {\n${indentPowerShell(segment.trimEnd())}\n  }\n`, { includeAssertion: false }) })
  },
  {
    id: 'CONTROL-SETUP-UNINVOKED-SCRIPTBLOCK',
    expectedCode: 'setup.executable_reachability', exactFailure: true,
    requiredTokens: setupReachabilityTokens,
    mutate: (fixture) => ({ ...fixture, database: replacePatternExactly(fixture.database,
      /  docker exec \$containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d \$database `\r?\n    -f '\/workspace\/supabase\/tests\/concurrency\/batch1_race_setup\.sql'/,
      "  $unusedSetup = {\n    docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `\n      -f '/workspace/supabase/tests/concurrency/batch1_race_setup.sql'\n  }"
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

const terminalControlSpecs = [
  {
    id: 'CONTROL-ROOT-EXIT-BEFORE-BATCH1-SETUP', expectedCode: 'terminal.unauthorized_exit', exactFailure: true,
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: insertBeforeBatch1Setup(fixture.database, '  exit 0\n') })
  },
  {
    id: 'CONTROL-UNCONDITIONAL-RETURN-BEFORE-BATCH1-SETUP', expectedCode: 'terminal.unauthorized_return', exactFailure: true,
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: insertBeforeBatch1Setup(fixture.database, '  return\n') })
  },
  {
    id: 'CONTROL-RETURN-BETWEEN-STAFF-RACES', expectedCode: 'terminal.unauthorized_return', exactFailure: true,
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, 'staff-absent',
      (segment) => `  return\n${segment}`) })
  },
  {
    id: 'CONTROL-RETURN-BEFORE-FINAL-ERROR-PROPAGATION', expectedCode: 'terminal.unauthorized_return', exactFailure: true,
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: replaceExactly(fixture.database,
      "  if ($LASTEXITCODE -ne 0) { throw 'Could not read final verification counts.' }",
      "  if ($LASTEXITCODE -ne 0) { throw 'Could not read final verification counts.' }\n  return") })
  },
  {
    id: 'CONTROL-CONTENTION-SWITCH-REINTRODUCED', expectedCode: 'terminal.contention_mode_present', exactFailure: true,
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: replaceExactly(fixture.database,
      '  [int]$ContentionHardTimeoutSeconds = 10,',
      '  [int]$ContentionHardTimeoutSeconds = 10,\n  [switch]$TeacherAttendanceContentionOnly,') })
  },
  {
    id: 'CONTROL-CONTENTION-SHORT-CIRCUIT-REINTRODUCED', expectedCode: 'terminal.contention_mode_present', exactFailure: false,
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: insertBeforeBatch1Setup(fixture.database,
      "  if ($TeacherAttendanceContentionOnly) {\n    Write-Host '[PASS] bounded existing/absent attendance contention, deliberate retries, and fixture cleanup'\n    return\n  }\n") })
  },
  {
    id: 'CONTROL-CONTENTION-ALIAS-SHADOW-ACTIVATION', expectedCode: 'terminal.contention_mode_present', exactFailure: true,
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: insertBeforeBatch1Setup(fixture.database,
      '  Set-Alias -Name Invoke-ContentionMutation -Value Set-Variable\n  Invoke-ContentionMutation -Name TeacherAttendanceContentionOnly -Value $true\n') })
  },
  {
    id: 'CONTROL-HIDDEN-ENV-SHORT-CIRCUIT', expectedCode: 'terminal.unauthorized_return', exactFailure: true,
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: insertBeforeBatch1Setup(fixture.database,
      '  if ([bool]$env:TECM_TEACHER_ATTENDANCE_CONTENTION_ONLY) { return }\n') })
  },
  {
    id: 'CONTROL-RELEASE-ACTIVATES-CONTENTION-MODE', expectedCode: 'workflow.contention_mode_activation', exactFailure: false,
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, workflow: replaceExactly(fixture.workflow,
      '        run: ./scripts/testing/database-verify.ps1',
      '        run: ./scripts/testing/database-verify.ps1 -TeacherAttendanceContentionOnly') })
  },
  {
    id: 'CONTROL-RELEASE-CONDITIONAL-DATABASE-FALLBACK', expectedCode: 'workflow.database_job', exactFailure: true,
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, workflow: replaceExactly(fixture.workflow,
      '        run: ./scripts/testing/database-verify.ps1',
      '        run: ./scripts/testing/database-verify.ps1\n      - name: Unapproved database fallback\n        if: failure()\n        shell: pwsh\n        run: ./scripts/testing/database-smoke.ps1') })
  }
];

const directThrowControlSpecs = [
  {
    id: 'CONTROL-SETUP-THROW-UNINVOKED-SCRIPTBLOCK', expectedCode: 'setup.reachable_failure', exactFailure: true,
    throwText: "throw 'Could not prepare Batch 1 race fixtures.'"
  },
  {
    id: 'CONTROL-STAFF-EXISTING-THROW-UNINVOKED-SCRIPTBLOCK', expectedCode: 'race.staff-existing.assertion_failure', exactFailure: true,
    throwText: "throw 'Existing-row staff attendance race assertion failed.'"
  },
  {
    id: 'CONTROL-UNEXPECTED-EXIT-THROW-UNINVOKED-SCRIPTBLOCK', expectedCode: 'helper.exit_failure_propagation', exactFailure: true,
    throwText: 'throw "Unexpected race exit pair: $actualExitPair"'
  },
  {
    id: 'CONTROL-BOTH-READY-THROW-UNINVOKED-SCRIPTBLOCK', expectedCode: 'helper.both_ready', exactFailure: true,
    throwText: 'throw "Race workers did not both reach barrier: $BarrierRaceName"'
  },
  {
    id: 'CONTROL-FIRST-BEFORE-SECOND-THROW-UNINVOKED-SCRIPTBLOCK', expectedCode: 'helper.release_order', exactFailure: true,
    throwText: 'throw "First race worker did not finish before stale-client release: $BarrierRaceName"'
  },
  {
    id: 'CONTROL-VERIFICATION-RETHROW-UNINVOKED-SCRIPTBLOCK', expectedCode: 'database.verification_rethrow', exactFailure: true,
    throwText: 'throw $verificationError'
  },
  {
    id: 'CONTROL-CLEANUP-RETHROW-UNINVOKED-SCRIPTBLOCK', expectedCode: 'database.cleanup_rethrow', exactFailure: true,
    throwText: 'throw $cleanupError'
  }
].map((spec) => ({
  ...spec,
  requiredTokens: [...mandatoryBatch1Tokens, spec.throwText],
  mutate: (fixture) => ({ ...fixture, database: hideThrowInScriptBlock(fixture.database, spec.throwText) })
}));

directThrowControlSpecs.push({
  id: 'CONTROL-UNEXPECTED-EXIT-THROW-NESTED-CATCH', expectedCode: 'helper.exit_failure_propagation', exactFailure: true,
  requiredTokens: [...mandatoryBatch1Tokens, 'throw "Unexpected race exit pair: $actualExitPair"'],
  mutate: (fixture) => ({ ...fixture, database: replaceExactly(fixture.database,
    'throw "Unexpected race exit pair: $actualExitPair"',
    'try { Write-Host \'nested throw control\' } catch { throw "Unexpected race exit pair: $actualExitPair" }') })
});

const safetyBoundaryCodes = new Map([
  ['setup', 'setup.reachable_failure'],
  ['assertion_staff-existing', 'race.staff-existing.assertion_failure'],
  ['assertion_staff-absent', 'race.staff-absent.assertion_failure'],
  ['assertion_staff-cross-role', 'race.staff-cross-role.assertion_failure'],
  ['unexpected_exit_pair', 'helper.exit_failure_propagation'],
  ['both_workers_ready', 'helper.both_ready'],
  ['first_before_second', 'helper.release_order'],
  ['verification_error', 'database.verification_rethrow'],
  ['cleanup_error', 'database.cleanup_rethrow']
]);

function wrapSafetyBoundary(fixture, boundary, family) {
  const ownership = topologyValidation.evidence?.direct_statement_ownership?.safety_throws?.[boundary];
  const exactIf = ownership?.if_extent?.text;
  if (!exactIf) throw new Error(`could not locate authoritative safety boundary: ${boundary}`);
  const replacement = family === 'false-wrapper'
    ? `if ($false) {\n${indentPowerShell(exactIf)}\n}`
    : `try {\n${indentPowerShell(exactIf)}\n} catch {\n  Write-Host 'swallowed safety boundary control'\n}`;
  return { ...fixture, database: replaceExactly(fixture.database, exactIf, replacement) };
}

const safetyWrapperControlSpecs = [...safetyBoundaryCodes].flatMap(([boundary, code]) => [
  {
    id: `CONTROL-${boundary.toUpperCase().replaceAll('_', '-')}-FALSE-WRAPPER`,
    expectedCodes: [code],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => wrapSafetyBoundary(fixture, boundary, 'false-wrapper')
  },
  {
    id: `CONTROL-${boundary.toUpperCase().replaceAll('_', '-')}-SWALLOWING-TRY-CATCH`,
    expectedCodes: [code],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => wrapSafetyBoundary(fixture, boundary, 'swallowing-try-catch')
  }
]);

const commandResolutionControlSpecs = [
  ['CONTROL-COMMAND-SET-ALIAS-SHADOW', 'command.alias_definition', "  Set-Alias -Name Invoke-DatabaseRace -Value Write-Host\n"],
  ['CONTROL-COMMAND-INDIRECT-SET-ALIAS', 'command.alias_definition', "  Set-Alias -Name AliasMutator -Value Set-Alias\n  AliasMutator -Name Invoke-DatabaseRace -Value Write-Host\n"],
  ['CONTROL-COMMAND-NEW-ALIAS-SHADOW', 'command.alias_definition', "  New-Alias -Name Invoke-DatabaseRace -Value Write-Host\n"],
  ['CONTROL-COMMAND-IMPORT-ALIAS', 'command.alias_import', "  Import-Alias -Path './aliases.csv'\n"],
  ['CONTROL-COMMAND-SET-ALIAS-PROVIDER', 'command.alias_provider_mutation', "  Set-Item -Path Alias:Invoke-DatabaseRace -Value Write-Host\n"],
  ['CONTROL-COMMAND-NEW-ALIAS-PROVIDER', 'command.alias_provider_mutation', "  New-Item -Path Alias:Invoke-DatabaseRace -Value Write-Host\n"],
  ['CONTROL-COMMAND-SET-FUNCTION-PROVIDER', 'command.function_provider_mutation', "  Set-Item -Path Function:Invoke-DatabaseRace -Value { Write-Host 'shadow' }\n"],
  ['CONTROL-COMMAND-NEW-FUNCTION-PROVIDER', 'command.function_provider_mutation', "  New-Item -Path Function:Invoke-DatabaseRace -Value { Write-Host 'shadow' }\n"],
  ['CONTROL-COMMAND-DYNAMIC-PROVIDER', 'command.dynamic_provider_mutation', "  $providerPath = 'Alias:' + 'Invoke-DatabaseRace'\n  Set-Item -Path $providerPath -Value Write-Host\n"],
  ['CONTROL-COMMAND-INVOKE-EXPRESSION', 'command.invoke_expression', "  Invoke-Expression \"Write-Host 'dynamic command control'\"\n"],
  ['CONTROL-COMMAND-SCRIPTBLOCK-CREATE', 'command.scriptblock_create', "  [ScriptBlock]::Create(\"Write-Host 'dynamic command control'\")\n"],
  ['CONTROL-COMMAND-ROOT-DOT-SOURCE', 'command.root_dot_source', "  . './shadow.ps1'\n"],
  ['CONTROL-COMMAND-DOCKER-FUNCTION-SHADOW', 'command.protected_function_shadow', "  function docker { Write-Host 'shadow' }\n"]
].map(([id, code, insertion]) => ({
  id, expectedCodes: [code], requiredTokens: mandatoryBatch1Tokens,
  mutate: (fixture) => ({ ...fixture, database: insertBeforeBatch1Setup(fixture.database, insertion) })
}));

commandResolutionControlSpecs.push({
  id: 'CONTROL-COMMAND-DUPLICATE-RACE-FUNCTION',
  expectedCodes: ['command.protected_function_shadow', 'helper.both_ready', 'helper.contract',
    'helper.executable_scope', 'helper.exit_failure_propagation', 'helper.release_order'],
  requiredTokens: mandatoryBatch1Tokens,
  mutate: (fixture) => ({ ...fixture, database: insertBeforeBatch1Setup(fixture.database,
    "  function Invoke-DatabaseRace { param() Write-Host 'shadow' }\n") })
});

commandResolutionControlSpecs.push({
  id: 'CONTROL-COMMAND-DYNAMIC-RACE-INVOCATION',
  expectedCodes: ['command.dynamic_invocation', 'race.order', 'race.staff-existing.invocation_count'],
  requiredTokens: mandatoryBatch1Tokens.filter((token) => token !== 'Invoke-DatabaseRace'),
  mutate: (fixture) => ({ ...fixture, database: mutateRaceSegment(fixture.database, 'staff-existing', (segment) =>
    replaceExactly(segment, '  Invoke-DatabaseRace `', "  $raceCommand = 'Invoke-' + 'DatabaseRace'\n  & $raceCommand `"),
  { includeAssertion: false }) })
});

const exactControlCodeSets = new Map([
  ['CONTROL-MISSING-STAFF-EXISTING', ['race.order', 'race.staff-existing.invocation_count']],
  ['CONTROL-MISSING-STAFF-ABSENT', ['race.order', 'race.staff-absent.invocation_count']],
  ['CONTROL-MISSING-STAFF-CROSS-ROLE', ['race.order', 'race.staff-cross-role.invocation_count']],
  ['CONTROL-WRONG-STAFF-EXISTING-WORKER', ['race.staff-existing.first_file']],
  ['CONTROL-WRONG-STAFF-ABSENT-WORKER', ['race.staff-absent.second_file']],
  ['CONTROL-WRONG-CROSS-ROLE-PAIRING', ['race.staff-cross-role.second_file']],
  ['CONTROL-MISSING-SETUP', ['setup.command_count']],
  ['CONTROL-WRONG-EXPECTED-PAIR', ['race.staff-existing.exit_pair']],
  ['CONTROL-MISSING-ATTENDANCE-ASSERT', ['race.staff-existing.assertion_file', 'race.staff-existing.assertion_fixture', 'race.staff-existing.assertion_reachable']],
  ['CONTROL-DISCONNECTED-ASSERTION', ['race.staff-existing.assertion_executable_reachability', 'race.staff-existing.assertion_failure']],
  ['CONTROL-RACE-FAILURE-NOT-PROPAGATED', ['helper.exit_failure_propagation']],
  ['CONTROL-RACE-REMOVED-FROM-RELEASE', ['workflow.database_job', 'workflow.database_verifier_step']],
  ['CONTROL-WRONG-WORKER-LINE-COMMENT', ['race.staff-existing.first_file']],
  ['CONTROL-WRONG-WORKER-BLOCK-COMMENT', ['race.staff-absent.second_file']],
  ['CONTROL-WRONG-WORKER-UNUSED-VARIABLE', ['race.staff-cross-role.second_file']],
  ['CONTROL-WRONG-WORKER-UNRELATED-ARRAY-DIAGNOSTIC', ['race.staff-existing.first_file']],
  ['CONTROL-WRONG-POSITIONAL-WORKER-ORDER', ['race.staff-cross-role.first_file', 'race.staff-cross-role.second_file']],
  ['CONTROL-CORRECT-TOKENS-WRONG-NAMED-PARAMETERS', ['race.staff-cross-role.first_file', 'race.staff-cross-role.second_file']],
  ['CONTROL-APPROVED-TOKEN-UNUSED-EXTRA-ARGUMENT', ['race.staff-existing.arguments', 'race.staff-existing.first_file']],
  ['CONTROL-DYNAMIC-PROTECTED-WORKER', ['race.staff-existing.first_file']],
  ['CONTROL-UNVERIFIED-SPLATTING', ['command.protected_splat', 'race.staff-existing.arguments', 'race.staff-existing.first_file', 'race.staff-existing.second_file']],
  ['CONTROL-ASSERTION-TOKEN-COMMENT-ONLY', ['race.staff-existing.assertion_reachable']],
  ['CONTROL-SETUP-TOKEN-STRING-ONLY', ['setup.command_count']],
  ['CONTROL-STAFF-EXISTING-RACE-UNINVOKED-SCRIPTBLOCK', ['race.staff-existing.executable_reachability']],
  ['CONTROL-STAFF-EXISTING-ASSERTION-UNINVOKED-SCRIPTBLOCK', ['race.staff-existing.assertion_executable_reachability']],
  ['CONTROL-STAFF-EXISTING-RACE-UNREACHED-NESTED-CATCH', ['race.staff-existing.executable_reachability']],
  ['CONTROL-SETUP-UNINVOKED-SCRIPTBLOCK', ['setup.executable_reachability']],
  ['CONTROL-FAILURE-PROPAGATION-TEXT-ONLY', ['helper.exit_failure_propagation']],
  ['CONTROL-POWERSHELL-PARSE-ERROR', ['powershell.parse']],
  ['CONTROL-ROOT-EXIT-BEFORE-BATCH1-SETUP', ['terminal.unauthorized_exit']],
  ['CONTROL-UNCONDITIONAL-RETURN-BEFORE-BATCH1-SETUP', ['terminal.unauthorized_return']],
  ['CONTROL-RETURN-BETWEEN-STAFF-RACES', ['terminal.unauthorized_return']],
  ['CONTROL-RETURN-BEFORE-FINAL-ERROR-PROPAGATION', ['terminal.unauthorized_return']],
  ['CONTROL-CONTENTION-SWITCH-REINTRODUCED', ['terminal.contention_mode_present']],
  ['CONTROL-CONTENTION-SHORT-CIRCUIT-REINTRODUCED', ['terminal.contention_mode_present', 'terminal.unauthorized_return']],
  ['CONTROL-CONTENTION-ALIAS-SHADOW-ACTIVATION', ['command.alias_definition', 'terminal.contention_mode_present']],
  ['CONTROL-HIDDEN-ENV-SHORT-CIRCUIT', ['terminal.unauthorized_return']],
  ['CONTROL-RELEASE-ACTIVATES-CONTENTION-MODE', ['workflow.contention_mode_activation', 'workflow.database_job', 'workflow.database_verifier_step']],
  ['CONTROL-RELEASE-CONDITIONAL-DATABASE-FALLBACK', ['workflow.database_job']],
  ['CONTROL-SETUP-THROW-UNINVOKED-SCRIPTBLOCK', ['setup.reachable_failure']],
  ['CONTROL-STAFF-EXISTING-THROW-UNINVOKED-SCRIPTBLOCK', ['race.staff-existing.assertion_failure']],
  ['CONTROL-UNEXPECTED-EXIT-THROW-UNINVOKED-SCRIPTBLOCK', ['helper.exit_failure_propagation']],
  ['CONTROL-BOTH-READY-THROW-UNINVOKED-SCRIPTBLOCK', ['helper.both_ready']],
  ['CONTROL-FIRST-BEFORE-SECOND-THROW-UNINVOKED-SCRIPTBLOCK', ['helper.release_order']],
  ['CONTROL-VERIFICATION-RETHROW-UNINVOKED-SCRIPTBLOCK', ['database.verification_rethrow']],
  ['CONTROL-CLEANUP-RETHROW-UNINVOKED-SCRIPTBLOCK', ['database.cleanup_rethrow']],
  ['CONTROL-UNEXPECTED-EXIT-THROW-NESTED-CATCH', ['helper.exit_failure_propagation']]
]);

for (const spec of [...legacyTopologyControlSpecs, ...terminalControlSpecs, ...directThrowControlSpecs]) {
  spec.expectedCodes = exactControlCodeSets.get(spec.id);
  if (!spec.expectedCodes) throw new Error(`missing exact control code set: ${spec.id}`);
}

function runAstBoundaryControls() {
  const validObject = {
    schema_version: 3,
    source_path: databaseVerifyPath,
    runtime: { parser_type: 'System.Management.Automation.Language.Parser' },
    parse_errors: [], commands: [], functions: [], ifs: [], throws: [], assignments: [], tries: [],
    parameters: [], root_parameters: [], target_variable_references: [], target_unary_expressions: [],
    target_foreach_variables: [], returns: [], exits: [], invoke_members: [],
    root_body_extent: { start_offset: 0, end_offset: 0 }, root_statements: [], root_traps: [],
    root_extent: { start_offset: 0, end_offset: 0 }
  };
  const validDocument = JSON.stringify(validObject);
  const specs = [
    { id: 'CONTROL-AST-TIMEOUT', expectedClassification: 'ast.timeout', result: { status: null, signal: null, error: { code: 'ETIMEDOUT' }, stdout: '', stderr: '' } },
    { id: 'CONTROL-AST-SIGNAL', expectedClassification: 'ast.signal', result: { status: null, signal: 'SIGTERM', stdout: '', stderr: '' } },
    { id: 'CONTROL-AST-NONZERO-EXIT', expectedClassification: 'ast.nonzero_exit', result: { status: 1, signal: null, stdout: validDocument, stderr: '' } },
    { id: 'CONTROL-AST-SPAWN-ERROR', expectedClassification: 'ast.spawn_error', result: { status: null, signal: null, error: { code: 'ENOENT' }, stdout: '', stderr: '' } },
    { id: 'CONTROL-AST-MISSING-EXIT', expectedClassification: 'ast.missing_exit', result: { status: null, signal: null, stdout: validDocument, stderr: '' } },
    { id: 'CONTROL-AST-PREAMBLE', expectedClassification: 'ast.output_shape', result: { status: 0, signal: null, stdout: `preamble\n${validDocument}`, stderr: '' } },
    { id: 'CONTROL-AST-MALFORMED-JSON', expectedClassification: 'ast.malformed_json', result: { status: 0, signal: null, stdout: '{malformed}', stderr: '' } },
    { id: 'CONTROL-AST-INCOMPLETE-JSON', expectedClassification: 'ast.incomplete_schema', result: { status: 0, signal: null, stdout: '{}', stderr: '' } },
    { id: 'CONTROL-AST-WRONG-PARSER', result: { status: 0, signal: null,
      stdout: JSON.stringify({ ...validObject, runtime: { parser_type: 'Untrusted.Parser' } }), stderr: '' }, expectedClassification: 'ast.parser_identity' },
    { id: 'CONTROL-AST-MALFORMED-SCHEMA', result: { status: 0, signal: null,
      stdout: JSON.stringify({ ...validObject, returns: [{}] }), stderr: '' }, expectedClassification: 'ast.invalid_schema' },
    { id: 'CONTROL-AST-STDERR', expectedClassification: 'ast.stderr', result: { status: 0, signal: null, stdout: validDocument, stderr: 'unexpected' } }
  ];
  const controls = specs.map((spec) => {
    let observedClassification = null;
    try {
      parseAstProcessResult(spec.result);
    } catch (error) {
      observedClassification = error instanceof AstBoundaryError ? error.code : 'unexpected.error';
    }
    return { id: spec.id, expected_classification: spec.expectedClassification,
      observed_classification: observedClassification,
      exact_match: observedClassification === spec.expectedClassification,
      control_passed: observedClassification === spec.expectedClassification };
  });
  let sourceIdentityClassification = null;
  try {
    const document = parseAstProcessResult({ status: 0, signal: null,
      stdout: JSON.stringify({ ...validObject, source_path: resolve(repositoryRoot, 'untrusted.ps1') }), stderr: '' });
    assertAstSourceIdentity(document, databaseVerifyPath);
  } catch (error) {
    sourceIdentityClassification = error instanceof AstBoundaryError ? error.code : 'unexpected.error';
  }
  controls.push({ id: 'CONTROL-AST-SOURCE-IDENTITY', expected_classification: 'ast.source_identity',
    observed_classification: sourceIdentityClassification,
    exact_match: sourceIdentityClassification === 'ast.source_identity',
    control_passed: sourceIdentityClassification === 'ast.source_identity' });
  return controls;
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

function buildDirectTopologyPositiveControl(validation) {
  const ownership = validation.evidence?.direct_statement_ownership;
  const races = staffRaceSpecs.map((spec) => ownership?.races?.find((entry) => entry.race === spec.name));
  const setupAccepted = ownership?.setup?.accepted === true && ownership.setup.statement_type === 'PipelineAst' &&
    ownership.setup.pipeline_matches_direct_statement === true;
  const racesAccepted = races.every((entry) => entry?.invocation?.accepted === true &&
    entry.invocation.statement_type === 'PipelineAst' && entry.invocation.pipeline_matches_direct_statement === true &&
    entry?.assertion?.accepted === true && entry.assertion.statement_type === 'PipelineAst' &&
    entry.assertion.pipeline_matches_direct_statement === true);
  return {
    id: 'CONTROL-DIRECT-EXECUTABLE-BATCH1-TOPOLOGY',
    intended_result: 'setup plus three races plus three assertions are direct main-try PipelineAst statements',
    control_passed: validation.issues.length === 0 && setupAccepted && racesAccepted,
    ownership
  };
}

function buildCompleteVerifierPositiveControl(validation) {
  const flow = validation.evidence?.control_flow;
  const workflowInvocation = validation.evidence?.workflow_invocation;
  return {
    id: 'CONTROL-COMPLETE-DATABASE-VERIFIER-ONLY',
    intended_result: 'no contention-only mode and no root terminal statement while Release remains exact and unconditional',
    control_passed: validation.issues.length === 0 && flow?.complete_verifier?.accepted === true &&
      flow.root_exit_count === 0 && flow.root_return_count === 0 &&
      workflowInvocation?.exact_run_count === 1 && workflowInvocation?.contention_mode_mention_count === 0 &&
      workflowInvocation?.run_contract_accepted === true && workflowInvocation?.has_job_condition === false &&
      workflowInvocation?.has_continue_on_error === false && workflowInvocation?.has_step_condition_or_continue === false,
    complete_verifier: flow?.complete_verifier,
    workflow_invocation: workflowInvocation
  };
}

function buildDirectThrowPositiveControl(validation) {
  const throws = validation.evidence?.direct_statement_ownership?.safety_throws;
  const required = [
    'setup', 'assertion_staff-existing', 'assertion_staff-absent', 'assertion_staff-cross-role',
    'unexpected_exit_pair', 'both_workers_ready', 'first_before_second', 'verification_error', 'cleanup_error'
  ];
  return {
    id: 'CONTROL-COMPLETE-SAFETY-THROW-ANCESTRY',
    intended_result: 'every safety-critical throw has exact complete ancestry from its clause through the authoritative root path',
    control_passed: validation.issues.length === 0 && required.every((name) => throws?.[name]?.complete_ancestry_accepted === true),
    required,
    ownership: throws
  };
}

function runExactCodeSetComparatorControls() {
  const specs = [
    { id: 'CONTROL-EXACT-CODE-SET-ACCEPTS-EQUAL', expected: ['a', 'b'], observed: ['b', 'a'], intended: true },
    { id: 'CONTROL-EXACT-CODE-SET-REJECTS-EXTRA', expected: ['a'], observed: ['a', 'unexpected'], intended: false },
    { id: 'CONTROL-EXACT-CODE-SET-REJECTS-MISSING', expected: ['a', 'b'], observed: ['a'], intended: false },
    { id: 'CONTROL-EXACT-CODE-SET-REJECTS-DUPLICATE', expected: ['a'], observed: ['a', 'a'], intended: false },
    { id: 'CONTROL-EXACT-CODE-SET-REJECTS-EMPTY-EXPECTED', expected: [], observed: ['a'], intended: false },
    { id: 'CONTROL-EXACT-CODE-SET-REJECTS-EMPTY-OBSERVED', expected: ['a'], observed: [], intended: false }
  ];
  return specs.map((spec) => {
    const observed = exactCodeSetMatch(spec.expected, spec.observed);
    return { ...spec, observed_match: observed, control_passed: observed === spec.intended };
  });
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
const positiveTopologyControl = buildDirectTopologyPositiveControl(topologyValidation);
if (!positiveTopologyControl.control_passed) failures.push(
  `[${positiveTopologyControl.id}] repository commands are not direct executable main-try PipelineAst statements`
);
const completeVerifierPositiveControl = buildCompleteVerifierPositiveControl(topologyValidation);
if (!completeVerifierPositiveControl.control_passed) failures.push(
  `[${completeVerifierPositiveControl.id}] complete database verifier contract was not proven`
);
const directThrowPositiveControl = buildDirectThrowPositiveControl(topologyValidation);
if (!directThrowPositiveControl.control_passed) failures.push(
  `[${directThrowPositiveControl.id}] safety-critical throws lack direct executable clause ownership`
);
const legacyTopologyControls = legacyTopologyControlSpecs.map(runTopologyControl);
const terminalControls = terminalControlSpecs.map(runTopologyControl);
const directThrowControls = directThrowControlSpecs.map(runTopologyControl);
const safetyWrapperControls = safetyWrapperControlSpecs.map(runTopologyControl);
const commandResolutionControls = commandResolutionControlSpecs.map(runTopologyControl);
const allMutationControls = [...legacyTopologyControls, ...terminalControls, ...directThrowControls,
  ...safetyWrapperControls, ...commandResolutionControls];
for (const control of allMutationControls) {
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
const exactCodeSetComparatorControls = runExactCodeSetComparatorControls();
for (const control of exactCodeSetComparatorControls) {
  if (!control.control_passed) failures.push(`[${control.id}] exact code-set comparator self-test failed`);
}
const allControlsPassed = positiveTopologyControl.control_passed && completeVerifierPositiveControl.control_passed &&
  directThrowPositiveControl.control_passed && allMutationControls.every((control) => control.control_passed) &&
  astBoundaryControls.every((control) => control.control_passed) && sourceOverrideControl.control_passed &&
  exactCodeSetComparatorControls.every((control) => control.control_passed);
const restorationPassed = repositoryTopologyRestored();
const cleanupPassed = allMutationControls.every((control) => control.cleanup === 'PASS');
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
    positive_control: positiveTopologyControl,
    complete_verifier_positive_control: completeVerifierPositiveControl,
    direct_throw_positive_control: directThrowPositiveControl,
    negative_controls: legacyTopologyControls,
    terminal_controls: terminalControls,
    direct_throw_controls: directThrowControls,
    safety_wrapper_controls: safetyWrapperControls,
    command_resolution_controls: commandResolutionControls,
    exact_code_set_comparator_controls: exactCodeSetComparatorControls,
    control_totals: {
      legacy_negative: legacyTopologyControls.length,
      terminal_negative: terminalControls.length,
      direct_throw_negative: directThrowControls.length,
      safety_wrapper_negative: safetyWrapperControls.length,
      command_resolution_negative: commandResolutionControls.length,
      ast_boundary: astBoundaryControls.length,
      exact_code_set_comparator: exactCodeSetComparatorControls.length,
      source_override: 1,
      positive: 3,
      total: legacyTopologyControls.length + terminalControls.length + directThrowControls.length +
        safetyWrapperControls.length + commandResolutionControls.length + astBoundaryControls.length +
        exactCodeSetComparatorControls.length + 1 + 3
    },
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
