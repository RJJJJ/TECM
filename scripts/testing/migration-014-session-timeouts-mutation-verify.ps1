param(
  [string]$PostgresImage = 'postgres:15-alpine',
  [ValidateRange(1, 120)]
  [int]$ReadyTimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$migrationRelativePath = 'supabase/migrations/202608140014_teacher_attendance_history_access.sql'
$migrationPath = Join-Path $repoRoot $migrationRelativePath
$database = 'tecm_m35'
$containerName = "tecm-m35-timeouts-$PID"
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("tecm-m35-timeouts-" + [guid]::NewGuid().ToString('N'))
$originalMigration = [IO.File]::ReadAllText($migrationPath)
$originalHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $migrationPath).Hash.ToLowerInvariant()
$cleanup = [ordered]@{ container = 'PENDING'; temp = 'PENDING' }

$prerequisites = @(
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
  'supabase/migrations/202608130013_course_cohort_enrollment_model.sql'
)

function Assert-MigrationTimeoutContract {
  param([Parameter(Mandatory)][string]$Sql)

  $lockSet = $Sql.IndexOf("set lock_timeout = '5s';", [StringComparison]::OrdinalIgnoreCase)
  $statementSet = $Sql.IndexOf("set statement_timeout = '60s';", [StringComparison]::OrdinalIgnoreCase)
  $assertion = $Sql.IndexOf("migration 014 session timeout assertion failed", [StringComparison]::Ordinal)
  $firstDdl = [regex]::Match($Sql, '(?im)^\s*(create\s+(?:or\s+replace\s+)?(?:index|function|trigger|policy)|drop\s+(?:trigger|policy)|alter\s+|grant\s+|revoke\s+)')
  $lockReset = $Sql.LastIndexOf('reset lock_timeout;', [StringComparison]::OrdinalIgnoreCase)
  $statementReset = $Sql.LastIndexOf('reset statement_timeout;', [StringComparison]::OrdinalIgnoreCase)

  if ($lockSet -lt 0 -or $statementSet -lt 0 -or $assertion -lt 0 -or -not $firstDdl.Success -or $lockReset -lt 0 -or $statementReset -lt 0) {
    throw 'M35 contract check could not find all timeout guard statements.'
  }
  if (-not ($lockSet -lt $statementSet -and $statementSet -lt $assertion -and $assertion -lt $firstDdl.Index -and $firstDdl.Index -lt $lockReset -and $lockReset -lt $statementReset)) {
    throw 'M35 contract check found timeout guard statements out of order.'
  }
  if ($Sql -notmatch "current_setting\('lock_timeout'\)::interval" -or $Sql -notmatch "current_setting\('statement_timeout'\)::interval" -or $Sql -notmatch 'actual_lock_timeout_seconds >= actual_statement_timeout_seconds') {
    throw 'M35 contract check found an incomplete runtime assertion.'
  }
}

function Copy-Input {
  param([Parameter(Mandatory)][string]$RelativePath)
  $source = Join-Path $repoRoot $RelativePath
  $destination = Join-Path $tempRoot $RelativePath
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination
}

function Invoke-ExternalProcess {
  param(
    [Parameter(Mandatory)][string]$FileName,
    [Parameter(Mandatory)][string[]]$Arguments
  )

  $quotedArguments = ($Arguments | ForEach-Object {
    if ($_ -notmatch '[\s"]') { $_ } else { '"' + $_.Replace('"', '\"') + '"' }
  }) -join ' '
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $FileName
  $startInfo.Arguments = $quotedArguments
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  [void]$process.Start()
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()

  [pscustomobject]@{
    ExitCode = $process.ExitCode
    Output = $stdoutTask.GetAwaiter().GetResult() + $stderrTask.GetAwaiter().GetResult()
  }
}

function Invoke-PsqlFile {
  param([Parameter(Mandatory)][string]$RelativePath)
  $workspacePath = '/workspace/' + ($RelativePath -replace '\\', '/')
  Invoke-ExternalProcess -FileName 'docker' -Arguments @(
    'exec', $containerName, 'psql', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', $database, '-f', $workspacePath
  )
}

$result = [ordered]@{
  mutation = 'M35'
  runtime = 'local PostgreSQL only'
  caught = $false
  restoration = 'FAIL'
  cleanup = $cleanup
  final_result = 'FAIL'
}

try {
  Assert-MigrationTimeoutContract -Sql $originalMigration
  New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
  foreach ($file in $prerequisites) { Copy-Input -RelativePath $file }
  Copy-Input -RelativePath $migrationRelativePath

  $mutatedPath = Join-Path $tempRoot $migrationRelativePath
  $mutatedMigration = [IO.File]::ReadAllText($mutatedPath)
  $matches = [regex]::Matches($mutatedMigration, [regex]::Escape("set lock_timeout = '5s';")).Count
  if ($matches -ne 1) { throw "M35 mutation matched $matches timeout settings." }
  [IO.File]::WriteAllText($mutatedPath, $mutatedMigration.Replace("set lock_timeout = '5s';", "set lock_timeout = '60s';"), [Text.UTF8Encoding]::new($false))

  docker run --name $containerName -e POSTGRES_PASSWORD=postgres -e "POSTGRES_DB=$database" -v "${tempRoot}:/workspace:ro" -d $PostgresImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'M35 could not start the local PostgreSQL container.' }

  $ready = $false
  for ($attempt = 0; $attempt -lt $ReadyTimeoutSeconds; $attempt++) {
    docker exec $containerName pg_isready -q -U postgres -d $database 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'M35 local PostgreSQL container did not become ready.' }

  foreach ($file in $prerequisites) {
    $setup = Invoke-PsqlFile -RelativePath $file
    if ($setup.ExitCode -ne 0) { throw "M35 prerequisite failed: $file" }
  }

  $mutationRun = Invoke-PsqlFile -RelativePath $migrationRelativePath
  if ($mutationRun.ExitCode -eq 0 -or -not $mutationRun.Output.Contains('migration 014 session timeout assertion failed')) {
    $diagnostic = (($mutationRun.Output -split "`r?`n") | Select-Object -Last 8) -join "`n"
    throw "M35 mutation was not rejected by the runtime timeout assertion (exit=$($mutationRun.ExitCode)): $diagnostic"
  }
  $result.caught = $true
  Write-Output 'M35 CAUGHT'
} finally {
  $currentMigration = [IO.File]::ReadAllText($migrationPath)
  $currentHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $migrationPath).Hash.ToLowerInvariant()
  $result.restoration = if ($currentMigration -ceq $originalMigration -and $currentHash -eq $originalHash) { 'PASS' } else { 'FAIL' }
  docker rm -f $containerName 2>$null | Out-Null
  $cleanup.container = if ($LASTEXITCODE -eq 0 -or -not (docker ps -a --format '{{.Names}}' | Select-String -SimpleMatch $containerName)) { 'PASS' } else { 'FAIL' }
  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
  $cleanup.temp = if (-not (Test-Path -LiteralPath $tempRoot)) { 'PASS' } else { 'FAIL' }
  $result.final_result = if ($result.caught -and $result.restoration -eq 'PASS' -and $cleanup.container -eq 'PASS' -and $cleanup.temp -eq 'PASS') { 'PASS' } else { 'FAIL' }
  $result | ConvertTo-Json -Depth 4 | Write-Output
}

if ($result.final_result -ne 'PASS') { exit 1 }
