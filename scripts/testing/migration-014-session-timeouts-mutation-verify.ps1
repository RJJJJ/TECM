param(
  [string]$PostgresImage = 'postgres:15-alpine',
  [ValidateRange(1, 120)]
  [int]$ReadyTimeoutSeconds = 60,
  [switch]$PortabilityOnly
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$migrationRelativePath = 'supabase/migrations/202608140014_teacher_attendance_history_access.sql'
$migrationPath = Join-Path $repoRoot $migrationRelativePath
$database = 'tecm_m35'
$containerName = "tecm-m35-timeouts-$PID"
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("tecm-m35-timeouts-" + [guid]::NewGuid().ToString('N'))
$mutationPattern = "(?im)^[\t ]*set[\t ]+lock_timeout[\t ]*=[\t ]*'5s'[\t ]*;[\t ]*(?=\r?$)"

function Compare-ByteArrays {
  param(
    [Parameter(Mandatory)][byte[]]$Left,
    [Parameter(Mandatory)][byte[]]$Right
  )

  if ($Left.Length -ne $Right.Length) { return $false }
  for ($index = 0; $index -lt $Left.Length; $index++) {
    if ($Left[$index] -ne $Right[$index]) { return $false }
  }
  return $true
}

function Get-ByteSha256 {
  param([Parameter(Mandatory)][byte[]]$Bytes)

  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha256.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
}

function Get-GitBlobHash {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$RelativePath
  )

  $output = @(& git hash-object "--path=$RelativePath" -- $Path 2>&1)
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0 -or $output.Count -ne 1 -or $output[0] -notmatch '^[0-9a-f]{40}$') {
    throw "Could not calculate Git blob hash for $Path (exit=$exitCode)."
  }
  return $output[0].Trim().ToLowerInvariant()
}

function Get-Utf8FileInfo {
  param(
    [Parameter(Mandatory)][byte[]]$Bytes,
    [Parameter(Mandatory)][string]$Path
  )

  $offset = 0
  $hasBom = $Bytes.Length -ge 3 -and $Bytes[0] -eq 0xef -and $Bytes[1] -eq 0xbb -and $Bytes[2] -eq 0xbf
  if ($hasBom) { $offset = 3 }

  $decoder = [Text.UTF8Encoding]::new($false, $true)
  try {
    $text = $decoder.GetString($Bytes, $offset, $Bytes.Length - $offset)
  } catch {
    throw "M35 requires UTF-8 migration input; could not decode $Path without replacement characters."
  }

  $crlfCount = 0
  $lfOnlyCount = 0
  $crOnlyCount = 0
  for ($index = 0; $index -lt $Bytes.Length; $index++) {
    if ($Bytes[$index] -eq 10) {
      if ($index -gt 0 -and $Bytes[$index - 1] -eq 13) { $crlfCount++ } else { $lfOnlyCount++ }
    } elseif ($Bytes[$index] -eq 13 -and ($index + 1 -ge $Bytes.Length -or $Bytes[$index + 1] -ne 10)) {
      $crOnlyCount++
    }
  }

  $lineEnding = if ($crlfCount -gt 0 -and $lfOnlyCount -eq 0 -and $crOnlyCount -eq 0) {
    'CRLF'
  } elseif ($lfOnlyCount -gt 0 -and $crlfCount -eq 0 -and $crOnlyCount -eq 0) {
    'LF'
  } elseif ($crlfCount -eq 0 -and $lfOnlyCount -eq 0 -and $crOnlyCount -eq 0) {
    'none'
  } else {
    'mixed'
  }

  [pscustomobject]@{
    Text = $text
    Encoding = if ($hasBom) { 'UTF-8 BOM' } else { 'UTF-8 no BOM' }
    HasBom = $hasBom
    LineEnding = $lineEnding
    ByteLength = $Bytes.Length
    Sha256 = Get-ByteSha256 -Bytes $Bytes
  }
}

function Convert-TextToUtf8Bytes {
  param(
    [Parameter(Mandatory)][string]$Text,
    [Parameter(Mandatory)][bool]$WithBom
  )

  $encoder = [Text.UTF8Encoding]::new($WithBom)
  $content = $encoder.GetBytes($Text)
  if (-not $WithBom) { return $content }

  $preamble = $encoder.GetPreamble()
  $bytes = [byte[]]::new($preamble.Length + $content.Length)
  [Array]::Copy($preamble, 0, $bytes, 0, $preamble.Length)
  [Array]::Copy($content, 0, $bytes, $preamble.Length, $content.Length)
  return $bytes
}

function Get-MutationMatches {
  param([Parameter(Mandatory)][string]$Sql)

  return [regex]::Matches($Sql, $script:mutationPattern)
}

function Set-MutationTarget {
  param([Parameter(Mandatory)][string]$Sql)

  $matches = @(Get-MutationMatches -Sql $Sql)
  if ($matches.Count -ne 1) {
    throw "M35 mutation matched $($matches.Count) timeout targets; expected exactly one."
  }

  $match = $matches[0]
  $replacement = $match.Value.Replace("'5s'", "'60s'")
  $mutatedSql = $Sql.Remove($match.Index, $match.Length).Insert($match.Index, $replacement)
  if ($mutatedSql -ceq $Sql) {
    throw 'M35 mutation did not change the selected timeout target.'
  }

  [pscustomobject]@{
    Sql = $mutatedSql
    MatchCount = $matches.Count
    Target = $match.Value
  }
}

function Invoke-PortabilityFixtureTests {
  $fixtures = @(
    [pscustomobject]@{ Name = 'LF'; Newline = "`n" },
    [pscustomobject]@{ Name = 'CRLF'; Newline = "`r`n" }
  )

  foreach ($fixture in $fixtures) {
    $sql = "-- fixture$($fixture.Newline)  set lock_timeout = '5s';$($fixture.Newline)  set statement_timeout = '60s';$($fixture.Newline)"
    $mutation = Set-MutationTarget -Sql $sql
    if ($mutation.Sql -notmatch "set lock_timeout = '60s';" -or $mutation.Sql -match "set lock_timeout = '5s';") {
      throw "M35 $($fixture.Name) fixture did not mutate only the expected timeout target."
    }
  }

  foreach ($negative in @(
      [pscustomobject]@{ Name = 'zero'; Sql = "set statement_timeout = '60s';`n" },
      [pscustomobject]@{ Name = 'multiple'; Sql = "set lock_timeout = '5s';`nset lock_timeout = '5s';`n" }
    )) {
    $failedClosed = $false
    try {
      [void](Set-MutationTarget -Sql $negative.Sql)
    } catch {
      $failedClosed = $_.Exception.Message -match "matched (0|2) timeout targets; expected exactly one"
    }
    if (-not $failedClosed) { throw "M35 $($negative.Name) mutation control did not fail closed." }
  }

  return [ordered]@{
    LF = 'PASS'
    CRLF = 'PASS'
    zero_match = 'PASS'
    multiple_match = 'PASS'
  }
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
  try {
    [void]$process.Start()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    [pscustomobject]@{
      ExitCode = $process.ExitCode
      Stdout = $stdout
      Stderr = $stderr
      Output = $stdout + $stderr
    }
  } finally {
    $process.Dispose()
  }
}

function Limit-DiagnosticText {
  param([AllowNull()][string]$Text)

  if ([string]::IsNullOrWhiteSpace($Text)) { return '' }
  $sanitized = $Text -replace '(?i)(password|token|secret|authorization|connection[_-]?string|service[_-]?role[_-]?key|anon[_-]?key)\s*[:=]\s*[^\s,;]+', '$1=<redacted>'
  $lines = @($sanitized -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($lines.Count -gt 20) { $lines = @($lines | Select-Object -Last 20) }
  return ($lines -join "`n").Trim()
}

function New-ProcessDiagnostic {
  param(
    [Parameter(Mandatory)]$ProcessResult,
    [Parameter(Mandatory)][string]$Command
  )

  [ordered]@{
    command = $Command
    exit_code = $ProcessResult.ExitCode
    stdout = Limit-DiagnosticText -Text $ProcessResult.Stdout
    stderr = Limit-DiagnosticText -Text $ProcessResult.Stderr
  }
}

function Assert-MigrationTimeoutContract {
  param([Parameter(Mandatory)][string]$Sql)

  $lockSet = $Sql.IndexOf("set lock_timeout = '5s';", [StringComparison]::OrdinalIgnoreCase)
  $statementSet = $Sql.IndexOf("set statement_timeout = '60s';", [StringComparison]::OrdinalIgnoreCase)
  $assertion = $Sql.IndexOf('migration 014 session timeout assertion failed', [StringComparison]::Ordinal)
  $firstDdl = [regex]::Match($Sql, '(?im)^[\t ]*(create\s+(?:or\s+replace\s+)?(?:index|function|trigger|policy)|drop\s+(?:trigger|policy)|alter\s+|grant\s+|revoke\s+)')
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

function Invoke-PsqlFile {
  param([Parameter(Mandatory)][string]$RelativePath)

  $workspacePath = '/workspace/' + ($RelativePath -replace '\\', '/')
  $arguments = @(
    'exec', $containerName, 'psql', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', $database, '-f', $workspacePath
  )
  $process = Invoke-ExternalProcess -FileName 'docker' -Arguments $arguments
  [pscustomobject]@{
    RelativePath = $RelativePath
    Command = 'docker ' + (($arguments | ForEach-Object { if ($_ -match '[\s"]') { '"' + $_ + '"' } else { $_ } }) -join ' ')
    ExitCode = $process.ExitCode
    Stdout = $process.Stdout
    Stderr = $process.Stderr
    Output = $process.Output
  }
}

if ($PortabilityOnly) {
  Invoke-PortabilityFixtureTests | ConvertTo-Json -Depth 4 | Write-Output
  exit 0
}

$originalBytes = [IO.File]::ReadAllBytes($migrationPath)
$originalInfo = Get-Utf8FileInfo -Bytes $originalBytes -Path $migrationPath
$originalBlobHash = Get-GitBlobHash -Path $migrationPath -RelativePath $migrationRelativePath
$cleanup = [ordered]@{ container = 'PENDING'; temp = 'PENDING' }
$result = [ordered]@{
  mutation = 'M35'
  runtime = 'local PostgreSQL only'
  runner_os = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription
  powershell_version = $PSVersionTable.PSVersion.ToString()
  source = [ordered]@{
    path = $migrationRelativePath
    encoding = $originalInfo.Encoding
    line_ending = $originalInfo.LineEnding
    byte_length = $originalBytes.Length
    sha256 = $originalInfo.Sha256
    git_blob_sha = $originalBlobHash
  }
  portability = 'PENDING'
  caught = $false
  restoration = 'FAIL'
  cleanup = $cleanup
  temporary_workspace = $tempRoot
  container = $containerName
  final_result = 'FAIL'
}
$tempMigrationPath = $null
$tempOriginalBytes = $null
$lastProcess = $null
$failureStage = 'initializing'
$containerStarted = $false

try {
  $failureStage = 'running LF/CRLF negative controls'
  $result.portability = Invoke-PortabilityFixtureTests
  Write-Output 'M35 portability fixtures PASS'

  $failureStage = 'checking migration 014 timeout contract'
  Assert-MigrationTimeoutContract -Sql $originalInfo.Text
  New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
  foreach ($file in @(
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
    )) { Copy-Input -RelativePath $file }
  Copy-Input -RelativePath $migrationRelativePath

  $tempMigrationPath = Join-Path $tempRoot $migrationRelativePath
  $tempOriginalBytes = [IO.File]::ReadAllBytes($tempMigrationPath)
  $tempInfo = Get-Utf8FileInfo -Bytes $tempOriginalBytes -Path $tempMigrationPath
  $mutation = Set-MutationTarget -Sql $tempInfo.Text
  $mutatedBytes = Convert-TextToUtf8Bytes -Text $mutation.Sql -WithBom $tempInfo.HasBom
  [IO.File]::WriteAllBytes($tempMigrationPath, $mutatedBytes)
  $mutatedInfo = Get-Utf8FileInfo -Bytes $mutatedBytes -Path $tempMigrationPath
  if ($mutatedInfo.Sha256 -eq $tempInfo.Sha256) { throw 'M35 mutation did not change fixture bytes.' }
  $result.mutation = [ordered]@{
    target_match_count = $mutation.MatchCount
    source_sha256 = $tempInfo.Sha256
    mutated_sha256 = $mutatedInfo.Sha256
    source_encoding = $tempInfo.Encoding
    source_line_ending = $tempInfo.LineEnding
    mutated_encoding = $mutatedInfo.Encoding
    mutated_line_ending = $mutatedInfo.LineEnding
  }

  $failureStage = 'starting disposable PostgreSQL container'
  $startArguments = @(
    'run', '--name', $containerName,
    '-e', 'POSTGRES_PASSWORD=postgres',
    '-e', "POSTGRES_DB=$database",
    '-v', "${tempRoot}:/workspace:ro",
    '-d', $PostgresImage
  )
  $start = Invoke-ExternalProcess -FileName 'docker' -Arguments $startArguments
  $lastProcess = [pscustomobject]@{
    ExitCode = $start.ExitCode
    Stdout = $start.Stdout
    Stderr = $start.Stderr
    Output = $start.Output
  }
  if ($start.ExitCode -ne 0) { throw 'M35 could not start the local PostgreSQL container.' }
  $containerStarted = $true

  $failureStage = 'waiting for disposable PostgreSQL readiness'
  $ready = $false
  $stableReadyChecks = 0
  for ($attempt = 0; $attempt -lt $ReadyTimeoutSeconds; $attempt++) {
    $readyCheck = Invoke-ExternalProcess -FileName 'docker' -Arguments @('exec', $containerName, 'pg_isready', '-q', '-U', 'postgres', '-d', $database)
    if ($readyCheck.ExitCode -eq 0) {
      $stableReadyChecks++
      if ($stableReadyChecks -ge 2) {
        $ready = $true
        break
      }
    } else {
      $stableReadyChecks = 0
    }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'M35 local PostgreSQL container did not become ready.' }

  $failureStage = 'executing M35 prerequisites'
  foreach ($file in @(
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
    )) {
    $setup = Invoke-PsqlFile -RelativePath $file
    $lastProcess = $setup
    if ($setup.ExitCode -ne 0) { throw "M35 prerequisite failed: $file" }
  }

  $failureStage = 'executing mutated migration 014'
  $mutationRun = Invoke-PsqlFile -RelativePath $migrationRelativePath
  $lastProcess = $mutationRun
  if ($mutationRun.ExitCode -eq 0 -or -not $mutationRun.Output.Contains('migration 014 session timeout assertion failed')) {
    throw "M35 mutation was not rejected by the runtime timeout assertion (exit=$($mutationRun.ExitCode))."
  }
  $result.caught = $true
  $result.mutation_process = New-ProcessDiagnostic -ProcessResult $mutationRun -Command $mutationRun.Command
  Write-Output 'M35 CAUGHT'
} catch {
  $failure = [ordered]@{
    stage = $failureStage
    message = $_.Exception.Message
  }
  if ($null -ne $lastProcess) {
    $command = if ($lastProcess.PSObject.Properties.Name -contains 'Command') { $lastProcess.Command } else { $failureStage }
    $failure.process = New-ProcessDiagnostic -ProcessResult $lastProcess -Command $command
  }
  $result.failure = $failure
  throw
} finally {
  $containerCleanupError = $null
  try {
    $removeOutput = @(& docker rm -f $containerName 2>&1)
    $removeExitCode = $LASTEXITCODE
    $remaining = @(& docker ps -a --format '{{.Names}}' 2>$null)
    $listExitCode = $LASTEXITCODE
    if ($listExitCode -ne 0) {
      $cleanup.container = 'FAIL'
      $containerCleanupError = 'Could not inspect disposable container cleanup state.'
    } elseif ($containerName -in $remaining) {
      $cleanup.container = 'FAIL'
      $containerCleanupError = 'Disposable PostgreSQL container remained after cleanup.'
    } else {
      $cleanup.container = 'PASS'
    }
  } catch {
    $cleanup.container = 'FAIL'
    $containerCleanupError = $_.Exception.Message
  }

  $tempRestoration = 'PASS'
  if ($null -ne $tempMigrationPath -and (Test-Path -LiteralPath $tempMigrationPath)) {
    try {
      [IO.File]::WriteAllBytes($tempMigrationPath, $tempOriginalBytes)
      $tempRestoredBytes = [IO.File]::ReadAllBytes($tempMigrationPath)
      if (-not (Compare-ByteArrays -Left $tempRestoredBytes -Right $tempOriginalBytes)) { $tempRestoration = 'FAIL' }
    } catch {
      $tempRestoration = 'FAIL'
    }
  }

  try {
    $currentBytes = [IO.File]::ReadAllBytes($migrationPath)
    if (-not (Compare-ByteArrays -Left $currentBytes -Right $originalBytes)) {
      [IO.File]::WriteAllBytes($migrationPath, $originalBytes)
    }
    $restoredBytes = [IO.File]::ReadAllBytes($migrationPath)
    $restoredHash = Get-ByteSha256 -Bytes $restoredBytes
    $restoredBlobHash = Get-GitBlobHash -Path $migrationPath -RelativePath $migrationRelativePath
    $result.restoration = if (
      (Compare-ByteArrays -Left $restoredBytes -Right $originalBytes) -and
      $restoredHash -eq $originalInfo.Sha256 -and
      $restoredBlobHash -eq $originalBlobHash -and
      $tempRestoration -eq 'PASS'
    ) { 'PASS' } else { 'FAIL' }
    $result.restored_sha256 = $restoredHash
    $result.restored_git_blob_sha = $restoredBlobHash
  } catch {
    $result.restoration = 'FAIL'
    $result.restoration_error = $_.Exception.Message
  }

  try {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
    $cleanup.temp = if (-not (Test-Path -LiteralPath $tempRoot)) { 'PASS' } else { 'FAIL' }
  } catch {
    $cleanup.temp = 'FAIL'
  }

  $result.restoration = if ($result.restoration -eq 'PASS' -and $tempRestoration -eq 'PASS') { 'PASS' } else { 'FAIL' }
  if ($containerCleanupError) { $result.cleanup_error = $containerCleanupError }
  $result.final_result = if (
    $result.caught -and
    $result.portability -ne 'PENDING' -and
    $result.restoration -eq 'PASS' -and
    $cleanup.container -eq 'PASS' -and
    $cleanup.temp -eq 'PASS'
  ) { 'PASS' } else { 'FAIL' }
  $result | ConvertTo-Json -Depth 8 | Write-Output
}

if ($result.final_result -ne 'PASS') { exit 1 }
