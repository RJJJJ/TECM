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
    '/workspace/supabase/migrations/202607180007_apns_dispatch_ambiguity.sql',
    '/workspace/supabase/migrations/202607180007_apns_dispatch_ambiguity.sql',
    '/workspace/supabase/migrations/202607180008_apns_completion_outcome.sql',
    '/workspace/supabase/migrations/202607180008_apns_completion_outcome.sql',
    '/workspace/supabase/migrations/202608020009_admin_operations_integrity.sql',
    '/workspace/supabase/migrations/202608020009_admin_operations_integrity.sql',
    '/workspace/supabase/migrations/202608020010_admin_operations_release_gate.sql',
    '/workspace/supabase/migrations/202608020010_admin_operations_release_gate.sql',
    '/workspace/supabase/migrations/202608020011_makeup_partial_state_recovery.sql',
    '/workspace/supabase/migrations/202608020011_makeup_partial_state_recovery.sql',
    '/workspace/supabase/migrations/202608050012_uat_core_workflows.sql',
    '/workspace/supabase/migrations/202608050012_uat_core_workflows.sql',
    '/workspace/supabase/migrations/202608130013_course_cohort_enrollment_model.sql',
    '/workspace/supabase/migrations/202608130013_course_cohort_enrollment_model.sql',
    '/workspace/supabase/migrations/202608140014_teacher_attendance_history_access.sql',
    '/workspace/supabase/migrations/202608140014_teacher_attendance_history_access.sql',
    '/workspace/supabase/seed.sql',
    '/workspace/supabase/seed.sql',
    '/workspace/supabase/tests/001_schema_contract.sql',
    '/workspace/supabase/tests/002_rls_tenant_isolation.sql',
    '/workspace/supabase/tests/003_attendance_leave_makeup.sql',
    '/workspace/supabase/tests/004_finance_ledger.sql',
    '/workspace/supabase/tests/005_automation_audit.sql',
    '/workspace/supabase/tests/006_submit_attendance_rpc.sql',
    '/workspace/supabase/tests/007_parent_notifications.sql',
    '/workspace/supabase/tests/008_foundation_security.sql',
    '/workspace/supabase/tests/009_apns_outbox_reliability.sql',
    '/workspace/supabase/tests/010_apns_dispatch_ambiguity.sql',
    '/workspace/supabase/tests/011_apns_completion_outcome.sql',
    '/workspace/supabase/tests/012_admin_operations_integrity.sql',
    '/workspace/supabase/tests/013_admin_operations_release_gate.sql',
    '/workspace/supabase/tests/014_makeup_partial_state_recovery.sql',
    '/workspace/supabase/tests/015_uat_core_workflows.sql',
    '/workspace/supabase/tests/016_course_cohort_enrollment_model.sql',
    '/workspace/supabase/tests/017_teacher_attendance_history_access.sql'
  )

  foreach ($file in $files) {
    Write-Host "[RUN] $file"
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $fileOutput = @(docker exec $containerName sh -c "psql -q -v ON_ERROR_STOP=1 -U postgres -d $database -f '$file'" 2>&1)
      $fileExit = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorAction
    }
    if ($fileExit -ne 0) {
      $fileOutput | Out-String | Write-Host
      throw "Database verification failed: $file"
    }
    $passedOutput = @($fileOutput | Select-String -Pattern 'passed|PASS')
    if ($passedOutput.Count -gt 0) { $passedOutput | Out-String | Write-Host }
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
      [int]$StartSecondDelayMilliseconds = 250,
      [switch]$ReleaseOutboxBarrier,
      [string]$BarrierRaceName,
      [int[]]$ExpectedFirstExitCodes = @(),
      [int[]]$ExpectedSecondExitCodes = @()
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
      if (-not $BarrierRaceName -and $StartSecondDelayMilliseconds -gt 0) {
        Start-Sleep -Milliseconds $StartSecondDelayMilliseconds
      }
      $second = Start-Job -Name 'race-second' -ScriptBlock {
        param($Name,$Db,$File,$Hang,$HangSeconds)
        if ($Hang) { Start-Sleep -Seconds $HangSeconds }
        & docker exec $Name psql -q -v ON_ERROR_STOP=1 -U postgres -d $Db -f $File 2>&1
        [pscustomobject]@{ ExitCode = $LASTEXITCODE }
      } -ArgumentList $containerName,$database,$SecondFile,$InjectConcurrencyHang,($ConcurrencyTimeoutSeconds + 5)
      $raceJobs += $second

      if ($BarrierRaceName) {
        $bothReady = $false
        $barrierAttempts = [Math]::Max(1, $ConcurrencyTimeoutSeconds * 10)
        for ($attempt = 0; $attempt -lt $barrierAttempts; $attempt++) {
          $readyCount = docker exec $containerName psql -q -U postgres -d $database -Atc `
            "select public.__test_race_ready_count('$BarrierRaceName')"
          if ($LASTEXITCODE -ne 0) { throw "Could not inspect race barrier: $BarrierRaceName" }
          if ($readyCount -eq '2') { $bothReady = $true; break }
          Start-Sleep -Milliseconds 100
        }
        if (-not $bothReady) {
          foreach ($job in $raceJobs) {
            $diagnosticOutput = @(Receive-Job -Job $job -Keep -ErrorAction Continue 2>&1)
            Write-Host "[RACE OUTPUT] $($job.Name) ($($job.State))"
            if ($diagnosticOutput.Count -gt 0) { $diagnosticOutput | Out-String | Write-Host }
          }
          throw "Race workers did not both reach barrier: $BarrierRaceName"
        }
        docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database -c `
          "insert into public.__test_race_barrier(race, worker, released_at) values ('$BarrierRaceName','first',statement_timestamp()) on conflict (race, worker) do update set released_at=excluded.released_at" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not release first race barrier: $BarrierRaceName" }
        docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database -c `
          "insert into public.__test_race_barrier(race, worker, released_at) values ('$BarrierRaceName','second',statement_timestamp()) on conflict (race, worker) do update set released_at=excluded.released_at" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not release second race barrier: $BarrierRaceName" }
      }

      if ($ReleaseOutboxBarrier) {
        $bothReady = $false
        for ($attempt = 0; $attempt -lt 100; $attempt++) {
          $readyCount = docker exec $containerName psql -q -U postgres -d $database -Atc `
            "select count(*) from public.__test_outbox_claim_barrier where worker in ('outbox-worker-a','outbox-worker-b')"
          if ($LASTEXITCODE -ne 0) { throw 'Could not inspect outbox claim release barrier.' }
          if ($readyCount -eq '2') { $bothReady = $true; break }
          Start-Sleep -Milliseconds 100
        }
        if (-not $bothReady) { throw 'Outbox claim workers did not reach the release barrier.' }
        docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database -c `
          "update public.__test_outbox_claim_barrier set released_at=statement_timestamp() where worker in ('outbox-worker-a','outbox-worker-b')" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not release outbox claim workers.' }
      }

      $raceResults = @(Wait-DatabaseRaceJobs -Jobs $raceJobs -TimeoutSeconds $ConcurrencyTimeoutSeconds)
      $firstOutput = ($raceResults | Where-Object Name -eq 'race-first').Output
      $secondOutput = ($raceResults | Where-Object Name -eq 'race-second').Output
      $firstExit = ($firstOutput | Where-Object { $null -ne $_.ExitCode } | Select-Object -Last 1).ExitCode
      $secondExit = ($secondOutput | Where-Object { $null -ne $_.ExitCode } | Select-Object -Last 1).ExitCode
      $allowedFirstExits = @($ExpectedFirstExitCodes)
      if ($allowedFirstExits.Count -eq 0) { $allowedFirstExits = @($ExpectedFirstExit) }
      $allowedSecondExits = @($ExpectedSecondExitCodes)
      if ($allowedSecondExits.Count -eq 0) { $allowedSecondExits = @($ExpectedSecondExit) }
      if ($firstExit -notin $allowedFirstExits -or $secondExit -notin $allowedSecondExits) {
        Write-Host "[RACE OUTPUT] first:`n$($firstOutput | Out-String)"
        Write-Host "[RACE OUTPUT] second:`n$($secondOutput | Out-String)"
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

  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/teacher_attendance_setup.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare teacher attendance concurrency fixture.' }
  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/teacher_attendance_first.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/teacher_attendance_second.sql' `
    -ExpectedFirstExitCodes @(0, 3) `
    -ExpectedSecondExitCodes @(0, 3) `
    -StartSecondDelayMilliseconds 0 `
    -BarrierRaceName 'teacher-attendance'
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/teacher_attendance_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Teacher attendance concurrency assertion failed.' }

  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/invite_first.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/invite_second.sql' `
    -ExpectedSecondExit 3 `
    -StartSecondDelayMilliseconds 0 `
    -BarrierRaceName 'invite'
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/invite_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Invitation concurrency assertion failed.' }

  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/disable_first.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/register_second.sql' `
    -ExpectedSecondExit 3 `
    -StartSecondDelayMilliseconds 0 `
    -BarrierRaceName 'disable-register'
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/device_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Device concurrency assertion failed.' }

  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/device_reset.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Could not reset device concurrency fixture.' }
  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/register_first.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/disable_second.sql' `
    -StartSecondDelayMilliseconds 0 `
    -BarrierRaceName 'register-disable'
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/device_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Opposite device concurrency assertion failed.' }

  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/outbox_setup.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare outbox concurrency fixture.' }
  Invoke-DatabaseRace `
    '/workspace/supabase/tests/concurrency/outbox_worker_a.sql' `
    '/workspace/supabase/tests/concurrency/outbox_worker_b.sql' 0 0 0 -ReleaseOutboxBarrier
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/outbox_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Outbox claim concurrency assertion failed.' }

  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/dispatch_setup.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare dispatch concurrency fixture.' }
  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/dispatch_worker_a.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/dispatch_worker_b.sql' `
    -ExpectedSecondExit 3 `
    -StartSecondDelayMilliseconds 0 `
    -BarrierRaceName 'dispatch'
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/dispatch_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Dispatch concurrency assertion failed.' }

  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/admin_ops_race_setup.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare Admin operations race fixtures.' }
  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/teacher_link_first.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/teacher_link_second.sql' `
    -ExpectedSecondExit 3 `
    -StartSecondDelayMilliseconds 0 `
    -BarrierRaceName 'teacher-link'
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/teacher_link_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Teacher link concurrency assertion failed.' }

  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/makeup_booking_first.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/makeup_booking_second.sql' `
    -StartSecondDelayMilliseconds 0 `
    -BarrierRaceName 'makeup-booking'
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/makeup_booking_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Makeup booking concurrency assertion failed.' }

  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/makeup_complete_first.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/makeup_complete_second.sql' `
    -StartSecondDelayMilliseconds 0 `
    -BarrierRaceName 'makeup-complete'
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/makeup_complete_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Makeup completion concurrency assertion failed.' }

  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/makeup_same_task_booking_first.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/makeup_same_task_completion_second.sql' `
    -ExpectedSecondExitCodes @(0, 3) `
    -StartSecondDelayMilliseconds 0 `
    -BarrierRaceName 'makeup-same-task'
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/makeup_same_task_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Makeup same-task booking/completion race assertion failed.' }

  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/course_enrollment_setup.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare Course enrollment concurrency fixtures.' }
  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/course_enroll_first.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/course_enroll_second.sql' `
    -ExpectedFirstExitCodes @(0, 3) `
    -ExpectedSecondExitCodes @(0, 3) `
    -StartSecondDelayMilliseconds 0 `
    -BarrierRaceName 'course-enroll'
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/course_enroll_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Course enrollment concurrency assertion failed.' }

  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/course_transfer_first.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/course_transfer_second.sql' `
    -ExpectedFirstExit 0 `
    -ExpectedSecondExit 3 `
    -StartSecondDelayMilliseconds 0 `
    -BarrierRaceName 'course-transfer-enroll'
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/course_transfer_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Course transfer/enrollment concurrency assertion failed.' }

  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/course_link_enroll_setup.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare Course link/enrollment race fixtures.' }
  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/course_link_enroll_first.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/course_link_second.sql' `
    -StartSecondDelayMilliseconds 250
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/course_link_enroll_first_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Enroll-first Course link race assertion failed.' }

  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/course_link_first.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/course_link_enroll_second.sql' `
    -StartSecondDelayMilliseconds 250
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/course_link_first_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Link-first Course enrollment race assertion failed.' }

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

  Write-Host '[PASS] repeatable migrations, negative preflight, repeatable seed, RLS, SQL suites 001-016, parent races, Admin operations races, bounded Course link/enrollment races, outbox claim race, dispatch-boundary race, and makeup same-task booking/completion race'
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
