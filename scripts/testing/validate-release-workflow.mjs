import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.argv.slice(2).length > 0) {
  console.error('validate-release-workflow does not accept source-path or test-only overrides');
  process.exit(2);
}

class AstBoundaryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AstBoundaryError';
    this.code = code;
  }
}

const repositoryRoot = resolve(import.meta.dirname, '../..');
const workflowPath = resolve(repositoryRoot, '.github/workflows/release-validation.yml');
const boundaryPath = resolve(repositoryRoot, 'scripts/testing/verify-local-supabase.sh');
const identityPath = resolve(repositoryRoot, 'admin-web/scripts/test-run-identity.mjs');
const fixtureEnvironmentPath = resolve(repositoryRoot, 'scripts/testing/prepare-admin-e2e-env.mjs');
const databaseVerifyPath = resolve(repositoryRoot, 'scripts/testing/database-verify.ps1');
const batch1MutationPath = resolve(repositoryRoot, 'scripts/testing/batch1-release-blockers-mutation-verify.mjs');
const batch1SqlPath = resolve(repositoryRoot, 'supabase/tests/020_batch1_release_blockers.sql');
const boundary = readFileSync(boundaryPath, 'utf8');
const identity = readFileSync(identityPath, 'utf8');
const fixtureEnvironment = readFileSync(fixtureEnvironmentPath, 'utf8');
const batch1Mutation = readFileSync(batch1MutationPath, 'utf8');
const batch1Sql = readFileSync(batch1SqlPath, 'utf8');
const failures = [];
const guardStarted = performance.now();
const astProcessMetrics = { count: 0, total_ms: 0, max_stdout_bytes: 0, slowest_ms: 0, slowest_source: null };

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
const databaseSourceSnapshot = createSourceSnapshot(databaseVerifyPath, protectedTopologySnapshots.get(databaseVerifyPath));
const databaseVerify = databaseSourceSnapshot.text;
const workflow = createSourceSnapshot(workflowPath, protectedTopologySnapshots.get(workflowPath)).text;

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
  [ordered]@{ source_extent = @($Extent.StartOffset, $Extent.EndOffset) }
}

function Convert-CompactExtent([System.Management.Automation.Language.IScriptExtent]$Extent) {
  if ($null -eq $Extent) { return $null }
  [ordered]@{ source_extent = @($Extent.StartOffset, $Extent.EndOffset) }
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
  # One traversal collects the same disjoint facts previously found by five
  # separate predicate traversals. Preserve parser order and every occurrence.
  $variables = [Collections.Generic.List[object]]::new()
  $binaryOperators = [Collections.Generic.List[object]]::new()
  $unaryOperators = [Collections.Generic.List[object]]::new()
  $literals = [Collections.Generic.List[object]]::new()
  $dynamicTypes = [Collections.Generic.List[object]]::new()
  foreach ($node in $Condition.FindAll({ param($child) $true }, $true)) {
    if ($node -is [System.Management.Automation.Language.VariableExpressionAst]) {
      $variables.Add($node.VariablePath.UserPath)
    } elseif ($node -is [System.Management.Automation.Language.BinaryExpressionAst]) {
      $binaryOperators.Add([string]$node.Operator)
    } elseif ($node -is [System.Management.Automation.Language.UnaryExpressionAst]) {
      $unaryOperators.Add([string]$node.TokenKind)
    } elseif ($node -is [System.Management.Automation.Language.ConstantExpressionAst] -or
        $node -is [System.Management.Automation.Language.StringConstantExpressionAst]) {
      $literals.Add([ordered]@{ type = $node.GetType().Name; value = $node.Value; extent = Convert-Extent $node.Extent })
    } elseif ($node -is [System.Management.Automation.Language.CommandAst] -or
        $node -is [System.Management.Automation.Language.SubExpressionAst] -or
        $node -is [System.Management.Automation.Language.ScriptBlockExpressionAst] -or
        $node -is [System.Management.Automation.Language.InvokeMemberExpressionAst]) {
      $dynamicTypes.Add($node.GetType().Name)
    }
  }
  [ordered]@{
    type = $Condition.GetType().Name
    pipeline_element_count = $pipelineElements.Count
    pipeline_element_types = @($pipelineElements | ForEach-Object { $_.GetType().Name })
    expression_type = if ($null -ne $expression) { $expression.GetType().Name } else { $null }
    variable_path = if ($expression -is [System.Management.Automation.Language.VariableExpressionAst]) {
      $expression.VariablePath.UserPath
    } else { $null }
    variable_references = $variables.ToArray()
    binary_operators = $binaryOperators.ToArray()
    unary_operators = $unaryOperators.ToArray()
    literals = $literals.ToArray()
    dynamic_node_types = $dynamicTypes.ToArray()
    extent = Convert-Extent $Condition.Extent
  }
}

function Convert-Parameter([System.Management.Automation.Language.ParameterAst]$Parameter) {
  [ordered]@{
    name = $Parameter.Name.VariablePath.UserPath
    owner_scriptblock_extent = if ($Parameter.Parent -is [System.Management.Automation.Language.ParamBlockAst]) {
      Convert-CompactExtent $Parameter.Parent.Parent.Extent
    } else { $null }
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
  $pipeline = $Node.Pipeline
  $pipelineElements = if ($pipeline -is [System.Management.Automation.Language.PipelineAst]) {
    @($pipeline.PipelineElements)
  } else { @() }
  $expression = if ($pipelineElements.Count -eq 1 -and
      $pipelineElements[0] -is [System.Management.Automation.Language.CommandExpressionAst]) {
    $pipelineElements[0].Expression
  } else { $null }
  [ordered]@{
    type = $Node.GetType().Name
    nearest_function = Get-NearestFunction $Node
    parent_type = if ($null -ne $Node.Parent) { $Node.Parent.GetType().Name } else { $null }
    ancestors = @(Get-Ancestors $Node)
    exit_argument = if ($Node -is [System.Management.Automation.Language.ExitStatementAst]) {
      [ordered]@{
        pipeline_type = if ($null -ne $pipeline) { $pipeline.GetType().Name } else { $null }
        pipeline_text = if ($null -ne $pipeline) { $pipeline.Extent.Text } else { $null }
        pipeline_element_count = $pipelineElements.Count
        pipeline_element_types = @($pipelineElements | ForEach-Object { $_.GetType().Name })
        expression_type = if ($null -ne $expression) { $expression.GetType().Name } else { $null }
        expression_text = if ($null -ne $expression) { $expression.Extent.Text } else { $null }
        literal_value = if ($expression -is [System.Management.Automation.Language.ConstantExpressionAst]) {
          $expression.Value
        } else { $null }
        literal_value_type = if ($expression -is [System.Management.Automation.Language.ConstantExpressionAst] -and
            $null -ne $expression.Value) { $expression.Value.GetType().FullName } else { $null }
        expression_static = Test-StaticExpression $expression
        variable_references = @(if ($null -ne $pipeline) {
          $pipeline.FindAll({ param($child) $child -is [System.Management.Automation.Language.VariableExpressionAst] }, $true) |
            ForEach-Object { [ordered]@{ path = $_.VariablePath.UserPath; splatted = $_.Splatted } }
        })
        command_count = @(if ($null -ne $pipeline) {
          $pipeline.FindAll({ param($child) $child -is [System.Management.Automation.Language.CommandAst] }, $true)
        }).Count
        subexpression_count = @(if ($null -ne $pipeline) {
          $pipeline.FindAll({ param($child) $child -is [System.Management.Automation.Language.SubExpressionAst] }, $true)
        }).Count
        scriptblock_expression_count = @(if ($null -ne $pipeline) {
          $pipeline.FindAll({ param($child) $child -is [System.Management.Automation.Language.ScriptBlockExpressionAst] }, $true)
        }).Count
        descendant_types = @(if ($null -ne $pipeline) {
          $pipeline.FindAll({ param($child) $true }, $true) | ForEach-Object { $_.GetType().Name }
        })
      }
    } else { $null }
    extent = Convert-Extent $Node.Extent
  }
}

function Test-StaticExpression([System.Management.Automation.Language.Ast]$Node) {
  if ($null -eq $Node) { return $false }
  return -not $script:dynamicExpressionAncestors.Contains($Node)
}

function Convert-Expression([System.Management.Automation.Language.Ast]$Node) {
  if ($null -eq $Node) { return $null }
  $result = [ordered]@{ type = $Node.GetType().Name; extent = Convert-CompactExtent $Node.Extent }
  if ($Node -is [System.Management.Automation.Language.VariableExpressionAst]) {
    $result.variable_path = $Node.VariablePath.UserPath
    $result.splatted = $Node.Splatted
  } elseif ($Node -is [System.Management.Automation.Language.StringConstantExpressionAst]) {
    $result.value = $Node.Value
  } elseif ($Node -is [System.Management.Automation.Language.ConstantExpressionAst]) {
    $result.value = $Node.Value
  } elseif ($Node -is [System.Management.Automation.Language.ExpandableStringExpressionAst]) {
    $result.value = $Node.Value
    $result.nested_extents = @($Node.NestedExpressions | ForEach-Object { Convert-CompactExtent $_.Extent })
  } elseif ($Node -is [System.Management.Automation.Language.BinaryExpressionAst]) {
    $result.operator = [string]$Node.Operator
    $result.left = Convert-Expression $Node.Left
    $result.right = Convert-Expression $Node.Right
  } elseif ($Node -is [System.Management.Automation.Language.TypeExpressionAst]) {
    $result.type_name = $Node.TypeName.FullName
  } elseif ($Node -is [System.Management.Automation.Language.ArrayLiteralAst]) {
    $result.items = @($Node.Elements | ForEach-Object { Convert-Expression $_ })
  } elseif ($Node -is [System.Management.Automation.Language.HashtableAst]) {
    $result.entries = @($Node.KeyValuePairs | ForEach-Object {
      [ordered]@{ key = Convert-Expression $_.Item1; value = Convert-Expression $_.Item2 }
    })
  } elseif ($Node -is [System.Management.Automation.Language.StatementBlockAst]) {
    if ($Node.Statements.Count -eq 1 -and $Node.Traps.Count -eq 0) {
      $result.inner = Convert-Expression $Node.Statements[0]
    }
  } elseif ($Node -is [System.Management.Automation.Language.ParenExpressionAst]) {
    $result.inner = Convert-Expression $Node.Pipeline
  } elseif ($Node -is [System.Management.Automation.Language.PipelineAst]) {
    if ($Node.PipelineElements.Count -eq 1) { $result.inner = Convert-Expression $Node.PipelineElements[0] }
  } elseif ($Node -is [System.Management.Automation.Language.CommandExpressionAst]) {
    if ($Node.Redirections.Count -eq 0) { $result.inner = Convert-Expression $Node.Expression }
  } elseif ($Node -is [System.Management.Automation.Language.MemberExpressionAst]) {
    $result.expression = Convert-Expression $Node.Expression
    $result.member = if ($Node.Member -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $Node.Member.Value } else { $null }
    $result.is_static = $Node.Static
    if ($Node -is [System.Management.Automation.Language.InvokeMemberExpressionAst]) {
      $result.arguments = @()
      if ($null -ne $Node.Arguments) {
        $result.arguments = @(
          $Node.Arguments |
            ForEach-Object { Convert-Expression $_ }
        )
      }
    }
  } elseif ($Node -is [System.Management.Automation.Language.ScriptBlockExpressionAst]) {
    $result.script_block_extent = Convert-CompactExtent $Node.ScriptBlock.Extent
  }
  $result
}

function Get-WrittenVariables([System.Management.Automation.Language.Ast]$Node) {
  if ($Node -is [System.Management.Automation.Language.VariableExpressionAst]) { $Node.VariablePath.UserPath }
  elseif ($Node -is [System.Management.Automation.Language.ArrayLiteralAst]) {
    $Node.Elements | ForEach-Object { Get-WrittenVariables $_ }
  } elseif ($Node -is [System.Management.Automation.Language.AttributedExpressionAst]) { Get-WrittenVariables $Node.Child }
  elseif ($Node -is [System.Management.Automation.Language.IndexExpressionAst]) { Get-WrittenVariables $Node.Target }
  elseif ($Node -is [System.Management.Automation.Language.MemberExpressionAst]) { Get-WrittenVariables $Node.Expression }
  elseif ($Node -is [System.Management.Automation.Language.ParenExpressionAst]) { Get-WrittenVariables $Node.Pipeline }
  elseif ($Node -is [System.Management.Automation.Language.PipelineAst] -and $Node.PipelineElements.Count -eq 1) {
    Get-WrittenVariables $Node.PipelineElements[0]
  } elseif ($Node -is [System.Management.Automation.Language.CommandExpressionAst]) { Get-WrittenVariables $Node.Expression }
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
      expression_ast = Convert-Expression $Element.Argument
      extent = Convert-Extent $Element.Argument.Extent
    }
  }
  [ordered]@{
    type = $Element.GetType().Name
    text = $Element.Extent.Text
    value = $value
    static = Test-StaticExpression $Element
    expression_ast = Convert-Expression $Element
    parameter_name = if ($Element -is [System.Management.Automation.Language.CommandParameterAst]) { $Element.ParameterName } else { $null }
    splatted = $Element -is [System.Management.Automation.Language.VariableExpressionAst] -and $Element.Splatted
    argument = $argument
    extent = Convert-Extent $Element.Extent
  }
}

try {
  $tokens = $null
  $parseErrors = $null
  $inputBytes = [IO.MemoryStream]::new()
  try {
    [Console]::OpenStandardInput().CopyTo($inputBytes)
    $sourceBytes = $inputBytes.ToArray()
  } finally { $inputBytes.Dispose() }
  $bomLength = if ($sourceBytes.Length -ge 3 -and $sourceBytes[0] -eq 239 -and
    $sourceBytes[1] -eq 187 -and $sourceBytes[2] -eq 191) { 3 } else { 0 }
  $sourceText = [Text.UTF8Encoding]::new($false, $true).GetString(
    $sourceBytes, $bomLength, $sourceBytes.Length - $bomLength)
  $ast = [System.Management.Automation.Language.Parser]::ParseInput(
    $sourceText, [IO.Path]::GetFullPath($TargetPath), [ref]$tokens, [ref]$parseErrors
  )
  # A subtree contains a dynamic node exactly when its root is that node or an
  # ancestor. Build this set once from the identical predicate, in this process
  # only. Reference identity prevents mixing distinct nodes with equal text.
  $script:dynamicExpressionAncestors = [Collections.Generic.HashSet[System.Management.Automation.Language.Ast]]::new()
  foreach ($node in $ast.FindAll({
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
  }, $true)) {
    $current = $node
    while ($null -ne $current -and $script:dynamicExpressionAncestors.Add($current)) { $current = $current.Parent }
  }
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
  # Parameters are declarations, not writes. Export executable binding/mutation
  # targets generically; the consumer chooses the protected variable names.
  $variableWrites = @($ast.FindAll({ param($node)
    $node -is [System.Management.Automation.Language.AssignmentStatementAst] -or
    $node -is [System.Management.Automation.Language.ForEachStatementAst] -or
    ($node -is [System.Management.Automation.Language.UnaryExpressionAst] -and
      [string]$node.TokenKind -in @('PlusPlus','MinusMinus','PostfixPlusPlus','PostfixMinusMinus'))
  }, $true) | ForEach-Object {
    $node = $_
    $target = if ($node -is [System.Management.Automation.Language.AssignmentStatementAst]) { $node.Left }
      elseif ($node -is [System.Management.Automation.Language.ForEachStatementAst]) { $node.Variable }
      else { $node.Child }
    [ordered]@{
      kind = $node.GetType().Name
      target = Convert-Expression $target
      operator = if ($node -is [System.Management.Automation.Language.AssignmentStatementAst]) { [string]$node.Operator } else { $null }
      value = if ($node -is [System.Management.Automation.Language.AssignmentStatementAst]) { Convert-Expression $node.Right } else { $null }
      variables = @(Get-WrittenVariables $target)
      nearest_function = Get-NearestFunction $node
      extent = Convert-CompactExtent $node.Extent
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
  $variableApiAccesses = @($ast.FindAll({ param($node)
    if ($node -isnot [System.Management.Automation.Language.MemberExpressionAst]) { return $false }
    if ($node.Member -is [System.Management.Automation.Language.StringConstantExpressionAst]) {
      return $node.Member.Value -in @('PSVariable', 'SessionState')
    }
    return $node.Expression -is [System.Management.Automation.Language.VariableExpressionAst] -and
      $node.Expression.VariablePath.UserPath -in @('ExecutionContext', 'PSCmdlet')
  }, $true) | ForEach-Object { [ordered]@{ extent = Convert-CompactExtent $_.Extent } })
  # Reject writable handle acquisition at the boundary; do not track aliases,
  # assignments or pipeline consumers after a handle has escaped.
  $writableReferences = @($ast.FindAll({ param($node)
    $node -is [System.Management.Automation.Language.ConvertExpressionAst] -and
      $node.Type.TypeName.FullName -in @('ref', 'System.Management.Automation.PSReference')
  }, $true) | ForEach-Object {
    [ordered]@{ target = Convert-Expression $_.Child; extent = Convert-CompactExtent $_.Extent }
  })
  # Keep zero/one/many root parameters as a JSON array; assignment otherwise unwraps a singleton.
  $rootParameters = @(if ($null -ne $ast.ParamBlock) {
    $ast.ParamBlock.Parameters | ForEach-Object { Convert-Parameter $_ }
  })
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
    schema_version = 8
    source_path = [IO.Path]::GetFullPath($TargetPath)
    # Raw identity includes a BOM; parser text identity does not. Neither reopens the path.
    source_bytes_sha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($sourceBytes)).ToLowerInvariant()
    source_text_sha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData(
      [Text.UTF8Encoding]::new($false, $true).GetBytes($ast.Extent.Text))).ToLowerInvariant()
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
    variable_writes = $variableWrites
    variable_api_accesses = $variableApiAccesses
    writable_references = $writableReferences
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
  [Console]::Out.Write(($payload | ConvertTo-Json -Depth 64 -Compress))
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

function rejectAstBoundary(code, message) {
  throw new AstBoundaryError(code, message);
}

function createSourceSnapshot(targetPath, inputBytes) {
  // Keep the authoritative bytes private. Callers receive copies only for stdin.
  const bytes = Buffer.from(inputBytes);
  const bomLength = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(bomLength));
  } catch {
    rejectAstBoundary('ast.source_identity', 'PowerShell AST source is not strict UTF-8');
  }
  return Object.freeze({ path: resolve(targetPath), text, byte_length: bytes.length,
    raw_sha256: sha256(bytes), text_sha256: sha256(Buffer.from(text, 'utf8')),
    copyBytes: () => Buffer.from(bytes), matchesBytes: current => bytes.equals(current) });
}

function captureSourceSnapshot(targetPath) {
  return createSourceSnapshot(targetPath, readFileSync(targetPath));
}

function assertSourceSnapshotCurrent(snapshot) {
  // A reread only checks the existing snapshot; it can never replace its source.
  if (!snapshot.matchesBytes(readFileSync(snapshot.path))) {
    rejectAstBoundary('ast.source_identity', 'PowerShell AST source changed after snapshot capture');
  }
}

function parseAstProcessResult(result) {
  if (result?.error?.code === 'ETIMEDOUT') rejectAstBoundary('ast.timeout', 'PowerShell AST subprocess timed out');
  if (result?.error?.code === 'ENOBUFS') rejectAstBoundary('ast.enobufs', 'PowerShell AST subprocess exceeded its output buffer');
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
    'root_traps', 'root_extent', 'variable_writes', 'variable_api_accesses', 'writable_references']) {
    if (!(key in document)) rejectAstBoundary('ast.incomplete_schema', `PowerShell AST output is incomplete: ${key}`);
  }
  if (document.runtime?.parser_type !== 'System.Management.Automation.Language.Parser') {
    rejectAstBoundary('ast.parser_identity', 'PowerShell AST parser identity is invalid');
  }
  if (document.schema_version !== 8 || !/^[a-f0-9]{64}$/.test(document.source_bytes_sha256 ?? '') ||
      !/^[a-f0-9]{64}$/.test(document.source_text_sha256 ?? '') ||
      !Array.isArray(document.parse_errors) || !Array.isArray(document.commands) || !Array.isArray(document.functions) ||
      !Array.isArray(document.ifs) || !Array.isArray(document.throws) || !Array.isArray(document.assignments) ||
      !Array.isArray(document.tries) || !Array.isArray(document.parameters) || !Array.isArray(document.root_parameters) ||
      !Array.isArray(document.target_variable_references) || !Array.isArray(document.target_unary_expressions) ||
      !Array.isArray(document.target_foreach_variables) || !Array.isArray(document.returns) || !Array.isArray(document.exits) ||
      !Array.isArray(document.invoke_members) || !Array.isArray(document.root_statements) ||
      !Array.isArray(document.root_traps) || !document.root_body_extent ||
      !Array.isArray(document.variable_writes) || document.variable_writes.some(entry =>
        !Array.isArray(entry?.variables) || !entry?.target?.extent || !entry?.extent) ||
      !Array.isArray(document.variable_api_accesses) || document.variable_api_accesses.some(entry => !entry?.extent) ||
      !Array.isArray(document.writable_references) || document.writable_references.some(entry => !entry?.extent || !entry?.target?.extent) ||
      document.functions.some((fn) => !Array.isArray(fn?.ancestors) || !Array.isArray(fn?.end_block_statements) ||
        !Array.isArray(fn?.end_block_traps) || !fn?.body_extent || !fn?.end_block_extent || !fn?.extent) ||
      document.tries.some((entry) => !Array.isArray(entry?.ancestors) || !Array.isArray(entry?.body_statements) || !entry?.extent) ||
      document.parameters.some((parameter) => !Array.isArray(parameter?.attributes) || parameter.attributes.some((attribute) =>
        !Array.isArray(attribute?.positional_arguments))) ||
      document.commands.some((command) =>
        !Array.isArray(command?.ancestors) || !Array.isArray(command?.elements) ||
        command.elements.some(element => !element?.expression_ast || (element.argument && !element.argument.expression_ast)) ||
        command?.enclosing_pipeline?.type !== 'PipelineAst' ||
        !command?.enclosing_pipeline?.extent || !command?.extent) || document.ifs.some((entry) =>
        !Array.isArray(entry?.clauses) || !Array.isArray(entry?.else_statements) || entry.clauses.some((clause) =>
          !clause?.condition_ast || !Array.isArray(clause.condition_ast.variable_references) ||
          !Array.isArray(clause.condition_ast.binary_operators) || !Array.isArray(clause.condition_ast.unary_operators) ||
          !Array.isArray(clause.condition_ast.literals) || !Array.isArray(clause.condition_ast.dynamic_node_types) ||
          !Array.isArray(clause?.body_statements) || !Array.isArray(clause?.body_traps))) ||
      [...document.returns, ...document.exits, ...document.throws].some((entry) =>
        !Array.isArray(entry?.ancestors) || !entry?.extent) || document.exits.some((entry) =>
        !entry?.exit_argument || !Array.isArray(entry.exit_argument.pipeline_element_types) ||
          !Array.isArray(entry.exit_argument.variable_references) || !Array.isArray(entry.exit_argument.descendant_types))) {
    rejectAstBoundary('ast.invalid_schema', 'PowerShell AST output schema is invalid');
  }
  return document;
}

function assertAstSourceIdentity(document, targetPath) {
  if (resolve(document.source_path) !== resolve(targetPath)) {
    rejectAstBoundary('ast.source_identity', 'PowerShell AST source identity mismatch');
  }
}

function restoreAstExtents(document, snapshot) {
  if (document.source_bytes_sha256 !== snapshot.raw_sha256) {
    rejectAstBoundary('ast.source_identity', 'PowerShell AST raw source hash mismatch');
  }
  if (document.source_text_sha256 !== snapshot.text_sha256) {
    rejectAstBoundary('ast.source_identity', 'PowerShell AST parser text hash mismatch');
  }
  const source = snapshot.text;
  const lineStarts = [0];
  for (let offset = 0; offset < source.length; offset += 1) {
    if (source[offset] === '\r') {
      if (source[offset + 1] === '\n') offset += 1;
      lineStarts.push(offset + 1);
    } else if (source[offset] === '\n') lineStarts.push(offset + 1);
  }
  const validRange = (start, end) => Number.isSafeInteger(start) && Number.isSafeInteger(end) &&
    start >= 0 && start <= end && end <= source.length;
  const position = offset => {
    let low = 0, high = lineStarts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (lineStarts[middle] <= offset) low = middle;
      else high = middle;
    }
    return { line: low + 1, column: offset - lineStarts[low] + 1 };
  };
  function extent(value) {
    if (!value || Array.isArray(value) || Object.keys(value).length !== 1 ||
        !Array.isArray(value.source_extent) || value.source_extent.length !== 2 ||
        !validRange(...value.source_extent)) {
      rejectAstBoundary('ast.invalid_extent', 'PowerShell AST compact extent is malformed or outside its source');
    }
    const [start, end] = value.source_extent;
    const first = position(start), last = position(end);
    return { text: source.slice(start, end), start_offset: start, end_offset: end,
      start_line: first.line, start_column: first.column, end_line: last.line, end_column: last.column };
  }
  function restore(value) {
    if (!value || typeof value !== 'object') return;
    // Ancestor records intentionally store offsets inline. Check them too.
    if (Object.hasOwn(value, 'start_offset') || Object.hasOwn(value, 'end_offset')) {
      if (!validRange(value.start_offset, value.end_offset)) {
        rejectAstBoundary('ast.invalid_extent', 'PowerShell AST ancestor offsets are outside their source');
      }
    }
    if (Object.hasOwn(value, 'source_extent')) {
      rejectAstBoundary('ast.invalid_extent', 'PowerShell AST extent marker is outside an extent field');
    }
    for (const [key, child] of Object.entries(value)) {
      if (/(?:^|_)extent$/.test(key) && child !== null) value[key] = extent(child);
      else if (key === 'nested_extents') {
        if (!Array.isArray(child)) rejectAstBoundary('ast.invalid_extent', 'PowerShell AST nested extents must be an array');
        value[key] = child.map(extent);
      } else restore(child);
    }
  }
  restore(document);
  if (document.root_extent?.start_offset !== 0 || document.root_extent?.end_offset !== source.length) {
    rejectAstBoundary('ast.source_identity', 'PowerShell AST root does not cover the complete source');
  }
  return document;
}

function runAstParserProcess(snapshot, extractorPath) {
  assertSourceSnapshotCurrent(snapshot);
  const started = performance.now();
  let result;
  try {
    result = spawnSync('pwsh', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-File', extractorPath, '-TargetPath', snapshot.path
    ], { input: snapshot.copyBytes(), encoding: 'utf8', timeout: 15_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  } finally {
    const elapsed = performance.now() - started;
    astProcessMetrics.count += 1;
    astProcessMetrics.total_ms += elapsed;
    astProcessMetrics.max_stdout_bytes = Math.max(astProcessMetrics.max_stdout_bytes, Buffer.byteLength(result?.stdout ?? ''));
    if (elapsed > astProcessMetrics.slowest_ms) {
      astProcessMetrics.slowest_ms = elapsed;
      astProcessMetrics.slowest_source = snapshot.path;
    }
    assertSourceSnapshotCurrent(snapshot);
  }
  return result;
}

function extractPowerShellAst(snapshot) {
  const root = mkdtempSync(resolve(tmpdir(), 'tecm-powershell-ast-'));
  const extractorPath = resolve(root, 'extract.ps1');
  let result;
  let elapsed = 0;
  try {
    writeFileSync(extractorPath, powershellAstExtractor);
    const started = performance.now();
    try { result = runAstParserProcess(snapshot, extractorPath); }
    finally { elapsed = performance.now() - started; }
    const document = parseAstProcessResult(result);
    assertAstSourceIdentity(document, snapshot.path);
    restoreAstExtents(document, snapshot);
    document.source_text = snapshot.text;
    return { document, snapshot, process: compactProcess(result) };
  } catch (error) {
    // Preserve bounded subprocess facts before the validator maps the failure
    // to its existing issue code. Never include source, huge stdout or paths.
    error.extraction = { boundary_code: error.code ?? 'ast.unclassified',
      ...compactProcess(result), error_name: result?.error?.name ?? null,
      error_errno: result?.error?.errno ?? null, error_syscall: result?.error?.syscall ?? null,
      elapsed_ms: elapsed, timeout_ms: 15_000, max_buffer_bytes: 8 * 1024 * 1024,
      stdout_bytes: Buffer.byteLength(result?.stdout ?? ''), stderr_bytes: Buffer.byteLength(result?.stderr ?? ''),
      stdout_sha256: sha256(result?.stdout ?? ''), stderr_sha256: sha256(result?.stderr ?? '') };
    throw error;
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

const exactArray = (actual, expected) => Array.isArray(actual) && actual.length === expected.length &&
  actual.every((value, index) => value === expected[index]);

function inspectAuthorizedM40Exit(ast, mainTry, verificationIf, mainTryRootIndex) {
  const allExits = ast.exits;
  const rootScopeExits = allExits.filter((entry) => entry.nearest_function === null);
  const exitEntry = allExits.length === 1 ? allExits[0] : null;
  const argument = exitEntry?.exit_argument;
  const argumentAccepted = Boolean(exitEntry) && argument?.pipeline_type === 'PipelineAst' &&
    normalizeAstText(argument.pipeline_text) === '1' && argument.pipeline_element_count === 1 &&
    exactArray(argument.pipeline_element_types, ['CommandExpressionAst']) &&
    argument.expression_type === 'ConstantExpressionAst' && normalizeAstText(argument.expression_text) === '1' &&
    argument.literal_value === 1 && argument.literal_value_type === 'System.Int32' &&
    argument.expression_static === true && argument.variable_references.length === 0 &&
    argument.command_count === 0 && argument.subexpression_count === 0 &&
    argument.scriptblock_expression_count === 0;

  const exitIfAncestors = exitEntry?.ancestors?.filter((entry) => entry.type === 'IfStatementAst') ?? [];
  const terminalIf = ast.ifs.find((entry) => sameExtent(entry.extent, exitIfAncestors[0]));
  const pendingIf = ast.ifs.find((entry) => sameExtent(entry.extent, exitIfAncestors[1]));
  const outerIf = ast.ifs.find((entry) => sameExtent(entry.extent, exitIfAncestors[2]));
  const terminalClause = terminalIf?.clauses?.length === 1 ? terminalIf.clauses[0] : null;
  const pendingClause = pendingIf?.clauses?.length === 1 ? pendingIf.clauses[0] : null;
  const outerClause = outerIf?.clauses?.length === 1 ? outerIf.clauses[0] : null;
  const exitAncestry = exactAncestorChain(exitEntry?.ancestors ?? [], [
    ancestorStep('StatementBlockAst', terminalClause?.body_extent, 'authorized M40 terminal guard body'),
    ancestorStep('IfStatementAst', terminalIf?.extent, 'authorized M40 terminal guard'),
    ancestorStep('StatementBlockAst', pendingClause?.body_extent, 'pending M40 terminal body'),
    ancestorStep('IfStatementAst', pendingIf?.extent, 'pending M40 terminal guard'),
    ancestorStep('StatementBlockAst', outerClause?.body_extent, 'verification failure body'),
    ancestorStep('IfStatementAst', outerIf?.extent, 'verification failure guard'),
    ancestorStep('NamedBlockAst', ast.root_body_extent, 'root executable body'),
    ancestorStep('ScriptBlockAst', ast.root_extent, 'root script')
  ]);
  const forbiddenExitAncestors = new Set([
    'FunctionDefinitionAst', 'ScriptBlockExpressionAst', 'ForEachStatementAst', 'ForStatementAst',
    'WhileStatementAst', 'DoWhileStatementAst', 'DoUntilStatementAst', 'SwitchStatementAst',
    'TrapStatementAst', 'TryStatementAst', 'CatchClauseAst', 'SubExpressionAst'
  ]);
  const forbiddenAncestors = exitEntry?.ancestors?.filter((entry) => forbiddenExitAncestors.has(entry.type)) ?? [];

  const condition = terminalClause?.condition_ast;
  const expectedConditionText = "$terminalExceptionMessage -eq $m40ExpectedTermination -and -not $cleanupError -and " +
    "$m40SidecarWriteCount -eq 1 -and $databaseCleanupLabel -eq 'PASS' -and $containerCleanupLabel -eq 'PASS'";
  const expectedLiterals = [
    ['ConstantExpressionAst', 1],
    ['StringConstantExpressionAst', 'PASS'],
    ['StringConstantExpressionAst', 'PASS']
  ];
  const conditionAccepted = condition?.type === 'PipelineAst' && condition.pipeline_element_count === 1 &&
    exactArray(condition.pipeline_element_types, ['CommandExpressionAst']) &&
    condition.expression_type === 'BinaryExpressionAst' &&
    exactArray(condition.variable_references, [
      'terminalExceptionMessage', 'm40ExpectedTermination', 'cleanupError', 'm40SidecarWriteCount',
      'databaseCleanupLabel', 'containerCleanupLabel'
    ]) && exactArray(condition.binary_operators, ['And', 'And', 'And', 'And', 'Ieq', 'Ieq', 'Ieq', 'Ieq']) &&
    exactArray(condition.unary_operators, ['Not']) && condition.dynamic_node_types.length === 0 &&
    condition.literals.length === expectedLiterals.length && condition.literals.every((literal, index) =>
      literal.type === expectedLiterals[index][0] && literal.value === expectedLiterals[index][1]) &&
    normalizeAstText(condition.extent?.text) === expectedConditionText;

  const terminalCalls = ast.commands.filter((command) => command.command_name === 'Write-M40TerminalOutcome');
  const terminalCall = terminalCalls.length === 1 ? terminalCalls[0] : null;
  const directTerminalBody = terminalClause?.body_statements ?? [];
  const directTerminalCall = terminalCall && directTerminalBody.length === 2 &&
    directTerminalBody[0].type === 'PipelineAst' && directTerminalBody[1].type === 'ExitStatementAst' &&
    sameExtent(terminalCall.enclosing_pipeline?.extent, directTerminalBody[0].extent) &&
    sameExtent(exitEntry?.extent, directTerminalBody[1].extent) && terminalCall.nearest_function === null &&
    normalizeAstText(terminalCall.extent?.text) === 'Write-M40TerminalOutcome' &&
    terminalCall.elements.length === 1;
  const enclosingGuardsAccepted = terminalIf?.nearest_function === null && terminalIf.clauses.length === 1 &&
    terminalIf.else_extent === null && terminalClause?.body_traps?.length === 0 &&
    pendingIf?.nearest_function === null && pendingIf.clauses.length === 1 && pendingIf.else_extent === null &&
    pendingClause?.body_traps?.length === 0 && exactVariableCondition(pendingClause, 'm40TerminalPending') &&
    outerIf?.nearest_function === null && outerIf.clauses.length === 1 && outerIf.else_extent === null &&
    outerClause?.body_traps?.length === 0 && exactVariableCondition(outerClause, 'verificationError') &&
    sameExtent(outerIf?.extent, verificationIf?.extent) && mainTryRootIndex >= 0 &&
    sameExtent(ast.root_statements[mainTryRootIndex + 1]?.extent, outerIf?.extent);

  const writerFunctions = ast.functions.filter((entry) => entry.name === 'Write-M40TerminalOutcome');
  const writer = writerFunctions.length === 1 ? writerFunctions[0] : null;
  const writerStatementTypes = writer?.end_block_statements?.map((entry) => entry.type) ?? [];
  const writerIfs = ast.ifs.filter((entry) => entry.nearest_function === 'Write-M40TerminalOutcome')
    .sort((left, right) => left.extent.start_offset - right.extent.start_offset);
  const writerAssignments = ast.assignments.filter((entry) => entry.nearest_function === 'Write-M40TerminalOutcome');
  const terminalRecordAssignments = writerAssignments.filter((entry) => normalizeAstText(entry.left) === '$terminalRecord');
  const terminalCountAssignments = writerAssignments.filter((entry) =>
    normalizeAstText(entry.left) === '$script:m40TerminalWriteCount' && normalizeAstText(entry.right) === '1');
  const writerOutputCommands = ast.commands.filter((command) => command.nearest_function === 'Write-M40TerminalOutcome' &&
    normalizeAstText(command.extent?.text) === 'Write-Host ($m40TerminalPrefix + $terminalJson)');
  const writerConditions = writerIfs.map((entry) => normalizeAstText(entry.clauses?.[0]?.condition));
  const writerAccepted = Boolean(writer) && writer.end_block_traps.length === 0 &&
    exactArray(writerStatementTypes, [
      'IfStatementAst', 'IfStatementAst', 'IfStatementAst', 'AssignmentStatementAst',
      'AssignmentStatementAst', 'AssignmentStatementAst', 'IfStatementAst',
      'AssignmentStatementAst', 'PipelineAst'
    ]) && exactArray(writerConditions, [
      '-not $m40SidecarMode -or -not $m40TerminalPending',
      '$m40SidecarWriteCount -ne 1 -or $m40TerminalWriteCount -ne 0',
      "$databaseCleanupLabel -ne 'PASS' -or $containerCleanupLabel -ne 'PASS'",
      '$terminalBytes.Length -eq 0 -or $terminalBytes.Length -gt $m40SidecarMaximumBytes'
    ]) && writerIfs.every((entry) => entry.clauses.length === 1 && entry.else_extent === null &&
      entry.clauses[0].body_traps.length === 0) && terminalRecordAssignments.length === 1 &&
    normalizeAstText(terminalRecordAssignments[0].right) ===
      '[ordered]@{ schema = $m40TerminalSchema producer = $m40TerminalProducer correlation = $m40SidecarCorrelation outcome = $m40ExpectedTermination database_cleanup = $databaseCleanupLabel container_cleanup = $containerCleanupLabel }' &&
    terminalCountAssignments.length === 1 && writerOutputCommands.length === 1 &&
    sameExtent(writerOutputCommands[0].enclosing_pipeline?.extent, writer.end_block_statements[8]?.extent) &&
    terminalCountAssignments[0].extent.start_offset < writerOutputCommands[0].extent.start_offset;

  const semanticWriterFunctions = ast.functions.filter((entry) => entry.name === 'Write-M40SemanticRecord');
  const semanticWriter = semanticWriterFunctions.length === 1 ? semanticWriterFunctions[0] : null;
  const semanticWriterInvocations = ast.invoke_members.filter((entry) => entry.nearest_function === 'Write-M40SemanticRecord');
  const atomicMoves = semanticWriterInvocations.filter((entry) => normalizeAstText(entry.expression) === '[IO.File]' &&
    normalizeAstText(entry.member) === 'Move');
  const committedReads = semanticWriterInvocations.filter((entry) => normalizeAstText(entry.expression) === '[IO.File]' &&
    normalizeAstText(entry.member) === 'ReadAllBytes');
  const utf8Reads = semanticWriterInvocations.filter((entry) => normalizeAstText(entry.member) === 'GetString');
  const semanticWriteCounts = ast.assignments.filter((entry) => entry.nearest_function === 'Write-M40SemanticRecord' &&
    normalizeAstText(entry.left) === '$script:m40SidecarWriteCount' && normalizeAstText(entry.right) === '1');
  const sidecarAtomicCommitAccepted = Boolean(semanticWriter) && atomicMoves.length === 1 && committedReads.length === 1 &&
    utf8Reads.length === 1 && semanticWriteCounts.length === 1 &&
    atomicMoves[0].extent.start_offset < committedReads[0].extent.start_offset &&
    committedReads[0].extent.start_offset < utf8Reads[0].extent.start_offset &&
    utf8Reads[0].extent.start_offset < semanticWriteCounts[0].extent.start_offset;

  const m40Functions = ast.functions.filter((entry) => entry.name === 'Invoke-TeacherAttendanceContention');
  const m40Function = m40Functions.length === 1 ? m40Functions[0] : null;
  const m40Commands = ast.commands.filter((entry) => entry.nearest_function === 'Invoke-TeacherAttendanceContention');
  const m40Assignments = ast.assignments.filter((entry) => entry.nearest_function === 'Invoke-TeacherAttendanceContention');
  const oneAssignment = (left, right = null) => {
    const matches = m40Assignments.filter((entry) => normalizeAstText(entry.left) === left &&
      (right === null || normalizeAstText(entry.right) === right));
    return matches.length === 1 ? matches[0] : null;
  };
  const oneCommand = (text) => {
    const matches = m40Commands.filter((entry) => normalizeAstText(entry.extent?.text) === text);
    return matches.length === 1 ? matches[0] : null;
  };
  const candidateReady = oneCommand('Write-Host "$m40LifecyclePrefix SEMANTIC_CANDIDATE_READY"');
  const postCandidate = oneAssignment('$m40PostCandidateAssertionSql');
  const holderRelease = oneAssignment('$holderReleaseSql');
  const holderTerminal = oneAssignment('$holderObservation');
  const jobFinalization = oneAssignment('$jobFinalization');
  const jobsStopped = oneAssignment('$jobsStopped', '$jobFinalization.JobsStopped');
  const jobsRemoved = oneAssignment('$jobsRemoved', '$jobFinalization.JobsRemoved');
  const barrierCleanup = oneAssignment('$barrierCleanupResult');
  const finalization = oneAssignment('$finalization');
  const lifecycle = oneAssignment('$lifecycle');
  const positiveM40 = oneAssignment('$positiveM40');
  const finalizationLine = oneCommand('Write-Host "$m40LifecyclePrefix FINALIZATION_PASS"');
  const semanticCalls = m40Commands.filter((entry) => entry.command_name === 'Write-M40SemanticRecord');
  const semanticCall = semanticCalls.length === 1 ? semanticCalls[0] : null;
  const sidecarCommitted = oneCommand('Write-Host "$m40LifecyclePrefix SIDECAR_COMMITTED"');
  const terminalPending = oneAssignment('$script:m40TerminalPending', '$true');
  const expectedTermination = oneCommand('Write-Host "[M40 EXPECTED TERMINATION] $m40ExpectedTermination"');
  const expectedThrows = ast.throws.filter((entry) => entry.nearest_function === 'Invoke-TeacherAttendanceContention' &&
    normalizeAstText(entry.extent?.text) === 'throw $m40ExpectedTermination');
  const expectedThrow = expectedThrows.length === 1 ? expectedThrows[0] : null;
  const positiveIf = ast.ifs.find((entry) => entry.nearest_function === 'Invoke-TeacherAttendanceContention' &&
    entry.clauses.length === 1 && exactVariableCondition(entry.clauses[0], 'positiveM40') &&
    inside(expectedThrow?.extent, entry.extent));
  const sidecarIf = ast.ifs.find((entry) => entry.nearest_function === 'Invoke-TeacherAttendanceContention' &&
    entry.clauses.length === 1 && exactVariableCondition(entry.clauses[0], 'm40SidecarMode') &&
    inside(sidecarCommitted?.extent, entry.extent));
  const positiveBodyAccepted = positiveIf?.else_extent === null && positiveIf.clauses[0].body_traps.length === 0 &&
    exactArray(positiveIf.clauses[0].body_statements.map((entry) => entry.type),
      ['IfStatementAst', 'PipelineAst', 'ThrowStatementAst']) &&
    sidecarIf?.else_extent === null && sidecarIf.clauses[0].body_traps.length === 0 &&
    exactArray(sidecarIf.clauses[0].body_statements.map((entry) => entry.type),
      ['PipelineAst', 'AssignmentStatementAst']) &&
    sameExtent(sidecarIf.extent, positiveIf.clauses[0].body_statements[0]?.extent) &&
    sameExtent(expectedTermination?.enclosing_pipeline?.extent, positiveIf.clauses[0].body_statements[1]?.extent) &&
    sameExtent(expectedThrow?.extent, positiveIf.clauses[0].body_statements[2]?.extent) &&
    sameExtent(sidecarCommitted?.enclosing_pipeline?.extent, sidecarIf.clauses[0].body_statements[0]?.extent) &&
    sameExtent(terminalPending?.extent, sidecarIf.clauses[0].body_statements[1]?.extent);
  const finalizationContract = normalizeAstText(finalization?.right) ===
    "if ($finalizationFailureCodes.Count -eq 0 -and $postCandidateAssertion -ne 'FAIL' -and $holderRelease -eq 'PASS' -and $holderTerminal -eq 'PASS' -and $competitorTerminal -eq 'PASS' -and $jobsStopped -ne 'FAIL' -and $jobsRemoved -eq 'PASS' -and $barrierCleanup -eq 'PASS') { 'PASS' } else { 'FAIL' }";
  const positiveContract = normalizeAstText(positiveM40?.right) ===
    "$semanticCandidate.IsExpectedM40 -and $allRejectionCodes.Count -eq 0 -and $finalization -eq 'PASS'";
  const orderedStages = [candidateReady, postCandidate, holderRelease, holderTerminal, jobFinalization, jobsStopped,
    jobsRemoved, barrierCleanup, finalization, lifecycle, positiveM40, finalizationLine, semanticCall,
    sidecarCommitted, terminalPending, expectedTermination, expectedThrow];
  const m40OrderAccepted = Boolean(m40Function) && orderedStages.every(Boolean) &&
    orderedStages.every((entry, index) => index === 0 || orderedStages[index - 1].extent.start_offset < entry.extent.start_offset) &&
    finalizationContract && positiveContract && positiveBodyAccepted &&
    inside(expectedThrow?.extent, mainTry.body_extent) && expectedThrow.extent.end_offset < mainTry.finally_extent.start_offset;

  const outerCleanupBeforeTermination = mainTry.finally_extent.end_offset < (terminalCall?.extent.start_offset ?? -1) &&
    (terminalCall?.extent.end_offset ?? Number.MAX_SAFE_INTEGER) < (exitEntry?.extent.start_offset ?? -1);
  const accepted = allExits.length === 1 && rootScopeExits.length === 1 && exitEntry?.nearest_function === null &&
    argumentAccepted && exitAncestry.accepted && forbiddenAncestors.length === 0 && conditionAccepted &&
    directTerminalCall && enclosingGuardsAccepted && writerAccepted && sidecarAtomicCommitAccepted &&
    m40OrderAccepted && outerCleanupBeforeTermination;
  return {
    accepted,
    total_exit_count: allExits.length,
    root_scope_exit_count: rootScopeExits.length,
    literal_exit_one: argumentAccepted,
    exit_argument: argument ?? null,
    ancestry: exitAncestry,
    forbidden_ancestors: [...new Set(forbiddenAncestors.map((entry) => entry.type))],
    exact_guard_condition: conditionAccepted,
    direct_terminal_body: Boolean(directTerminalCall),
    enclosing_guards: enclosingGuardsAccepted,
    terminal_writer: { accepted: writerAccepted, function_count: writerFunctions.length,
      statement_types: writerStatementTypes, output_count: writerOutputCommands.length },
    sidecar_atomic_commit: { accepted: sidecarAtomicCommitAccepted, function_count: semanticWriterFunctions.length,
      atomic_move_count: atomicMoves.length, committed_read_count: committedReads.length,
      utf8_read_count: utf8Reads.length, committed_count_assignment_count: semanticWriteCounts.length },
    m40_finalization_order: { accepted: m40OrderAccepted, function_count: m40Functions.length,
      ordered_stage_offsets: orderedStages.map((entry) => entry?.extent?.start_offset ?? null),
      finalization_contract: finalizationContract, positive_contract: positiveContract,
      positive_body: Boolean(positiveBodyAccepted) },
    outer_cleanup_before_terminal: outerCleanupBeforeTermination,
    terminal_call_count: terminalCalls.length
  };
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

// These names come from AST VariablePath/UserPath or literal command arguments,
// never from searching source text. Unknown qualifiers are not silently stripped.
function canonicalVariable(value) {
  if (typeof value !== 'string') return null;
  let name = value.toLowerCase();
  const qualifiedProvider = 'microsoft.powershell.core\\variable::';
  if (name.startsWith(qualifiedProvider)) name = 'variable:' + name.slice(qualifiedProvider.length);
  if (name.startsWith('variable::')) name = 'variable:' + name.slice('variable::'.length);
  let provider = null;
  if (name.startsWith('variable:')) {
    provider = 'variable';
    name = name.slice('variable:'.length);
    if (name.startsWith('\\') || name.startsWith('/')) name = name.slice(1);
  }
  let scope = null;
  const colon = name.indexOf(':');
  if (colon >= 0) {
    scope = name.slice(0, colon);
    if (!new Set(['script', 'global', 'local', 'private']).has(scope)) return null;
    name = name.slice(colon + 1);
  }
  if (!name || /[:*?\[\]]/.test(name)) return null;
  return { name, scope, provider };
}

const variableCommandAliases = new Map([
  ['sv', 'set-variable'], ['set', 'set-variable'], ['nv', 'new-variable'],
  ['rv', 'remove-variable'], ['clv', 'clear-variable'], ['gv', 'get-variable'],
  ['si', 'set-item'], ['ni', 'new-item'], ['ri', 'remove-item'], ['rm', 'remove-item'],
  ['del', 'remove-item'], ['erase', 'remove-item'], ['rd', 'remove-item'], ['rmdir', 'remove-item'],
  ['cli', 'clear-item'], ['copy', 'copy-item'], ['cp', 'copy-item'], ['cpi', 'copy-item'],
  ['move', 'move-item'], ['mv', 'move-item'], ['mi', 'move-item'], ['ren', 'rename-item'], ['rni', 'rename-item'],
  ['sc', 'set-content'], ['ac', 'add-content'], ['clc', 'clear-content'],
  ['sp', 'set-itemproperty'], ['clp', 'clear-itemproperty'], ['rp', 'remove-itemproperty'],
  ['gi', 'get-item'], ['sal', 'set-alias'], ['nal', 'new-alias'], ['ipal', 'import-alias']
]);

function canonicalCommand(command) {
  const raw = String(command.command_name ?? '').toLowerCase();
  const parts = raw.split('\\');
  if (parts.length === 2) {
    if (parts[0] !== 'microsoft.powershell.utility' && parts[0] !== 'microsoft.powershell.management') return raw;
    return variableCommandAliases.get(parts[1]) ?? parts[1];
  }
  return variableCommandAliases.get(raw) ?? raw;
}

function unwrapExpression(node) {
  const wrappers = new Set(['ParenExpressionAst', 'PipelineAst', 'CommandExpressionAst', 'StatementBlockAst']);
  while (node && wrappers.has(node.type) && node.inner) node = node.inner;
  return node;
}

// Separate from bindCommand: its existing exact-spelling contracts are unchanged.
function bindVariableArguments(command, parameters, switches = [], positions = []) {
  const bindings = new Map();
  const positional = [];
  for (let i = 1; i < command.elements.length; i += 1) {
    const element = command.elements[i];
    if (element.splatted) return null;
    let name;
    let value = element.expression_ast;
    if (element.type === 'CommandParameterAst') {
      const raw = String(element.parameter_name).toLowerCase();
      const key = commonParameterAliases.get(raw) ?? raw;
      const exact = parameters.find(name => name === key);
      const choices = exact ? [exact] : parameters.filter(name => name.startsWith(key));
      if (choices.length !== 1) return null;
      name = choices[0];
      if (switches.indexOf(name) >= 0) {
        value = element.argument?.expression_ast ?? { type: 'ConstantExpressionAst', value: true };
      } else {
        value = element.argument?.expression_ast;
        if (!value) {
          const next = command.elements[++i];
          if (!next || next.type === 'CommandParameterAst' || next.splatted) return null;
          value = next.expression_ast;
        }
      }
    } else {
      positional.push(value);
      continue;
    }
    if (bindings.has(name)) return null;
    bindings.set(name, unwrapExpression(value));
  }
  if (bindings.has('literalpath') && bindings.has('path')) return null;
  const remaining = positions.filter(name => !bindings.has(name) && !(name === 'path' && bindings.has('literalpath')));
  if (positional.length > remaining.length) return null;
  positional.forEach((value, index) => bindings.set(remaining[index], unwrapExpression(value)));
  return bindings;
}

const commonParameterAliases = new Map([
  ['ov', 'outvariable'], ['ev', 'errorvariable'], ['wv', 'warningvariable'],
  ['iv', 'informationvariable'], ['pv', 'pipelinevariable'], ['ob', 'outbuffer'],
  ['ea', 'erroraction'], ['wa', 'warningaction'], ['infa', 'informationaction'],
  ['vb', 'verbose'], ['db', 'debug'], ['proga', 'progressaction']
]);
const commonParameters = ['verbose', 'debug', 'erroraction', 'warningaction', 'informationaction',
  'progressaction', 'errorvariable', 'warningvariable', 'informationvariable', 'outvariable', 'outbuffer', 'pipelinevariable'];
const outputVariableParameters = new Set(['outvariable', 'errorvariable', 'warningvariable', 'informationvariable', 'pipelinevariable']);
function commonVariableParameter(key) {
  key = String(key ?? '').toLowerCase();
  key = commonParameterAliases.get(key) ?? key;
  const matches = commonParameters.includes(key) ? [key] : commonParameters.filter(name => name.startsWith(key));
  return matches.length === 1 && outputVariableParameters.has(matches[0]) ? matches[0] : null;
}

function resolveCommandVariableParameter(ast, command, token) {
  const key = String(token ?? '').toLowerCase();
  if (!key) return { kind: 'irrelevant' };
  const expanded = commonParameterAliases.get(key) ?? key;
  // Only tokens that could select an output-variable parameter need this
  // security decision. Other binding contracts retain their own validators.
  if (![...outputVariableParameters].some(name => name === expanded || name.startsWith(expanded)))
    return { kind: 'irrelevant' };
  const raw = String(command.command_name ?? '').toLowerCase();
  const unknown = reason => ({ kind: 'unknown', reason });
  if (command.elements[0]?.type !== 'StringConstantExpressionAst' || !raw || command.invocation_operator === 'Dot')
    return unknown('command is not a proven literal invocation');
  const definitions = ast.functions.filter(fn => canonicalVariable(fn.name)?.name === raw);
  const aliasCommands = ast.commands.filter(other => ['set-alias', 'new-alias', 'import-alias'].includes(canonicalCommand(other)));
  if (aliasCommands.some(other => {
    if (canonicalCommand(other) === 'import-alias') return true;
    const bound = bindVariableArguments(other, ['name', 'value', 'description', 'option', 'scope', 'force', 'passthru',
      'whatif', 'confirm', ...commonParameters], ['force', 'passthru', 'whatif', 'confirm', 'verbose', 'debug'], ['name', 'value']);
    const names = literalTargets(bound?.get('name'));
    return !names || names.some(name => name.toLowerCase() === raw);
  })) {
    // The existing unconditional alias-definition/import gates already reject
    // this script. Do not grant a custom-parameter exemption or add a second
    // classification to their established exact-code controls.
    return { kind: 'rejected', reason: 'existing alias-resolution gate rejects this command identity' };
  }
  if (raw === 'docker' && definitions.length === 0) return { kind: 'irrelevant', reason: 'native command contract' };
  if (raw.includes('\\') || variableCommandAliases.has(raw)) return unknown('module-qualified or alias identity has no local exemption');
  let custom = [];
  let parameters = [];
  if (definitions.length > 0) {
    if (definitions.length !== 1) return unknown('duplicate or shadow function definitions');
    const fn = definitions[0];
    const owner = fn.ancestors[1];
    if (String(fn.name).toLowerCase() !== raw || fn.ancestors[0]?.type !== 'NamedBlockAst' ||
        owner?.type !== 'ScriptBlockAst' || !command.ancestors.some(ancestor =>
          ancestor.type === 'ScriptBlockAst' && sameExtent(ancestor, owner)) || fn.extent.end_offset >= command.extent.start_offset)
      return unknown('function is not a preceding direct definition in a visible lexical scope');
    parameters = ast.parameters.filter(parameter => sameExtent(parameter.owner_scriptblock_extent, fn.body_extent) ||
      (!parameter.owner_scriptblock_extent && parameter.nearest_function?.toLowerCase() === raw &&
        inside(parameter.extent, fn.extent) && parameter.extent.end_offset <= fn.body_extent.start_offset));
    custom = parameters.map(parameter => String(parameter.name).toLowerCase());
    if (custom.length !== fn.parameters.length || new Set(custom).size !== custom.length ||
        parameters.some(parameter => parameter.attributes.some(attribute =>
          /^(?:alias|aliasattribute|system\.management\.automation\.aliasattribute)$/i.test(attribute.type_name ?? ''))))
      return unknown('parameter declarations or aliases cannot be bound uniquely');
  } else if (!['write-output', 'get-date', ...providerContracts.keys(),
    'set-variable', 'new-variable', 'clear-variable', 'remove-variable', 'get-variable'].includes(raw)) {
    return unknown('no unique visible local definition or supported command contract');
  }
  const effective = [...new Set([...custom, ...commonParameters])];
  const resolveToken = token => {
    token = token.toLowerCase();
    if (custom.includes(token)) return { kind: 'custom', name: token };
    token = commonParameterAliases.get(token) ?? token;
    const matches = effective.includes(token) ? [token] : effective.filter(name => name.startsWith(token));
    if (matches.length !== 1) return unknown('ambiguous or unbound parameter token');
    return { kind: custom.includes(matches[0]) ? 'custom' : outputVariableParameters.has(matches[0]) ? 'common' : 'irrelevant', name: matches[0] };
  };
  const resolution = resolveToken(key);
  if (parameters.length > 0) {
    // A local exemption requires the invocation's named binding to be intact,
    // not merely the presence of a matching declaration elsewhere in the AST.
    const seen = new Set();
    for (let index = 1; index < command.elements.length; index += 1) {
      const element = command.elements[index];
      if (element.splatted) return unknown('local invocation contains an unproven splat');
      if (element.type !== 'CommandParameterAst') return unknown('local positional binding is not proven');
      const bound = resolveToken(String(element.parameter_name));
      if (!bound.name || seen.has(bound.name)) return unknown('local named binding is ambiguous or duplicated');
      seen.add(bound.name);
      const parameter = parameters.find(parameter => parameter.name.toLowerCase() === bound.name);
      const isSwitch = parameter?.static_type === 'System.Management.Automation.SwitchParameter' ||
        (!parameter && ['verbose', 'debug'].includes(bound.name));
      if (!isSwitch && !element.argument) {
        const value = command.elements[++index];
        if (!value || value.splatted || value.type === 'CommandParameterAst') return unknown('named parameter argument is missing');
      }
    }
  }
  return resolution;
}

// Positions are cmdlet-specific. LiteralPath selects the corresponding set and
// removes Path from positional binding. Unsupported sets fail closed.
const providerContracts = new Map([
  ['copy-item', { positions: ['path', 'destination'], required: ['destination'], extra: ['destination', 'container', 'recurse', 'tosession', 'fromsession'] }],
  ['move-item', { positions: ['path', 'destination'], required: ['destination'], extra: ['destination'] }],
  ['rename-item', { positions: ['path', 'newname'], required: ['newname'], extra: ['newname'] }],
  ['set-item', { positions: ['path', 'value'], required: ['value'], extra: ['value'] }],
  ['new-item', { positions: ['path'], required: [], extra: ['name', 'value', 'itemtype'], literal: false }],
  ['clear-item', { positions: ['path'], required: [], extra: [] }],
  ['remove-item', { positions: ['path'], required: [], extra: ['recurse'] }],
  ['set-content', { positions: ['path', 'value'], required: ['value'], extra: ['value', 'encoding', 'nonewline', 'asbytestream'] }],
  ['add-content', { positions: ['path', 'value'], required: ['value'], extra: ['value', 'encoding', 'nonewline', 'asbytestream'] }],
  ['clear-content', { positions: ['path'], required: [], extra: [] }],
  ['set-itemproperty', { positions: ['path', 'name', 'value'], required: ['name', 'value'], extra: ['name', 'value'] }],
  ['new-itemproperty', { positions: ['path', 'name'], required: ['name', 'value'], extra: ['name', 'value', 'propertytype'] }],
  ['clear-itemproperty', { positions: ['path', 'name'], required: ['name'], extra: ['name'] }],
  ['remove-itemproperty', { positions: ['path', 'name'], required: ['name'], extra: ['name'] }],
  ['get-item', { positions: ['path'], required: [], extra: [] }]
]);

function staticCommandSplat(ast, command, element) {
  // A literal table immediately before this pipeline has no intervening code
  // that could rebind it. Deliberately do not infer general data flow.
  if (command.extent.start_offset !== command.enclosing_pipeline.extent.start_offset ||
      command.elements.slice(1).some(item => !item.splatted &&
        !['StringConstantExpressionAst', 'ConstantExpressionAst'].includes(item.type))) return null;
  const writes = ast.variable_writes.filter(write => write.operator === 'Equals' &&
    write.target.type === 'VariableExpressionAst' &&
    String(write.target.variable_path).toLowerCase() === String(element.expression_ast.variable_path).toLowerCase() &&
    write.extent.end_offset < command.enclosing_pipeline.extent.start_offset &&
    ast.source_text.slice(write.extent.end_offset, command.enclosing_pipeline.extent.start_offset).trim() === '');
  if (writes.length !== 1) return null;
  const table = unwrapExpression(writes[0].value);
  if (table?.type !== 'HashtableAst') return null;
  const entries = new Map();
  for (const entry of table.entries) {
    const keys = literalTargets(entry.key);
    const values = literalTargets(entry.value);
    if (keys?.length !== 1 || values?.length !== 1 || entries.has(keys[0].toLowerCase())) return null;
    entries.set(keys[0].toLowerCase(), values[0]);
  }
  return entries;
}

function literalTargets(node) {
  node = unwrapExpression(node);
  if (node?.type === 'ArrayLiteralAst') {
    const values = node.items.map(literalTargets);
    return values.some(value => value === null) ? null : values.flat();
  }
  return node?.type === 'StringConstantExpressionAst' ? [node.value] : null;
}

function isTemporaryFileTarget(ast, command, target) {
  // LiteralPath does not expand wildcards. A proven suffix cannot name any of
  // the protected variables. This preserves existing temporary-file cleanup.
  if (target?.type !== 'VariableExpressionAst' || target.splatted) return false;
  const name = canonicalVariable(target.variable_path)?.name;
  const writes = ast.variable_writes.filter(write => write.nearest_function === command.nearest_function &&
    write.variables.some(value => canonicalVariable(value)?.name === name));
  if (writes.length !== 1 || writes[0].operator !== 'Equals' ||
      writes[0].target.type !== 'VariableExpressionAst' || writes[0].extent.end_offset >= command.extent.start_offset) return false;
  // A command-based rebinding would invalidate the single-assignment proof.
  if (ast.commands.some(other => other !== command && other.nearest_function === command.nearest_function &&
    (['set-variable','new-variable','clear-variable','remove-variable','get-variable','get-item',
      'set-item','new-item','clear-item','remove-item','copy-item','move-item','rename-item',
      'set-content','add-content','clear-content','set-itemproperty','new-itemproperty',
      'clear-itemproperty','remove-itemproperty'].indexOf(canonicalCommand(other)) >= 0 ||
      other.elements.some(element => ['common', 'unknown', 'rejected'].includes(
        resolveCommandVariableParameter(ast, other, element.parameter_name).kind) ||
        (element.splatted && canonicalCommand(other) !== 'docker'))))) return false;
  const value = unwrapExpression(writes[0].value);
  if (value?.type === 'BinaryExpressionAst' && value.operator === 'Plus' &&
      value.right?.type === 'StringConstantExpressionAst') return ['.tmp', '.pending'].indexOf(value.right.value) >= 0;
  return value?.type === 'ExpandableStringExpressionAst' && ['.tmp', '.pending'].some(suffix =>
    value.value.endsWith(suffix) && value.nested_extents.every(extent => extent.end_offset <= value.extent.end_offset - suffix.length - 1));
}

function inspectProtectedWrites(ast, provenance) {
  const sourceNames = new Set(['capturesource', 'packetsource', 'observersource']);
  const result = { m40: [], sources: [], unresolved: [...ast.variable_api_accesses] };
  const record = (value, entry, providerOnly = false) => {
    if (providerOnly && typeof value === 'string') {
      const lower = value.toLowerCase();
      // Keep relative names in the check: the current provider can be Variable.
      if (['function:', 'alias:', 'env:', 'filesystem::'].some(prefix => lower.startsWith(prefix))) return;
    }
    const variable = canonicalVariable(value);
    if (!variable) { result.unresolved.push(entry); return; }
    if (variable.name === 'm40acceptance') result.m40.push(entry);
    if (sourceNames.has(variable.name)) result.sources.push(entry);
  };
  for (const write of ast.variable_writes) {
    for (const variable of write.variables) {
      // Function/Environment-provider references are not variable bindings.
      if (canonicalVariable(variable)) record(variable, write);
    }
  }
  for (const reference of ast.writable_references) {
    const target = unwrapExpression(reference.target);
    if (target?.type !== 'VariableExpressionAst' || target.splatted) result.unresolved.push(reference);
    else record(target.variable_path, reference);
  }
  for (const parameter of ast.parameters) {
    if (sourceNames.has(canonicalVariable(parameter.name)?.name) &&
        !provenance.chains.some(chain => chain.accepted && sameExtent(chain.parameter, parameter.extent))) result.sources.push(parameter);
  }
  const variableMutators = new Set(['set-variable', 'new-variable', 'clear-variable', 'remove-variable']);
  const switches = ['passthru', 'force', 'whatif', 'confirm', 'recurse', 'nonewline', 'verbose', 'debug',
    'valueonly', 'container', 'asbytestream'];
  for (const command of ast.commands) {
    const name = canonicalCommand(command);
    const leaf = name.split('\\').at(-1);
    const variable = variableMutators.has(leaf);
    const provider = providerContracts.has(leaf);
    const getter = leaf === 'get-variable' || leaf === 'get-item';
    if (variable || provider || getter) {
      if (name !== leaf) { result.unresolved.push(command); continue; }
      const contract = providerContracts.get(name);
      const names = provider ? ['path', ...(contract.literal === false ? [] : ['literalpath']), ...contract.extra,
        'passthru', 'force', 'whatif', 'confirm', 'include', 'exclude', 'filter', 'credential', ...commonParameters] :
        ['name', 'value', 'scope', 'description', 'option', 'visibility', 'passthru', 'force', 'whatif', 'confirm',
          'include', 'exclude', 'valueonly', ...commonParameters];
      const positions = provider ? contract.positions : ['set-variable', 'new-variable'].includes(name) ? ['name', 'value'] : ['name'];
      const bound = bindVariableArguments(command, names, switches, positions);
      if (!bound || (provider && contract.required.some(key => !bound.has(key))) ||
          (bound.has('tosession') || bound.has('fromsession'))) { result.unresolved.push(command); continue; }
      const target = bound?.get(variable || name === 'get-variable' ? 'name' : 'literalpath') ?? bound?.get('path');
      const targets = literalTargets(target);
      if (!targets) {
        if (!(provider && name === 'remove-item' && bound?.has('literalpath') && isTemporaryFileTarget(ast, command, target)))
          result.unresolved.push(command);
        continue;
      }
      // ValueOnly returns values, not PSVariable objects. Otherwise reject
      // protected handle acquisition even if its eventual use looks read-only.
      const valueOnly = name === 'get-variable' && bound.get('valueonly')?.type === 'ConstantExpressionAst' &&
        bound.get('valueonly').value === true;
      if (!valueOnly) for (const target of targets) record(target, command, provider);
      if (bound.has('destination') || bound.has('newname')) {
        const destinations = literalTargets(bound.get('destination') ?? bound.get('newname'));
        if (!destinations) result.unresolved.push(command);
        else for (const target of destinations) record(target, command, true);
      }
      // New-Item -Name is an item name, while property cmdlets use Name for
      // the property. Never confuse either with positional Value.
      if (name === 'new-item' && bound.has('name')) {
        const names = literalTargets(bound.get('name'));
        if (!names) result.unresolved.push(command);
        else for (const target of names) record(target, command, true);
      }
    }
    // These common parameters bind output into variables without an assignment AST.
    for (let i = 1; i < command.elements.length; i += 1) {
      const element = command.elements[i];
      const key = String(element.parameter_name ?? '').toLowerCase();
      const resolution = resolveCommandVariableParameter(ast, command, key);
      if (resolution.kind === 'unknown') { result.unresolved.push(command); continue; }
      if (resolution.kind !== 'common') continue;
      const targets = literalTargets(element.argument?.expression_ast ?? command.elements[i + 1]?.expression_ast);
      if (!targets) result.unresolved.push(command);
      else for (const target of targets) record(target.startsWith('+') ? target.slice(1) : target, command);
    }
    for (const element of command.elements.filter(element => element.splatted)) {
      // docker is the existing native-command contract (its function/alias
      // shadows are rejected separately); native arguments cannot bind common
      // PowerShell output-variable parameters.
      if (name === 'docker') continue;
      const entries = staticCommandSplat(ast, command, element);
      if (!entries) { result.unresolved.push(command); continue; }
      for (const [key, value] of entries) {
        const resolution = resolveCommandVariableParameter(ast, command, key);
        if (resolution.kind === 'unknown') result.unresolved.push(command);
        if (resolution.kind === 'common') record(value.startsWith('+') ? value.slice(1) : value, command);
      }
      // Only this bounded built-in binding is proven here. Provider, function,
      // mixed named/splat and unknown command bindings remain fail closed.
      const allowed = ['inputobject', 'noenumerate', ...commonParameters];
      const keys = [...entries.keys()].map(key => commonParameterAliases.get(key) ?? key);
      if (name !== 'write-output' || command.elements.some(element => element.type === 'CommandParameterAst') ||
          command.elements.filter(element => element.splatted).length !== 1 ||
          keys.some(key => !allowed.includes(key)) || new Set(keys).size !== keys.length) result.unresolved.push(command);
    }
  }
  return result;
}

const approvedWorkerSources = new Map([
  ['invoke-negativepreflightprocess', { source: 'capturesource', body: 'ff0ee094a24687c9509e7992ef9fede2144cfcf41ae0eb4b4f71fe884107f700' }],
  ['write-m40workerpacket', { source: 'packetsource', body: '3d47e40217bbc29d5bc54621bb8666b35c27dcdbecee739e18de2c645ea711e2' }],
  ['send-m40childobservation', { source: 'observersource', body: '2bf070b6906394260b9a63da0dcc008354e5bbaf7e67f938ccb1eeb9eb4c5df2' }]
]);

const compactExtent = extent => extent ? { start_offset: extent.start_offset, end_offset: extent.end_offset } : null;

function inspectWorkerProvenance(ast) {
  const transfers = [];
  const chains = [];
  for (const [helper, contract] of approvedWorkerSources) {
    const definitions = ast.functions.filter(fn => canonicalVariable(fn.name)?.name === helper);
    const definition = definitions[0];
    const definitionAccepted = definitions.length === 1 && ast.root_statements.some(statement =>
      statement.type === 'FunctionDefinitionAst' && sameExtent(statement.extent, definition.extent)) &&
      sha256(Buffer.from(definition.body_extent.text.replaceAll('\r\n', '\n'))) === contract.body;
    const installs = ast.commands.filter(command => {
      if (canonicalCommand(command) !== 'set-item') return false;
      const binding = bindVariableArguments(command, ['literalpath', 'value']);
      const targets = literalTargets(binding?.get('literalpath'));
      return targets?.length === 1 && targets[0].toLowerCase() === `function:${helper}`;
    });
    const install = installs[0];
    const jobs = ast.commands.filter(command => canonicalCommand(command) === 'start-job' &&
      command.elements.some(element => element.type === 'ScriptBlockExpressionAst' && inside(install?.extent, element.extent)));
    const job = jobs[0];
    const jobBinding = job && bindVariableArguments(job, ['name', 'scriptblock', 'argumentlist']);
    const block = jobBinding?.get('scriptblock');
    const args = jobBinding?.get('argumentlist');
    const parameters = block?.script_block_extent ? ast.parameters.filter(parameter =>
      sameExtent(parameter.owner_scriptblock_extent, block.script_block_extent))
      .sort((a, b) => a.extent.start_offset - b.extent.start_offset) : [];
    const positions = parameters.flatMap((parameter, index) =>
      canonicalVariable(parameter.name)?.name === contract.source ? [index] : []);
    const parameter = parameters[positions[0]];
    const argument = unwrapExpression(args?.items?.[positions[0]]);
    const supplied = argument?.type === 'InvokeMemberExpressionAst' && !argument.is_static &&
      argument.member?.toLowerCase() === 'tostring' && argument.arguments?.length === 0 &&
      argument.expression?.type === 'VariableExpressionAst' && !argument.expression.splatted &&
      argument.expression.variable_path.toLowerCase() === `function:${helper}`;
    const installBinding = install && bindVariableArguments(install, ['literalpath', 'value']);
    const create = unwrapExpression(installBinding?.get('value'));
    const reference = create?.arguments?.[0];
    const sourceReference = canonicalVariable(reference?.variable_path);
    const created = create?.type === 'InvokeMemberExpressionAst' && create.is_static &&
      create.member?.toLowerCase() === 'create' && create.expression?.type === 'TypeExpressionAst' &&
      ['scriptblock', 'system.management.automation.scriptblock'].indexOf(create.expression.type_name.toLowerCase()) >= 0 &&
      create.arguments.length === 1 && reference.type === 'VariableExpressionAst' && !reference.splatted &&
      sourceReference?.name === contract.source && [null, 'local', 'private'].indexOf(sourceReference.scope) >= 0;
    const accepted = definitionAccepted && installs.length === 1 && jobs.length === 1 &&
      canonicalVariable(job.nearest_function)?.name === 'invoke-teacherattendancecontention' &&
      args?.type === 'ArrayLiteralAst' && args.items.length === parameters.length && positions.length === 1 &&
      parameter.default_value === null && parameter.attributes.length === 0 && supplied && created &&
      definition.extent.end_offset < job.extent.start_offset && parameter.extent.end_offset < create.extent.start_offset;
    if (accepted) transfers.push(install);
    chains.push({ helper, source: contract.source, accepted: Boolean(accepted),
      definition: compactExtent(definition?.extent), parameter: compactExtent(parameter?.extent),
      argument: compactExtent(argument?.extent), installation: compactExtent(install?.extent) });
  }
  const shadows = ast.functions.filter(fn => ['start-job', 'set-item'].indexOf(canonicalVariable(fn.name)?.name) >= 0);
  const functionWrites = ast.variable_writes.filter(write => write.variables.some(value => {
    const path = value.toLowerCase();
    const name = path.startsWith('function:') ? canonicalVariable(path.slice('function:'.length))?.name : null;
    return approvedWorkerSources.has(name) || ['start-job', 'set-item'].indexOf(name) >= 0;
  }));
  const otherInstallers = ast.commands.filter(command => {
    if (transfers.indexOf(command) >= 0 ||
        ['set-item','new-item','clear-item','remove-item','copy-item','move-item','rename-item',
          'set-content','add-content','clear-content','set-itemproperty','new-itemproperty',
          'clear-itemproperty','remove-itemproperty'].indexOf(canonicalCommand(command)) < 0) return false;
    return command.elements.some(element => literalTargets(element.argument?.expression_ast ?? element.expression_ast)?.some(value =>
      value.toLowerCase().startsWith('function:') && approvedWorkerSources.has(canonicalVariable(value.slice('function:'.length))?.name)));
  });
  return { transfers, chains, accepted: chains.every(chain => chain.accepted) &&
    shadows.length === 0 && functionWrites.length === 0 && otherInstallers.length === 0 };
}

function validateBatch1RaceTopology(databasePath, workflowText, sourceSnapshot = null) {
  const issues = [];
  const add = (condition, code, message) => { if (!condition) issues.push({ code, message }); };
  let extraction;
  try {
    const snapshot = sourceSnapshot ?? captureSourceSnapshot(databasePath);
    assertAstSourceIdentity({ source_path: snapshot.path }, databasePath);
    extraction = extractPowerShellAst(snapshot);
  } catch (error) {
    issues.push({ code: 'powershell.runtime_or_output', message: error instanceof Error ? error.message : String(error) });
    return { issues, evidence: { extraction: 'FAIL', extraction_failure: error.extraction ?? null } };
  }
  const ast = extraction.document;
  const databaseText = extraction.snapshot.text;
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

  const commandName = canonicalCommand;
  const commandText = (command) => normalizeAstText(command.extent?.text).toLowerCase();
  const aliasDefinitions = ast.commands.filter((command) => ['set-alias', 'new-alias'].includes(commandName(command)));
  const aliasImports = ast.commands.filter((command) => commandName(command) === 'import-alias');
  const providerMutations = ast.commands.filter((command) => ['set-item', 'new-item'].includes(commandName(command)));
  const workerProvenance = inspectWorkerProvenance(ast);
  const workerTransfers = workerProvenance.transfers;
  const protectedWrites = inspectProtectedWrites(ast, workerProvenance);
  add(protectedWrites.m40.length === 0, 'scope.m40_acceptance_write', 'M40Acceptance must not be rewritten after parameter binding');
  add(protectedWrites.sources.length === 0, 'helper.source_write', 'Worker helper source parameters must not be rewritten');
  add(protectedWrites.unresolved.length === 0, 'variable.target_unknown', 'Variable-mutator targets must be statically provable');
  add(workerProvenance.accepted, 'helper.source_provenance', 'Worker helper sources must retain their unique approved AST provenance');
  const aliasProviderMutations = providerMutations.filter((command) => commandText(command).includes('alias:'));
  const functionProviderMutations = providerMutations.filter((command) => commandText(command).includes('function:') && !workerTransfers.includes(command));
  const dynamicProviderMutations = providerMutations.filter((command) =>
    !commandText(command).includes('alias:') && !commandText(command).includes('function:'));
  const invokeExpressions = ast.commands.filter((command) => ['invoke-expression', 'iex'].includes(commandName(command)));
  const scriptBlockCreates = ast.invoke_members.filter((entry) =>
    normalizeAstText(entry.member).toLowerCase() === 'create' &&
    normalizeAstText(entry.expression).toLowerCase().includes('scriptblock') &&
    !workerTransfers.some((command) => inside(entry.extent, command.extent)));
  const rootDotSources = ast.commands.filter((command) => command.nearest_function === null && command.invocation_operator === 'Dot');
  const observerFunction = ast.functions.find((fn) => fn.name === 'Invoke-NegativePreflightProcess');
  const observerParameter = ast.parameters.find((parameter) => parameter.name === 'DiagnosticObserver' &&
    parameter.nearest_function === 'Invoke-NegativePreflightProcess');
  const observerParameterAccepted = observerParameter?.static_type === 'System.Management.Automation.ScriptBlock' &&
    normalizeAstText(observerParameter.default_value?.extent?.text) === '$null' &&
    !ast.assignments.some((entry) => inside(entry.extent, observerFunction?.extent) &&
      entry.left_variables.some((name) => name.toLowerCase() === 'diagnosticobserver'));
  const literalObserverCalls = ast.commands.filter((command) => commandName(command) === 'invoke-negativepreflightprocess')
    .every((command) => command.elements.every((element, index) => element.parameter_name?.toLowerCase() !== 'diagnosticobserver' ||
      command.elements[index + 1]?.type === 'ScriptBlockExpressionAst'));
  const dynamicInvocations = ast.commands.filter((command) => command.command_name === null && !(
    command.nearest_function === 'Publish-M40ChildObservation' && inside(command.extent, observerFunction?.extent) &&
    command.invocation_operator === 'Ampersand' && command.elements[0]?.type === 'VariableExpressionAst' &&
    command.elements[0]?.text === '$DiagnosticObserver' && observerParameterAccepted && literalObserverCalls));
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
  // Complete no-argument verification enters this opt-in M40 exclusion block.
  // Retain direct statement/throw ownership inside it; arbitrary wrappers still fail.
  const scopeParameters = ast.root_parameters.filter(parameter => canonicalVariable(parameter.name)?.name === 'm40acceptance');
  const scopeParameter = scopeParameters[0];
  const repositoryScopes = ast.ifs.filter(entry => {
    const condition = entry.clauses[0]?.condition_ast;
    return entry.clauses.length === 1 && entry.else_extent === null &&
      condition?.expression_type === 'UnaryExpressionAst' &&
      exactArray(condition.unary_operators, ['Not']) && condition.binary_operators.length === 0 &&
      condition.dynamic_node_types.length === 0 && condition.literals.length === 0 &&
      condition.variable_references.length === 1 && canonicalVariable(condition.variable_references[0])?.name === 'm40acceptance' &&
      directIfStatementOwnership(entry, mainTry).accepted && entry.clauses[0].body_traps.length === 0;
  });
  // Structural ownership remains available for diagnostics even when a write is rejected.
  const scopeDefaultComplete = scopeParameters.length === 1 &&
    scopeParameter.static_type === 'System.Management.Automation.SwitchParameter' && scopeParameter.default_value === null;
  const repositoryScope = scopeDefaultComplete && repositoryScopes.length === 1 ? repositoryScopes[0] : null;
  const repositoryBody = repositoryScope ? repositoryScope.clauses[0] : mainTry;
  const repositoryScopeAncestors = repositoryScope ? [
    ancestorStep('StatementBlockAst', repositoryBody.body_extent, 'complete repository verification body'),
    ancestorStep('IfStatementAst', repositoryScope.extent, 'explicit opt-in M40 exclusion')
  ] : [];

  const setupPath = '/workspace/supabase/tests/concurrency/batch1_race_setup.sql';
  const setupExpected = ['value:exec', 'expression:$containerName', 'value:psql', 'parameter:q',
    'parameter:v', 'value:ON_ERROR_STOP=1', 'parameter:u', 'value:postgres',
    'parameter:d', 'expression:$database', 'parameter:f', `value:${setupPath}`];
  const setupCommands = mainBodyCommands.filter((command) => command.command_name === 'docker' &&
    command.elements.some((element) => element.value === setupPath));
  add(setupCommands.length === 1 && exactCommandElements(setupCommands[0], setupExpected),
    'setup.command_count', 'Batch 1 race setup must be one exact executable docker command');
  if (setupCommands.length === 1) {
    const setupOwnership = directMainStatementOwnership(setupCommands[0], repositoryBody);
    ownershipEvidence.setup = setupOwnership;
    add(setupOwnership.accepted, 'setup.executable_reachability',
      'Batch 1 setup command must directly own one top-level main-try PipelineAst statement');
    const setupStatementIndex = setupOwnership.statement_index;
    const failureStatement = repositoryBody.body_statements[setupStatementIndex + 1];
    const failureIf = ifForStatement(failureStatement);
    const setupThrow = withCompleteThrowAncestry(
      directThrowOwnership(ast, failureIf, null, '$LASTEXITCODE -ne 0',
        "throw 'Could not prepare Batch 1 race fixtures.'"),
      [
        ancestorStep('StatementBlockAst', failureIf?.clauses?.[0]?.body_extent, 'approved setup failure clause'),
        ancestorStep('IfStatementAst', failureIf?.extent, 'approved setup failure condition'),
        ...repositoryScopeAncestors,
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
    const invocationOwnership = directMainStatementOwnership(command, repositoryBody);
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
    const assertionStatement = repositoryBody.body_statements[invocationStatement + 1];
    const failureStatement = repositoryBody.body_statements[invocationStatement + 2];
    const assertionCommands = mainBodyCommands.filter((candidate) => inside(candidate.extent, assertionStatement?.extent));
    const assertion = assertionCommands.length === 1 ? assertionCommands[0] : null;
    const assertionExpected = ['value:exec', 'expression:$containerName', 'value:psql', 'parameter:q',
      'parameter:v', 'value:ON_ERROR_STOP=1'];
    for (const variable of spec.assertionVariables) assertionExpected.push('parameter:v', `value:${variable}`);
    assertionExpected.push('parameter:u', 'value:postgres', 'parameter:d', 'expression:$database',
      'parameter:f', 'value:/workspace/supabase/tests/concurrency/batch1_attendance_assert.sql');
    add(invocationStatement >= 0 && assertion?.command_name === 'docker' && exactCommandElements(assertion, assertionExpected),
      `race.${spec.name}.assertion_reachable`, `${spec.name} exact assertion command must execute immediately after both worker results`);
    const assertionOwnership = assertion ? directMainStatementOwnership(assertion, repositoryBody) : null;
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
        ...repositoryScopeAncestors,
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
  const alternativeTerminations = ast.invoke_members.filter((entry) =>
    /^(?:exit|failfast|setshouldexit)$/i.test(normalizeAstText(entry.member).replace(/^(['"])(.*)\1$/, '$2'))
  );
  const authorizedM40Exit = inspectAuthorizedM40Exit(ast, mainTry, verificationIf, mainTryRootIndex);
  const targetParameterName = 'TeacherAttendanceContentionOnly';
  const targetRootParameters = ast.root_parameters.filter((parameter) =>
    parameter.name.toLowerCase() === targetParameterName.toLowerCase());
  const targetParameters = ast.parameters.filter((parameter) =>
    parameter.name.toLowerCase() === targetParameterName.toLowerCase());
  const targetNameTextMentions = databaseText.match(/TeacherAttendanceContentionOnly/gi) ?? [];
  if (!authorizedM40Exit.accepted) {
    issues.push({ code: 'terminal.unauthorized_exit', message: 'Only the single AST-proven literal M40 failure exit is authorized' });
  }
  if (rootReturns.length > 0) issues.push({ code: 'terminal.unauthorized_return', message: 'Root execution must not contain ReturnStatementAst' });
  if (alternativeTerminations.length > 0) {
    issues.push({ code: 'terminal.alternative_termination', message: 'Process and host termination methods cannot bypass the literal M40 exit contract' });
  }
  if (targetNameTextMentions.length > 0) {
    issues.push({ code: 'terminal.contention_mode_present', message: 'Database verifier must not contain a contention-only mode, alias, activation, or reference' });
  }

  const controlFlowEvidence = {
    complete_verifier: {
      accepted: rootReturns.length === 0 && authorizedM40Exit.accepted && targetNameTextMentions.length === 0
        && alternativeTerminations.length === 0,
      root_count: targetRootParameters.length,
      all_parameter_count: targetParameters.length,
      reference_count: ast.target_variable_references.length,
      text_mention_count: targetNameTextMentions.length
    },
    root_exit_count: rootExits.length,
    total_exit_count: ast.exits.length,
    root_return_count: rootReturns.length,
    authorized_m40_exit: authorizedM40Exit
  };

  const databaseJob = extractWorkflowJob(workflowText, 'database');
  const verifierStepName = 'Verify migrations, repeatable seed, RLS, and SQL suites';
  const verifierStepInspection = inspectWorkflowStep(databaseJob, verifierStepName);
  const modeMentions = databaseJob?.filter((line) => /TeacherAttendanceContentionOnly/i.test(line)) ?? [];
  const verifierMentions = databaseJob?.filter((line) => /scripts\/testing\/database-verify\.ps1/i.test(line)) ?? [];
  const expectedDatabaseRuns = [
    'run: bash scripts/testing/verify-ci-checkout.sh',
    "run: docker pull postgres:15-alpine && docker image inspect postgres:15-alpine --format '{{.Id}}'",
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
  const adminJob = extractWorkflowJob(workflowText, 'admin-web');
  const adminProvisioning = validateWorkflowStep(adminJob, 'Prepare PostgreSQL image for database verification',
    "docker pull postgres:15-alpine && docker image inspect postgres:15-alpine --format '{{.Id}}'", null,
    'workflow.admin_postgres_image', issues);
  add(adminProvisioning?.found && adminProvisioning.start < adminJob.indexOf('      - run: npm run test:mutation:teacher-attendance'),
    'workflow.admin_postgres_order', 'Admin Web must prepare the PostgreSQL image before Teacher database mutations');
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
      source_identity: { raw_sha256: extraction.snapshot.raw_sha256, parser_text_sha256: extraction.snapshot.text_sha256,
        ast_bytes_sha256: ast.source_bytes_sha256, ast_text_sha256: ast.source_text_sha256,
        text_contract_sha256: sha256(databaseText), ast_source_text_sha256: sha256(ast.source_text) },
      main_try_start_offset: mainTry.extent.start_offset,
      command_resolution: commandResolutionEvidence,
      protected_variable_writes: protectedWrites,
      worker_source_provenance: workerProvenance.chains,
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
  const candidate = text.replace(search, () => replacement);
  const offset = text.indexOf(search);
  if (candidate === text || candidate !== text.slice(0, offset) + replacement + text.slice(offset + search.length)
      || (replacement.length > 0 && candidate.split(replacement).length !== text.split(replacement).length + 1)) {
    throw new Error('negative control exact splice failed');
  }
  return candidate;
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
  const candidate = text.slice(0, match.index) + replacement + text.slice(match.index + match[0].length);
  if (candidate === text || (replacement.length > 0
      && candidate.split(replacement).length !== text.split(replacement).length + 1)) {
    throw new Error('negative control pattern splice failed');
  }
  return candidate;
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
    if (!Array.isArray(spec.expectedCodes) || (spec.expectedCodes.length === 0 && !spec.positive)) {
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
    const exactCodeSet = spec.positive ? expectedCodes.length === 0 && observedCodes.length === 0 :
      exactCodeSetMatch(expectedCodes, observedCodes);
    const provenanceAccepted = validation.evidence?.worker_source_provenance?.length === 3 &&
      validation.evidence.worker_source_provenance.every(chain => chain.accepted);
    report = {
      id: spec.id,
      expected_failures: expectedCodes,
      observed_failures: observedCodes,
      exact_code_set_match: exactCodeSet,
      parser_valid: validation.evidence?.parse_errors === 0,
      approved_tokens_retained: tokensRetained,
      candidate_changed: candidateChanged,
      ...(spec.positive ? { worker_bindings_and_provenance_accepted: provenanceAccepted } : {}),
      mutation_proof: mutationProofs,
      ...(validation.evidence?.extraction_failure ? { extraction_failure: validation.evidence.extraction_failure } : {}),
      control_passed: exactCodeSet && tokensRetained && candidateChanged && mutationProven && (!spec.positive || provenanceAccepted) &&
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

function replaceAuthorizedM40Exit(text, replacement) {
  return replacePatternExactly(text, /      exit 1(?=\r?\n)/, replacement);
}

function moveAuthorizedM40ExitBefore(text, target, indentation = '    ') {
  const withoutAuthorizedExit = replaceAuthorizedM40Exit(text, '');
  return replaceExactly(withoutAuthorizedExit, target, `${indentation}exit 1\n${target}`);
}

function insertBeforeMainTry(text, insertion) {
  const offset = topologyValidation.evidence.main_try_start_offset;
  if (text !== databaseVerify || !Number.isInteger(offset)) throw new Error('Main-try mutation requires the parsed pristine source');
  recordMutationProof('ast', 'authoritative root main try', 1);
  return text.slice(0, offset) + insertion + text.slice(offset);
}

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

const authorizedExitControlSpecs = [
  ...[
    ['ENVIRONMENT-EXIT', '[Environment]::Exit(0)'],
    ['ENVIRONMENT-FAILFAST', "[Environment]::FailFast('CONTROL_ONLY')"],
    ['HOST-SETSHOULDEXIT', '$host.SetShouldExit(0)']
  ].map(([id, statement]) => ({
    id: `CONTROL-ALTERNATIVE-TERMINATION-${id}`,
    expectedCodes: ['terminal.alternative_termination'],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: insertBeforeBatch1Setup(fixture.database, `  ${statement}\n`) })
  })),
  {
    id: 'CONTROL-AUTHORIZED-M40-EXIT-ZERO', expectedCodes: ['terminal.unauthorized_exit'],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: replaceAuthorizedM40Exit(fixture.database, '      exit 0') })
  },
  {
    id: 'CONTROL-AUTHORIZED-M40-EXIT-VARIABLE', expectedCodes: ['terminal.unauthorized_exit'],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: replaceAuthorizedM40Exit(fixture.database,
      '      $authorizedM40ExitCode = 1\n      exit $authorizedM40ExitCode') })
  },
  {
    id: 'CONTROL-AUTHORIZED-M40-EXIT-EXPRESSION', expectedCodes: ['terminal.unauthorized_exit'],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: replaceAuthorizedM40Exit(fixture.database, '      exit (1 + 0)') })
  },
  {
    id: 'CONTROL-AUTHORIZED-M40-EXIT-DYNAMIC-ARGUMENT', expectedCodes: ['terminal.unauthorized_exit'],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: replaceAuthorizedM40Exit(fixture.database,
      '      exit $(Write-Output 1)') })
  },
  {
    id: 'CONTROL-AUTHORIZED-M40-SECOND-ROOT-EXIT', expectedCodes: ['terminal.unauthorized_exit'],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: replaceExactly(fixture.database,
      'if ($cleanupError) { throw $cleanupError }',
      'if ($cleanupError) { throw $cleanupError }\nexit 1') })
  },
  {
    id: 'CONTROL-AUTHORIZED-M40-EXIT-BEFORE-FINALIZATION', expectedCodes: ['terminal.unauthorized_exit'],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: moveAuthorizedM40ExitBefore(fixture.database,
      '    $finalization = if (') })
  },
  {
    id: 'CONTROL-AUTHORIZED-M40-EXIT-BEFORE-SIDECAR-COMMIT', expectedCodes: ['terminal.unauthorized_exit'],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: moveAuthorizedM40ExitBefore(fixture.database,
      '    Write-M40SemanticRecord -RaceName $RaceName `') })
  },
  {
    id: 'CONTROL-AUTHORIZED-M40-EXIT-BEFORE-SENTINEL', expectedCodes: ['terminal.unauthorized_exit'],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: moveAuthorizedM40ExitBefore(fixture.database,
      '      Write-Host "[M40 EXPECTED TERMINATION] $m40ExpectedTermination"', '      ') })
  },
  {
    id: 'CONTROL-AUTHORIZED-M40-EXIT-BEFORE-HOLDER-JOB-BARRIER-CLEANUP', expectedCodes: ['terminal.unauthorized_exit'],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: moveAuthorizedM40ExitBefore(fixture.database,
      '    $holderReleaseSql = ') })
  },
  {
    id: 'CONTROL-AUTHORIZED-M40-EXIT-IN-FALSE-BRANCH', expectedCodes: ['terminal.unauthorized_exit'],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: replaceAuthorizedM40Exit(fixture.database,
      '      if ($false) {\n        exit 1\n      }') })
  },
  {
    id: 'CONTROL-AUTHORIZED-M40-EXIT-IN-UNINVOKED-SCRIPTBLOCK', expectedCodes: ['terminal.unauthorized_exit'],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: replaceAuthorizedM40Exit(fixture.database,
      '      $unusedM40Exit = { exit 1 }') })
  },
  {
    id: 'CONTROL-AUTHORIZED-M40-EXIT-IN-FUNCTION', expectedCodes: ['terminal.unauthorized_exit'],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: replaceAuthorizedM40Exit(fixture.database,
      '      function Invoke-UnauthorizedM40Exit { exit 1 }') })
  },
  {
    id: 'CONTROL-AUTHORIZED-M40-EXIT-IN-LOOP', expectedCodes: ['terminal.unauthorized_exit'],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: replaceAuthorizedM40Exit(fixture.database,
      '      foreach ($m40ExitControl in @(1)) { exit 1 }') })
  },
  {
    id: 'CONTROL-AUTHORIZED-M40-EXIT-IN-SWALLOWING-TRY-CATCH', expectedCodes: ['terminal.unauthorized_exit'],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: replaceAuthorizedM40Exit(fixture.database,
      "      try { exit 1 } catch { Write-Host 'swallowed M40 exit control' }") })
  },
  {
    id: 'CONTROL-AUTHORIZED-M40-NORMAL-PATH-REACHABLE-EXIT',
    expectedCodes: ['database.verification_rethrow', 'terminal.unauthorized_exit'],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: replaceExactly(fixture.database,
      'if ($verificationError) {', 'if ($true) {') })
  },
  {
    id: 'CONTROL-AUTHORIZED-M40-RETURN-INSTEAD-OF-EXIT',
    expectedCodes: ['terminal.unauthorized_exit', 'terminal.unauthorized_return'],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: replaceAuthorizedM40Exit(fixture.database, '      return') })
  },
  {
    id: 'CONTROL-AUTHORIZED-M40-EARLY-ROOT-EXIT', expectedCodes: ['terminal.unauthorized_exit'],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: insertBeforeMainTry(fixture.database, 'exit 1\n\n') })
  },
  {
    id: 'CONTROL-AUTHORIZED-M40-HIDDEN-DYNAMIC-SECOND-EXIT',
    expectedCodes: ['command.dynamic_invocation', 'terminal.unauthorized_exit'],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: insertBeforeBatch1Setup(fixture.database, '  & { exit 1 }\n') })
  },
  {
    id: 'CONTROL-CONTENTION-SWITCH-DEFAULTS-TO-SHORTENED-MODE',
    expectedCodes: ['terminal.contention_mode_present'],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => ({ ...fixture, database: replaceExactly(fixture.database,
      '  [int]$ContentionHardTimeoutSeconds = 10,',
      '  [int]$ContentionHardTimeoutSeconds = 10,\n  [switch]$TeacherAttendanceContentionOnly = $true,') })
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
    expectedCodes: boundary === 'verification_error' ? [code, 'terminal.unauthorized_exit'] : [code],
    requiredTokens: mandatoryBatch1Tokens,
    mutate: (fixture) => wrapSafetyBoundary(fixture, boundary, 'false-wrapper')
  },
  {
    id: `CONTROL-${boundary.toUpperCase().replaceAll('_', '-')}-SWALLOWING-TRY-CATCH`,
    expectedCodes: boundary === 'verification_error' ? [code, 'terminal.unauthorized_exit'] : [code],
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
  id, expectedCodes: id === 'CONTROL-COMMAND-DYNAMIC-PROVIDER' ? [code, 'variable.target_unknown'] : [code], requiredTokens: mandatoryBatch1Tokens,
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

// These six fixtures use the existing disposable production-validator runner.
const protectedVariableControlSpecs = [
  ['CONTROL-M40-SCOPED-WRITE', 'scope.m40_acceptance_write', '$script:M40Acceptance = $true', 'main'],
  ['CONTROL-M40-SET-VARIABLE', 'scope.m40_acceptance_write', 'Set-Variable -Name M40Acceptance -Value $true', 'main'],
  ['CONTROL-M40-SET-VARIABLE-CASE', 'scope.m40_acceptance_write', 'Set-Variable -Name m40acceptance -Value $true', 'main'],
  ['CONTROL-CAPTURE-CASE-WRITE', 'helper.source_write', "$capturesource = 'Write-Host REVIEW_INJECTED'", 'worker'],
  ['CONTROL-CAPTURE-SCOPED-WRITE', 'helper.source_write', "$script:CaptureSource = 'Write-Host REVIEW_INJECTED'", 'worker'],
  ['CONTROL-CAPTURE-SET-VARIABLE', 'helper.source_write', "Set-Variable -Name CaptureSource -Value 'Write-Host REVIEW_INJECTED'", 'worker']
].map(([id, code, insertion, scope]) => ({
  id, expectedCodes: [code], requiredTokens: mandatoryBatch1Tokens,
  mutate: fixture => {
    const anchor = scope === 'main' ? '  if (-not $M40Acceptance) {' :
      "            Set-Item -LiteralPath 'function:Invoke-NegativePreflightProcess' -Value ([scriptblock]::Create($CaptureSource))";
    const indent = scope === 'main' ? '  ' : '            ';
    return { ...fixture, database: replaceExactly(fixture.database, anchor, indent + insertion + '\n' + anchor) };
  }
}));
commandResolutionControlSpecs.push(...protectedVariableControlSpecs);

const indirectMutationControlSpecs = [];
function indirectControl(id, insertion, expectedCodes, worker = false) {
  return {
    id: `CONTROL-INDIRECT-${id}`, expectedCodes, positive: expectedCodes.length === 0,
    requiredTokens: mandatoryBatch1Tokens,
    mutate: fixture => {
      const anchor = worker ?
        "            Set-Item -LiteralPath 'function:Invoke-NegativePreflightProcess' -Value ([scriptblock]::Create($CaptureSource))" :
        '  if (-not $M40Acceptance) {';
      return { ...fixture, database: replaceExactly(fixture.database, anchor, insertion + '\n' + anchor) };
    }
  };
}
for (const target of ['M40Acceptance', 'CaptureSource', 'PacketSource', 'ObserverSource']) {
  const code = target === 'M40Acceptance' ? 'scope.m40_acceptance_write' : 'helper.source_write';
  const value = target === 'M40Acceptance' ? '$true' : "'Write-Output REVIEW_INJECTED'";
  for (const [kind, insertion] of [
    ['REF', `$slot = [ref]$${target}\n$slot.Value = ${value}`],
    ['GET-VARIABLE', `$slot = Get-Variable ${target}\n$alias = $slot\n$alias.Value = ${value}`],
    ['GET-ITEM', `$slot = Get-Item Variable:${target}\n$slot.Value = ${value}`],
    ['PIPELINE', `Get-Variable ${target} | ForEach-Object { $_.Value = ${value} }`],
    ['GET-ITEM-PIPELINE', `gi Variable:${target} | % { $_.Value = ${value} }`]
  ]) indirectMutationControlSpecs.push(indirectControl(`${target.toUpperCase()}-${kind}`, insertion, [code], target !== 'M40Acceptance'));
}
for (const [id, insertion, codes] of [
  ['DYNAMIC-HANDLE', '$name = "CaptureSource"\n$slot = gv $name\n$slot.Value = "injected"', ['variable.target_unknown']],
  ['DYNAMIC-REF', '$slot = [ref](Get-Variable $name)\n$slot.Value = "injected"', ['variable.target_unknown']],
  ['COPY-DESTINATION', "$replacement = 'Write-Output REVIEW_INJECTED'\nCopy-Item Variable:replacement Variable:CaptureSource -Force", ['helper.source_write']],
  ['MOVE-DESTINATION', 'Move-Item Variable:replacement Variable:PacketSource -Force', ['helper.source_write']],
  ['RENAME-NEWNAME', 'Rename-Item Variable:replacement ObserverSource -Force', ['helper.source_write']],
  ['COPY-LITERALPATH', 'Copy-Item -LiteralPath Variable:replacement Variable:CaptureSource -Force', ['helper.source_write']],
  ['COPY-NAMED-AFTER-POSITIONAL', 'Copy-Item Variable:CaptureSource -Path Variable:replacement -Force', ['helper.source_write']],
  ['COPY-DYNAMIC-DESTINATION', 'Copy-Item Variable:replacement $destination', ['variable.target_unknown']],
  ['COPY-MISSING-DESTINATION', 'Copy-Item Variable:replacement', ['variable.target_unknown']],
  ['COPY-CONFLICTING-SETS', 'Copy-Item -Path Variable:replacement -LiteralPath Variable:replacement -Destination Variable:CaptureSource', ['variable.target_unknown']],
  ['SPLAT-OUTVARIABLE', "$options = @{ OutVariable = 'CaptureSource' }\nWrite-Output 'Write-Output REVIEW_INJECTED' @options | Out-Null", ['helper.source_write']],
  ['SPLAT-ALIAS', "$options = @{ oV = '+PacketSource' }\nWrite-Output 'injected' @options | Out-Null", ['helper.source_write']],
  ['SPLAT-DYNAMIC', 'Write-Output "injected" @options | Out-Null', ['variable.target_unknown']],
  ['SPLAT-REBIND', "$options = @{ OutVariable = 'unrelated' }\n$options.OutVariable = 'CaptureSource'\nWrite-Output 'injected' @options", ['variable.target_unknown']],
  ['SPLAT-OTHER-COMMAND', "$options = @{ OutVariable = 'CaptureSource' }\nGet-Date @options | Out-Null", ['helper.source_write', 'variable.target_unknown']],
  ['SPLAT-PIPELINE-PREDECESSOR', "$options = @{ OutVariable = 'unrelated' }\nWrite-Output 'injected' | Write-Output @options", ['variable.target_unknown']]
]) indirectMutationControlSpecs.push(indirectControl(id, insertion, codes));
for (const abbreviation of ['OutV', 'oUtVa', 'OutVar', 'OutVari', 'OutVaria', 'OutVariab', 'OutVariabl', 'OutVariable', 'OV']) {
  indirectMutationControlSpecs.push(indirectControl(`COMMON-${abbreviation.toUpperCase()}`,
    `Write-Output 'Write-Output REVIEW_INJECTED' -${abbreviation} CaptureSource | Out-Null`, ['helper.source_write']));
}
indirectMutationControlSpecs.push(
  indirectControl('POSITIVE-WORKER-BINDINGS', '$readOnly = @($CaptureSource, $PacketSource, $ObserverSource)', [], true),
  indirectControl('POSITIVE-READS-AND-UNRELATED',
    '$readOnly = $M40Acceptance\n$readOnly = Get-Variable M40Acceptance -ValueOnly\n$unrelated = 1\n$slot = [ref]$unrelated\n$slot.Value = 2\n$slot = Get-Variable unrelated\n$slot.Value = 3\nCopy-Item Variable:unrelated Variable:unrelatedCopy\nMove-Item Variable:unrelatedCopy Variable:unrelatedMoved\nRename-Item Variable:unrelatedMoved unrelatedRenamed', []),
  indirectControl('POSITIVE-STATIC-SPLAT', "$options = @{ OutVariable = 'unrelated' }\nWrite-Output 'safe' @options | Out-Null", [])
);

// Keep approved helper bodies byte-for-byte intact. The baseline proves both
// Publish-M40PipeLines calls; independent local functions exercise the same
// binding rules without weakening helper body-hash provenance.
const parameterBindingControlSpecs = [];
function parameterBindingControl(id, insertion, expectedCodes) {
  return {
    id: `CONTROL-PARAMETER-BINDING-${id}`, expectedCodes, positive: expectedCodes.length === 0,
    requiredTokens: mandatoryBatch1Tokens,
    mutate: fixture => ({ ...fixture, database: replaceExactly(fixture.database,
      'function Invoke-NegativePreflightProcess {', insertion + '\nfunction Invoke-NegativePreflightProcess {') })
  };
}
const pipeBindingDefinition = 'function Test-LocalPipeBinding { param([object]$Pipe, [bool]$Final = $false) Write-Output $Pipe }';
for (const [id, invocation] of [
  ['POSITIVE-PIPE', 'Test-LocalPipeBinding -Pipe $pipe'],
  ['POSITIVE-PIPE-FINAL', 'Test-LocalPipeBinding -Pipe $pipe -Final $true'],
  ['POSITIVE-CASE', 'Test-LocalPipeBinding -pIpE $pipe -fInAl $true']
]) parameterBindingControlSpecs.push(parameterBindingControl(id, `${pipeBindingDefinition}\n${invocation}`, []));
for (const parameter of ['Pipe', 'PipelineVariable', 'PV', 'pIpE', 'pV', 'oUtV']) {
  parameterBindingControlSpecs.push(parameterBindingControl(`COMMON-${parameter}`,
    `Write-Output 'injected' -${parameter} CaptureSource | Out-Null`, ['helper.source_write']));
}
for (const [id, insertion, expectedCodes] of [
  ['DYNAMIC-TARGET', "Write-Output 'injected' -Pipe $target", ['variable.target_unknown']],
  ['MISSING-DEFINITION', 'Test-MissingPipeBinding -Pipe $pipe', ['variable.target_unknown']],
  ['DUPLICATE-DEFINITION', `${pipeBindingDefinition}\n${pipeBindingDefinition}\nTest-LocalPipeBinding -Pipe $pipe`, ['variable.target_unknown']],
  ['SHADOW-DEFINITION', `${pipeBindingDefinition}\nfunction Test-BindingCaller { ${pipeBindingDefinition}\nTest-LocalPipeBinding -Pipe $pipe }`, ['variable.target_unknown']],
  ['CONDITIONAL-DEFINITION', `if ($true) { ${pipeBindingDefinition} }\nTest-LocalPipeBinding -Pipe $pipe`, ['variable.target_unknown']],
  ['INVISIBLE-DEFINITION', `function Test-BindingOwner { ${pipeBindingDefinition}\nWrite-Output 'owner' }\nTest-LocalPipeBinding -Pipe $pipe`, ['variable.target_unknown']],
  ['MODULE-IDENTITY', `${pipeBindingDefinition}\nUnprovenModule\\Test-LocalPipeBinding -Pipe $pipe`, ['variable.target_unknown']],
  ['DYNAMIC-COMMAND', `${pipeBindingDefinition}\n$command = 'Test-LocalPipeBinding'\n& $command -Pipe $pipe`, ['command.dynamic_invocation', 'variable.target_unknown']],
  ['ALIAS-IDENTITY', `${pipeBindingDefinition}\nSet-Alias -Name Test-LocalPipeBinding -Value Write-Output\nTest-LocalPipeBinding -Pipe $pipe`, ['command.alias_definition']],
  ['AMBIGUOUS-PREFIX', "function Test-PipelineBinding { param($PipelineInput) Write-Output $PipelineInput }\nTest-PipelineBinding -Pipe CaptureSource", ['variable.target_unknown']],
  ['DUPLICATE-NAMED-ARGUMENT', `${pipeBindingDefinition}\nTest-LocalPipeBinding -Pipe $pipe -pIpE $pipe`, ['variable.target_unknown']],
  ['LOCAL-SPLAT', `${pipeBindingDefinition}\n$options = @{ Pipe = 'safe' }\nTest-LocalPipeBinding @options`, ['variable.target_unknown']]
]) parameterBindingControlSpecs.push(parameterBindingControl(id, insertion, expectedCodes));

// Retain each exact Stage 1 counterexample as an independent control, at the
// original root-scope anchor, in addition to the broader handle matrix above.
const originalBypassControlSpecs = [
  ['M40-REF', '$slot = [ref]$M40Acceptance\n$slot.Value = $true', 'scope.m40_acceptance_write'],
  ['M40-HANDLE', '$slot = Get-Variable M40Acceptance\n$slot.Value = $true', 'scope.m40_acceptance_write'],
  ['M40-PIPELINE', 'Get-Variable M40Acceptance | ForEach-Object { $_.Value = $true }', 'scope.m40_acceptance_write'],
  ['CAPTURE-REF', "$slot = [ref]$CaptureSource\n$slot.Value = 'Write-Output REVIEW_INJECTED'", 'helper.source_write'],
  ['CAPTURE-HANDLE', "$slot = Get-Variable CaptureSource\n$slot.Value = 'Write-Output REVIEW_INJECTED'", 'helper.source_write'],
  ['CAPTURE-GETITEM', "$slot = Get-Item Variable:CaptureSource\n$slot.Value = 'Write-Output REVIEW_INJECTED'", 'helper.source_write'],
  ['COPY-POSITIONAL', "$replacement = 'Write-Output REVIEW_INJECTED'\nCopy-Item Variable:replacement Variable:CaptureSource -Force", 'helper.source_write'],
  ['OUTV', "Write-Output 'Write-Output REVIEW_INJECTED' -OutV CaptureSource | Out-Null", 'helper.source_write'],
  ['SPLAT', "$options = @{ OutVariable = 'CaptureSource' }\nWrite-Output 'Write-Output REVIEW_INJECTED' @options | Out-Null", 'helper.source_write']
].map(([id, insertion, code]) => ({ ...indirectControl(`STAGE1-${id}`, insertion, [code]), id: `CONTROL-ORIGINAL-BYPASS-${id}` }));

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
  ['CONTROL-UNVERIFIED-SPLATTING', ['command.protected_splat', 'race.staff-existing.arguments', 'race.staff-existing.first_file', 'race.staff-existing.second_file', 'variable.target_unknown']],
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
    schema_version: 8,
    source_path: databaseVerifyPath,
    source_bytes_sha256: databaseSourceSnapshot.raw_sha256,
    source_text_sha256: databaseSourceSnapshot.text_sha256,
    runtime: { parser_type: 'System.Management.Automation.Language.Parser' },
    parse_errors: [], commands: [], functions: [], ifs: [], throws: [], assignments: [], variable_writes: [], variable_api_accesses: [], writable_references: [], tries: [],
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
  const sourceBytes = Buffer.from('a\r\n😀b\n');
  const snapshot = createSourceSnapshot(databaseVerifyPath, sourceBytes);
  const compactDocument = () => ({ source_bytes_sha256: snapshot.raw_sha256, source_text_sha256: snapshot.text_sha256,
    root_extent: { source_extent: [0, sourceBytes.toString('utf8').length] },
    extent: { source_extent: [3, 6] }, nested_extents: [{ source_extent: [0, 0] }] });
  const compactCases = [
    { id: 'CONTROL-AST-COMPACT-SOURCE-HASH', code: 'ast.source_identity', mutate: doc => { doc.source_bytes_sha256 = sha256('different candidate'); } },
    { id: 'CONTROL-AST-COMPACT-NEGATIVE-OFFSET', code: 'ast.invalid_extent', mutate: doc => { doc.extent.source_extent[0] = -1; } },
    { id: 'CONTROL-AST-COMPACT-REVERSED-OFFSETS', code: 'ast.invalid_extent', mutate: doc => { doc.extent.source_extent = [6, 3]; } },
    { id: 'CONTROL-AST-COMPACT-OUTSIDE-SOURCE', code: 'ast.invalid_extent', mutate: doc => { doc.extent.source_extent[1] = 100; } },
    { id: 'CONTROL-AST-COMPACT-NONINTEGER-OFFSET', code: 'ast.invalid_extent', mutate: doc => { doc.extent.source_extent[0] = 0.5; } },
    { id: 'CONTROL-AST-COMPACT-MISSING-MARKER', code: 'ast.invalid_extent', mutate: doc => { doc.extent = {}; } },
    { id: 'CONTROL-AST-COMPACT-EXTRA-FIELD', code: 'ast.invalid_extent', mutate: doc => { doc.extent.text = 'untrusted'; } },
    { id: 'CONTROL-AST-COMPACT-TRUNCATED-ROOT', code: 'ast.source_identity', mutate: doc => { doc.root_extent.source_extent[1] -= 1; } }
  ];
  for (const spec of compactCases) {
    const document = compactDocument();
    spec.mutate(document);
    let observed = null;
    try { restoreAstExtents(document, snapshot); } catch (error) { observed = error.code; }
    controls.push({ id: spec.id, expected_classification: spec.code, observed_classification: observed,
      exact_match: observed === spec.code, control_passed: observed === spec.code });
  }
  const roundTrip = restoreAstExtents(compactDocument(), snapshot);
  controls.push({ id: 'CONTROL-AST-COMPACT-UNICODE-CRLF-ROUNDTRIP', control_passed:
    roundTrip.extent.text === '😀b' && roundTrip.extent.start_line === 2 && roundTrip.extent.start_column === 1 &&
    roundTrip.extent.end_line === 2 && roundTrip.extent.end_column === 4 &&
    roundTrip.root_extent.end_line === 3 && roundTrip.root_extent.end_column === 1 &&
    roundTrip.nested_extents[0].text === '' });
  let bufferClassification = null;
  try { parseAstProcessResult({ error: { code: 'ENOBUFS' } }); } catch (error) { bufferClassification = error.code; }
  controls.push({ id: 'CONTROL-AST-ENOBUFS', expected_classification: 'ast.enobufs', observed_classification: bufferClassification,
    exact_match: bufferClassification === 'ast.enobufs', control_passed: bufferClassification === 'ast.enobufs' });
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

function runSnapshotEncodingControls({ stopOnFailure = false } = {}) {
  const root = mkdtempSync(resolve(tmpdir(), 'tecm-ast-snapshot-controls-'));
  const targetPath = resolve(root, 'source.ps1');
  const oraclePath = resolve(root, 'coordinates.ps1');
  const controls = [];
  const fixtureLines = ["param([switch]$M40Acceptance)", '# snapshot fixture',
    'function Test-Snapshot {', "  Write-Output 'teacher'", '}', 'Test-Snapshot', ''];
  const fixtureBytes = Buffer.from(fixtureLines.join('\n'));
  // Independent coordinate oracle: real IScriptExtent fields, without the compact codec.
  const oracle = String.raw`
param([string]$TargetPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$reader = [IO.StreamReader]::new([Console]::OpenStandardInput(), [Text.UTF8Encoding]::new($false, $true), $true)
try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($text, $TargetPath, [ref]$tokens, [ref]$errors)
function Position($extent) {
  [ordered]@{ text = $extent.Text; start_offset = $extent.StartOffset; end_offset = $extent.EndOffset
    start_line = $extent.StartLineNumber; start_column = $extent.StartColumnNumber
    end_line = $extent.EndLineNumber; end_column = $extent.EndColumnNumber }
}
$result = [ordered]@{ parse_errors = @($errors).Count; root = Position $ast.Extent
  commands = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true) |
    ForEach-Object { Position $_.Extent }) }
[Console]::Out.Write(($result | ConvertTo-Json -Depth 8 -Compress))
`;
  const run = (id, expected, action) => {
    let observed = [];
    let facts = null;
    let error = null;
    try { facts = action(); }
    catch (caught) { observed = [caught.code ?? 'unexpected.error']; error = caught.message; }
    const exact = expected.length === 0 ? observed.length === 0 : exactCodeSetMatch(expected, observed);
    controls.push({ id, expected_failures: expected, observed_failures: observed,
      exact_code_set_match: exact, control_passed: exact, facts, ...(error ? { error } : {}) });
    return exact || !stopOnFailure;
  };
  const requireFact = (condition, message) => {
    if (!condition) rejectAstBoundary('control.snapshot_mismatch', message);
  };
  const sameCoordinates = (actual, expected) => ['text', 'start_offset', 'end_offset',
    'start_line', 'start_column', 'end_line', 'end_column'].every(key => actual?.[key] === expected?.[key]);
  const verifyCoordinates = bytes => {
    writeFileSync(targetPath, bytes);
    const snapshot = captureSourceSnapshot(targetPath);
    const extraction = extractPowerShellAst(snapshot);
    const reference = runAstParserProcess(snapshot, oraclePath);
    requireFact(reference.status === 0 && !reference.signal && !reference.error && !String(reference.stderr ?? '').trim(),
      'Actual-parser coordinate oracle failed');
    const expected = JSON.parse(reference.stdout);
    const ast = extraction.document;
    requireFact(ast.parse_errors.length === 0 && expected.parse_errors === 0, 'Encoding fixture did not parse');
    requireFact(sameCoordinates(ast.root_extent, expected.root) && ast.commands.length === expected.commands.length &&
      ast.commands.every((command, index) => sameCoordinates(command.extent, expected.commands[index])),
    'Compact coordinates differ from actual PowerShell extents');
    requireFact(ast.source_text === snapshot.text && ast.source_bytes_sha256 === snapshot.raw_sha256 &&
      ast.source_text_sha256 === snapshot.text_sha256, 'Extractor identities do not share the snapshot');
    return { actual_parser: true, compared_extents: 1 + ast.commands.length,
      raw_sha256: snapshot.raw_sha256, parser_text_sha256: snapshot.text_sha256 };
  };
  try {
    writeFileSync(oraclePath, oracle);
    const encodings = [
      ['UTF8', Buffer.from(fixtureLines.join('\n').replace('teacher', '教師出席'))],
      ['UTF8-BOM', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fixtureBytes])],
      ['BARE-CR', Buffer.from(fixtureLines.join('\r'))],
      ['LF', fixtureBytes],
      ['CRLF', Buffer.from(fixtureLines.join('\r\n'))],
      ['MIXED-NEWLINE', Buffer.from(fixtureLines.map((line, index) => line + (index === fixtureLines.length - 1 ? '' :
        ['\r', '\n', '\r\n'][index % 3])).join(''))],
      ['NON-BMP', Buffer.from(fixtureLines.join('\n').replace('teacher', '😀𝄞𐐷'))]
    ];
    for (const [name, bytes] of encodings) {
      if (!run(`CONTROL-AST-SNAPSHOT-${name}`, [], () => verifyCoordinates(bytes))) return controls;
    }
    if (!run('CONTROL-AST-SNAPSHOT-INVALID-UTF8', ['ast.source_identity'], () => {
      writeFileSync(targetPath, Buffer.from([0x23, 0xc3, 0x28]));
      captureSourceSnapshot(targetPath);
    })) return controls;
    if (!run('CONTROL-AST-SNAPSHOT-PATH-CHANGED', ['ast.source_identity'], () => {
      writeFileSync(targetPath, fixtureBytes);
      const snapshot = captureSourceSnapshot(targetPath);
      writeFileSync(targetPath, '# replaced after capture');
      const before = astProcessMetrics.count;
      try { extractPowerShellAst(snapshot); }
      finally { requireFact(astProcessMetrics.count === before, 'Changed source reached the parser'); }
    })) return controls;
    if (!run('CONTROL-AST-SNAPSHOT-POST-PARSE-CHANGE', ['ast.source_identity'], () => {
      writeFileSync(targetPath, fixtureBytes);
      const snapshot = captureSourceSnapshot(targetPath);
      // Exercise the same post-spawn byte barrier with a disposable writer child.
      const writerPath = resolve(root, 'change-source.ps1');
      writeFileSync(writerPath, "param([string]$TargetPath)\n$tokens = $null; $errors = $null\n" +
        "[void][System.Management.Automation.Language.Parser]::ParseInput([Console]::In.ReadToEnd(), [ref]$tokens, [ref]$errors)\n" +
        "[IO.File]::WriteAllText($TargetPath, '# changed during child')");
      runAstParserProcess(snapshot, writerPath);
    })) return controls;
    for (const [name, field] of [['RAW-HASH', 'source_bytes_sha256'], ['PARSER-TEXT-HASH', 'source_text_sha256']]) {
      if (!run(`CONTROL-AST-SNAPSHOT-${name}`, ['ast.source_identity'], () => {
        const snapshot = createSourceSnapshot(targetPath, fixtureBytes);
        const document = { source_bytes_sha256: snapshot.raw_sha256, source_text_sha256: snapshot.text_sha256,
          root_extent: { source_extent: [0, snapshot.text.length] } };
        document[field] = sha256('different source');
        restoreAstExtents(document, snapshot);
      })) return controls;
    }
    for (const [name, stdout, expected] of [['MALFORMED', '{malformed}', 'ast.malformed_json'],
      ['PARTIAL', '{"schema_version":8', 'ast.output_shape']]) {
      if (!run(`CONTROL-AST-SNAPSHOT-${name}-RESPONSE`, [expected], () => {
        parseAstProcessResult({ status: 0, signal: null, stdout, stderr: '' });
      })) return controls;
    }
    for (const [name, prefix, expected] of [['BOM-BASELINE', '', []],
      ['AST-TEXT-SAME-SNAPSHOT', '# TeacherAttendanceContentionOnly\n', ['terminal.contention_mode_present']]]) {
      if (!run(`CONTROL-AST-SNAPSHOT-${name}`, [], () => {
        writeFileSync(targetPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(prefix + databaseVerify)]));
        const snapshot = captureSourceSnapshot(targetPath);
        const validation = validateBatch1RaceTopology(targetPath, workflow, snapshot);
        const observed = validation.issues.map(issue => issue.code);
        requireFact(expected.length === 0 ? observed.length === 0 : exactCodeSetMatch(expected, observed),
          'Production topology or text contract did not match the captured candidate');
        const identity = validation.evidence.source_identity;
        requireFact(identity?.raw_sha256 === snapshot.raw_sha256 && identity.ast_bytes_sha256 === snapshot.raw_sha256 &&
          identity.parser_text_sha256 === snapshot.text_sha256 && identity.ast_text_sha256 === snapshot.text_sha256 &&
          identity.text_contract_sha256 === snapshot.text_sha256 && identity.ast_source_text_sha256 === snapshot.text_sha256 &&
          snapshot.raw_sha256 !== snapshot.text_sha256, 'AST and text contracts used different source snapshots');
        return { source_identity: identity, expected_topology_issues: expected, observed_topology_issues: observed };
      })) return controls;
    }
  } finally {
    writeFileSync(targetPath, fixtureBytes);
    const restoration = readFileSync(targetPath).equals(fixtureBytes);
    rmSync(root, { recursive: true, force: true });
    const cleanup = !existsSync(root);
    const repositoryRestoration = repositoryTopologyRestored();
    for (const control of controls) {
      control.restoration = restoration ? 'PASS' : 'FAIL';
      control.cleanup = cleanup ? 'PASS' : 'FAIL';
      control.repository_restoration = repositoryRestoration ? 'PASS' : 'FAIL';
      control.control_passed = control.control_passed && restoration && cleanup && repositoryRestoration;
    }
  }
  return controls;
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
    intended_result: 'no contention-only mode or root return, one authorized M40 failure exit, and exact unconditional no-argument Release invocation',
    control_passed: validation.issues.length === 0 && flow?.complete_verifier?.accepted === true &&
      flow.root_exit_count === 1 && flow.total_exit_count === 1 && flow.root_return_count === 0 &&
      flow.authorized_m40_exit?.accepted === true &&
      workflowInvocation?.exact_run_count === 1 && workflowInvocation?.contention_mode_mention_count === 0 &&
      workflowInvocation?.run_contract_accepted === true && workflowInvocation?.has_job_condition === false &&
      workflowInvocation?.has_continue_on_error === false && workflowInvocation?.has_step_condition_or_continue === false,
    complete_verifier: flow?.complete_verifier,
    workflow_invocation: workflowInvocation
  };
}

function buildAuthorizedM40ExitPositiveControl(validation) {
  const flow = validation.evidence?.control_flow;
  const authorized = flow?.authorized_m40_exit;
  return {
    id: 'CONTROL-AUTHORIZED-M40-LITERAL-EXIT-ONE',
    intended_result: 'exactly one literal exit 1 follows authoritative M40 finalization, atomic sidecar commit, sentinel, and outer cleanup',
    expected_exit_count: 1,
    observed_exit_count: flow?.total_exit_count ?? null,
    expected_literal_exit: 1,
    observed_literal_exit: authorized?.exit_argument?.literal_value ?? null,
    control_passed: validation.issues.length === 0 && flow?.root_exit_count === 1 &&
      flow?.total_exit_count === 1 && flow?.root_return_count === 0 && authorized?.accepted === true &&
      authorized?.literal_exit_one === true && authorized?.exact_guard_condition === true &&
      authorized?.direct_terminal_body === true && authorized?.enclosing_guards === true &&
      authorized?.terminal_writer?.accepted === true && authorized?.sidecar_atomic_commit?.accepted === true &&
      authorized?.m40_finalization_order?.accepted === true && authorized?.outer_cleanup_before_terminal === true,
    authorized_exit: authorized
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

const topologyValidation = validateBatch1RaceTopology(databaseVerifyPath, workflow, databaseSourceSnapshot);
for (const issue of topologyValidation.issues) failures.push(`[${issue.code}] ${issue.message}`);
const positiveTopologyControl = buildDirectTopologyPositiveControl(topologyValidation);
if (!positiveTopologyControl.control_passed) failures.push(
  `[${positiveTopologyControl.id}] repository commands are not direct executable main-try PipelineAst statements`
);
const completeVerifierPositiveControl = buildCompleteVerifierPositiveControl(topologyValidation);
if (!completeVerifierPositiveControl.control_passed) failures.push(
  `[${completeVerifierPositiveControl.id}] complete database verifier contract was not proven`
);
const authorizedM40ExitPositiveControl = buildAuthorizedM40ExitPositiveControl(topologyValidation);
if (!authorizedM40ExitPositiveControl.control_passed) failures.push(
  `[${authorizedM40ExitPositiveControl.id}] unique literal M40 failure exit contract was not proven`
);
const directThrowPositiveControl = buildDirectThrowPositiveControl(topologyValidation);
if (!directThrowPositiveControl.control_passed) failures.push(
  `[${directThrowPositiveControl.id}] safety-critical throws lack direct executable clause ownership`
);
const legacyTopologyControls = legacyTopologyControlSpecs.map(runTopologyControl);
const terminalControls = terminalControlSpecs.map(runTopologyControl);
const authorizedExitControls = authorizedExitControlSpecs.map(runTopologyControl);
const directThrowControls = directThrowControlSpecs.map(runTopologyControl);
const safetyWrapperControls = safetyWrapperControlSpecs.map(runTopologyControl);
const commandResolutionControls = commandResolutionControlSpecs.map(runTopologyControl);
const indirectMutationControls = indirectMutationControlSpecs.map(runTopologyControl);
const parameterBindingControls = parameterBindingControlSpecs.map(runTopologyControl);
const originalBypassControls = originalBypassControlSpecs.map(runTopologyControl);
const allMutationControls = [...legacyTopologyControls, ...terminalControls, ...authorizedExitControls, ...directThrowControls,
  ...safetyWrapperControls, ...commandResolutionControls, ...indirectMutationControls, ...parameterBindingControls, ...originalBypassControls];
for (const control of allMutationControls) {
  if (!control.control_passed) failures.push(
    `[${control.id}] topology negative control failed: observed=${JSON.stringify(control.observed_failures)} error=${control.error ?? 'none'} restoration=${control.restoration} cleanup=${control.cleanup}` +
      (control.extraction_failure ? ` extraction=${JSON.stringify(control.extraction_failure)}` : '')
  );
}
const astBoundaryControls = runAstBoundaryControls();
for (const control of astBoundaryControls) {
  if (!control.control_passed) failures.push(`[${control.id}] AST output boundary did not fail closed`);
}
const snapshotEncodingControls = runSnapshotEncodingControls();
for (const control of snapshotEncodingControls) {
  if (!control.control_passed) failures.push(`[${control.id}] snapshot/encoding control failed: ${JSON.stringify(control.observed_failures)}`);
}
const sourceOverrideControl = runSourceOverrideControl();
if (!sourceOverrideControl.control_passed) failures.push('[CONTROL-NO-SOURCE-PATH-OVERRIDE] normal invocation accepted an override');
const exactCodeSetComparatorControls = runExactCodeSetComparatorControls();
for (const control of exactCodeSetComparatorControls) {
  if (!control.control_passed) failures.push(`[${control.id}] exact code-set comparator self-test failed`);
}
const allControlsPassed = positiveTopologyControl.control_passed && completeVerifierPositiveControl.control_passed &&
  authorizedM40ExitPositiveControl.control_passed && directThrowPositiveControl.control_passed &&
  allMutationControls.every((control) => control.control_passed) &&
  astBoundaryControls.every((control) => control.control_passed) && sourceOverrideControl.control_passed &&
  snapshotEncodingControls.length === 16 && snapshotEncodingControls.every((control) => control.control_passed) &&
  exactCodeSetComparatorControls.every((control) => control.control_passed) &&
  new Set([positiveTopologyControl, completeVerifierPositiveControl, authorizedM40ExitPositiveControl, directThrowPositiveControl,
    ...allMutationControls, ...astBoundaryControls, ...snapshotEncodingControls, sourceOverrideControl, ...exactCodeSetComparatorControls].map(control => control.id)).size ===
      4 + allMutationControls.length + astBoundaryControls.length + snapshotEncodingControls.length + 1 + exactCodeSetComparatorControls.length;
if (!allControlsPassed && failures.length === 0) failures.push('Control aggregation or unique IDs failed');
const restorationPassed = repositoryTopologyRestored();
const cleanupPassed = [...allMutationControls, ...snapshotEncodingControls].every((control) => control.cleanup === 'PASS');
if (!restorationPassed) failures.push('Protected topology files were not restored');
if (!cleanupPassed) failures.push('Topology control cleanup failed');

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
{
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
    authorized_m40_exit_positive_control: authorizedM40ExitPositiveControl,
    direct_throw_positive_control: directThrowPositiveControl,
    negative_controls: legacyTopologyControls,
    terminal_controls: terminalControls,
    authorized_exit_controls: authorizedExitControls,
    direct_throw_controls: directThrowControls,
    safety_wrapper_controls: safetyWrapperControls,
    command_resolution_controls: commandResolutionControls,
    indirect_mutation_controls: indirectMutationControls,
    parameter_binding_controls: parameterBindingControls,
    original_bypass_controls: originalBypassControls,
    snapshot_encoding_controls: snapshotEncodingControls,
    performance: { elapsed_ms: performance.now() - guardStarted, ast_subprocesses: {
      ...astProcessMetrics, average_ms: astProcessMetrics.count ? astProcessMetrics.total_ms / astProcessMetrics.count : 0 },
      CI_TIMEOUT_WATCH: 'Retained: compare complete guard duration against the unchanged CI job timeout.' },
    exact_code_set_comparator_controls: exactCodeSetComparatorControls,
    control_totals: {
      legacy_negative: legacyTopologyControls.length,
      terminal_negative: terminalControls.length,
      authorized_exit_negative: authorizedExitControls.length,
      direct_throw_negative: directThrowControls.length,
      safety_wrapper_negative: safetyWrapperControls.length,
      command_resolution_negative: commandResolutionControls.length,
      indirect_negative: indirectMutationControls.filter(control => control.expected_failures.length > 0).length,
      indirect_positive: indirectMutationControls.filter(control => control.expected_failures.length === 0).length,
      parameter_binding_negative: parameterBindingControls.filter(control => control.expected_failures.length > 0).length,
      parameter_binding_positive: parameterBindingControls.filter(control => control.expected_failures.length === 0).length,
      original_bypass_negative: originalBypassControls.length,
      ast_boundary: astBoundaryControls.length,
      snapshot_encoding: snapshotEncodingControls.length,
      exact_code_set_comparator: exactCodeSetComparatorControls.length,
      source_override: 1,
      positive: 4,
      total: legacyTopologyControls.length + terminalControls.length + authorizedExitControls.length + directThrowControls.length +
        safetyWrapperControls.length + commandResolutionControls.length + indirectMutationControls.length + parameterBindingControls.length +
        originalBypassControls.length + astBoundaryControls.length + snapshotEncodingControls.length +
        exactCodeSetComparatorControls.length + 1 + 4
    },
    ast_extraction: topologyValidation.evidence,
    ast_boundary_controls: astBoundaryControls,
    source_override_control: sourceOverrideControl,
    protected_hashes: Object.fromEntries([...protectedTopologySnapshots].map(([path, bytes]) => [path.slice(repositoryRoot.length + 1).replaceAll('\\', '/'), sha256(bytes)])),
    failures,
    aggregation: allControlsPassed && restorationPassed && cleanupPassed ? 'PASS' : 'FAIL',
    restoration: restorationPassed ? 'PASS' : 'FAIL',
    cleanup: cleanupPassed ? 'PASS' : 'FAIL',
    final_result: failures.length === 0 && allControlsPassed && restorationPassed && cleanupPassed ? 'PASS' : 'FAIL'
  }));
}
