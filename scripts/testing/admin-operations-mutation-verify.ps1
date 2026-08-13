param(
  [string]$PostgresImage = 'postgres:15-alpine',
  [ValidateRange(1, 3600)]
  [int]$CommandTimeoutSeconds = $(if ($env:TECM_MUTATION_COMMAND_TIMEOUT_SECONDS) { [int]$env:TECM_MUTATION_COMMAND_TIMEOUT_SECONDS } else { 120 }),
  [ValidateRange(1, 3600)]
  [int]$ReadyTimeoutSeconds = $(if ($env:TECM_MUTATION_READY_TIMEOUT_SECONDS) { [int]$env:TECM_MUTATION_READY_TIMEOUT_SECONDS } else { 60 }),
  [string[]]$CaseFilter = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$database = 'tecm_mutation_verify'

$setupFiles = @(
  'supabase/tests/000_bootstrap.sql',
  'supabase/migrations/202607110000_legacy_baseline.sql',
  'supabase/migrations/202607110001_tenant_operations_finance.sql',
  'supabase/migrations/202607110002_invariants_rls_rpcs.sql',
  'supabase/migrations/202607110003_release_blockers.sql',
  'supabase/tests/000_legacy_parent_fixture.sql',
  'supabase/migrations/202607150004_parent_notifications.sql',
  'supabase/seed.sql',
  'supabase/seed.sql',
  'supabase/tests/000_foundation_security_fixture.sql',
  'supabase/migrations/202607180005_foundation_security.sql',
  'supabase/migrations/202607180005_foundation_security.sql',
  'supabase/tests/000_apns_outbox_reliability_legacy_fixture.sql',
  'supabase/migrations/202607180006_apns_outbox_reliability.sql',
  'supabase/migrations/202607180006_apns_outbox_reliability.sql',
  'supabase/migrations/202607180007_apns_dispatch_ambiguity.sql',
  'supabase/migrations/202607180007_apns_dispatch_ambiguity.sql',
  'supabase/migrations/202607180008_apns_completion_outcome.sql',
  'supabase/migrations/202607180008_apns_completion_outcome.sql',
  'supabase/migrations/202608020009_admin_operations_integrity.sql',
  'supabase/migrations/202608020009_admin_operations_integrity.sql',
  'supabase/migrations/202608020010_admin_operations_release_gate.sql',
  'supabase/migrations/202608020010_admin_operations_release_gate.sql',
  'supabase/migrations/202608020011_makeup_partial_state_recovery.sql',
  'supabase/migrations/202608020011_makeup_partial_state_recovery.sql',
  'supabase/migrations/202608050012_uat_core_workflows.sql',
  'supabase/migrations/202608050012_uat_core_workflows.sql',
  'supabase/migrations/202608130013_course_cohort_enrollment_model.sql',
  'supabase/migrations/202608130013_course_cohort_enrollment_model.sql'
)

$targetAssertion = 'supabase/tests/013_admin_operations_release_gate.sql'

$cases = @(
  [pscustomobject]@{
    Case = 'M14'
    Description = 'Remove cross-organization membership-only teacher identity rejection.'
    MutationFile = 'supabase/migrations/202608020010_admin_operations_release_gate.sql'
    TargetAssertion = $targetAssertion
    ExpectedFailure = 'cross-org membership-only identity was linked'
    Search = @'
  if exists (
    select 1
    from public.organization_members
    where user_id = target_user_id
      and organization_id <> target_organization_id
  ) then
    raise exception 'teacher identity belongs to another organization';
  end if;

'@
    Replacement = ''
  },
  [pscustomobject]@{
    Case = 'M15'
    Description = 'Remove makeup booking idempotency payload mismatch rejection.'
    MutationFile = 'supabase/migrations/202608020011_makeup_partial_state_recovery.sql'
    TargetAssertion = $targetAssertion
    ExpectedFailure = 'mismatched makeup booking payload was accepted'
    Search = @'
    if existing_session.entitlement_id is distinct from target_entitlement_id
      or existing_session.teacher_id is distinct from target_teacher_id
      or existing_session.scheduled_at <> target_scheduled_at then
      raise exception 'idempotency key payload mismatch';
    end if;
'@
    Replacement = ''
  },
  [pscustomobject]@{
    Case = 'M16'
    Description = 'Allow ambiguous makeup completion when multiple scheduled sessions exist.'
    MutationFile = 'supabase/migrations/202608020011_makeup_partial_state_recovery.sql'
    TargetAssertion = $targetAssertion
    ExpectedFailure = 'makeup task with multiple scheduled sessions was completed'
    Search = '  if total_sessions <> 1 or scheduled_sessions <> 1 then'
    Replacement = '  if total_sessions < 1 or scheduled_sessions < 1 then'
  },
  [pscustomobject]@{
    Case = 'M17'
    Description = 'Bypass staff leave idempotency replay lookup before mutable validation.'
    MutationFile = 'supabase/migrations/202608020010_admin_operations_release_gate.sql'
    TargetAssertion = $targetAssertion
    ExpectedFailure = 'M17 stale leave replay was validated before idempotency lookup'
    Search = @'
  select * into existing_request
  from public.leave_requests
  where organization_id = target_organization_id
    and idempotency_key = target_idempotency_key
  for update;
'@
    Replacement = @'
  select * into existing_request
  from public.leave_requests
  where organization_id = target_organization_id
    and idempotency_key = target_idempotency_key || ':mutated'
  for update;
'@
  },
  [pscustomobject]@{
    Case = 'M18'
    Description = 'Leave a withdrawn duplicate enrollment invisible instead of reactivating it.'
    MutationFile = 'supabase/migrations/202608130013_course_cohort_enrollment_model.sql'
    TargetAssertion = 'supabase/tests/016_course_cohort_enrollment_model.sql'
    ExpectedFailure = 'withdrawn membership was not restored'
    Search = "      set status = 'active', left_at = null, joined_at = current_date"
    Replacement = "      set left_at = null, joined_at = current_date"
  },
  [pscustomobject]@{
    Case = 'M19'
    Description = 'Remove the student tenant join from parent authorization.'
    MutationFile = 'supabase/migrations/202607180005_foundation_security.sql'
    TargetAssertion = 'supabase/tests/015_uat_core_workflows.sql'
    ExpectedFailure = 'parent-student tenant condition no longer blocks unsafe legacy link'
    Search = '     and s.organization_id=psl.organization_id'
    Replacement = ''
  },
  [pscustomobject]@{
    Case = 'M20'
    Description = 'Restore the invalid global student-only active membership unique index.'
    MutationFile = 'supabase/migrations/202608130013_course_cohort_enrollment_model.sql'
    TargetAssertion = 'supabase/tests/016_course_cohort_enrollment_model.sql'
    ExpectedFailure = 'unique_active_exam_membership'
    Search = 'drop index if exists public.unique_active_exam_membership;'
    Replacement = @'
create unique index if not exists unique_active_exam_membership
  on public.cohort_students(student_id) where is_active_membership;
'@
  },
  [pscustomobject]@{
    Case = 'M21'
    Description = 'Remove the same-Course active membership recheck.'
    MutationFile = 'supabase/migrations/202608130013_course_cohort_enrollment_model.sql'
    TargetAssertion = 'supabase/tests/016_course_cohort_enrollment_model.sql'
    ExpectedFailure = 'same-course second cohort enrollment was accepted'
    Search = '      and ec.course_id = cohort_course'
    Replacement = '      and false'
  },
  [pscustomobject]@{
    Case = 'M22'
    Description = 'Remove the tenant check from the controlled Course-link path.'
    MutationFile = 'supabase/migrations/202608130013_course_cohort_enrollment_model.sql'
    TargetAssertion = 'supabase/tests/016_course_cohort_enrollment_model.sql'
    ExpectedFailure = 'cross-tenant course link was accepted'
    Search = @'
  select * into course_row from public.courses
  where id = target_course_id and organization_id = target_organization_id and is_active
  for share;
'@
    Replacement = @'
  execute 'alter table public.exam_cohorts disable trigger trg_exam_cohorts_tenant_fk';
  select * into course_row from public.courses
  where id = target_course_id and is_active
  for share;
'@
  },
  [pscustomobject]@{
    Case = 'M23'
    Description = 'Remove the transfer transaction lock.'
    MutationFile = 'supabase/migrations/202608130013_course_cohort_enrollment_model.sql'
    TargetAssertion = 'supabase/tests/016_course_cohort_enrollment_model.sql'
    ExpectedFailure = 'transfer advisory lock missing'
    Search = @'
  if source_cohort_id = target_cohort_id then raise exception 'transfer cohorts must differ'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended('student-enrollment:' || target_organization_id::text || ':' || target_student_id::text, 0)
  );
'@
    Replacement = @'
  if source_cohort_id = target_cohort_id then raise exception 'transfer cohorts must differ'; end if;
'@
  },
  [pscustomobject]@{
    Case = 'M24'
    Description = 'Allow a legacy NULL-Course active enrollment to be bypassed.'
    MutationFile = 'supabase/migrations/202608130013_course_cohort_enrollment_model.sql'
    TargetAssertion = 'supabase/tests/016_course_cohort_enrollment_model.sql'
    ExpectedFailure = 'legacy NULL-course UAT did not return course-link business failure'
    Search = '      and ec.course_id is null'
    Replacement = "      and ec.course_id = '00000000-0000-0000-0000-000000000000'::uuid"
  },
  [pscustomobject]@{
    Case = 'M25'
    Description = 'Restore direct authenticated enrollment DML bypass.'
    MutationFile = 'supabase/migrations/202608130013_course_cohort_enrollment_model.sql'
    TargetAssertion = 'supabase/tests/016_course_cohort_enrollment_model.sql'
    ExpectedFailure = 'authenticated direct enrollment DML bypassed canonical RPC'
    Search = 'revoke insert, update, delete on public.cohort_students from authenticated;'
    Replacement = 'grant insert, update, delete on public.cohort_students to authenticated;'
  },
  [pscustomobject]@{
    Case = 'M26'
    Description = 'Swallow a transfer failure after mutating the source instead of rolling back.'
    MutationFile = 'supabase/migrations/202608130013_course_cohort_enrollment_model.sql'
    TargetAssertion = 'supabase/tests/016_course_cohort_enrollment_model.sql'
    ExpectedFailure = 'atomic transfer state is incorrect'
    Search = '  if destination_membership.id is null then'
    Replacement = @'
  return jsonb_build_object('ok', false, 'status', 'partial');
  if destination_membership.id is null then
'@
  }
)

if ($CaseFilter.Count -gt 0) {
  $cases = @($cases | Where-Object { $_.Case -in $CaseFilter })
  if ($cases.Count -ne $CaseFilter.Count) { throw 'One or more requested mutation cases do not exist.' }
}

function ConvertTo-WorkspacePath {
  param([Parameter(Mandatory)][string]$RelativePath)
  return '/workspace/' + ($RelativePath -replace '\\', '/')
}

function Get-FileSha256 {
  param([Parameter(Mandatory)][string]$Path)
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Invoke-ProcessBounded {
  param(
    [Parameter(Mandatory)][string]$FileName,
    [Parameter(Mandatory)][string[]]$Arguments,
    [Parameter(Mandatory)][int]$TimeoutSeconds
  )

  function Join-ProcessArguments {
    param([Parameter(Mandatory)][string[]]$ArgumentList)
    return ($ArgumentList | ForEach-Object {
      if ($_ -notmatch '[\s"]') { $_ } else { '"' + ($_.Replace('"', '\"')) + '"' }
    }) -join ' '
  }

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $FileName
  $startInfo.Arguments = Join-ProcessArguments -ArgumentList $Arguments
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  [void]$process.Start()
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()

  $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
  if ($timedOut) {
    try { $process.Kill($true) } catch { try { $process.Kill() } catch {} }
    $process.WaitForExit()
  }

  [pscustomobject]@{
    ExitCode = if ($timedOut) { $null } else { $process.ExitCode }
    TimedOut = $timedOut
    Stdout = $stdoutTask.GetAwaiter().GetResult()
    Stderr = $stderrTask.GetAwaiter().GetResult()
  }
}

function Invoke-Docker {
  param(
    [Parameter(Mandatory)][string[]]$Arguments,
    [int]$TimeoutSeconds = $CommandTimeoutSeconds
  )
  return Invoke-ProcessBounded -FileName 'docker' -Arguments $Arguments -TimeoutSeconds $TimeoutSeconds
}

function Invoke-Git {
  param([Parameter(Mandatory)][string[]]$Arguments)
  return Invoke-ProcessBounded -FileName 'git' -Arguments $Arguments -TimeoutSeconds 30
}

function Copy-SqlInputs {
  param([Parameter(Mandatory)][string]$TempRoot)

  $relativeFiles = @($setupFiles + $targetAssertion + @($cases | ForEach-Object { $_.TargetAssertion })) | Select-Object -Unique
  foreach ($relativeFile in $relativeFiles) {
    $source = Join-Path $repoRoot $relativeFile
    if (-not (Test-Path -LiteralPath $source)) {
      throw "Required SQL input is missing: $relativeFile"
    }
    $destination = Join-Path $TempRoot $relativeFile
    $destinationDirectory = Split-Path -Parent $destination
    New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
  }
}

function Apply-Mutation {
  param(
    [Parameter(Mandatory)]$CaseDefinition,
    [Parameter(Mandatory)][string]$TempRoot
  )

  $mutationPath = Join-Path $TempRoot $CaseDefinition.MutationFile
  $sourceSha = Get-FileSha256 -Path $mutationPath
  $content = Get-Content -Raw -LiteralPath $mutationPath
  $matchCount = ([regex]::Matches($content, [regex]::Escape($CaseDefinition.Search))).Count
  if ($matchCount -ne 1) {
    throw "Mutation search pattern matched $matchCount times for $($CaseDefinition.Case)."
  }
  $mutated = $content.Replace($CaseDefinition.Search, $CaseDefinition.Replacement)
  Set-Content -LiteralPath $mutationPath -Value $mutated -NoNewline
  $mutatedSha = Get-FileSha256 -Path $mutationPath

  return [pscustomobject]@{
    SourceSha256 = $sourceSha
    MutatedSha256 = $mutatedSha
    Restored = (Get-FileSha256 -Path (Join-Path $repoRoot $CaseDefinition.MutationFile)) -eq $sourceSha
  }
}

function Wait-PostgresReady {
  param([Parameter(Mandatory)][string]$ContainerName)

  $stableReadyChecks = 0
  $deadline = [Diagnostics.Stopwatch]::StartNew()
  while ($deadline.Elapsed.TotalSeconds -lt $ReadyTimeoutSeconds) {
    $ready = Invoke-Docker -Arguments @('exec', $ContainerName, 'pg_isready', '-q', '-U', 'postgres', '-d', $database) -TimeoutSeconds 10
    if (-not $ready.TimedOut -and $ready.ExitCode -eq 0) {
      $stableReadyChecks++
      if ($stableReadyChecks -ge 2) { return $true }
    } else {
      $stableReadyChecks = 0
    }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Invoke-PsqlFile {
  param(
    [Parameter(Mandatory)][string]$ContainerName,
    [Parameter(Mandatory)][string]$RelativeFile
  )

  return Invoke-Docker -Arguments @(
    'exec', $ContainerName, 'psql', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', $database, '-f', (ConvertTo-WorkspacePath $RelativeFile)
  )
}

function Get-SanitizedFailureClass {
  param(
    [Parameter(Mandatory)]$Result,
    [Parameter(Mandatory)][string]$ExpectedFailure
  )

  $combined = (($Result.Stdout, $Result.Stderr) -join "`n")
  if ($Result.TimedOut) { return 'timeout' }
  if ($Result.ExitCode -eq 0) { return 'assertion_unexpectedly_passed' }
  if ($combined.Contains($ExpectedFailure)) { return 'expected_assertion_failure' }
  if ($combined -match '(?i)(syntax error|does not exist|permission denied|could not open file|duplicate key|violates)') {
    return 'unexpected_setup_or_compile_failure'
  }
  return 'unexpected_assertion_failure'
}

function Invoke-MutationCase {
  param([Parameter(Mandatory)]$CaseDefinition)

  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("tecm-admin-mutation-{0}-{1}" -f $CaseDefinition.Case, ([guid]::NewGuid().ToString('N')))
  $containerName = "tecm-admin-mutation-$($CaseDefinition.Case.ToLowerInvariant())-$PID"
  $cleanup = [ordered]@{ container_removed = $false; temp_removed = $false }
  $caseEvidence = [ordered]@{
    case = $CaseDefinition.Case
    mutation_description = $CaseDefinition.Description
    mutation_file = $CaseDefinition.MutationFile
    target_assertion = $CaseDefinition.TargetAssertion
    expected_failure = $CaseDefinition.ExpectedFailure
    source_sha256 = $null
    mutated_sha256 = $null
    classification = $null
    setup_file = $null
    assertion_exit_code = $null
    assertion_timed_out = $false
    restoration = $null
    cleanup = $cleanup
  }

  try {
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
    Copy-SqlInputs -TempRoot $tempRoot
    $mutation = Apply-Mutation -CaseDefinition $CaseDefinition -TempRoot $tempRoot
    $caseEvidence.source_sha256 = $mutation.SourceSha256
    $caseEvidence.mutated_sha256 = $mutation.MutatedSha256
    $caseEvidence.restoration = if ($mutation.Restored) { 'source_worktree_unchanged' } else { 'source_worktree_changed' }
    if (-not $mutation.Restored) {
      $caseEvidence.classification = 'source_restoration_failure'
      return [pscustomobject]$caseEvidence
    }

    $run = Invoke-Docker -Arguments @(
      'run', '--name', $containerName,
      '-e', 'POSTGRES_PASSWORD=postgres',
      '-e', "POSTGRES_DB=$database",
      '-v', "${tempRoot}:/workspace:ro",
      '-d', $PostgresImage
    )
    if ($run.TimedOut -or $run.ExitCode -ne 0) {
      $caseEvidence.classification = 'environment_container_start_failure'
      return [pscustomobject]$caseEvidence
    }

    if (-not (Wait-PostgresReady -ContainerName $containerName)) {
      $caseEvidence.classification = 'environment_database_ready_timeout'
      return [pscustomobject]$caseEvidence
    }

    foreach ($file in $setupFiles) {
      $caseEvidence.setup_file = $file
      $setup = Invoke-PsqlFile -ContainerName $containerName -RelativeFile $file
      if ($setup.TimedOut) {
        $caseEvidence.classification = 'setup_timeout'
        return [pscustomobject]$caseEvidence
      }
      if ($setup.ExitCode -ne 0) {
        $caseEvidence.classification = 'setup_or_compile_failure'
        return [pscustomobject]$caseEvidence
      }
    }

    $caseEvidence.setup_file = $null
    $assertion = Invoke-PsqlFile -ContainerName $containerName -RelativeFile $CaseDefinition.TargetAssertion
    $caseEvidence.assertion_exit_code = $assertion.ExitCode
    $caseEvidence.assertion_timed_out = $assertion.TimedOut
    $caseEvidence.classification = Get-SanitizedFailureClass -Result $assertion -ExpectedFailure $CaseDefinition.ExpectedFailure
    return [pscustomobject]$caseEvidence
  } catch {
    $caseEvidence.classification = 'harness_failure'
    $caseEvidence.error = $_.Exception.Message
    return [pscustomobject]$caseEvidence
  } finally {
    $removeContainer = Invoke-Docker -Arguments @('rm', '-f', $containerName) -TimeoutSeconds 30
    $cleanup.container_removed = (-not $removeContainer.TimedOut) -and ($removeContainer.ExitCode -eq 0 -or $removeContainer.Stderr.Contains('No such container'))
    if (Test-Path -LiteralPath $tempRoot) {
      Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    $cleanup.temp_removed = -not (Test-Path -LiteralPath $tempRoot)
  }
}

$evidence = [ordered]@{
  harness = 'admin-operations-mutation-verify'
  postgres_image = $PostgresImage
  command_timeout_seconds = $CommandTimeoutSeconds
  ready_timeout_seconds = $ReadyTimeoutSeconds
  environment = 'unknown'
  cases = @()
  verification = [ordered]@{}
  final_result = 'failed'
}

try {
  $dockerInfo = Invoke-Docker -Arguments @('info', '--format', '{{.ServerVersion}}') -TimeoutSeconds 30
  if ($dockerInfo.TimedOut -or $dockerInfo.ExitCode -ne 0) {
    $evidence.environment = 'docker_unavailable'
  } else {
    $evidence.environment = 'docker_available'
    foreach ($caseDefinition in $cases) {
      $evidence.cases += Invoke-MutationCase -CaseDefinition $caseDefinition
    }
  }

  $diffCheck = Invoke-Git -Arguments @('diff', '--check', '--', 'scripts/testing/admin-operations-mutation-verify.ps1')
  $status = Invoke-Git -Arguments @('status', '--porcelain')
  $head = Invoke-Git -Arguments @('rev-parse', 'HEAD')
  $trackedDiff = Invoke-Git -Arguments @('diff', '--quiet', '--')

  $evidence.verification.diff_check_exit_code = $diffCheck.ExitCode
  $evidence.verification.diff_check_clean = (-not $diffCheck.TimedOut) -and $diffCheck.ExitCode -eq 0
  $evidence.verification.worktree_head = $head.Stdout.Trim()
  $evidence.verification.worktree_status_porcelain = @($status.Stdout -split "`r?`n" | Where-Object { $_ })
  $evidence.verification.tracked_worktree_clean = (-not $trackedDiff.TimedOut) -and $trackedDiff.ExitCode -eq 0

  $allCasesCaught = $evidence.environment -eq 'docker_available' -and @(
    $evidence.cases | Where-Object { $_.classification -ne 'expected_assertion_failure' }
  ).Count -eq 0
  $allCleanupComplete = @(
    $evidence.cases | Where-Object { -not $_.cleanup.container_removed -or -not $_.cleanup.temp_removed }
  ).Count -eq 0

  if ($allCasesCaught -and $allCleanupComplete -and $evidence.verification.diff_check_clean -and $evidence.verification.tracked_worktree_clean) {
    $evidence.final_result = 'passed'
  } elseif ($evidence.environment -ne 'docker_available') {
    $evidence.final_result = 'environment_failed_closed'
  } else {
    $evidence.final_result = 'failed_closed'
  }
} catch {
  $evidence.final_result = 'harness_failed_closed'
  $evidence.error = $_.Exception.Message
} finally {
  $json = $evidence | ConvertTo-Json -Depth 8
  Write-Output $json
}

if ($evidence.final_result -ne 'passed') {
  exit 1
}
