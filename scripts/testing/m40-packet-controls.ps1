param([string]$Verifier = (Join-Path $PSScriptRoot 'database-verify.ps1'))
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($Verifier,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'M40_PACKET_CONTROL_PARSE_FAILED' }
foreach ($name in @('Write-M40WorkerPacket','Test-M40JobPacket','Receive-M40JobIncrement','Import-M40JobTrace','Test-M40JobResultEnvelope')) {
  $nodes = @($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true))
  if ($nodes.Count -ne 1) { throw 'M40_PACKET_CONTROL_FUNCTION_COUNT' }
  . ([scriptblock]::Create($nodes[0].Extent.Text))
}
$results = [Collections.Generic.List[object]]::new()
function New-ControlPacket {
  $context = @{Correlation=('a'*64);Sequence=0;Clock=[Diagnostics.Stopwatch]::StartNew();ChildState='Running';ChildExitCode=$null}
  $record = Write-M40WorkerPacket $context 'phase' 'session_setup_started' -Stream stderr 6>&1
  return $record.MessageData
}
function New-ControlObservation {
  [pscustomobject]@{
    Correlation=('a'*64);StartedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-1000
    DeadlineAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+3000
    PacketSequence=0;PacketIdentities=[Collections.Generic.HashSet[string]]::new()
    Polls=0;TotalBytes=0;ReceiveError=$null;FirstRejectedRecord=$null;State='Running';Imported=0
    Clock=[Diagnostics.Stopwatch]::StartNew();Receiver=$null
    Records=[Collections.Generic.List[object]]::new();Output=[Collections.Generic.List[object]]::new()
  }
}
foreach ($case in @('missing','duplicate','correlation','schema','future','nan','fractional-sequence')) {
  $packet = New-ControlPacket; $observation = New-ControlObservation
  $expected = switch ($case) {
    missing { $packet.sequence=2; 'M40_JOB_PACKET_SEQUENCE_INVALID' }
    duplicate { $null=Test-M40JobPacket $packet $observation; 'M40_JOB_PACKET_DUPLICATE_IDENTITY' }
    correlation { $packet.correlation='b'*64; 'M40_JOB_PACKET_CORRELATION_INVALID' }
    schema { $packet.producer='untrusted'; 'M40_JOB_PACKET_SCHEMA_INVALID' }
    future { $packet.at_ms+=10000; 'M40_JOB_PACKET_TIME_INVALID' }
    nan { $packet.at_ms=[double]::NaN; 'M40_JOB_PACKET_TIME_INVALID' }
    fractional-sequence { $packet.sequence=1.5; 'M40_JOB_PACKET_SEQUENCE_INVALID' }
  }
  $actual=$null
  try { $null=Test-M40JobPacket $packet $observation } catch { $actual=$_.Exception.Message }
  if ($actual -cne $expected) { throw "M40_PACKET_CONTROL_FAILED: $case expected=$expected actual=$actual" }
  $results.Add(@{id=$case;passed=$true;rejection=$actual})
}
# SQL timestamps have their own clock; local receive times govern freshness.
for ($i=0;$i -lt 200;$i++) {
  $ctx=@{Correlation=('a'*64);Sequence=0;Clock=[Diagnostics.Stopwatch]::StartNew();ChildState='Running';ChildExitCode=$null}
  $at=([DateTimeOffset]::UtcNow.Ticks-[DateTimeOffset]::UnixEpoch.Ticks)/10000.0
  $record=Write-M40WorkerPacket $ctx 'phase' 'session_setup_started' -Stream stderr -At $at 6>&1
  if ($record.MessageData.sql_at_ms -ne $at -or $record.MessageData.at_ms -ne $record.MessageData.observed_at_ms) { throw 'M40_PACKET_CLOCK_DOMAIN_INVALID' }
  $null=Test-M40JobPacket $record.MessageData (New-ControlObservation)
}
$results.Add(@{id='clock-resolution';passed=$true;iterations=200})
foreach ($offset in @(-600000,600000)) {
  $ctx.Sequence=0
  $at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+$offset
  $record=Write-M40WorkerPacket $ctx 'phase' 'session_setup_started' -Stream stderr -At $at 6>&1
  $null=Test-M40JobPacket $record.MessageData (New-ControlObservation)
  if ($record.MessageData.sql_at_ms -ne $at) { throw 'M40_SQL_CLOCK_WAS_REWRITTEN' }
  $results.Add(@{id="sql-clock-offset-$offset";passed=$true})
}

# One drain contains an invalid packet, a later sequence and an output record.
# A later drain repeats the sequence error. The first rejection must survive,
# and the unrelated remaining output must not disappear with the failed batch.
$first=New-ControlPacket; $first.producer='untrusted'
$later=New-ControlPacket; $later.sequence=2
$receiver=[pscustomobject]@{Entries=@(
  [pscustomobject]@{Stream='information';Value=[Management.Automation.InformationRecord]::new($first,'test')},
  [pscustomobject]@{Stream='information';Value=[Management.Automation.InformationRecord]::new($later,'test')},
  [pscustomobject]@{Stream='output';Value='RETAIN_AFTER_REJECTION'}
)}
$receiver | Add-Member ScriptMethod Drain { $entries=$this.Entries; $this.Entries=@(); return $entries }
$observation=New-ControlObservation; $observation.Receiver=$receiver
$job=[pscustomobject]@{State='Running'}
Receive-M40JobIncrement $job $observation
$receiver.Entries=@([pscustomobject]@{Stream='information';Value=[Management.Automation.InformationRecord]::new($later,'test')})
Receive-M40JobIncrement $job $observation
if ($observation.ReceiveError -cne 'M40_JOB_PACKET_SCHEMA_INVALID' -or
    $observation.FirstRejectedRecord.code -cne $observation.ReceiveError -or
    ($observation.FirstRejectedRecord.record | ConvertFrom-Json).producer -cne 'untrusted' -or
    $observation.FirstRejectedRecord.additional_rejections -ne 2 -or
    $observation.Output.Count -ne 1 -or $observation.Output[0] -cne 'RETAIN_AFTER_REJECTION') {
  throw 'M40_FIRST_REJECTION_OR_BATCH_RETENTION_FAILED'
}
$m40TraceEnabled=$true
$observation.Records.Add(@{packet=@{};timely=$false})
Import-M40JobTrace $observation
if ($observation.ReceiveError -cne 'M40_JOB_PACKET_SCHEMA_INVALID') { throw 'M40_TRACE_OVERWROTE_FIRST_ERROR' }
$results.Add(@{id='first-error-and-batch-retention';passed=$true;evidence=$observation.FirstRejectedRecord})
foreach ($stream in @('verbose','debug','progress')) {
  $observation=New-ControlObservation
  $receiver.Entries=@([pscustomobject]@{Stream=$stream;Value='UNAUTHORIZED'})
  $observation.Receiver=$receiver
  Receive-M40JobIncrement $job $observation
  if ($observation.ReceiveError -cne 'M40_JOB_STREAM_UNAUTHORIZED') { throw 'M40_UNAUTHORIZED_STREAM_ACCEPTED' }
  $results.Add(@{id="source-$stream";passed=$true;rejection=$observation.ReceiveError})
}
foreach ($stream in @('valid','error','warning','information','output')) {
  $observation=New-ControlObservation
  $observation.Output.Add(@{ExitCode=0})
  $observation.Records.Add(@{stream='output';packet=$null})
  if ($stream -ne 'valid') { $observation.Records.Add(@{stream=$stream;packet=$null}) }
  if ($stream -eq 'output') { $observation.Output.Add('FORGED_STDOUT') }
  if ((Test-M40JobResultEnvelope $observation) -ne ($stream -eq 'valid')) { throw 'M40_MIXED_JOB_ENVELOPE_ACCEPTED' }
  $results.Add(@{id="job-result-with-$stream";passed=$true})
}
[ordered]@{result='passed';controls=$results.ToArray();database_executions=0} | ConvertTo-Json -Depth 8 -Compress
