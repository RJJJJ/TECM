param(
  [string]$PostgresImage = 'postgres:15-alpine',
  [ValidateRange(1, 3600)]
  [int]$ConcurrencyTimeoutSeconds = $(
    if ($env:TECM_DATABASE_RACE_TIMEOUT_SECONDS) {
      [int]$env:TECM_DATABASE_RACE_TIMEOUT_SECONDS
    } else {
      60
    }
  ),
  # Test-only switch for proving the bounded wait path. It is intentionally opt-in.
  [switch]$InjectConcurrencyHang
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$containerName = "tecm-db-verify-$PID"
$database = 'tecm_verify'

docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not available.' }

docker run --name $containerName `
  -e POSTGRES_PASSWORD=postgres `
  -e POSTGRES_DB=$database `
  -v "${repoRoot}:/workspace:ro" `
  -d $PostgresImage | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not start PostgreSQL verification container.' }

try {
  $ready = $false
  $stableReadyChecks = 0
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    docker exec $containerName pg_isready -q -U postgres -d $database 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $stableReadyChecks++
      if ($stableReadyChecks -ge 2) { $ready = $true; break }
    } else {
      $stableReadyChecks = 0
    }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'PostgreSQL did not become ready.' }

  $files = @(
    '/workspace/supabase/tests/000_bootstrap.sql',
    '/workspace/supabase/migrations/202607110000_legacy_baseline.sql',
    '/workspace/supabase/migrations/202607110001_tenant_operations_finance.sql',
    '/workspace/supabase/migrations/202607110002_invariants_rls_rpcs.sql',
    '/workspace/supabase/migrations/202607110003_release_blockers.sql',
    '/workspace/supabase/tests/000_legacy_parent_fixture.sql',
    '/workspace/supabase/migrations/202607150004_parent_notifications.sql',
    '/workspace/supabase/seed.sql',
    '/workspace/supabase/seed.sql',
    '/workspace/supabase/tests/000_foundation_security_fixture.sql',
    '/workspace/supabase/migrations/202607180005_foundation_security.sql',
    '/workspace/supabase/migrations/202607180005_foundation_security.sql',
    '/workspace/supabase/tests/000_apns_outbox_reliability_legacy_fixture.sql',
    '/workspace/supabase/migrations/202607180006_apns_outbox_reliability.sql',
    '/workspace/supabase/migrations/202607180006_apns_outbox_reliability.sql',
    '/workspace/supabase/tests/001_schema_contract.sql',
    '/workspace/supabase/tests/002_rls_tenant_isolation.sql',
    '/workspace/supabase/tests/003_attendance_leave_makeup.sql',
    '/workspace/supabase/tests/004_finance_ledger.sql',
    '/workspace/supabase/tests/005_automation_audit.sql',
    '/workspace/supabase/tests/006_submit_attendance_rpc.sql',
    '/workspace/supabase/tests/007_parent_notifications.sql',
    '/workspace/supabase/tests/008_foundation_security.sql',
    '/workspace/supabase/tests/009_apns_outbox_reliability.sql'
  )

  foreach ($file in $files) {
    Write-Host "[RUN] $file"
    docker exec $containerName sh -c "psql -q -v ON_ERROR_STOP=1 -U postgres -d $database -f '$file'"
    if ($LASTEXITCODE -ne 0) { throw "Database verification failed: $file" }
  }

  function Wait-DatabaseRaceJobs {
    param(
      [Parameter(Mandatory)]
      [System.Management.Automation.Job[]]$Jobs,
      [Parameter(Mandatory)]
      [int]$TimeoutSeconds
    )

    $terminalStates = @('Completed', 'Failed', 'Stopped')
    $deadline = [System.Diagnostics.Stopwatch]::StartNew()

    try {
      while (@($Jobs | Where-Object { $_.State -notin $terminalStates }).Count -gt 0) {
        if ($deadline.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
          $unfinished = @($Jobs | Where-Object { $_.State -notin $terminalStates })
          $unfinishedSummary = ($unfinished | ForEach-Object { "$($_.Name) ($($_.State))" }) -join ', '
          Write-Host "[TIMEOUT] Database race exceeded ${TimeoutSeconds}s. Unfinished jobs: $unfinishedSummary"
          foreach ($job in $Jobs) {
            $diagnosticOutput = @(Receive-Job -Job $job -Keep -ErrorAction Continue 2>&1)
            Write-Host "[RACE OUTPUT] $($job.Name) ($($job.State))"
            if ($diagnosticOutput.Count -gt 0) { $diagnosticOutput | Out-String | Write-Host }
          }
          throw "Database race timed out after ${TimeoutSeconds}s: $unfinishedSummary"
        }
        Start-Sleep -Milliseconds 100
      }

      return @(
        foreach ($job in $Jobs) {
          [pscustomobject]@{
            Name = $job.Name
            State = $job.State
            Output = @(Receive-Job -Job $job -ErrorAction Continue 2>&1)
          }
        }
      )
    } finally {
      foreach ($job in $Jobs) {
        if ($job.State -notin $terminalStates) {
          Stop-Job -Job $job -ErrorAction SilentlyContinue
        }
      }
      foreach ($job in $Jobs) {
        Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
      }
    }
  }

  function Invoke-DatabaseRace {
    param(
      [string]$FirstFile,
      [string]$SecondFile,
      [int]$ExpectedFirstExit = 0,
      [int]$ExpectedSecondExit = 0,
      [int]$StartSecondDelayMilliseconds = 250
    )

    Write-Host "[RACE] $FirstFile <> $SecondFile"
    $raceJobs = @()
    try {
      $first = Start-Job -Name 'race-first' -ScriptBlock {
        param($Name,$Db,$File)
        & docker exec $Name psql -q -v ON_ERROR_STOP=1 -U postgres -d $Db -f $File 2>&1
        [pscustomobject]@{ ExitCode = $LASTEXITCODE }
      } -ArgumentList $containerName,$database,$FirstFile
      $raceJobs += $first
      if ($StartSecondDelayMilliseconds -gt 0) {
        Start-Sleep -Milliseconds $StartSecondDelayMilliseconds
      }
      $second = Start-Job -Name 'race-second' -ScriptBlock {
        param($Name,$Db,$File,$Hang,$HangSeconds)
        if ($Hang) { Start-Sleep -Seconds $HangSeconds }
        & docker exec $Name psql -q -v ON_ERROR_STOP=1 -U postgres -d $Db -f $File 2>&1
        [pscustomobject]@{ ExitCode = $LASTEXITCODE }
      } -ArgumentList $containerName,$database,$SecondFile,$InjectConcurrencyHang,($ConcurrencyTimeoutSeconds + 5)
      $raceJobs += $second

      $raceResults = @(Wait-DatabaseRaceJobs -Jobs $raceJobs -TimeoutSeconds $ConcurrencyTimeoutSeconds)
      $firstOutput = ($raceResults | Where-Object Name -eq 'race-first').Output
      $secondOutput = ($raceResults | Where-Object Name -eq 'race-second').Output
      $firstExit = ($firstOutput | Where-Object { $null -ne $_.ExitCode } | Select-Object -Last 1).ExitCode
      $secondExit = ($secondOutput | Where-Object { $null -ne $_.ExitCode } | Select-Object -Last 1).ExitCode
      if ($firstExit -ne $ExpectedFirstExit -or $secondExit -ne $ExpectedSecondExit) {
        $firstOutput | Write-Host
        $secondOutput | Write-Host
        throw "Unexpected race exits: first=$firstExit second=$secondExit"
      }
    } finally {
      # This also covers a failure between starting the two jobs. The helper's
      # cleanup is intentionally idempotent, so completed races remain safe.
      foreach ($job in $raceJobs) {
        if ($job.State -notin @('Completed', 'Failed', 'Stopped')) {
          Stop-Job -Job $job -ErrorAction SilentlyContinue
        }
        Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
      }
    }
  }

  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/000_setup.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare concurrency fixtures.' }

  Invoke-DatabaseRace `
    '/workspace/supabase/tests/concurrency/invite_first.sql' `
    '/workspace/supabase/tests/concurrency/invite_second.sql' 0 3
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/invite_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Invitation concurrency assertion failed.' }

  Invoke-DatabaseRace `
    '/workspace/supabase/tests/concurrency/disable_first.sql' `
    '/workspace/supabase/tests/concurrency/register_second.sql' 0 3
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/device_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Device concurrency assertion failed.' }

  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/device_reset.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Could not reset device concurrency fixture.' }
  Invoke-DatabaseRace `
    '/workspace/supabase/tests/concurrency/register_first.sql' `
    '/workspace/supabase/tests/concurrency/disable_second.sql' 0 0
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/device_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Opposite device concurrency assertion failed.' }

  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/outbox_setup.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare outbox concurrency fixture.' }
  Invoke-DatabaseRace `
    '/workspace/supabase/tests/concurrency/outbox_worker_a.sql' `
    '/workspace/supabase/tests/concurrency/outbox_worker_b.sql' 0 0 0
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/outbox_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Outbox claim concurrency assertion failed.' }

  $unsafeDatabase = 'tecm_unsafe_preflight'
  docker exec $containerName createdb -U postgres $unsafeDatabase
  if ($LASTEXITCODE -ne 0) { throw 'Could not create unsafe preflight database.' }
  $unsafeFiles = @(
    '/workspace/supabase/tests/000_bootstrap.sql',
    '/workspace/supabase/migrations/202607110000_legacy_baseline.sql',
    '/workspace/supabase/migrations/202607110001_tenant_operations_finance.sql',
    '/workspace/supabase/migrations/202607110002_invariants_rls_rpcs.sql',
    '/workspace/supabase/migrations/202607110003_release_blockers.sql',
    '/workspace/supabase/migrations/202607150004_parent_notifications.sql',
    '/workspace/supabase/seed.sql',
    '/workspace/supabase/tests/000_foundation_security_unsafe_fixture.sql'
  )
  foreach ($file in $unsafeFiles) {
    docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $unsafeDatabase -f $file
    if ($LASTEXITCODE -ne 0) { throw "Unsafe preflight setup failed: $file" }
  }
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $unsafeDatabase `
    -f '/workspace/supabase/migrations/202607180005_foundation_security.sql'
  if ($LASTEXITCODE -eq 0) { throw 'Unsafe legacy data did not block the foundation migration.' }
  $expiresColumn = docker exec $containerName psql -q -U postgres -d $unsafeDatabase -Atc `
    "select count(*) from information_schema.columns where table_schema='public' and table_name='parent_account_invitations' and column_name='expires_at'"
  if ($LASTEXITCODE -ne 0 -or $expiresColumn -ne '0') {
    throw 'Blocked migration partially applied mutable DDL before preflight.'
  }

  Write-Host '[PASS] repeatable migrations, negative preflight, seed, RLS, nine SQL suites, parent races and bounded outbox claim race'
  docker exec $containerName psql -U postgres -d $database -F ',' -Atc `
    "select 'tables',count(*) from pg_tables where schemaname='public'
     union all select 'forced_rls',count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relforcerowsecurity
     union all select 'demo_students',count(*) from students where organization_id='10000000-0000-4000-8000-000000000000' and left(id::text,8)='15000000' and right(id::text,12)::bigint between 1 and 10
     union all select 'teachers',count(*) from teacher_profiles where organization_id='10000000-0000-4000-8000-000000000000'
     union all select 'classes',count(*) from exam_cohorts where organization_id='10000000-0000-4000-8000-000000000000'
     union all select 'today_sessions',count(*) from lesson_sessions where organization_id='10000000-0000-4000-8000-000000000000' and starts_at >= (((now() at time zone 'Asia/Macau')::date)::timestamp at time zone 'Asia/Macau') and starts_at < ((((now() at time zone 'Asia/Macau')::date+1))::timestamp at time zone 'Asia/Macau')
     union all select 'open_debt',count(*) from charges where organization_id='10000000-0000-4000-8000-000000000000' and status in ('open','partially_paid')
     union all select 'pending_makeup',count(*) from makeup_entitlements where organization_id='10000000-0000-4000-8000-000000000000' and status='available'
     union all select 'completed_makeup',count(*) from makeup_sessions where organization_id='10000000-0000-4000-8000-000000000000' and status='completed';"
  if ($LASTEXITCODE -ne 0) { throw 'Could not read final verification counts.' }
} finally {
  docker rm -f $containerName 2>$null | Out-Null
}
