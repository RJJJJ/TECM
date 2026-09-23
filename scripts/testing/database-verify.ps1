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
  [switch]$InjectConcurrencyHang,
  [ValidateRange(2, 30)]
  [int]$ContentionHardTimeoutSeconds = 10,
  [string]$RevisionGuardMigrationOverride,
  # Explicit local M40 scope. The default release verifier still runs every suite.
  [switch]$M40Acceptance
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$containerName = "tecm-db-verify-$PID"
$database = 'tecm_verify'
$unsafeDatabase = 'tecm_unsafe_preflight'
$containerStarted = $false
# Overrides must replace the final effective teacher RPC, not its superseded body.
$revisionGuardMigration = '/workspace/supabase/migrations/20260922135148_teacher_attendance_membership_and_roster.sql'
$overrideDirectory = $null
$verificationError = $null
$cleanupError = $null
$m40SemanticPrefix = '@@TECM_M40_SEMANTIC@@'
$m40SemanticSchema = 'tecm.m40.semantic.v1'
$m40SidecarSemanticSchema = 'tecm.m40.semantic.v2'
$m40SemanticProducer = 'database-verify.ps1/Invoke-TeacherAttendanceContention'
$m40SidecarPathEnvironment = 'TECM_M40_SEMANTIC_RECORD_PATH'
$m40SidecarCorrelationEnvironment = 'TECM_M40_SEMANTIC_CORRELATION'
$m40SidecarMaximumBytes = 16KB
$m40SidecarPathInput = [Environment]::GetEnvironmentVariable($m40SidecarPathEnvironment, 'Process')
$m40SidecarCorrelationInput = [Environment]::GetEnvironmentVariable($m40SidecarCorrelationEnvironment, 'Process')
[Environment]::SetEnvironmentVariable($m40SidecarPathEnvironment, $null, 'Process')
[Environment]::SetEnvironmentVariable($m40SidecarCorrelationEnvironment, $null, 'Process')
$m40SidecarMode = $false
$m40SidecarPath = $null
$m40SidecarCorrelation = $null
$m40SidecarWriteCount = 0
$m40LifecyclePrefix = '[M40 LIFECYCLE]'
$m40RejectionPrefix = '[M40 REJECT]'
$m40ExpectedTermination = 'M40_BLOCKING_CONTENTION_CAUGHT'
$m40TerminalPrefix = '@@TECM_M40_TERMINAL@@'
$m40TerminalSchema = 'tecm.m40.terminal.v1'
$m40TerminalProducer = 'database-verify.ps1/outer-finalization'
$m40TerminalPending = $false
$m40TerminalWriteCount = 0
$m40TerminalRejectionEmitted = $null
$databaseCleanupLabel = 'NOT_RUN'
$containerCleanupLabel = 'NOT_RUN'

function Initialize-M40SemanticSidecar {
  $hasPath = -not [string]::IsNullOrWhiteSpace($m40SidecarPathInput)
  $hasCorrelation = -not [string]::IsNullOrWhiteSpace($m40SidecarCorrelationInput)
  if (-not $hasPath -and -not $hasCorrelation) { return }
  if (-not $hasPath -or -not $hasCorrelation) {
    throw 'M40 sidecar path and correlation must be supplied together.'
  }

  [Guid]$parsedCorrelation = [Guid]::Empty
  if (-not [Guid]::TryParseExact($m40SidecarCorrelationInput, 'D', [ref]$parsedCorrelation)) {
    throw 'M40 sidecar correlation must be a canonical UUID.'
  }
  $candidatePath = [IO.Path]::GetFullPath($m40SidecarPathInput)
  $repositoryPrefix = $repoRoot.TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if ($candidatePath.Equals($repoRoot, [StringComparison]::OrdinalIgnoreCase) -or
      $candidatePath.StartsWith($repositoryPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'M40 sidecar path must be outside the repository.'
  }
  $candidateParent = [IO.Path]::GetDirectoryName($candidatePath)
  if (-not [IO.Directory]::Exists($candidateParent)) {
    throw 'M40 sidecar parent must already exist.'
  }
  if ([IO.File]::Exists($candidatePath) -or [IO.Directory]::Exists($candidatePath)) {
    throw 'M40 sidecar path must not exist before verifier start.'
  }

  $script:m40SidecarPath = $candidatePath
  $script:m40SidecarCorrelation = $parsedCorrelation.ToString('D')
  $script:m40SidecarMode = $true
}

function Write-M40SemanticRecord {
  param(
    [Parameter(Mandatory)][string]$RaceName,
    [Parameter(Mandatory)][string]$Classification,
    [AllowNull()][object]$SqlClassification,
    [AllowNull()][object]$SqlState,
    [AllowNull()][object]$ErrorIdentifier,
    [AllowNull()][object]$ElapsedMilliseconds,
    [Parameter(Mandatory)][string]$WorkerState,
    [AllowNull()][object]$WorkerExitCode,
    [bool]$WorkerTimedOut = $false,
    [AllowNull()][object]$WorkerSignal,
    [AllowNull()][object]$WorkerProcessError,
    [Parameter(Mandatory)][string]$Readiness,
    [bool]$UnauthorizedMarkerObserved = $false,
    [AllowNull()][object]$Lifecycle
  )

  $sqlRecord = [ordered]@{
    classification = $SqlClassification
    sqlstate = $SqlState
    error_identifier = $ErrorIdentifier
    elapsed_milliseconds = $ElapsedMilliseconds
    unauthorized_marker_observed = $UnauthorizedMarkerObserved
  }
  $workerRecord = [ordered]@{
    state = $WorkerState
    exit_code = $WorkerExitCode
    timed_out = $WorkerTimedOut
    signal = $WorkerSignal
    process_error = $WorkerProcessError
  }
  $record = if ($m40SidecarMode) {
    [ordered]@{
      schema = $m40SidecarSemanticSchema
      producer = $m40SemanticProducer
      correlation = $m40SidecarCorrelation
      race = $RaceName
      classification = $Classification
      sql = $sqlRecord
      worker = $workerRecord
      readiness = $Readiness
      lifecycle = $Lifecycle
    }
  } else {
    [ordered]@{
      schema = $m40SemanticSchema
      producer = $m40SemanticProducer
      race = $RaceName
      classification = $Classification
      sql = $sqlRecord
      worker = $workerRecord
      readiness = $Readiness
    }
  }
  if ($m40SidecarMode -and $null -eq $Lifecycle) {
    throw 'M40 sidecar lifecycle record is required.'
  }
  $recordJson = $record | ConvertTo-Json -Compress -Depth 8
  if (-not $m40SidecarMode) {
    return
  }

  $temporaryPath = "$m40SidecarPath.$m40SidecarCorrelation.tmp"
  try {
    if ($m40SidecarWriteCount -ne 0) { throw 'M40 sidecar already contains an authoritative record.' }
    if ([IO.File]::Exists($m40SidecarPath) -or [IO.Directory]::Exists($m40SidecarPath)) {
      throw 'M40 sidecar target appeared before the authoritative write.'
    }
    $recordBytes = [Text.UTF8Encoding]::new($false).GetBytes($recordJson)
    if ($recordBytes.Length -eq 0 -or $recordBytes.Length -gt $m40SidecarMaximumBytes) {
      throw 'M40 sidecar record exceeded its bounded size contract.'
    }
    $stream = [IO.FileStream]::new(
      $temporaryPath,
      [IO.FileMode]::CreateNew,
      [IO.FileAccess]::Write,
      [IO.FileShare]::None,
      4096,
      [IO.FileOptions]::WriteThrough
    )
    try {
      $stream.Write($recordBytes, 0, $recordBytes.Length)
      $stream.Flush($true)
    } finally {
      $stream.Dispose()
    }
    [IO.File]::Move($temporaryPath, $m40SidecarPath)
    $writtenBytes = [IO.File]::ReadAllBytes($m40SidecarPath)
    $writtenJson = [Text.UTF8Encoding]::new($false, $true).GetString($writtenBytes)
    if ($writtenBytes.Length -ne $recordBytes.Length -or $writtenJson -cne $recordJson) {
      throw 'M40 sidecar record verification failed after the atomic move.'
    }
    $script:m40SidecarWriteCount = 1
  } catch {
    if ([IO.File]::Exists($temporaryPath)) {
      try { Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction Stop } catch { }
    }
    Write-Host "$m40RejectionPrefix M40_SIDECAR_WRITE_FAILED"
    throw 'M40_SIDECAR_WRITE_FAILED'
  }
}

function Write-M40TerminalOutcome {
  if (-not $m40SidecarMode -or -not $m40TerminalPending) {
    throw 'M40 terminal outcome requires a pending sidecar finalization.'
  }
  if ($m40SidecarWriteCount -ne 1 -or $m40TerminalWriteCount -ne 0) {
    throw 'M40 terminal outcome requires exactly one authoritative sidecar and no prior terminal record.'
  }
  if ($databaseCleanupLabel -ne 'PASS' -or $containerCleanupLabel -ne 'PASS') {
    throw 'M40 terminal outcome requires successful outer cleanup.'
  }
  $terminalRecord = [ordered]@{
    schema = $m40TerminalSchema
    producer = $m40TerminalProducer
    correlation = $m40SidecarCorrelation
    outcome = $m40ExpectedTermination
    database_cleanup = $databaseCleanupLabel
    container_cleanup = $containerCleanupLabel
  }
  $terminalJson = $terminalRecord | ConvertTo-Json -Compress -Depth 4
  $terminalBytes = [Text.UTF8Encoding]::new($false).GetBytes($terminalJson)
  if ($terminalBytes.Length -eq 0 -or $terminalBytes.Length -gt $m40SidecarMaximumBytes) {
    throw 'M40 terminal outcome exceeded its bounded size contract.'
  }
  $script:m40TerminalWriteCount = 1
  Write-Host ($m40TerminalPrefix + $terminalJson)
}

function Get-SanitizedM40SqlDiagnostic {
  param([object[]]$Output)

  $text = (@($Output | ForEach-Object { [string]$_ }) -join "`n")
  $match = [regex]::Match($text, 'ERROR:\s+([0-9A-Z]{5}):\s*([^\r\n]*)')
  $sqlState = if ($match.Success) { $match.Groups[1].Value } else { $null }
  $message = if ($match.Success) { $match.Groups[2].Value.Trim() } else { '' }
  $phaseMatches = [regex]::Matches($text, '@@TECM_M40_PHASE@@([a-z_]+)')
  $phase = if ($phaseMatches.Count -gt 0) {
    $phaseMatches[$phaseMatches.Count - 1].Groups[1].Value
  } else {
    $null
  }
  $timeoutPhaseIdentifiers = @{
    session_setup = 'session_setup_statement_timeout'
    rpc_timeout_armed = 'timeout_arm_statement_timeout'
    pre_rpc_timeout_control = 'pre_rpc_statement_timeout'
    rpc_statement_started = 'rpc_wrapper_pre_invocation_timeout'
    rpc_invoked = 'rpc_statement_timeout_unclassified'
    rpc_timeout_sqlstate_invalid = 'rpc_timeout_sqlstate_invalid'
    rpc_timeout_message_invalid = 'rpc_timeout_message_invalid'
    rpc_timeout_elapsed_below_minimum = 'rpc_timeout_elapsed_below_minimum'
    rpc_timeout_elapsed_above_maximum = 'rpc_timeout_elapsed_above_maximum'
  }
  $safeIdentifiers = @(
    'UNRELATED_M40_SQL_PROBE',
    'GENERIC_P0001_M40_PROBE',
    'UNAUTHORIZED_M40_MARKER_PROBE'
  )
  $errorIdentifier = if ($sqlState -eq '57014' -and $phase -and $timeoutPhaseIdentifiers.ContainsKey($phase)) {
    $timeoutPhaseIdentifiers[$phase]
  } elseif ($message -in $safeIdentifiers) {
    $message
  } elseif ($message) {
    'redacted_unexpected_sql_error'
  } else {
    'unavailable_sql_diagnostic'
  }
  [pscustomobject]@{
    SqlState = $sqlState
    ErrorIdentifier = $errorIdentifier
    UnauthorizedMarkerObserved = $text.Contains($m40SemanticPrefix)
  }
}

if ($RevisionGuardMigrationOverride) {
  $overridePath = (Resolve-Path -LiteralPath $RevisionGuardMigrationOverride).Path
  if (-not (Test-Path -LiteralPath $overridePath -PathType Leaf)) {
    throw 'Revision guard migration override must be an existing file.'
  }
  $overrideDirectory = Split-Path -Parent $overridePath
  $revisionGuardMigration = '/revision-override/' + [IO.Path]::GetFileName($overridePath)
}

  function Invoke-NegativePreflightProcess {
    param(
      [Parameter(Mandatory)][string]$FilePath,
      [Parameter(Mandatory)][string[]]$Arguments,
      [Parameter(Mandatory)][string]$Phase,
      [ValidateRange(1, 300)][int]$TimeoutSeconds = 120,
      [ValidateRange(1024, 262144)][int]$MaximumStreamBytes = 16384,
      [AllowNull()][scriptblock]$DiagnosticObserver = $null,
      [AllowNull()][hashtable]$NativeTimeoutSnapshotContext = $null
    )

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in $Arguments) { [void]$startInfo.ArgumentList.Add($argument) }

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $started = $false
    $timedOut = $false
    $exitCode = $null
    $processError = $null
    $standardOutput = ''
    $standardError = ''
    $pipes = @()
    $snapshotEnabled = $Phase -eq 'competitor' -and $null -ne $NativeTimeoutSnapshotContext
    $timeoutSnapshot = $null
    $snapshotStatus = $null
    function Copy-M40NativeTimeoutSnapshot {
      param($NativeProcess, $NativePipes, $GuardClock, $Context)
      $start = [Diagnostics.Stopwatch]::GetTimestamp()
      $guardStart = $GuardClock.Elapsed.TotalMilliseconds
      $state = if ($NativeProcess.HasExited) { 'Exited' } else { 'Running' }
      $copy = [ordered]@{
        diagnostic_only = $true; semantic_authority = $false; expected_correlation = $Context.Correlation
        clock = 'System.Diagnostics.Stopwatch.GetTimestamp'; clock_frequency = [Diagnostics.Stopwatch]::Frequency
        snapshot_started_ticks = $start; guard_elapsed_at_start_ms = $guardStart
        process_id = $NativeProcess.Id; executable = $NativeProcess.StartInfo.FileName; process_state = $state
        process_observed_ticks = [Diagnostics.Stopwatch]::GetTimestamp()
        streams = @()
      }
      foreach ($nativePipe in $NativePipes) {
        $observed = [Diagnostics.Stopwatch]::GetTimestamp()
        $length = $nativePipe.Bytes.Length
        $kept = [int][Math]::Min($length,16384)
        $accumulated = [byte[]]::new($kept)
        [Array]::Copy($nativePipe.Bytes.GetBuffer(),0,$accumulated,0,$kept)
        $complete = [bool]$nativePipe.Complete
        $taskStatus = [string]$nativePipe.Pending.Status
        $readCount = $null; $pendingBytes = $null
        $readState = if ($complete) { 'already_consumed' } else { 'unavailable' }
        if (-not $complete -and $taskStatus -ceq 'RanToCompletion') {
          # This task has succeeded. Never await a pending/faulted/canceled read.
          $readCount = $nativePipe.Pending.GetAwaiter().GetResult()
          $pendingBytes = [byte[]]::new([int][Math]::Min($readCount,4096))
          [Array]::Copy($nativePipe.Buffer,0,$pendingBytes,0,$pendingBytes.Length)
          $readState = 'successful_unprocessed_read'
        }
        $copy.streams += [pscustomobject][ordered]@{
          stream = $nativePipe.Origin; observed_started_ticks = $observed
          accumulated_original_length = $length; accumulated_saved_length = $kept
          accumulated_truncated = $length -gt $kept; accumulated_bytes = $accumulated
          line_offset = $nativePipe.LineOffset; collector_complete = $complete; collector_observed_eof = $complete
          pending_task_status = $taskStatus; read_state = $readState; unprocessed_read_count = $readCount
          unprocessed_saved_length = if ($null -eq $pendingBytes) { $null } else { $pendingBytes.Length }
          unprocessed_truncated = if ($null -eq $pendingBytes) { $null } else { $readCount -gt $pendingBytes.Length }
          unprocessed_bytes = $pendingBytes; observed_finished_ticks = [Diagnostics.Stopwatch]::GetTimestamp()
        }
      }
      $copy.guard_elapsed_at_finish_ms = $GuardClock.Elapsed.TotalMilliseconds
      $copy.snapshot_finished_ticks = [Diagnostics.Stopwatch]::GetTimestamp()
      return [pscustomobject]$copy
    }
    function Save-M40NativeTimeoutSnapshot {
      param($Snapshot, $Context)
      # Called only after the existing native termination/cleanup block.
      foreach ($streamCopy in $Snapshot.streams) {
        $streamCopy.accumulated_bytes = [Convert]::ToBase64String($streamCopy.accumulated_bytes)
        if ($null -ne $streamCopy.unprocessed_bytes) {
          $streamCopy.unprocessed_bytes = [Convert]::ToBase64String($streamCopy.unprocessed_bytes)
        }
      }
      $bytes = [Text.UTF8Encoding]::new($false,$true).GetBytes(($Snapshot | ConvertTo-Json -Compress -Depth 6) + "`n")
      if ($bytes.Length -gt 65536) { throw 'snapshot_size_exceeded' }
      $digest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
      $file = [IO.File]::Open($Context.Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
      try { $file.Write($bytes,0,$bytes.Length); $file.Flush($true) } finally { $file.Dispose() }
      if ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($Context.Path))).ToLowerInvariant() -cne $digest) {
        throw 'snapshot_verification_failed'
      }
      return [pscustomobject]@{ status='saved'; expected_correlation=$Context.Correlation; bytes=$bytes.Length; sha256=$digest }
    }
    function Publish-M40ChildObservation {
      param([string]$Kind, [string]$Stream = 'none', [string]$Text = '')
      if ($null -eq $DiagnosticObserver) { return }
      $state = if (-not $started) { 'NotStarted' } elseif ($process.HasExited) { 'Exited' } else { 'Running' }
      $code = if ($started -and $process.HasExited) { $process.ExitCode } else { $null }
      & $DiagnosticObserver ([pscustomobject]@{ Kind=$Kind; Stream=$Stream; Text=$Text; State=$state; ExitCode=$code })
    }
    function Publish-M40PipeLines {
      param([object]$Pipe, [bool]$Final = $false)
      if ($null -eq $DiagnosticObserver) { return }
      $bytes = $Pipe.Bytes.ToArray()
      for ($index = $Pipe.LineOffset; $index -lt $bytes.Length; $index++) {
        if ($bytes[$index] -ne 10 -and -not ($Final -and $index -eq $bytes.Length - 1)) { continue }
        $length = $index - $Pipe.LineOffset + $(if ($bytes[$index] -eq 10) { 0 } else { 1 })
        if ($length -gt 0 -and $bytes[$Pipe.LineOffset + $length - 1] -eq 13) { $length-- }
        $line = [Text.UTF8Encoding]::new($false,$true).GetString($bytes,$Pipe.LineOffset,$length)
        Publish-M40ChildObservation -Kind 'line' -Stream $Pipe.Origin -Text $line
        $Pipe.LineOffset = $index + 1
      }
    }
    try {
      if (-not $process.Start()) { throw 'negative_preflight_process_start_failed' }
      $started = $true
      $process.StandardInput.Close()
      Publish-M40ChildObservation -Kind 'child_started'
      # Read both byte streams concurrently, with a hard bound before decoding.
      # StreamReader's replacement fallback must never repair invalid UTF-8.
      foreach ($stream in @($process.StandardOutput.BaseStream,$process.StandardError.BaseStream)) {
        $buffer = [byte[]]::new(4096)
        $pipes += [pscustomobject]@{
          Stream = $stream; Buffer = $buffer; Bytes = [IO.MemoryStream]::new()
          LineOffset = 0; Origin = $(if ($pipes.Count -eq 0) { 'stdout' } else { 'stderr' })
          Pending = $stream.ReadAsync($buffer,0,$buffer.Length); Complete = $false
        }
      }
      $deadline = [Diagnostics.Stopwatch]::StartNew()
      $lastHeartbeat = -250
      while (-not $process.HasExited -or @($pipes | Where-Object { -not $_.Complete }).Count -gt 0) {
        if ($deadline.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
          $timedOut = $true
          if ($snapshotEnabled) {
            try { $timeoutSnapshot = Copy-M40NativeTimeoutSnapshot $process $pipes $deadline $NativeTimeoutSnapshotContext }
            catch { $snapshotStatus = [pscustomobject]@{ status='unavailable'; reason='snapshot_copy_failed' } }
          }
          throw 'negative_preflight_process_timeout'
        }
        if ($DiagnosticObserver -and $deadline.ElapsedMilliseconds - $lastHeartbeat -ge 250) {
          Publish-M40ChildObservation -Kind $(if ($process.HasExited) { 'child_exited' } else { 'child_running' })
          $lastHeartbeat = $deadline.ElapsedMilliseconds
        }
        foreach ($pipe in $pipes) {
          if ($pipe.Complete -or -not $pipe.Pending.IsCompleted) { continue }
          $read = $pipe.Pending.GetAwaiter().GetResult()
          if ($read -eq 0) { $pipe.Complete = $true; Publish-M40PipeLines -Pipe $pipe -Final $true; continue }
          if ($pipe.Bytes.Length + $read -gt $MaximumStreamBytes) { throw 'negative_preflight_output_oversized' }
          $pipe.Bytes.Write($pipe.Buffer,0,$read)
          Publish-M40PipeLines -Pipe $pipe
          $pipe.Pending = $pipe.Stream.ReadAsync($pipe.Buffer,0,$pipe.Buffer.Length)
        }
        Start-Sleep -Milliseconds 10
      }
      $utf8 = [Text.UTF8Encoding]::new($false,$true)
      try {
        $standardOutput = $utf8.GetString($pipes[0].Bytes.ToArray())
        $standardError = $utf8.GetString($pipes[1].Bytes.ToArray())
      } catch {
        throw 'negative_preflight_encoding_invalid'
      }
      $exitCode = $process.ExitCode
      Publish-M40ChildObservation -Kind 'child_exited'
    } catch {
      $processError = if ($_.Exception.Message -cin @(
        'negative_preflight_process_start_failed','negative_preflight_process_timeout',
        'negative_preflight_output_oversized','negative_preflight_encoding_invalid'
      )) { $_.Exception.Message } else { 'negative_preflight_process_error' }
      $standardOutput = ''
      $standardError = ''
      Publish-M40ChildObservation -Kind 'child_failed'
    } finally {
      if ($started -and -not $process.HasExited) {
        try {
          $process.Kill($true)
          if (-not $process.WaitForExit(5000)) { $processError = 'negative_preflight_process_termination_failed' }
          Publish-M40ChildObservation -Kind 'child_terminated'
        } catch {
          $processError = 'negative_preflight_process_termination_failed'
        }
      }
      foreach ($pipe in $pipes) { $pipe.Stream.Dispose(); $pipe.Bytes.Dispose() }
      $process.Dispose()
    }
    if ($snapshotEnabled -and $timedOut -and $null -ne $timeoutSnapshot) {
      try { $snapshotStatus = Save-M40NativeTimeoutSnapshot $timeoutSnapshot $NativeTimeoutSnapshotContext }
      catch { $snapshotStatus = [pscustomobject]@{ status='unavailable'; reason='snapshot_save_failed' } }
    }
    $captureResult = [pscustomobject]@{
      Phase = $Phase
      ExitCode = $exitCode
      TimedOut = $timedOut
      Signal = $null
      ProcessError = $processError
      Stdout = $standardOutput
      Stderr = $standardError
    }
    if ($snapshotEnabled) {
      if ($null -eq $snapshotStatus) { $snapshotStatus = [pscustomobject]@{ status='not_triggered' } }
      $captureResult | Add-Member -NotePropertyName NativeTimeoutSnapshotStatus -NotePropertyValue $snapshotStatus
    }
    $captureResult
  }

# Diagnostic evidence only. No trace field is consumed by the M40 SQL classifier.
$m40TraceInput = [Environment]::GetEnvironmentVariable('TECM_M40_TRACE_PATH', 'Process')
$m40TraceCorrelation = [Environment]::GetEnvironmentVariable('TECM_M40_TRACE_CORRELATION', 'Process')
[Environment]::SetEnvironmentVariable('TECM_M40_TRACE_PATH', $null, 'Process')
[Environment]::SetEnvironmentVariable('TECM_M40_TRACE_CORRELATION', $null, 'Process')
$m40TraceEnabled = $false
$m40TraceEvents = [Collections.Generic.List[object]]::new()
$m40TraceStart = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$m40TracePhase = 'phase_unknown'
$m40TraceSource = 'verifier'
$m40TraceOrdinal = 0
$m40TraceWriteError = $false

function Initialize-M40DiagnosticTrace {
  if (-not $m40TraceInput -and -not $m40TraceCorrelation) { return }
  $tracePath = [IO.Path]::GetFullPath($m40TraceInput)
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ($m40TraceCorrelation -cnotmatch '^[a-f0-9]{64}$' -or
      -not $tracePath.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($tracePath) -cne 'diagnostic.json' -or
      -not [IO.Directory]::Exists([IO.Path]::GetDirectoryName($tracePath)) -or
      [IO.File]::Exists($tracePath)) { throw 'M40_TRACE_SETUP_INVALID' }
  $script:m40TraceEnabled = $true
}

function Add-M40TraceEvent {
  param([string]$Phase, [string]$Stream = 'none', [string]$Classification = 'phase_completed',
    [AllowNull()][object]$SqlState = $null, [double]$At = 0, [AllowNull()][object]$SqlAt = $null,
    [int]$ByteCount = 0, [AllowNull()][object]$Digest = $null,
    [string]$Kind = 'phase', [string]$Source = 'verifier', [int]$Ordinal = 0)
  if (-not $m40TraceEnabled) { return }
  if ($m40TraceEvents.Count -ge 128) { throw 'M40_TRACE_RECORD_COUNT_INVALID' }
  if ($At -eq 0) { $At = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
  $script:m40TracePhase = $Phase
  $m40TraceEvents.Add([ordered]@{
    schema = 'tecm.m40.diagnostic.event.v1'; correlation = $m40TraceCorrelation
    producer = 'database-verify.ps1/diagnostic'; sequence = $m40TraceEvents.Count + 1
    kind = $Kind; phase = $Phase; stream = $Stream; at_ms = $At; sql_at_ms = $SqlAt
    elapsed_ms = [Math]::Round($At - $m40TraceStart, 3)
    sqlstate = $SqlState; classification = $Classification
    byte_count = $ByteCount; digest = $Digest; source = $Source; source_ordinal = $Ordinal
  })
}

function Add-M40TraceDiagnostic {
  param([string]$Text, [string]$Stream, [string]$Phase = 'phase_unknown',
    [string]$Source = 'verifier', [int]$Ordinal = 0,
    [string]$Classification = 'unclassified_diagnostic', [AllowNull()][object]$SqlState = $null)
  if (-not $m40TraceEnabled) { return }
  $bytes = [Text.UTF8Encoding]::new($false, $true).GetBytes($Text)
  if ($bytes.Length -gt 16384) { throw 'M40_TRACE_DIAGNOSTIC_OVERSIZED' }
  $state = [regex]::Match($Text, '(?:ERROR|FATAL|PANIC|SQLSTATE):?\s+([0-9A-Z]{5})(?::|\b)')
  if ($state.Success) { $SqlState = $state.Groups[1].Value }
  $digest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
  Add-M40TraceEvent -Phase $Phase -Stream $Stream -Classification $Classification -SqlState $SqlState `
    -ByteCount $bytes.Length -Digest $digest -Kind 'diagnostic' -Source $Source -Ordinal $Ordinal
}

function Initialize-M40JobReceiver {
  if ('TecmM40.JobReceiverV2' -as [type]) { return }
  # PSRemotingChildJob's Results includes host calls bound to the creating host.
  # Receive-Job executes those calls, even when its own pipeline redirects all
  # streams. WarningRecord results only populate WarningVariable. Consume the
  # leaf's native collections instead, exclusively, and never execute Results.
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Management.Automation;
namespace TecmM40 {
  public sealed class JobIngressV2 {
    public string Stream { get; }
    public object Value { get; }
    public JobIngressV2(string stream, object value) { Stream = stream; Value = value; }
  }
  public sealed class JobReceiverV2 : IDisposable {
    readonly object sync = new object();
    readonly List<JobIngressV2> pending = new List<JobIngressV2>();
    readonly List<Action> detach = new List<Action>();
    bool overflow, disposed;
    public JobReceiverV2(Job parent) {
      if (parent.ChildJobs.Count != 1 || parent.ChildJobs[0].ChildJobs.Count != 0)
        throw new InvalidOperationException("M40_JOB_TOPOLOGY_INVALID");
      var job = parent.ChildJobs[0];
      Watch(job.Output, "output"); Watch(job.Error, "error");
      Watch(job.Warning, "warning"); Watch(job.Information, "information");
      Watch(job.Verbose, "verbose"); Watch(job.Debug, "debug"); Watch(job.Progress, "progress");
    }
    void Watch<T>(PSDataCollection<T> stream, string origin) {
      EventHandler<DataAddedEventArgs> handler = (sender, args) => Consume(stream, origin);
      stream.DataAdded += handler;
      detach.Add(() => stream.DataAdded -= handler);
      // Subscribe first, then consume the initial backlog. ReadAll is consuming;
      // a racing callback sees only records not already taken by this call.
      Consume(stream, origin);
    }
    void Consume<T>(PSDataCollection<T> stream, string origin) {
      lock (sync) {
        if (disposed) return;
        if (stream.Count > 512) { overflow = true; return; }
        foreach (var record in stream.ReadAll()) {
          if (pending.Count >= 512) { overflow = true; break; }
          pending.Add(new JobIngressV2(origin, record));
        }
      }
    }
    public JobIngressV2[] Drain() {
      lock (sync) {
        if (disposed) throw new InvalidOperationException("M40_JOB_RECEIVER_DISPOSED");
        if (overflow) throw new InvalidOperationException("M40_JOB_RECORD_LIMIT");
        var result = pending.ToArray(); pending.Clear(); return result;
      }
    }
    public void Dispose() {
      lock (sync) {
        if (disposed) return;
        disposed = true;
        foreach (var action in detach) action();
        detach.Clear();
      }
    }
  }
}
'@
}

function Write-M40WorkerPacket {
  param([hashtable]$Context, [string]$Kind, [string]$Phase, [string]$Stream = 'none',
    [string]$Classification = 'phase_completed', [double]$At = 0, [AllowNull()][object]$SqlState = $null,
    [int]$ByteCount = 0, [AllowNull()][object]$Digest = $null)
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  # PostgreSQL in Docker and the Windows observer have different clocks.
  # Local deadlines use only local observation time. Preserve SQL time solely
  # for ordering/durations within that SQL session, never cross-clock freshness.
  $sqlAt = if ($Kind -eq 'phase' -and $Stream -eq 'stderr' -and $At -ne 0) { $At } else { $null }
  $Context.Sequence++
  if ($Context.Sequence -gt 256) { throw 'M40_JOB_PACKET_LIMIT' }
  $packet = [pscustomobject][ordered]@{
    schema='tecm.m40.job.diagnostic.v1'; producer='database-verify.ps1/worker-observer'
    correlation=$Context.Correlation; sequence=$Context.Sequence; kind=$Kind; phase=$Phase; stream=$Stream
    at_ms=$now; sql_at_ms=$sqlAt; observed_at_ms=$now; worker_elapsed_ms=$Context.Clock.Elapsed.TotalMilliseconds
    sqlstate=$SqlState; classification=$Classification; byte_count=$ByteCount; digest=$Digest
    child_state=$Context.ChildState; child_exit_code=$Context.ChildExitCode
  }
  # The information stream bypasses the function's buffered success result.
  Write-Information -MessageData $packet -InformationAction Continue
}

function Send-M40ChildObservation {
  param([hashtable]$Context, [object]$Event)
  if ($Event.Kind -ne 'line') {
    $Context.ChildState = $Event.State
    $Context.ChildExitCode = $Event.ExitCode
    Write-M40WorkerPacket $Context 'process' $Context.Phase -Classification $Event.Kind
    return
  }
  $line = [string]$Event.Text
  if ($line.Length -eq 0) { return }
  if ($Event.Stream -eq 'stderr') {
    $match = [regex]::Match($line, '^psql:[^\r\n]{1,256}:\d+: NOTICE:\s+(?:00000:\s+)?@@TECM_R3_PHASE@@([a-z_]+)\|([0-9]{13}(?:\.[0-9]{1,3})?)\|(none|[0-9A-Z]{5})$')
    if ($match.Success) {
      $Context.Phase = $match.Groups[1].Value
      $at = [double]::Parse($match.Groups[2].Value,[Globalization.CultureInfo]::InvariantCulture)
      $state = if ($match.Groups[3].Value -eq 'none') { $null } else { $match.Groups[3].Value }
      Write-M40WorkerPacket $Context 'phase' $Context.Phase -Stream 'stderr' -At $at -SqlState $state
      $Context.KnownFrame = $true
      return
    }
    if ($line -match 'NOTICE:\s+(?:00000:\s+)?@@TECM_M40_PHASE@@[a-z_]+$') { $Context.KnownFrame = $true; return }
    if ($Context.KnownFrame -and $line -match '^(?:CONTEXT:\s+PL/pgSQL function inline_code_block line \d+ at RAISE|LOCATION:\s+exec_stmt_raise,\s+pl_exec\.c:\d+)$') { return }
    $Context.KnownFrame = $false
    if ($line -match 'ERROR:\s+57014:\s+canceling statement due to statement timeout$' -and $Context.Phase -eq 'slow_setup_started') {
      $Context.SqlState = '57014'; $Context.Classification = 'pre_rpc_statement_timeout'
    }
    $phase = $Context.Phase
  } else {
    if ($line -cmatch '^@@TECM_R3_STREAM_PHASE@@(session_setup_completed|slow_setup_completed)$') { $Context.StdoutPhase=$Matches[1]; return }
    if ($line -notmatch '^\s*(?:psql:|ERROR:|CONTEXT:|LOCATION:|FATAL:|PANIC:|SQLSTATE\b)') { return }
    $phase = $Context.StdoutPhase
  }
  $bytes = [Text.UTF8Encoding]::new($false,$true).GetBytes($line)
  if ($bytes.Length -gt 16384) { throw 'M40_JOB_PACKET_LIMIT' }
  $state = [regex]::Match($line,'(?:ERROR|FATAL|PANIC|SQLSTATE):?\s+([0-9A-Z]{5})(?::|\b)')
  $sqlState = if ($state.Success) { $state.Groups[1].Value } else { $Context.SqlState }
  $classification = if ($Event.Stream -eq 'stderr') { $Context.Classification } else { 'unclassified_diagnostic' }
  Write-M40WorkerPacket $Context 'diagnostic' $phase -Stream $Event.Stream -SqlState $sqlState -Classification $classification `
    -ByteCount $bytes.Length -Digest ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant())
}

function Test-M40JobPacket {
  param([object]$Packet, [object]$Observation)
  $fields = @('schema','producer','correlation','sequence','kind','phase','stream','at_ms','sql_at_ms','observed_at_ms',
    'worker_elapsed_ms','sqlstate','classification','byte_count','digest','child_state','child_exit_code')
  if ((@($Packet.PSObject.Properties.Name | Sort-Object) -join ',') -cne (($fields | Sort-Object) -join ',')) { throw 'M40_JOB_PACKET_FIELDS_INVALID' }
  if ($Packet.schema -cne 'tecm.m40.job.diagnostic.v1' -or $Packet.producer -cne 'database-verify.ps1/worker-observer') { throw 'M40_JOB_PACKET_SCHEMA_INVALID' }
  if ($Packet.correlation -cnotmatch '^[a-f0-9]{64}$' -or $Packet.correlation -cne $Observation.Correlation) { throw 'M40_JOB_PACKET_CORRELATION_INVALID' }
  $identity = $Packet.correlation + '|' + $Packet.sequence + '|' + $Packet.stream
  if ($Observation.PacketIdentities.Contains($identity)) { throw 'M40_JOB_PACKET_DUPLICATE_IDENTITY' }
  if ($Packet.sequence -isnot [int] -and $Packet.sequence -isnot [long]) { throw 'M40_JOB_PACKET_SEQUENCE_INVALID' }
  if ($Packet.sequence -ne $Observation.PacketSequence + 1 -or $Packet.sequence -gt 256) { throw 'M40_JOB_PACKET_SEQUENCE_INVALID' }
  if ($Packet.phase -cnotin @('phase_unknown','session_setup_started','session_setup_completed','slow_setup_started',
      'slow_setup_completed','statement_timeout_armed','rpc_started','rpc_finished','classification_completed') -or
      $Packet.kind -cnotin @('phase','diagnostic','process') -or $Packet.stream -cnotin @('none','stdout','stderr') -or
      $Packet.child_state -cnotin @('NotStarted','Running','Exited','TerminationFailed','Unknown') -or
      $Packet.classification -cnotin @('phase_completed','unclassified_diagnostic','pre_rpc_statement_timeout',
        'worker_started','child_started','child_running','child_exited','child_failed','child_terminated')) { throw 'M40_JOB_PACKET_VALUE_INVALID' }
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  # The job can start between Start-Job and Wait; tolerate only that bounded startup interval.
  if (-not [double]::IsFinite([double]$Packet.at_ms) -or -not [double]::IsFinite([double]$Packet.observed_at_ms) -or
      $Packet.at_ms -lt $Observation.StartedAt - 2000 -or $Packet.at_ms -gt $now -or
      $Packet.observed_at_ms -lt $Packet.at_ms -or $Packet.observed_at_ms -gt $now -or
      -not [double]::IsFinite([double]$Packet.worker_elapsed_ms) -or $Packet.worker_elapsed_ms -lt 0 -or
      $Packet.worker_elapsed_ms -gt 60000) { throw 'M40_JOB_PACKET_TIME_INVALID' }
  if ($null -ne $Packet.sqlstate -and $Packet.sqlstate -cnotmatch '^[0-9A-Z]{5}$') { throw 'M40_JOB_PACKET_SQLSTATE_INVALID' }
  if ($null -ne $Packet.sql_at_ms -and ($Packet.kind -ne 'phase' -or $Packet.stream -ne 'stderr' -or
      -not [double]::IsFinite([double]$Packet.sql_at_ms) -or $Packet.sql_at_ms -lt 1000000000000 -or
      $Packet.sql_at_ms -ge 10000000000000)) { throw 'M40_JOB_PACKET_TIME_INVALID' }
  if ($Packet.byte_count -lt 0 -or $Packet.byte_count -gt 16384 -or
      ($Packet.kind -eq 'diagnostic' -and ($Packet.digest -cnotmatch '^[a-f0-9]{64}$' -or $Packet.stream -eq 'none')) -or
      ($Packet.kind -ne 'diagnostic' -and ($null -ne $Packet.digest -or $Packet.byte_count -ne 0))) { throw 'M40_JOB_PACKET_METADATA_INVALID' }
  $null = $Observation.PacketIdentities.Add($identity)
  $Observation.PacketSequence++
  # Reconstruct the allowed fields to exclude remoting metadata from persisted evidence.
  $safe = [ordered]@{}
  foreach ($field in $fields) { $safe[$field] = $Packet.$field }
  return $safe
}

function Import-M40JobTrace {
  param([object]$Observation)
  if (-not $m40TraceEnabled) { return }
  while ($Observation.Imported -lt $Observation.Records.Count) {
    $record = $Observation.Records[$Observation.Imported++]
    $packet = $record.packet
    if ($null -eq $packet) { continue }
    if (-not $record.timely) {
      if (-not $Observation.ReceiveError) { $Observation.ReceiveError = 'M40_JOB_TRACE_LATE' }
      continue
    }
    if ($packet.kind -in @('phase','diagnostic')) {
      Add-M40TraceEvent -Phase $packet.phase -Stream $packet.stream -At $packet.at_ms -SqlAt $packet.sql_at_ms -Source 'competitor' `
        -Kind $packet.kind -Classification $packet.classification -SqlState $packet.sqlstate `
        -ByteCount $packet.byte_count -Digest $packet.digest
    }
  }
}

function Save-M40JobRejectionEvidence {
  if (-not $m40SidecarMode -or $null -eq $script:m40CompetitorObservation) { return }
  $observation = $script:m40CompetitorObservation
  $record = [ordered]@{
    schema='tecm.m40.job.rejection-evidence.v1'; correlation=$m40SidecarCorrelation
    representation='PowerShell deserialized observation; not original process bytes'
    first_error=$observation.FirstJobError; first_rejected_ingress=$observation.FirstRejectedRecord
    receive_error=$observation.ReceiveError; record_count=$observation.Records.Count
    state=$observation.State; removed=$observation.Removed
  }
  $bytes = [Text.UTF8Encoding]::new($false,$true).GetBytes(($record | ConvertTo-Json -Compress -Depth 8) + "`n")
  if ($bytes.Length -gt 131072) { throw 'M40_JOB_REJECTION_EVIDENCE_OVERSIZED' }
  $path = [IO.Path]::Combine([IO.Path]::GetDirectoryName($m40SidecarPath),'job-rejection-evidence.json')
  [IO.File]::WriteAllBytes($path,$bytes)
}

function Complete-M40JobCapture {
  if (-not $m40TraceEnabled -or $null -eq $script:m40CompetitorObservation) { return }
  $observation = $script:m40CompetitorObservation
  if ($observation.FirstRejectedRecord) {
    # This is the first deserialized ingress record, not original pipe bytes.
    $rejectedPath = [IO.Path]::Combine([IO.Path]::GetDirectoryName($m40TraceInput),'first-rejection.json')
    [IO.File]::WriteAllText($rejectedPath, ($observation.FirstRejectedRecord | ConvertTo-Json -Compress -Depth 8), [Text.UTF8Encoding]::new($false,$true))
  }
  $record = [ordered]@{
    schema='tecm.m40.job.capture.v1'; correlation=$m40TraceCorrelation; semantic_authority=$false
    started_at_ms=$observation.StartedAt; deadline_at_ms=$observation.DeadlineAt
    completed_at_ms=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    timed_out=$observation.TimedOut; state_at_deadline=$observation.StateAtDeadline; final_state=$observation.State
    receive_error=$observation.ReceiveError; polls=$observation.Polls
    records=@($observation.Records.ToArray()); lifecycle=@($observation.Lifecycle.ToArray())
    cleanup_codes=@($observation.CleanupCodes.ToArray() | Sort-Object -Unique); removed=$observation.Removed
  }
  $path = [IO.Path]::Combine([IO.Path]::GetDirectoryName($m40TraceInput),'job-capture.json')
  $temporary = $path + '.pending'
  $bytes = [Text.UTF8Encoding]::new($false,$true).GetBytes(($record | ConvertTo-Json -Compress -Depth 12) + "`n")
  if ($bytes.Length -gt 131072) { throw 'M40_JOB_CAPTURE_OVERSIZED' }
  try {
    $stream = [IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    [IO.File]::Move($temporary,$path)
    if ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($path))) -cne
        [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes))) { throw 'M40_JOB_CAPTURE_WRITE_INVALID' }
  } finally {
    if ([IO.File]::Exists($temporary)) { Remove-Item -LiteralPath $temporary -Force -ErrorAction Stop }
  }
}

function Complete-M40DiagnosticTrace {
  if (-not $m40TraceEnabled) { return }
  $temporary = $m40TraceInput + '.pending'
  try {
    $record = [ordered]@{
      schema = 'tecm.m40.diagnostic.v1'; correlation = $m40TraceCorrelation
      producer = 'database-verify.ps1/diagnostic'; started_at_ms = $m40TraceStart
      completed_at_ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      events = @($m40TraceEvents.ToArray())
    }
    $json = ($record | ConvertTo-Json -Compress -Depth 8) + "`n"
    $bytes = [Text.UTF8Encoding]::new($false, $true).GetBytes($json)
    if ($bytes.Length -gt 65536) { throw 'M40_TRACE_OVERSIZED' }
    $stream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    [IO.File]::Move($temporary, $m40TraceInput)
    if ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($m40TraceInput))) -cne
        [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes))) { throw 'M40_TRACE_WRITE_INVALID' }
  } catch {
    $script:m40TraceWriteError = $true
    if ([IO.File]::Exists($temporary)) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
    Write-Host '[M40 DIAGNOSTIC REJECT] M40_TRACE_WRITE_FAILED'
  }
}

try {
  Initialize-M40DiagnosticTrace
  Initialize-M40SemanticSidecar
  docker info --format '{{.ServerVersion}}' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not available.' }

  $dockerRunArguments = @(
    'run', '--pull', 'never', '--network', 'none', '--name', $containerName,
    '--tmpfs', '/var/lib/postgresql/data',
    '-e', 'POSTGRES_PASSWORD=postgres',
    '-e', "POSTGRES_DB=$database",
    '-v', "${repoRoot}:/workspace:ro"
  )
  if ($overrideDirectory) {
    $dockerRunArguments += @('-v', "${overrideDirectory}:/revision-override:ro")
  }
  $dockerRunArguments += @('-d', $PostgresImage)
  & docker @dockerRunArguments | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not start PostgreSQL verification container.' }
  $containerStarted = $true

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
    '/workspace/supabase/migrations/202608240015_attendance_function_execute_hardening.sql',
    '/workspace/supabase/migrations/202608240015_attendance_function_execute_hardening.sql',
    '/workspace/supabase/migrations/20260825150954_teacher_attendance_revision_guard.sql',
    '/workspace/supabase/migrations/20260825150954_teacher_attendance_revision_guard.sql',
    '/workspace/supabase/migrations/20260830100127_batch1_staff_attendance_operation_idempotency.sql',
    '/workspace/supabase/migrations/20260830100127_batch1_staff_attendance_operation_idempotency.sql',
    $revisionGuardMigration,
    $revisionGuardMigration,
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
    '/workspace/supabase/tests/017_teacher_attendance_history_access.sql',
    '/workspace/supabase/tests/018_attendance_function_execute_hardening.sql',
    '/workspace/supabase/tests/019_teacher_attendance_revision_guard.sql',
    '/workspace/supabase/tests/020_batch1_release_blockers.sql',
    '/workspace/supabase/tests/021_teacher_attendance_membership_and_roster.sql'
  )

  if ($M40Acceptance) {
    # Keep all schema/seed setup and attendance/security suites. Other business
    # suites remain in the default repository verifier, outside M40 acceptance.
    $files = @($files | Where-Object {
      $_ -notmatch '/tests/(?:00[1-9]|01[0-9]|020)_' -or
      $_ -match '/tests/(?:00[1-8]|017|018|019)_'
    })
  }
  Add-M40TraceEvent -Phase 'fixture_setup_started'
  foreach ($file in $files) {
    $script:m40TracePhase = 'fixture_setup'
    $script:m40TraceOrdinal++
    Write-Host "[RUN] $file"
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      if ($m40TraceEnabled) {
        $fileCapture = Invoke-NegativePreflightProcess -FilePath 'docker' -Phase 'fixture_setup' -MaximumStreamBytes 65536 -Arguments @(
          'exec', $containerName, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
          '-U', 'postgres', '-d', $database, '-f', $file)
        $fileOutput = @(([string]$fileCapture.Stdout + [string]$fileCapture.Stderr) -split '\r?\n')
        $fileExit = if ($fileCapture.ProcessError -or $fileCapture.TimedOut) { -1 } else { $fileCapture.ExitCode }
      } else {
        $fileOutput = @(docker exec $containerName sh -c "psql -q -v ON_ERROR_STOP=1 -U postgres -d $database -f '$file'" 2>&1)
        $fileExit = $LASTEXITCODE
      }
    } finally {
      $ErrorActionPreference = $previousErrorAction
    }
    if ($fileExit -ne 0) {
      if ($m40TraceEnabled) {
        foreach ($origin in @('stdout','stderr')) {
          $capturedText = if ($origin -eq 'stdout') { $fileCapture.Stdout } else { $fileCapture.Stderr }
          foreach ($line in @([string]$capturedText -split '\r?\n')) {
            if ($line.Length -gt 0) {
              Add-M40TraceDiagnostic -Text $line -Stream $origin -Phase 'fixture_setup' -Source 'fixture' `
                -Ordinal $m40TraceOrdinal -Classification 'sql_fixture_error'
            }
          }
        }
      } else { $fileOutput | Out-String | Write-Host }
      throw "Database verification failed: $file"
    }
    $passedOutput = @($fileOutput | Select-String -Pattern 'passed|PASS')
    if ($passedOutput.Count -gt 0) { $passedOutput | Out-String | Write-Host }
  }

  Add-M40TraceEvent -Phase 'fixture_setup_completed'

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
      [int[]]$ExpectedSecondExitCodes = @(),
      [string[]]$ExpectedExitPairs = @(),
      [string[]]$FirstPsqlVariables = @(),
      [string[]]$SecondPsqlVariables = @(),
      [switch]$ReleaseFirstBeforeSecond
    )

    Write-Host "[RACE] $FirstFile <> $SecondFile"
    $raceJobs = @()
    try {
      $first = Start-Job -Name 'race-first' -ScriptBlock {
        param($Name,$Db,$File,$PsqlVariables)
        $arguments = @('exec', $Name, 'psql', '-q', '-v', 'ON_ERROR_STOP=1')
        foreach ($variable in $PsqlVariables) { $arguments += @('-v', $variable) }
        $arguments += @('-U', 'postgres', '-d', $Db, '-f', $File)
        & docker @arguments 2>&1
        [pscustomobject]@{ ExitCode = $LASTEXITCODE }
      } -ArgumentList $containerName,$database,$FirstFile,$FirstPsqlVariables
      $raceJobs += $first
      if (-not $BarrierRaceName -and $StartSecondDelayMilliseconds -gt 0) {
        Start-Sleep -Milliseconds $StartSecondDelayMilliseconds
      }
      $second = Start-Job -Name 'race-second' -ScriptBlock {
        param($Name,$Db,$File,$Hang,$HangSeconds,$PsqlVariables)
        if ($Hang) { Start-Sleep -Seconds $HangSeconds }
        $arguments = @('exec', $Name, 'psql', '-q', '-v', 'ON_ERROR_STOP=1')
        foreach ($variable in $PsqlVariables) { $arguments += @('-v', $variable) }
        $arguments += @('-U', 'postgres', '-d', $Db, '-f', $File)
        & docker @arguments 2>&1
        [pscustomobject]@{ ExitCode = $LASTEXITCODE }
      } -ArgumentList $containerName,$database,$SecondFile,$InjectConcurrencyHang,($ConcurrencyTimeoutSeconds + 5),$SecondPsqlVariables
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
        if ($ReleaseFirstBeforeSecond) {
          $firstCompleted = $false
          for ($attempt = 0; $attempt -lt $barrierAttempts; $attempt++) {
            if ($first.State -in @('Completed','Failed','Stopped')) { $firstCompleted = $true; break }
            Start-Sleep -Milliseconds 100
          }
          if (-not $firstCompleted) { throw "First race worker did not finish before stale-client release: $BarrierRaceName" }
        }
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
      $actualExitPair = "$firstExit,$secondExit"
      $pairAccepted = $ExpectedExitPairs.Count -gt 0 -and $actualExitPair -in $ExpectedExitPairs
      $individualExitsAccepted = $ExpectedExitPairs.Count -eq 0 -and $firstExit -in $allowedFirstExits -and $secondExit -in $allowedSecondExits
      if (-not $pairAccepted -and -not $individualExitsAccepted) {
        Write-Host "[RACE OUTPUT] first:`n$($firstOutput | Out-String)"
        Write-Host "[RACE OUTPUT] second:`n$($secondOutput | Out-String)"
        throw "Unexpected race exit pair: $actualExitPair"
      }
      Write-Host "[RACE PASS] exit pair: $actualExitPair"
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

  function Set-Batch1OperationBaseline {
    param([Parameter(Mandatory)][string]$RaceName)
    if ($RaceName -notmatch '^batch1-(payment|intake)-(same|different)$') {
      throw "Invalid Batch 1 operation race name: $RaceName"
    }
    $baselineSql = "delete from public.__test_batch1_worker_results where race='$RaceName'; " +
      "insert into public.__test_batch1_operation_baseline(" +
      "race,audit_count,notification_count,outbox_count,receipt_count,payment_count,allocation_count," +
      "parent_count,child_count,student_count,parent_link_count,cohort_count,package_count,credit_count,charge_count) " +
      "select '$RaceName',(select count(*) from public.audit_logs),(select count(*) from public.notifications)," +
      "(select count(*) from public.notification_outbox),(select count(*) from public.receipts)," +
      "(select count(*) from public.payments),(select count(*) from public.payment_allocations)," +
      "(select count(*) from public.parent_profiles),(select count(*) from public.children)," +
      "(select count(*) from public.students),(select count(*) from public.parent_student_links)," +
      "(select count(*) from public.cohort_students),(select count(*) from public.student_packages)," +
      "(select count(*) from public.credit_ledger),(select count(*) from public.charges) " +
      "on conflict(race) do update set audit_count=excluded.audit_count,notification_count=excluded.notification_count," +
      "outbox_count=excluded.outbox_count,receipt_count=excluded.receipt_count,payment_count=excluded.payment_count," +
      "allocation_count=excluded.allocation_count,parent_count=excluded.parent_count,child_count=excluded.child_count," +
      "student_count=excluded.student_count,parent_link_count=excluded.parent_link_count,cohort_count=excluded.cohort_count," +
      "package_count=excluded.package_count,credit_count=excluded.credit_count,charge_count=excluded.charge_count"
    docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database -c $baselineSql | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not capture Batch 1 operation baseline: $RaceName" }
  }

  function Test-Batch1WorkerResultContract {
    param([object[]]$Rows,[string]$Operation,[string]$Mode,[string]$WinnerIdentity,[string]$LoserIdentity)
    if ($Rows.Count -ne 2) { return $false }
    $first = @($Rows | Where-Object worker -eq 'first')
    $second = @($Rows | Where-Object worker -eq 'second')
    if ($first.Count -ne 1 -or $second.Count -ne 1) { return $false }
    if (@($Rows | Where-Object operation -ne $Operation).Count -ne 0) { return $false }
    if ($first[0].outcome -ne 'committed' -or $first[0].classification -ne 'committed' -or
        $first[0].sqlstate -or $first[0].error_identifier -or -not $first[0].result_id -or
        $first[0].payload_identity -ne $WinnerIdentity -or
        $first[0].fingerprint_classification -ne 'winner-canonical-v1') { return $false }
    if ($Mode -eq 'same') {
      return $second[0].outcome -eq 'committed' -and $second[0].classification -eq 'committed' -and
        -not $second[0].sqlstate -and -not $second[0].error_identifier -and
        $second[0].payload_identity -eq $LoserIdentity -and
        $second[0].fingerprint_classification -eq 'same-canonical-v1' -and
        $second[0].result_id -eq $first[0].result_id
    }
    if ($Mode -eq 'different') {
      return $second[0].outcome -eq 'rejected' -and
        $second[0].classification -eq 'idempotency_payload_mismatch' -and
        $second[0].sqlstate -eq 'P0001' -and
        $second[0].error_identifier -eq 'idempotency_key_payload_mismatch' -and
        $second[0].payload_identity -eq $LoserIdentity -and
        $second[0].fingerprint_classification -eq 'loser-mismatch' -and -not $second[0].result_id
    }
    return $false
  }

  function Assert-Batch1WorkerResultContract {
    param(
      [Parameter(Mandatory)][string]$RaceName,[Parameter(Mandatory)][string]$Operation,
      [Parameter(Mandatory)][string]$Mode,[Parameter(Mandatory)][string]$WinnerIdentity,
      [Parameter(Mandatory)][string]$LoserIdentity
    )
    $json = docker exec $containerName psql -q -U postgres -d $database -Atc `
      "select coalesce(jsonb_agg(to_jsonb(r) order by worker),'[]'::jsonb) from public.__test_batch1_worker_results r where race='$RaceName'"
    if ($LASTEXITCODE -ne 0 -or -not $json) { throw "Batch 1 worker result query failed: $RaceName" }
    try {
      $parsedRows = $json | ConvertFrom-Json
      $rows = @()
      foreach ($parsedRow in $parsedRows) { $rows += $parsedRow }
    } catch { throw "Batch 1 worker result JSON was invalid: $RaceName" }
    if (-not (Test-Batch1WorkerResultContract -Rows $rows -Operation $Operation -Mode $Mode `
      -WinnerIdentity $WinnerIdentity -LoserIdentity $LoserIdentity)) {
      Write-Host "[RACE CONTRACT OUTPUT] $RaceName $json"
      throw "Batch 1 structured worker result contract failed: $RaceName"
    }
    Write-Host "[RACE CONTRACT PASS] $RaceName"
  }

  # Executable fail-closed controls for unrelated SQL failure, unique violation,
  # missing classification/incomplete output, and bounded timeout cleanup.
  $controlCommitted = [pscustomobject]@{
    worker='first';operation='payment';outcome='committed';classification='committed';sqlstate=$null;
    error_identifier=$null;payload_identity='winner';fingerprint_classification='winner-canonical-v1';
    result_id='00000000-0000-4000-8000-000000000001'
  }
  $controlUnexpected = [pscustomobject]@{
    worker='second';operation='payment';outcome='rejected';classification='unexpected_sql_failure';sqlstate='42501';
    error_identifier='unexpected_sql_failure';payload_identity='loser';fingerprint_classification='loser-mismatch';result_id=$null
  }
  $controlUnique = $controlUnexpected.PSObject.Copy()
  $controlUnique.classification='unique_violation';$controlUnique.sqlstate='23505';$controlUnique.error_identifier='unique_violation'
  $controlIncomplete = $controlUnexpected.PSObject.Copy()
  $controlIncomplete.classification=$null;$controlIncomplete.sqlstate=$null
  foreach ($control in @($controlUnexpected,$controlUnique,$controlIncomplete)) {
    if (Test-Batch1WorkerResultContract -Rows @($controlCommitted,$control) -Operation 'payment' `
      -Mode 'different' -WinnerIdentity 'winner' -LoserIdentity 'loser') {
      throw 'Batch 1 structured worker result parser accepted a negative control.'
    }
  }
  if (Test-Batch1WorkerResultContract -Rows @($controlCommitted) -Operation 'payment' `
    -Mode 'different' -WinnerIdentity 'winner' -LoserIdentity 'loser') {
    throw 'Batch 1 structured worker result parser accepted incomplete output.'
  }
  $timeoutControl = Start-Job -Name 'batch1-timeout-negative-control' -ScriptBlock { Start-Sleep -Seconds 5 }
  $timeoutRejected = $false
  try {
    Wait-DatabaseRaceJobs -Jobs @($timeoutControl) -TimeoutSeconds 1 | Out-Null
  } catch {
    if ($_.Exception.Message -like 'Database race timed out after 1s:*') { $timeoutRejected=$true } else { throw }
  }
  if (-not $timeoutRejected) { throw 'Database race timeout negative control did not fail closed.' }
  Write-Host '[PASS] Batch 1 structured-result unrelated/unique/incomplete and timeout negative controls'

  function Invoke-M40DockerCommand {
    param([Parameter(Mandatory)][string[]]$Arguments)

    $nativeOutput = @()
    $exitCode = $null
    $processError = $null
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      try {
        $nativeOutput = @(& docker @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
      } catch {
        $processError = 'docker_process_error'
      }
    } finally {
      $ErrorActionPreference = $previousErrorAction
    }
    [pscustomobject]@{
      ExitCode = $exitCode
      Signal = $null
      ProcessError = $processError
      Output = @($nativeOutput | ForEach-Object { [string]$_ })
    }
  }

  function Get-NegativePreflightAssessment {
    param([Parameter(Mandatory)][object]$Result)

    $rejectionCodes = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $expectedPhase = 'negative_preflight'
    $expectedSqlState = 'P0001'
    $expectedIdentifier = 'foundation_security_preflight_failed_before_mutation'
    $expectedMessagePrefix = 'foundation security preflight failed before mutation: '
    $stdoutText = [string]$Result.Stdout
    $stderrText = [string]$Result.Stderr

    if ($Result.Phase -cne $expectedPhase) {
      [void]$rejectionCodes.Add('NEGATIVE_PREFLIGHT_PHASE_INVALID')
    }
    if ($Result.ExitCode -ne 3) {
      [void]$rejectionCodes.Add('NEGATIVE_PREFLIGHT_PROCESS_EXIT_INVALID')
    }
    if ($Result.TimedOut -isnot [bool] -or $Result.TimedOut -eq $true -or
        -not [string]::IsNullOrEmpty([string]$Result.Signal) -or
        -not [string]::IsNullOrEmpty([string]$Result.ProcessError)) {
      [void]$rejectionCodes.Add('NEGATIVE_PREFLIGHT_PROCESS_LIFECYCLE_INVALID')
    }
    if ($stdoutText.Length -ne 0) {
      [void]$rejectionCodes.Add('NEGATIVE_PREFLIGHT_STDOUT_NOT_EMPTY')
    }
    if ($stderrText.Length -eq 0 -or [Text.Encoding]::UTF8.GetByteCount($stderrText) -gt 16384) {
      [void]$rejectionCodes.Add('NEGATIVE_PREFLIGHT_DIAGNOSTIC_BOUNDS_INVALID')
    }
    if ($stderrText -match '(?i)(?:password|passwd|credential|secret|token|authorization|bearer|jwt|api[_-]?key|private[_-]?key)\s*[=:]') {
      [void]$rejectionCodes.Add('NEGATIVE_PREFLIGHT_SENSITIVE_DIAGNOSTIC')
    }
    if ($stderrText -match '(?i)(?:[A-Z]:[\\/]Users[\\/][^\\/\r\n]+|/(?:Users|home)/[^/\r\n]+/)') {
      [void]$rejectionCodes.Add('NEGATIVE_PREFLIGHT_PRIVATE_PATH_DIAGNOSTIC')
    }

    if ($stderrText -match '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\uFEFF\uFFFD]') {
      [void]$rejectionCodes.Add('NEGATIVE_PREFLIGHT_DIAGNOSTIC_CHARACTERS_INVALID')
    }
    if ($stderrText -match '\r(?!\n)' -or
        ($stderrText.Contains("`r`n") -and $stderrText -match '(?<!\r)\n')) {
      [void]$rejectionCodes.Add('NEGATIVE_PREFLIGHT_DIAGNOSTIC_NEWLINES_INVALID')
    }
    # Permit one final line terminator, but never erase blank or extra records.
    $lines = @([regex]::Replace($stderrText, '\r?\n\z', '') -split '\r?\n')
    $errorIndexes = @()
    $contextIndexes = @()
    $locationIndexes = @()
    for ($index = 0; $index -lt $lines.Count; $index++) {
      if ($lines[$index] -match ': ERROR:\s+') { $errorIndexes += $index }
      if ($lines[$index] -match '^CONTEXT:\s+') { $contextIndexes += $index }
      if ($lines[$index] -match '^LOCATION:\s+') { $locationIndexes += $index }
    }
    if ($errorIndexes.Count -ne 1) {
      [void]$rejectionCodes.Add('NEGATIVE_PREFLIGHT_ERROR_COUNT_INVALID')
    }
    if ($contextIndexes.Count -ne 1) {
      [void]$rejectionCodes.Add('NEGATIVE_PREFLIGHT_CONTEXT_COUNT_INVALID')
    }
    if ($locationIndexes.Count -ne 1) {
      [void]$rejectionCodes.Add('NEGATIVE_PREFLIGHT_LOCATION_COUNT_INVALID')
    }
    if ($lines.Count -ne 3) {
      [void]$rejectionCodes.Add('NEGATIVE_PREFLIGHT_DIAGNOSTIC_RECORD_COUNT_INVALID')
    }
    if ($lines.Count -eq 3 -and $errorIndexes.Count -eq 1 -and $contextIndexes.Count -eq 1 -and
        $locationIndexes.Count -eq 1 -and
        ($errorIndexes[0] -ne 0 -or $contextIndexes[0] -ne 1 -or $locationIndexes[0] -ne 2)) {
      [void]$rejectionCodes.Add('NEGATIVE_PREFLIGHT_DIAGNOSTIC_ORDER_INVALID')
    }

    $sqlState = $null
    $semanticIdentifier = $null
    if ($errorIndexes.Count -eq 1) {
      $errorMatch = [regex]::Match(
        $lines[$errorIndexes[0]],
        '^psql:/workspace/supabase/migrations/202607180005_foundation_security\.sql:48: ERROR:\s+([0-9A-Z]{5}):\s+(.+)$'
      )
      if (-not $errorMatch.Success) {
        [void]$rejectionCodes.Add('NEGATIVE_PREFLIGHT_DIAGNOSTIC_STRUCTURE_INVALID')
      } else {
        $sqlState = $errorMatch.Groups[1].Value
        $message = $errorMatch.Groups[2].Value
        if ($sqlState -cne $expectedSqlState) {
          [void]$rejectionCodes.Add('NEGATIVE_PREFLIGHT_SQLSTATE_INVALID')
        }
        if (-not $message.StartsWith($expectedMessagePrefix, [StringComparison]::Ordinal)) {
          [void]$rejectionCodes.Add('NEGATIVE_PREFLIGHT_SEMANTIC_IDENTIFIER_INVALID')
        } else {
          $semanticIdentifier = $expectedIdentifier
          $payloadValid = $false
          $document = $null
          try {
            $document = [Text.Json.JsonDocument]::Parse($message.Substring($expectedMessagePrefix.Length))
            $properties = @($document.RootElement.EnumerateObject())
            $payloadNames = @($properties.Name | Sort-Object)
            # seed.sql supplies the first link plus generate_series(2,10).
            # The unsafe fixture changes all ten; this is an exact fixture contract.
            $expectedCounts = @{ leave_normalization_collisions = 0L; unsafe_notifications = 0L; unsafe_parent_links = 10L }
            $payloadValid = ($payloadNames -join ',') -ceq 'leave_normalization_collisions,unsafe_notifications,unsafe_parent_links'
            foreach ($property in $properties) {
              [long]$count = -1
              if ($property.Value.ValueKind -ne [Text.Json.JsonValueKind]::Number -or
                  -not $property.Value.TryGetInt64([ref]$count) -or
                  -not $expectedCounts.ContainsKey($property.Name) -or $count -ne $expectedCounts[$property.Name]) {
                $payloadValid = $false
              }
            }
          } catch {
            $payloadValid = $false
          } finally {
            if ($null -ne $document) { $document.Dispose() }
          }
          if (-not $payloadValid) {
            [void]$rejectionCodes.Add('NEGATIVE_PREFLIGHT_SEMANTIC_PAYLOAD_INVALID')
          }
        }
      }
    }

    if ($contextIndexes.Count -eq 1 -and
        $lines[$contextIndexes[0]] -cnotmatch '^CONTEXT:\s+PL/pgSQL function inline_code_block line 34 at RAISE$') {
      [void]$rejectionCodes.Add('NEGATIVE_PREFLIGHT_DIAGNOSTIC_STRUCTURE_INVALID')
    }
    if ($locationIndexes.Count -eq 1 -and
        $lines[$locationIndexes[0]] -cnotmatch '^LOCATION:\s+exec_stmt_raise,\s+pl_exec\.c:\d+$') {
      [void]$rejectionCodes.Add('NEGATIVE_PREFLIGHT_DIAGNOSTIC_STRUCTURE_INVALID')
    }

    $sortedRejectionCodes = @($rejectionCodes | Sort-Object)
    [pscustomobject]@{
      Accepted = $sortedRejectionCodes.Count -eq 0
      Classification = if ($sortedRejectionCodes.Count -eq 0) { $expectedIdentifier } else { 'rejected' }
      SqlState = $sqlState
      SemanticIdentifier = $semanticIdentifier
      ErrorCount = $errorIndexes.Count
      ContextCount = $contextIndexes.Count
      LocationCount = $locationIndexes.Count
      DiagnosticRecordCount = $lines.Count
      RejectionCodes = $sortedRejectionCodes
    }
  }

  function New-M40JobObservation {
    param([object]$Job, [Parameter(Mandatory)][ValidateRange(0.1,30)][double]$TimeoutSeconds, [string]$Correlation = '')
    $startedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $observation = [pscustomobject]@{
      State = [string]$Job.State; StateAtDeadline = $null; TimedOut = $false; ReceiveError = $null; FirstRejectedRecord = $null
      FirstJobError = $null
      StartedAt = $startedAt; DeadlineAt = $startedAt + $TimeoutSeconds * 1000
      Clock = [Diagnostics.Stopwatch]::StartNew(); Correlation = $Correlation
      Receiver = [TecmM40.JobReceiverV2]::new($Job)
      Output = [Collections.Generic.List[object]]::new()
      Records = [Collections.Generic.List[object]]::new()
      Lifecycle = [Collections.Generic.List[object]]::new()
      CleanupCodes = [Collections.Generic.List[string]]::new()
      Polls = 0; TotalBytes = 0; Imported = 0; PacketSequence = 0; Removed = $false
      PacketIdentities = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    }
    $Job | Add-Member -NotePropertyName M40Observation -NotePropertyValue $observation -Force
    return $observation
  }

  function Receive-M40JobIncrement {
    param([object]$Job, [object]$Observation)
    $Observation.Polls++
    # The native stream consumer is the only ingestion path. Never call
    # Receive-Job here: replaying a remoting host call leaks outside this collector.
    try {
      $batch = @($Observation.Receiver.Drain())
    } catch {
      if (-not $Observation.ReceiveError) {
        $Observation.ReceiveError = if ($_.Exception.Message -cmatch '^M40_JOB_[A-Z_]+$') { $_.Exception.Message } else { 'job_receive_failed' }
      }
      $Observation.State = [string]$Job.State
      return
    }
    foreach ($entry in $batch) {
      $packet = $null; $record = $null; $origin = $null
      try {
        $record = $entry.Value
        $origin = $entry.Stream
        if ($Observation.Records.Count -ge 512) { throw 'M40_JOB_RECORD_LIMIT' }
        if ($origin -cnotin @('output','error','warning','information')) { throw 'M40_JOB_STREAM_UNAUTHORIZED' }
        $packet = if ($origin -eq 'information') { $record.MessageData } else { $null }
        $safePacket = $null
        if ($null -ne $packet -and $null -ne $packet.PSObject.Properties['schema']) {
          $safePacket = Test-M40JobPacket -Packet $packet -Observation $Observation
        }
        $bytes = [Text.UTF8Encoding]::new($false,$true).GetBytes([string]$record)
        if ($bytes.Length -gt 65536 -or $Observation.TotalBytes + $bytes.Length -gt 1048576) { throw 'M40_JOB_RECORD_LIMIT' }
        $Observation.TotalBytes += $bytes.Length
        if ($origin -eq 'error' -and $null -eq $Observation.FirstJobError) {
          $errorText = [string]$record
          $Observation.FirstJobError = [ordered]@{
            representation = 'PowerShell deserialized ErrorRecord text; not original process bytes'
            text = $errorText.Substring(0,[Math]::Min($errorText.Length,16384))
            truncated = $errorText.Length -gt 16384
            fully_qualified_error_id = [string]$record.FullyQualifiedErrorId
          }
        }
        $at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $emittedAt = if ($null -ne $safePacket) { $safePacket.observed_at_ms } else { $null }
        $Observation.Records.Add([ordered]@{
          sequence = $Observation.Records.Count + 1; stream = $origin; correlation = $Observation.Correlation
          received_at_ms = $at; elapsed_ms = $Observation.Clock.Elapsed.TotalMilliseconds
          emitted_at_ms = $emittedAt
          timely = if ($null -ne $emittedAt) { $emittedAt -le $Observation.DeadlineAt } else { $at -le $Observation.DeadlineAt }
          byte_count = $bytes.Length
          digest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
          classification = if ($safePacket) { 'sanitized_worker_event' } else { 'job_stream_record' }
          packet = $safePacket
        })
        if ($origin -eq 'output') { $Observation.Output.Add($record) }
      } catch {
      if (-not $Observation.ReceiveError) {
        $Observation.ReceiveError = if ($_.Exception.Message -cmatch '^M40_JOB_[A-Z_]+$') { $_.Exception.Message } else { 'job_receive_failed' }
        $serialized = if ($null -ne $packet) { $packet | ConvertTo-Json -Compress -Depth 4 } else { [string]$record }
        $Observation.FirstRejectedRecord = [ordered]@{
          code=$Observation.ReceiveError; stream=$origin; expected_sequence=$Observation.PacketSequence+1; additional_rejections=0
          received_at_ms=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
          representation='deserialized ingress; not original pipe bytes'
          record=$serialized.Substring(0,[Math]::Min($serialized.Length,16384)); truncated=$serialized.Length -gt 16384
        }
      } elseif ($Observation.FirstRejectedRecord) {
        $Observation.FirstRejectedRecord.additional_rejections++
      }
      }
    }
    $Observation.State = [string]$Job.State
  }

  function Wait-M40JobTerminal {
    param([Parameter(Mandatory)][object]$Job,
      [Parameter(Mandatory)][ValidateRange(0.1,30)][double]$TimeoutSeconds, [string]$Correlation = '')
    $observation = New-M40JobObservation -Job $Job -TimeoutSeconds $TimeoutSeconds -Correlation $Correlation
    $terminalStates = @('Completed','Failed','Stopped')
    do {
      Receive-M40JobIncrement -Job $Job -Observation $observation
      if ($observation.ReceiveError) { break }
      if ($Job.State -in $terminalStates) { break }
      if ($observation.Clock.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
        $observation.TimedOut = $true
        $observation.StateAtDeadline = [string]$Job.State
        break
      }
      Start-Sleep -Milliseconds 25
    } while ($true)
    # Also drain a terminal transition. Timeout is sticky and retains all records.
    Receive-M40JobIncrement -Job $Job -Observation $observation
    return $observation
  }

  function Add-M40JobLifecycle {
    param([object]$Observation, [string]$Phase)
    $Observation.Lifecycle.Add([ordered]@{ sequence=$Observation.Lifecycle.Count+1; phase=$Phase
      at_ms=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); elapsed_ms=$Observation.Clock.Elapsed.TotalMilliseconds })
  }

  function Test-M40JobResultEnvelope {
    param([object]$Observation)
    return $Observation.Output.Count -eq 1 -and @($Observation.Records | Where-Object {
      $_.stream -ne 'output' -and -not ($_.stream -eq 'information' -and $null -ne $_.packet)
    }).Count -eq 0
  }

  function Finalize-M40OwnedJobs {
    param([AllowEmptyCollection()][object[]]$Jobs)
    $terminalStates = @('Completed','Failed','Stopped')
    $stopRequired = $false; $stopPassed = $true; $removePassed = $true
    foreach ($job in @($Jobs)) {
      if ($null -eq $job) { continue }
      $observation = if ($job.PSObject.Properties['M40Observation']) { $job.M40Observation }
        else { New-M40JobObservation -Job $job -TimeoutSeconds 10 }
      Add-M40JobLifecycle $observation 'pre_stop_drain'
      Receive-M40JobIncrement -Job $job -Observation $observation
      if ($job.State -notin $terminalStates) {
        $stopRequired = $true
        Add-M40JobLifecycle $observation 'stop_started'
        # PSRemotingJob exposes only synchronous StopJob. Invoke it on an owned
        # runspace and bound the caller's wait; never hide a failed stop/removal.
        $stopper = [Management.Automation.PowerShell]::Create()
        $null = $stopper.AddScript('param($ownedJob) $ownedJob.StopJob()').AddArgument($job)
        $stopAsync = $stopper.BeginInvoke()
        $stopClock = [Diagnostics.Stopwatch]::StartNew()
        while (-not $stopAsync.IsCompleted -and $stopClock.Elapsed.TotalSeconds -lt $ContentionHardTimeoutSeconds) {
          Receive-M40JobIncrement -Job $job -Observation $observation
          Start-Sleep -Milliseconds 25
        }
        if ($stopAsync.IsCompleted) {
          try { $null = $stopper.EndInvoke($stopAsync); if ($stopper.HadErrors) { throw 'M40_JOB_STOP_FAILED' } }
          catch { $observation.CleanupCodes.Add('M40_JOB_STOP_FAILED') }
          $stopper.Dispose()
        } else {
          $observation.CleanupCodes.Add('M40_JOB_STOP_FAILED')
          $null = $stopper.BeginStop($null,$null)
        }
      }
      if ($job.State -in $terminalStates) {
        Add-M40JobLifecycle $observation 'stop_terminal'
        Add-M40JobLifecycle $observation 'post_stop_drain'
        Receive-M40JobIncrement -Job $job -Observation $observation
        try {
          Remove-Job -Job $job -ErrorAction Stop
          if (@(Get-Job | Where-Object Id -eq $job.Id).Count -ne 0) { throw 'M40_JOB_REMOVE_FAILED' }
          $observation.Receiver.Dispose()
          $observation.Removed = $true
          Add-M40JobLifecycle $observation 'removed'
        } catch { $observation.CleanupCodes.Add('M40_JOB_REMOVE_FAILED') }
      } else { $observation.CleanupCodes.Add('M40_JOB_STOP_FAILED') }
      if ($observation.ReceiveError) { $observation.CleanupCodes.Add('M40_JOB_DRAIN_FAILED') }
      if ($observation.CleanupCodes.Contains('M40_JOB_STOP_FAILED')) { $stopPassed = $false }
      if (-not $observation.Removed -or $observation.CleanupCodes.Count -gt 0) { $removePassed = $false }
    }
    [pscustomobject]@{
      JobsStopped = if (-not $stopPassed) { 'FAIL' } elseif (-not $stopRequired) { 'NOT_REQUIRED' } else { 'PASS' }
      JobsRemoved = if ($removePassed) { 'PASS' } else { 'FAIL' }
    }
  }

  function Invoke-TeacherAttendanceContention {
    param(
      [Parameter(Mandatory)]
      [ValidatePattern('^teacher-attendance-contention-(existing|absent)$')]
      [string]$RaceName,
      [Parameter(Mandatory)]
      [string]$SessionId,
      [Parameter(Mandatory)]
      [AllowEmptyString()]
      [string]$ExpectedRevision,
      [Parameter(Mandatory)]
      [string]$TargetStatus,
      [Parameter(Mandatory)]
      [string]$RequestId
    )

    Initialize-M40JobReceiver
    Write-Host "[CONTENTION] $RaceName"
    $holder = $null
    $competitor = $null
    $holderReady = $false
    $semanticCandidate = $null
    $semanticCandidateReady = $false
    $semanticRejectionCodes = [Collections.Generic.List[string]]::new()
    $finalizationFailureCodes = [Collections.Generic.List[string]]::new()
    $failureSqlState = $null
    $postCandidateAssertion = 'NOT_REQUIRED'
    $holderRelease = 'NOT_REQUIRED'
    $holderTerminal = 'NOT_STARTED'
    $competitorTerminal = 'NOT_STARTED'
    $jobsStopped = 'NOT_REQUIRED'
    $jobsRemoved = 'NOT_RUN'
    $barrierCleanup = 'NOT_RUN'
    $workerState = 'NotStarted'
    $competitorExit = $null
    $workerSignal = $null
    $workerProcessError = $null
    $workerTimedOut = $false
    $unauthorizedMarkerObserved = $false

    try {
      $holder = Start-Job -Name "${RaceName}-holder" -ScriptBlock {
        param($Name,$Db,$Race,$Session)
        $nativeOutput = @()
        $exitCode = $null
        $processError = $null
        try {
          $nativeOutput = @(& docker exec $Name psql -q -v ON_ERROR_STOP=1 `
            -v "race_name=$Race" -v "session_id=$Session" `
            -U postgres -d $Db `
            -f '/workspace/supabase/tests/concurrency/teacher_attendance_contention_holder.sql' 2>&1)
          $exitCode = $LASTEXITCODE
        } catch {
          $processError = 'docker_exec_process_error'
        }
        [pscustomobject]@{
          ExitCode = $exitCode
          Signal = $null
          ProcessError = $processError
          Diagnostic = @($nativeOutput | ForEach-Object { [string]$_ })
        }
      } -ArgumentList $containerName,$database,$RaceName,$SessionId

      $readinessAttempts = [Math]::Max(1, $ContentionHardTimeoutSeconds * 10)
      for ($attempt = 0; $attempt -lt $readinessAttempts; $attempt++) {
        $readinessResult = Invoke-M40DockerCommand -Arguments @(
          'exec', $containerName, 'psql', '-qAt', '-v', 'ON_ERROR_STOP=1',
          '-U', 'postgres', '-d', $database,
          '-c', "select public.__test_race_ready_count('$RaceName')"
        )
        if ($readinessResult.ProcessError -or $readinessResult.Signal -or $readinessResult.ExitCode -ne 0) {
          throw 'M40_HOLDER_READINESS_INSPECTION_FAILED'
        }
        if ($readinessResult.Output.Count -eq 1 -and $readinessResult.Output[0].Trim() -eq '1') {
          $holderReady = $true
          break
        }
        Start-Sleep -Milliseconds 100
      }
      if (-not $holderReady) { throw 'M40_HOLDER_READINESS_FAILED' }

      $competitor = Start-Job -Name "${RaceName}-competitor" -ScriptBlock {
        param($Name,$Db,$Race,$Session,$Revision,$Status,$Request,$TraceEnabled,$CaptureSource,$PacketSource,$ObserverSource,$TraceCorrelation,$SnapshotContext)
        $nativeOutput = @()
        $workerExitCode = $null
        $workerProcessError = $null
        $captured = $null
        try {
          if ($TraceEnabled) {
            Set-Item -LiteralPath 'function:Invoke-NegativePreflightProcess' -Value ([scriptblock]::Create($CaptureSource))
            Set-Item -LiteralPath 'function:Write-M40WorkerPacket' -Value ([scriptblock]::Create($PacketSource))
            Set-Item -LiteralPath 'function:Send-M40ChildObservation' -Value ([scriptblock]::Create($ObserverSource))
            $script:m40WorkerContext = @{ Correlation=$TraceCorrelation; Sequence=0; Clock=[Diagnostics.Stopwatch]::StartNew()
              Phase='phase_unknown'; StdoutPhase='phase_unknown'; KnownFrame=$false; SqlState=$null
              Classification='unclassified_diagnostic'; ChildState='NotStarted'; ChildExitCode=$null }
            Write-M40WorkerPacket $script:m40WorkerContext 'process' 'phase_unknown' -Classification 'worker_started'
            $captured = Invoke-NegativePreflightProcess -FilePath 'docker' -Phase 'competitor' -TimeoutSeconds 10 -DiagnosticObserver {
              param($event) Send-M40ChildObservation -Context $script:m40WorkerContext -Event $event
            } -NativeTimeoutSnapshotContext $SnapshotContext -Arguments @(
              'exec', $Name, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
              '-v', "race_name=$Race", '-v', "session_id=$Session", '-v', "expected_revision=$Revision",
              '-v', "target_status=$Status", '-v', "request_id=$Request", '-U', 'postgres', '-d', $Db,
              '-f', '/workspace/supabase/tests/concurrency/teacher_attendance_contention_competitor.sql')
            $nativeOutput = @(([string]$captured.Stdout + [string]$captured.Stderr) -split '\r?\n')
            $workerExitCode = $captured.ExitCode
            $workerProcessError = $captured.ProcessError
          } else {
          $nativeOutput = @(& docker exec $Name psql -q -v ON_ERROR_STOP=1 `
            -v "race_name=$Race" -v "session_id=$Session" `
            -v "expected_revision=$Revision" -v "target_status=$Status" `
            -v "request_id=$Request" `
            -U postgres -d $Db `
            -f '/workspace/supabase/tests/concurrency/teacher_attendance_contention_competitor.sql' 2>&1)
          $workerExitCode = $LASTEXITCODE
          }
        } catch {
          $workerProcessError = 'docker_exec_process_error'
        }
        $workerOutput = [pscustomobject]@{
          ExitCode = $workerExitCode
          Signal = $null
          ProcessError = $workerProcessError
          Diagnostic = @($nativeOutput | ForEach-Object { [string]$_ })
          TraceCapture = $captured
        }
        if ($TraceEnabled -and $null -ne $captured) {
          $workerOutput | Add-Member -NotePropertyName NativeTimeoutSnapshotStatus -NotePropertyValue $captured.NativeTimeoutSnapshotStatus
        }
        $workerOutput
      } -ArgumentList $containerName,$database,$RaceName,$SessionId,$ExpectedRevision,$TargetStatus,$RequestId,$m40TraceEnabled,${function:Invoke-NegativePreflightProcess}.ToString(),${function:Write-M40WorkerPacket}.ToString(),${function:Send-M40ChildObservation}.ToString(),$m40TraceCorrelation,$(if ($m40TraceEnabled) { @{ Correlation=$m40TraceCorrelation; Path=[IO.Path]::Combine([IO.Path]::GetDirectoryName($m40TraceInput),'native-timeout-snapshot.json') } } else { $null })

      # Internal supervision includes startup, SQL execution and worker teardown.
      # PostgreSQL statement timeout and diagnostic child-process limits are separate.
      $competitorObservation = Wait-M40JobTerminal -Job $competitor -TimeoutSeconds 30 -Correlation $m40TraceCorrelation
      $script:m40CompetitorObservation = $competitorObservation
      if ($m40TraceEnabled) { Import-M40JobTrace $competitorObservation }
      $workerState = $competitorObservation.State
      if ($competitorObservation.TimedOut) {
        $workerTimedOut = $true
        $competitorTerminal = 'FAIL'
        throw 'M40_COMPETITOR_JOB_TIMEOUT'
      }
      if ($competitorObservation.ReceiveError) {
        $competitorTerminal = 'FAIL'
        throw 'M40_COMPETITOR_JOB_RECEIVE_FAILED'
      }
      $competitorTerminal = if ($competitorObservation.State -eq 'Completed') { 'PASS' } else { 'FAIL' }
      $workerResults = @($competitorObservation.Output | Where-Object {
        $null -ne $_.PSObject.Properties['ExitCode'] -and
        $null -ne $_.PSObject.Properties['Signal'] -and
        $null -ne $_.PSObject.Properties['ProcessError'] -and
        $null -ne $_.PSObject.Properties['Diagnostic']
      })
      $workerResult = if ($workerResults.Count -eq 1) { $workerResults[0] } else { $null }
      if ($m40SidecarMode) {
        [IO.File]::WriteAllText([IO.Path]::Combine([IO.Path]::GetDirectoryName($m40SidecarPath),'competitor-result.json'),
          ($workerResult | ConvertTo-Json -Compress -Depth 8), [Text.UTF8Encoding]::new($false,$true))
      }
      if ($m40TraceEnabled -and $null -ne $workerResult.NativeTimeoutSnapshotStatus) {
        try {
          [IO.File]::WriteAllText([IO.Path]::Combine([IO.Path]::GetDirectoryName($m40TraceInput),'native-timeout-snapshot-status.json'),
            ($workerResult.NativeTimeoutSnapshotStatus | ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false,$true))
        } catch { } # Teacher records unavailable evidence if status persistence fails.
      }
      $competitorExit = if ($workerResult) { $workerResult.ExitCode } else { $null }
      $workerSignal = if ($workerResult) { $workerResult.Signal } else { $null }
      $workerProcessError = if ($workerResult) { $workerResult.ProcessError } else { 'worker_result_contract_error' }
      $diagnosticOutput = if ($workerResult) { @($workerResult.Diagnostic) } else { @() }
      # Competitor evidence was drained incrementally, independently of TraceCapture.
      $rawCompetitorText = (@($diagnosticOutput | ForEach-Object { [string]$_ }) -join "`n")
      $unauthorizedMarkerObserved = $rawCompetitorText.Contains($m40SemanticPrefix)

      $databaseRecordResult = Invoke-M40DockerCommand -Arguments @(
        'exec', $containerName, 'psql', '-qAt', '-v', 'ON_ERROR_STOP=1',
        '-U', 'postgres', '-d', $database,
        '-c', "select json_build_object('race',race,'classification',classification,'elapsed_milliseconds',elapsed_milliseconds)::text from public.__test_teacher_attendance_contention_result where race='$RaceName'"
      )
      $databaseRecord = $null
      $databaseRecordValid = $false
      if (-not $databaseRecordResult.ProcessError -and -not $databaseRecordResult.Signal -and
          $databaseRecordResult.ExitCode -eq 0 -and $databaseRecordResult.Output.Count -eq 1) {
        try {
          $databaseRecord = $databaseRecordResult.Output[0] | ConvertFrom-Json
          $recordProperties = @($databaseRecord.PSObject.Properties.Name | Sort-Object)
          $databaseRecordValid = ($recordProperties -join ',') -eq 'classification,elapsed_milliseconds,race' -and
            $databaseRecord.race -eq $RaceName -and
            $databaseRecord.classification -is [string] -and
            $null -ne $databaseRecord.elapsed_milliseconds
        } catch {
          $databaseRecordValid = $false
        }
      }
      $elapsedMilliseconds = if ($databaseRecordValid) { [double]$databaseRecord.elapsed_milliseconds } else { $null }
      $workerLifecycleValid = $workerResults.Count -eq 1 -and
        $competitorTerminal -eq 'PASS' -and
        $null -eq $workerSignal -and
        $null -eq $workerProcessError

      if ($workerLifecycleValid -and $competitorExit -eq 0 -and $databaseRecordValid -and
          $databaseRecord.classification -eq 'attendance update is already in progress' -and
          $elapsedMilliseconds -ge 0 -and $elapsedMilliseconds -lt 2000) {
        $semanticCandidateReady = $true
        $semanticCandidate = [ordered]@{
          Classification = 'attendance_contention_rejected'
          SqlClassification = $databaseRecord.classification
          SqlState = 'P0001'
          ErrorIdentifier = 'attendance_contention_in_progress'
          ElapsedMilliseconds = $elapsedMilliseconds
          IsExpectedM40 = $false
        }
      } elseif ($workerLifecycleValid -and $competitorExit -eq 0 -and $databaseRecordValid -and
                $databaseRecord.classification -eq 'm40_blocking_statement_timeout_v1' -and
                $elapsedMilliseconds -ge 2500 -and $elapsedMilliseconds -lt 5000) {
        $semanticCandidateReady = $true
        $semanticCandidate = [ordered]@{
          Classification = 'm40_blocking_contention'
          SqlClassification = $databaseRecord.classification
          SqlState = '57014'
          ErrorIdentifier = 'statement_timeout'
          ElapsedMilliseconds = $elapsedMilliseconds
          IsExpectedM40 = $true
        }
        Write-Host "$m40LifecyclePrefix SEMANTIC_CANDIDATE_READY"
      } elseif ($workerLifecycleValid -and $competitorExit -ne 0 -and -not $databaseRecordValid) {
        $diagnostic = Get-SanitizedM40SqlDiagnostic -Output $diagnosticOutput
        $semanticCandidate = [ordered]@{
          Classification = 'unrelated_sql_error'
          SqlClassification = 'unexpected_sql_failure'
          SqlState = $diagnostic.SqlState
          ErrorIdentifier = $diagnostic.ErrorIdentifier
          ElapsedMilliseconds = $null
          IsExpectedM40 = $false
        }
        $semanticRejectionCodes.Add('M40_UNRELATED_SQL_FAILURE')
      } else {
        $failureClassification = if (-not $workerLifecycleValid) {
          'worker_lifecycle_failure'
        } elseif (-not $databaseRecordValid) {
          'missing_or_malformed_sql_semantic_record'
        } else {
          'contradictory_sql_semantic_record'
        }
        $semanticCandidate = [ordered]@{
          Classification = $failureClassification
          SqlClassification = $(if ($databaseRecordValid) { $databaseRecord.classification } else { $null })
          SqlState = $null
          ErrorIdentifier = $failureClassification
          ElapsedMilliseconds = $elapsedMilliseconds
          IsExpectedM40 = $false
        }
        $semanticRejectionCodes.Add('M40_SEMANTIC_RECORD_UNEXPECTED')
      }
      if ($unauthorizedMarkerObserved -and -not $semanticRejectionCodes.Contains('M40_UNAUTHORIZED_MARKER_OBSERVED')) {
        $semanticRejectionCodes.Add('M40_UNAUTHORIZED_MARKER_OBSERVED')
      }

      if ($semanticCandidate.IsExpectedM40) {
        $escapedRaceName = $RaceName.Replace("'", "''")
        $escapedRequestId = $RequestId.Replace("'", "''")
        $m40PostCandidateAssertionSql = "select case when exists (select 1 from public.__test_teacher_attendance_contention_context where race='$escapedRaceName') and exists (select 1 from public.__test_teacher_attendance_contention_result where race='$escapedRaceName' and classification='m40_blocking_statement_timeout_v1' and elapsed_milliseconds >= 2500 and elapsed_milliseconds < 5000) and public.__test_teacher_attendance_business_counts() = (select business_counts from public.__test_teacher_attendance_contention_snapshot where label='contention-baseline') and not exists (select 1 from public.__test_teacher_attendance_contention_context c where c.race='$escapedRaceName' and ((c.attendance_id is null and exists (select 1 from public.attendance_records ar where ar.session_id=c.session_id and ar.student_id=c.student_id)) or (c.attendance_id is not null and (not exists (select 1 from public.attendance_records ar where ar.id=c.attendance_id and ar.status=c.initial_status and ar.revision=c.initial_revision) or (select count(*) from public.attendance_records ar where ar.session_id=c.session_id and ar.student_id=c.student_id) <> 1)))) and not exists (select 1 from public.audit_logs where table_name='attendance_records' and new_data->'attendance_history'->>'request_id'='$escapedRequestId') then 'M40_ASSERT_PASS' else 'M40_ASSERT_FAIL' end"
        $assertResult = Invoke-M40DockerCommand -Arguments @(
          'exec', $containerName, 'psql', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
          '-U', 'postgres', '-d', $database,
          '-c', $m40PostCandidateAssertionSql
        )
        if (-not $assertResult.ProcessError -and -not $assertResult.Signal -and
            $assertResult.ExitCode -eq 0 -and $assertResult.Output.Count -eq 1 -and
            $assertResult.Output[0].Trim() -eq 'M40_ASSERT_PASS') {
          $postCandidateAssertion = 'PASS'
        } else {
          $postCandidateAssertion = 'FAIL'
          $assertDiagnostic = Get-SanitizedM40SqlDiagnostic -Output $assertResult.Output
          $failureSqlState = $assertDiagnostic.SqlState
          $assertionCode = if ($failureSqlState -eq '22023') {
            'M40_POST_CANDIDATE_SQL_22023'
          } else {
            'M40_POST_CANDIDATE_ASSERTION_FAILED'
          }
          if (-not $finalizationFailureCodes.Contains($assertionCode)) { $finalizationFailureCodes.Add($assertionCode) }
        }
      } elseif ($semanticCandidateReady -and $semanticRejectionCodes.Count -eq 0) {
        $assertResult = Invoke-M40DockerCommand -Arguments @(
          'exec', $containerName, 'psql', '-q', '-v', 'ON_ERROR_STOP=1',
          '-v', "race_name=$RaceName",
          '-U', 'postgres', '-d', $database,
          '-f', '/workspace/supabase/tests/concurrency/teacher_attendance_contention_assert.sql'
        )
        if (-not $assertResult.ProcessError -and -not $assertResult.Signal -and $assertResult.ExitCode -eq 0) {
          $postCandidateAssertion = 'PASS'
        } else {
          $postCandidateAssertion = 'FAIL'
          $finalizationFailureCodes.Add('M40_POST_CANDIDATE_ASSERTION_FAILED')
        }
      }
    } catch {
      $operationCode = if ($_.Exception.Message -match '^M40_[A-Z0-9_]+$') {
        $_.Exception.Message
      } else {
        'M40_CONTENTION_OPERATION_FAILED'
      }
      if (-not $finalizationFailureCodes.Contains($operationCode)) { $finalizationFailureCodes.Add($operationCode) }
    }

    if ($null -ne $competitorObservation -and -not (Test-M40JobResultEnvelope $competitorObservation)) {
      $competitorTerminal = 'FAIL'
      if (-not $finalizationFailureCodes.Contains('M40_COMPETITOR_JOB_RECEIVE_FAILED')) {
        $finalizationFailureCodes.Add('M40_COMPETITOR_JOB_RECEIVE_FAILED')
      }
    }
    $holderReleaseSql = "with released as (insert into public.__test_race_barrier(race,worker,released_at) values ('$RaceName','first',statement_timestamp()) on conflict (race,worker) do update set released_at=excluded.released_at returning 1) select count(*) from released"
    if ($holderReady) {
      $releaseResult = Invoke-M40DockerCommand -Arguments @(
        'exec', $containerName, 'psql', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
        '-U', 'postgres', '-d', $database,
        '-c', $holderReleaseSql
      )
      if (-not $releaseResult.ProcessError -and -not $releaseResult.Signal -and
          $releaseResult.ExitCode -eq 0 -and $releaseResult.Output.Count -eq 1 -and
          $releaseResult.Output[0].Trim() -eq '1') {
        $holderRelease = 'PASS'
      } else {
        $holderRelease = 'FAIL'
        if (-not $finalizationFailureCodes.Contains('M40_HOLDER_RELEASE_FAILED')) {
          $finalizationFailureCodes.Add('M40_HOLDER_RELEASE_FAILED')
        }
        if ($null -eq $failureSqlState) {
          $releaseDiagnostic = Get-SanitizedM40SqlDiagnostic -Output $releaseResult.Output
          $failureSqlState = $releaseDiagnostic.SqlState
        }
      }
    }

    if ($holderRelease -eq 'PASS') { Add-M40TraceEvent -Phase 'holder_release_completed' }
    if ($null -ne $holder -and $holderRelease -ne 'PASS') {
      $emergencyHolderReleaseSql = "insert into public.__test_race_barrier(race,worker,released_at) values ('$RaceName','first',statement_timestamp()) on conflict (race,worker) do update set released_at=excluded.released_at"
      $emergencyReleaseResult = Invoke-M40DockerCommand -Arguments @(
        'exec', $containerName, 'psql', '-q', '-v', 'ON_ERROR_STOP=1',
        '-U', 'postgres', '-d', $database,
        '-c', $emergencyHolderReleaseSql
      )
      if ($emergencyReleaseResult.ProcessError -or $emergencyReleaseResult.Signal -or $emergencyReleaseResult.ExitCode -ne 0) {
        if (-not $finalizationFailureCodes.Contains('M40_HOLDER_EMERGENCY_RELEASE_FAILED')) {
          $finalizationFailureCodes.Add('M40_HOLDER_EMERGENCY_RELEASE_FAILED')
        }
      }
    }

    if ($null -ne $holder) {
      $holderObservation = Wait-M40JobTerminal -Job $holder -TimeoutSeconds 10
      if ($holderObservation.TimedOut) {
        $holderTerminal = 'FAIL'
        if (-not $finalizationFailureCodes.Contains('M40_HOLDER_JOB_TIMEOUT')) { $finalizationFailureCodes.Add('M40_HOLDER_JOB_TIMEOUT') }
      } elseif ($holderObservation.ReceiveError) {
        $holderTerminal = 'FAIL'
        if (-not $finalizationFailureCodes.Contains('M40_HOLDER_JOB_RECEIVE_FAILED')) { $finalizationFailureCodes.Add('M40_HOLDER_JOB_RECEIVE_FAILED') }
      } else {
        $holderResults = @($holderObservation.Output | Where-Object {
          $null -ne $_.PSObject.Properties['ExitCode'] -and
          $null -ne $_.PSObject.Properties['Signal'] -and
          $null -ne $_.PSObject.Properties['ProcessError'] -and
          $null -ne $_.PSObject.Properties['Diagnostic']
        })
        $holderResult = if ($holderResults.Count -eq 1) { $holderResults[0] } else { $null }
        if ($m40SidecarMode) {
          $holderEvidencePath = [IO.Path]::Combine([IO.Path]::GetDirectoryName($m40SidecarPath),'holder-result.json')
          try {
            [IO.File]::WriteAllText($holderEvidencePath, ($holderResult | ConvertTo-Json -Compress -Depth 6), [Text.UTF8Encoding]::new($false,$true))
          } catch { $finalizationFailureCodes.Add('M40_HOLDER_JOB_RECEIVE_FAILED') }
        }
        $holderTerminal = if ($holderObservation.State -eq 'Completed' -and $holderResult -and
          (Test-M40JobResultEnvelope $holderObservation) -and
          $holderResult.ExitCode -eq 0 -and $null -eq $holderResult.Signal -and
          $null -eq $holderResult.ProcessError) { 'PASS' } else { 'FAIL' }
        if ($holderTerminal -ne 'PASS' -and -not $finalizationFailureCodes.Contains('M40_HOLDER_JOB_FAILED')) {
          $finalizationFailureCodes.Add('M40_HOLDER_JOB_FAILED')
        }
      }
    }

    $jobFinalization = Finalize-M40OwnedJobs -Jobs @($competitor,$holder)
    if ($m40TraceEnabled -and $null -ne $script:m40CompetitorObservation) {
      Import-M40JobTrace $script:m40CompetitorObservation
      if ($script:m40CompetitorObservation.ReceiveError -and -not $finalizationFailureCodes.Contains('M40_JOB_DRAIN_FAILED')) {
        $finalizationFailureCodes.Add('M40_JOB_DRAIN_FAILED')
      }
    }
    $jobsStopped = $jobFinalization.JobsStopped
    $jobsRemoved = $jobFinalization.JobsRemoved
    if ($jobsStopped -eq 'FAIL' -and -not $finalizationFailureCodes.Contains('M40_JOB_STOP_FAILED')) {
      $finalizationFailureCodes.Add('M40_JOB_STOP_FAILED')
    }
    if ($jobsRemoved -eq 'FAIL' -and -not $finalizationFailureCodes.Contains('M40_JOB_REMOVE_FAILED')) {
      $finalizationFailureCodes.Add('M40_JOB_REMOVE_FAILED')
    }

    if ($jobsRemoved -eq 'PASS' -and $jobsStopped -ne 'FAIL') { Add-M40TraceEvent -Phase 'job_cleanup_completed' }
    $barrierCleanupResult = Invoke-M40DockerCommand -Arguments @(
      'exec', $containerName, 'psql', '-qAt', '-v', 'ON_ERROR_STOP=1',
      '-U', 'postgres', '-d', $database,
      '-c', "delete from public.__test_race_barrier where race='$RaceName'; select count(*) from public.__test_race_barrier where race='$RaceName'"
    )
    if (-not $barrierCleanupResult.ProcessError -and -not $barrierCleanupResult.Signal -and
        $barrierCleanupResult.ExitCode -eq 0 -and $barrierCleanupResult.Output.Count -eq 1 -and
        $barrierCleanupResult.Output[0].Trim() -eq '0') {
      $barrierCleanup = 'PASS'
    } else {
      $barrierCleanup = 'FAIL'
      if (-not $finalizationFailureCodes.Contains('M40_BARRIER_CLEANUP_FAILED')) {
        $finalizationFailureCodes.Add('M40_BARRIER_CLEANUP_FAILED')
      }
    }

    if ($barrierCleanup -eq 'PASS') { Add-M40TraceEvent -Phase 'barrier_cleanup_completed' }
    if ($null -eq $semanticCandidate) {
      $semanticCandidate = [ordered]@{
        Classification = 'worker_lifecycle_failure'
        SqlClassification = $null
        SqlState = $null
        ErrorIdentifier = $(if ($finalizationFailureCodes.Count -gt 0) { $finalizationFailureCodes[0] } else { 'M40_CONTENTION_OPERATION_FAILED' })
        ElapsedMilliseconds = $null
        IsExpectedM40 = $false
      }
    }
    if ($competitorTerminal -eq 'NOT_STARTED' -and $null -ne $competitor) {
      $competitorTerminal = if ($competitor.State -in @('Completed','Failed','Stopped')) { 'PASS' } else { 'FAIL' }
    }
    $finalization = if ($finalizationFailureCodes.Count -eq 0 -and
      $postCandidateAssertion -ne 'FAIL' -and
      $holderRelease -eq 'PASS' -and
      $holderTerminal -eq 'PASS' -and
      $competitorTerminal -eq 'PASS' -and
      $jobsStopped -ne 'FAIL' -and
      $jobsRemoved -eq 'PASS' -and
      $barrierCleanup -eq 'PASS') { 'PASS' } else { 'FAIL' }
    $allRejectionCodes = @($semanticRejectionCodes + $finalizationFailureCodes | Sort-Object -Unique)
    $lifecycle = [ordered]@{
      semantic_candidate = if ($semanticCandidateReady) { 'PASS' } elseif ($semanticCandidate.Classification -eq 'unrelated_sql_error') { 'REJECTED' } else { 'FAIL' }
      post_candidate_assertion = $postCandidateAssertion
      holder_release = $holderRelease
      holder_terminal = $holderTerminal
      competitor_terminal = $competitorTerminal
      jobs_stopped = $jobsStopped
      jobs_removed = $jobsRemoved
      barrier_cleanup = $barrierCleanup
      finalization = $finalization
      rejection_codes = $allRejectionCodes
      failure_sqlstate = $failureSqlState
    }

    $positiveM40 = $semanticCandidate.IsExpectedM40 -and
      $allRejectionCodes.Count -eq 0 -and $finalization -eq 'PASS'
    if ($positiveM40) { Write-Host "$m40LifecyclePrefix FINALIZATION_PASS" }
    Write-M40SemanticRecord -RaceName $RaceName `
      -Classification $semanticCandidate.Classification `
      -SqlClassification $semanticCandidate.SqlClassification -SqlState $semanticCandidate.SqlState `
      -ErrorIdentifier $semanticCandidate.ErrorIdentifier -ElapsedMilliseconds $semanticCandidate.ElapsedMilliseconds `
      -WorkerState $workerState -WorkerExitCode $competitorExit -WorkerTimedOut $workerTimedOut `
      -WorkerSignal $workerSignal -WorkerProcessError $workerProcessError `
      -Readiness $(if ($holderReady) { 'PASS' } else { 'FAIL' }) `
      -UnauthorizedMarkerObserved $unauthorizedMarkerObserved -Lifecycle $lifecycle

    if ($positiveM40) {
      if ($m40SidecarMode) {
        Write-Host "$m40LifecyclePrefix SIDECAR_COMMITTED"
        $script:m40TerminalPending = $true
      }
      Write-Host "[M40 EXPECTED TERMINATION] $m40ExpectedTermination"
      throw $m40ExpectedTermination
    }
    if ($allRejectionCodes.Count -gt 0) {
      foreach ($rejectionCode in $allRejectionCodes) { Write-Host "$m40RejectionPrefix $rejectionCode" }
      throw $allRejectionCodes[0]
    }
    Write-Host "[CONTENTION PASS] $RaceName bounded classification, verified finalization, and no-side-effect proof"
  }

  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/000_setup.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare concurrency fixtures.' }

  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/teacher_attendance_contention_setup.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare bounded attendance contention fixtures.' }
  Invoke-TeacherAttendanceContention `
    -RaceName 'teacher-attendance-contention-existing' `
    -SessionId '1d000000-0000-4000-8000-000000000025' `
    -ExpectedRevision '1' `
    -TargetStatus 'absent' `
    -RequestId 'teacher-attendance-contention-existing-rejected'
  Invoke-TeacherAttendanceContention `
    -RaceName 'teacher-attendance-contention-absent' `
    -SessionId '1d000000-0000-4000-8000-000000000026' `
    -ExpectedRevision '' `
    -TargetStatus 'excused' `
    -RequestId 'teacher-attendance-contention-absent-rejected'
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/teacher_attendance_contention_retry_cleanup.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Attendance contention retry or cleanup assertion failed.' }
  if ($M40Acceptance) { Write-Host '[PASS] m40_contention_retry_cleanup=PASS' }

  if (-not $M40Acceptance) {
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/teacher_attendance_setup.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare teacher attendance concurrency fixture.' }
  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/teacher_attendance_first.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/teacher_attendance_second.sql' `
    -ExpectedExitPairs @('0,3', '3,0') `
    -StartSecondDelayMilliseconds 0 `
    -BarrierRaceName 'teacher-attendance'
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/teacher_attendance_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Teacher attendance concurrency assertion failed.' }

  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/teacher_attendance_existing_setup.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare existing teacher attendance concurrency fixture.' }
  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/teacher_attendance_existing_first.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/teacher_attendance_existing_second.sql' `
    -ExpectedExitPairs @('0,3', '3,0') `
    -StartSecondDelayMilliseconds 0 `
    -BarrierRaceName 'teacher-attendance-existing'
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/teacher_attendance_existing_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Existing teacher attendance concurrency assertion failed.' }

  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/batch1_race_setup.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare Batch 1 race fixtures.' }

  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql' `
    -ExpectedExitPairs @('0,3') -ReleaseFirstBeforeSecond `
    -StartSecondDelayMilliseconds 0 `
    -BarrierRaceName 'staff-existing' `
    -FirstPsqlVariables @('race_name=staff-existing','worker_name=first','user_id=10000000-0000-4000-8000-000000000001','session_id=1d000000-0000-4000-8000-000000000032','target_status=absent','expected_revision=1','reason=staff existing first','request_id=batch1-staff-existing-first') `
    -SecondPsqlVariables @('race_name=staff-existing','worker_name=second','user_id=10000000-0000-4000-8000-000000000002','session_id=1d000000-0000-4000-8000-000000000032','target_status=excused','expected_revision=1','reason=staff existing second','request_id=batch1-staff-existing-second')
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 `
    -v 'session_id=1d000000-0000-4000-8000-000000000032' -v 'winner_revision=2' `
    -v 'first_request=batch1-staff-existing-first' -v 'second_request=batch1-staff-existing-second' `
    -v 'race_name=staff-existing' -v 'refresh_request=batch1-staff-existing-refresh' -v 'credit_delta=2' `
    -U postgres -d $database -f '/workspace/supabase/tests/concurrency/batch1_attendance_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Existing-row staff attendance race assertion failed.' }

  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql' `
    -ExpectedExitPairs @('0,3') -ReleaseFirstBeforeSecond `
    -StartSecondDelayMilliseconds 0 `
    -BarrierRaceName 'staff-absent' `
    -FirstPsqlVariables @('race_name=staff-absent','worker_name=first','user_id=10000000-0000-4000-8000-000000000001','session_id=1d000000-0000-4000-8000-000000000031','target_status=absent','expected_revision=','reason=staff absent first','request_id=batch1-staff-absent-first') `
    -SecondPsqlVariables @('race_name=staff-absent','worker_name=second','user_id=10000000-0000-4000-8000-000000000002','session_id=1d000000-0000-4000-8000-000000000031','target_status=excused','expected_revision=','reason=staff absent second','request_id=batch1-staff-absent-second')
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 `
    -v 'session_id=1d000000-0000-4000-8000-000000000031' -v 'winner_revision=1' `
    -v 'first_request=batch1-staff-absent-first' -v 'second_request=batch1-staff-absent-second' `
    -v 'race_name=staff-absent' -v 'refresh_request=batch1-staff-absent-refresh' -v 'credit_delta=1' `
    -U postgres -d $database -f '/workspace/supabase/tests/concurrency/batch1_attendance_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Initially-absent staff attendance race assertion failed.' }

  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/batch1_staff_worker.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/batch1_teacher_worker.sql' `
    -ExpectedExitPairs @('0,3') -ReleaseFirstBeforeSecond `
    -StartSecondDelayMilliseconds 0 `
    -BarrierRaceName 'staff-cross-role' `
    -FirstPsqlVariables @('race_name=staff-cross-role','worker_name=first','user_id=10000000-0000-4000-8000-000000000002','session_id=1d000000-0000-4000-8000-000000000033','target_status=absent','expected_revision=1','reason=cross role staff','request_id=batch1-cross-role-staff') `
    -SecondPsqlVariables @('race_name=staff-cross-role','worker_name=second','session_id=1d000000-0000-4000-8000-000000000033','target_status=excused','expected_revision=1','reason=cross role teacher','request_id=batch1-cross-role-teacher')
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 `
    -v 'session_id=1d000000-0000-4000-8000-000000000033' -v 'winner_revision=2' `
    -v 'first_request=batch1-cross-role-staff' -v 'second_request=batch1-cross-role-teacher' `
    -v 'race_name=staff-cross-role' -v 'refresh_request=batch1-cross-role-refresh' -v 'credit_delta=2' `
    -U postgres -d $database -f '/workspace/supabase/tests/concurrency/batch1_attendance_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Cross-role teacher/staff attendance race assertion failed.' }

  Set-Batch1OperationBaseline -RaceName 'batch1-payment-same'
  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/batch1_payment_worker.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/batch1_payment_worker.sql' `
    -ExpectedExitPairs @('0,0') -ReleaseFirstBeforeSecond -StartSecondDelayMilliseconds 0 -BarrierRaceName 'batch1-payment-same' `
    -FirstPsqlVariables @('race_name=batch1-payment-same','worker_name=first','charge_id=41000000-0000-4000-8000-000000000021','amount_minor=100000','method=cash','idempotency_key=batch1-payment-race-same','payload_identity=payment-same-100000-cash','fingerprint_classification=winner-canonical-v1') `
    -SecondPsqlVariables @('race_name=batch1-payment-same','worker_name=second','charge_id=41000000-0000-4000-8000-000000000021','amount_minor=100000','method=cash','idempotency_key=batch1-payment-race-same','payload_identity=payment-same-100000-cash','fingerprint_classification=same-canonical-v1')
  Assert-Batch1WorkerResultContract -RaceName 'batch1-payment-same' -Operation 'payment' -Mode 'same' `
    -WinnerIdentity 'payment-same-100000-cash' -LoserIdentity 'payment-same-100000-cash'
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 `
    -v 'race_name=batch1-payment-same' -v 'idempotency_key=batch1-payment-race-same' -v 'expected_mode=same' `
    -v 'winner_charge_id=41000000-0000-4000-8000-000000000021' -v 'winner_amount_minor=100000' `
    -v 'winner_identity=payment-same-100000-cash' -v 'loser_identity=payment-same-100000-cash' `
    -U postgres -d $database -f '/workspace/supabase/tests/concurrency/batch1_payment_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Concurrent same-payload payment assertion failed.' }

  Set-Batch1OperationBaseline -RaceName 'batch1-payment-different'
  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/batch1_payment_worker.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/batch1_payment_worker.sql' `
    -ExpectedExitPairs @('0,0') -ReleaseFirstBeforeSecond -StartSecondDelayMilliseconds 0 -BarrierRaceName 'batch1-payment-different' `
    -FirstPsqlVariables @('race_name=batch1-payment-different','worker_name=first','charge_id=41000000-0000-4000-8000-000000000022','amount_minor=110000','method=cash','idempotency_key=batch1-payment-race-different','payload_identity=payment-winner-110000-cash','fingerprint_classification=winner-canonical-v1') `
    -SecondPsqlVariables @('race_name=batch1-payment-different','worker_name=second','charge_id=41000000-0000-4000-8000-000000000022','amount_minor=120000','method=cash','idempotency_key=batch1-payment-race-different','payload_identity=payment-loser-120000-cash','fingerprint_classification=loser-mismatch')
  Assert-Batch1WorkerResultContract -RaceName 'batch1-payment-different' -Operation 'payment' -Mode 'different' `
    -WinnerIdentity 'payment-winner-110000-cash' -LoserIdentity 'payment-loser-120000-cash'
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 `
    -v 'race_name=batch1-payment-different' -v 'idempotency_key=batch1-payment-race-different' -v 'expected_mode=different' `
    -v 'winner_charge_id=41000000-0000-4000-8000-000000000022' -v 'winner_amount_minor=110000' `
    -v 'winner_identity=payment-winner-110000-cash' -v 'loser_identity=payment-loser-120000-cash' `
    -U postgres -d $database -f '/workspace/supabase/tests/concurrency/batch1_payment_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Concurrent changed-payload payment assertion failed.' }

  Set-Batch1OperationBaseline -RaceName 'batch1-intake-same'
  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/batch1_intake_worker.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/batch1_intake_worker.sql' `
    -ExpectedExitPairs @('0,0') -ReleaseFirstBeforeSecond -StartSecondDelayMilliseconds 0 -BarrierRaceName 'batch1-intake-same' `
    -FirstPsqlVariables @('race_name=batch1-intake-same','worker_name=first','guardian_name=Batch1 Same Guardian','phone=+85363000001','student_name=Batch1 Same Student','idempotency_key=batch1-intake-race-same','payload_identity=intake-same-student','fingerprint_classification=winner-canonical-v1') `
    -SecondPsqlVariables @('race_name=batch1-intake-same','worker_name=second','guardian_name=Batch1 Same Guardian','phone=+85363000001','student_name=Batch1 Same Student','idempotency_key=batch1-intake-race-same','payload_identity=intake-same-student','fingerprint_classification=same-canonical-v1')
  Assert-Batch1WorkerResultContract -RaceName 'batch1-intake-same' -Operation 'intake' -Mode 'same' `
    -WinnerIdentity 'intake-same-student' -LoserIdentity 'intake-same-student'
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 `
    -v 'race_name=batch1-intake-same' -v 'idempotency_key=batch1-intake-race-same' -v 'expected_mode=same' `
    -v 'winner_guardian_name=Batch1 Same Guardian' -v 'winner_phone=+85363000001' `
    -v 'winner_student_name=Batch1 Same Student' -v 'loser_student_name=Batch1 Same Student' `
    -v 'winner_identity=intake-same-student' -v 'loser_identity=intake-same-student' `
    -U postgres -d $database -f '/workspace/supabase/tests/concurrency/batch1_intake_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Concurrent same-payload intake assertion failed.' }

  Set-Batch1OperationBaseline -RaceName 'batch1-intake-different'
  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/batch1_intake_worker.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/batch1_intake_worker.sql' `
    -ExpectedExitPairs @('0,0') -ReleaseFirstBeforeSecond -StartSecondDelayMilliseconds 0 -BarrierRaceName 'batch1-intake-different' `
    -FirstPsqlVariables @('race_name=batch1-intake-different','worker_name=first','guardian_name=Batch1 Diff Guardian','phone=+85363000002','student_name=Batch1 Diff Student A','idempotency_key=batch1-intake-race-different','payload_identity=intake-winner-student-a','fingerprint_classification=winner-canonical-v1') `
    -SecondPsqlVariables @('race_name=batch1-intake-different','worker_name=second','guardian_name=Batch1 Diff Guardian','phone=+85363000002','student_name=Batch1 Diff Student B','idempotency_key=batch1-intake-race-different','payload_identity=intake-loser-student-b','fingerprint_classification=loser-mismatch')
  Assert-Batch1WorkerResultContract -RaceName 'batch1-intake-different' -Operation 'intake' -Mode 'different' `
    -WinnerIdentity 'intake-winner-student-a' -LoserIdentity 'intake-loser-student-b'
  docker exec $containerName psql -q -v ON_ERROR_STOP=1 `
    -v 'race_name=batch1-intake-different' -v 'idempotency_key=batch1-intake-race-different' -v 'expected_mode=different' `
    -v 'winner_guardian_name=Batch1 Diff Guardian' -v 'winner_phone=+85363000002' `
    -v 'winner_student_name=Batch1 Diff Student A' -v 'loser_student_name=Batch1 Diff Student B' `
    -v 'winner_identity=intake-winner-student-a' -v 'loser_identity=intake-loser-student-b' `
    -U postgres -d $database -f '/workspace/supabase/tests/concurrency/batch1_intake_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Concurrent changed-payload intake assertion failed.' }

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
    -StartSecondDelayMilliseconds 0 `
    -BarrierRaceName 'disable-register' `
    -ExpectedExitPairs @('0,3')
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
    -BarrierRaceName 'register-disable' `
    -ExpectedExitPairs @('0,0')
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

  $teacherLinkTargetA = '44000000-0000-4000-8000-000000000001'
  $teacherLinkTargetB = '44000000-0000-4000-8000-000000000002'
  $organizationA = '10000000-0000-4000-8000-000000000000'
  $organizationB = '20000000-0000-4000-8000-000000000000'
  if ($teacherLinkTargetA -eq $teacherLinkTargetB) {
    throw 'Teacher-link scenario targets must differ.'
  }

  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/admin_ops_race_setup.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare Admin operations race fixtures.' }
  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/teacher_link_first.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/teacher_link_second.sql' `
    -StartSecondDelayMilliseconds 0 `
    -BarrierRaceName 'teacher-link-a-wins' `
    -ExpectedExitPairs @('0,3') `
    -FirstPsqlVariables @('race_name=teacher-link-a-wins', 'winner_lock=true', "target_user_id=$teacherLinkTargetA") `
    -SecondPsqlVariables @('race_name=teacher-link-a-wins', 'winner_lock=false', "target_user_id=$teacherLinkTargetA")
  $teacherLinkAAssertionArguments = @(
    'exec', $containerName, 'psql', '-q', '-v', 'ON_ERROR_STOP=1',
    '-v', "target_user_id=$teacherLinkTargetA",
    '-v', "expected_winner_organization_id=$organizationA",
    '-v', "expected_loser_organization_id=$organizationB",
    '-U', 'postgres', '-d', $database,
    '-f', '/workspace/supabase/tests/concurrency/teacher_link_assert.sql'
  )
  & docker @teacherLinkAAssertionArguments
  if ($LASTEXITCODE -ne 0) { throw 'Teacher link concurrency assertion failed.' }

  Invoke-DatabaseRace `
    -FirstFile '/workspace/supabase/tests/concurrency/teacher_link_first.sql' `
    -SecondFile '/workspace/supabase/tests/concurrency/teacher_link_second.sql' `
    -StartSecondDelayMilliseconds 0 `
    -BarrierRaceName 'teacher-link-b-wins' `
    -ExpectedExitPairs @('3,0') `
    -FirstPsqlVariables @('race_name=teacher-link-b-wins', 'winner_lock=false', "target_user_id=$teacherLinkTargetB") `
    -SecondPsqlVariables @('race_name=teacher-link-b-wins', 'winner_lock=true', "target_user_id=$teacherLinkTargetB")
  $teacherLinkBAssertionArguments = @(
    'exec', $containerName, 'psql', '-q', '-v', 'ON_ERROR_STOP=1',
    '-v', "target_user_id=$teacherLinkTargetB",
    '-v', "expected_winner_organization_id=$organizationB",
    '-v', "expected_loser_organization_id=$organizationA",
    '-U', 'postgres', '-d', $database,
    '-f', '/workspace/supabase/tests/concurrency/teacher_link_assert.sql'
  )
  & docker @teacherLinkBAssertionArguments
  if ($LASTEXITCODE -ne 0) { throw 'Teacher link reverse-order concurrency assertion failed.' }

  docker exec $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d $database `
    -f '/workspace/supabase/tests/concurrency/teacher_link_combined_assert.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Teacher link combined scenario isolation assertion failed.' }

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

  }
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
  $negativePreflightResult = Invoke-NegativePreflightProcess `
    -FilePath 'docker' `
    -Arguments @(
      'exec', '-e', 'LC_ALL=C', '-e', 'PGCLIENTENCODING=UTF8', $containerName,
      'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
      '-U', 'postgres', '-d', $unsafeDatabase,
      '-f', '/workspace/supabase/migrations/202607180005_foundation_security.sql'
    ) `
    -Phase 'negative_preflight'
  $negativePreflightAssessment = Get-NegativePreflightAssessment -Result $negativePreflightResult
  if (-not $negativePreflightAssessment.Accepted) {
    $negativePreflightRejections = @($negativePreflightAssessment.RejectionCodes) -join ','
    throw "Expected negative preflight diagnostic contract rejected: $negativePreflightRejections"
  }
  Write-Host '[PASS] negative_preflight=PASS'
  $expiresColumn = docker exec $containerName psql -q -U postgres -d $unsafeDatabase -Atc `
    "select count(*) from information_schema.columns where table_schema='public' and table_name='parent_account_invitations' and column_name='expires_at'"
  if ($LASTEXITCODE -ne 0 -or $expiresColumn -ne '0') {
    throw 'Blocked migration partially applied mutable DDL before preflight.'
  }

  if ($M40Acceptance) {
    Write-Host '[PASS] M40 acceptance database: repeatable migrations and seed, SQL suites 001-008/017-019/021, bounded existing/absent attendance contention, retry assertions, negative preflight'
  } else {
    Write-Host '[PASS] repeatable migrations, negative preflight, repeatable seed, RLS, SQL suites 001-021, bounded existing/absent attendance contention and races, deterministic teacher-link A/B winner races, parent races, Admin operations races, bounded Course link/enrollment races, outbox claim race, dispatch-boundary race, and makeup same-task booking/completion race'
  }
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
} catch {
  $verificationError = $_
  if ($_.Exception.Message -ne $m40ExpectedTermination) {
    Add-M40TraceDiagnostic -Text 'OperationStopped: (DATABASE_VERIFIER_FAILED:String) [], InvalidOperationException' `
      -Stream 'stderr' -Phase 'outer_failure' -Classification 'outer_verifier_failure'
  }
} finally {
  if ($containerStarted) {
    $cleanupErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $databaseCleanupPassed = $true
    foreach ($cleanupDatabase in @($unsafeDatabase,$database)) {
      docker exec $containerName psql -q -U postgres -d postgres -c `
        "select pg_terminate_backend(pid) from pg_stat_activity where datname='$cleanupDatabase' and pid <> pg_backend_pid()" 2>$null | Out-Null
      if ($LASTEXITCODE -ne 0) { $databaseCleanupPassed = $false }
      docker exec $containerName dropdb -U postgres --if-exists $cleanupDatabase 2>$null | Out-Null
      if ($LASTEXITCODE -ne 0) { $databaseCleanupPassed = $false }
    }
    $remainingDatabases = docker exec $containerName psql -q -U postgres -d postgres -Atc `
      "select count(*) from pg_database where datname in ('$database','$unsafeDatabase')" 2>$null
    if ($LASTEXITCODE -ne 0 -or $remainingDatabases -ne '0') { $databaseCleanupPassed = $false }

    docker rm -f -v $containerName 2>$null | Out-Null
    $containerCleanupPassed = $LASTEXITCODE -eq 0
    $remainingContainer = docker ps -a -q --filter "name=^/${containerName}$" 2>$null
    if ($LASTEXITCODE -ne 0 -or $remainingContainer) { $containerCleanupPassed = $false }

    $databaseCleanupLabel = if ($databaseCleanupPassed) { 'PASS' } else { 'FAIL' }
    $containerCleanupLabel = if ($containerCleanupPassed) { 'PASS' } else { 'FAIL' }
    Write-Host "[CLEANUP] database=$databaseCleanupLabel container=$containerCleanupLabel"
    if (-not $databaseCleanupPassed -or -not $containerCleanupPassed) {
      $cleanupError = 'Database verification cleanup failed.'
    }
    $ErrorActionPreference = $cleanupErrorAction
  }
  $traceCleanup = if ($databaseCleanupLabel -eq 'PASS' -and $containerCleanupLabel -eq 'PASS') { 'phase_completed' } else { 'cleanup_failed' }
  Add-M40TraceEvent -Phase 'outer_cleanup_completed' -Classification $traceCleanup
  try { Save-M40JobRejectionEvidence }
  catch { if (-not $cleanupError) { $cleanupError = 'M40 job rejection evidence preservation failed.' } }
  Complete-M40JobCapture
  Complete-M40DiagnosticTrace
}

if ($verificationError) {
  if ($cleanupError) { Write-Host "[CLEANUP ERROR] $cleanupError" }
  if ($m40TerminalPending) {
    $terminalExceptionMessage = [string]$verificationError.Exception.Message
    if ($terminalExceptionMessage -eq $m40ExpectedTermination -and -not $cleanupError -and
        $m40SidecarWriteCount -eq 1 -and $databaseCleanupLabel -eq 'PASS' -and
        $containerCleanupLabel -eq 'PASS') {
      Write-M40TerminalOutcome
      exit 1
    }
    $terminalFailureCode = if ($cleanupError) {
      'M40_TERMINAL_CLEANUP_FAILED'
    } elseif ($m40SidecarWriteCount -ne 1) {
      'M40_TERMINAL_SIDECAR_STATE_INVALID'
    } elseif ($terminalExceptionMessage -in @('M40_POST_SIDECAR_SQL_22023','M40_TERMINAL_FINALIZATION_FAILED')) {
      $terminalExceptionMessage
    } else {
      'M40_UNEXPECTED_POST_SIDECAR_FAILURE'
    }
    if ($m40TerminalRejectionEmitted -ne $terminalFailureCode) {
      Write-Host "$m40RejectionPrefix $terminalFailureCode"
    }
  }
  # Rethrow only a fixed failure record after cleanup. CategoryView avoids
  # PowerShell adding source excerpts, stack frames, or local paths.
  $ErrorView = 'CategoryView'
  $PSStyle.OutputRendering = 'PlainText'
  $verificationError = [Management.Automation.ErrorRecord]::new(
    [InvalidOperationException]::new('DATABASE_VERIFIER_FAILED'),
    'DATABASE_VERIFIER_FAILED', [Management.Automation.ErrorCategory]::OperationStopped,
    'DATABASE_VERIFIER_FAILED'
  )
  throw $verificationError
}
if ($cleanupError) { throw $cleanupError }
