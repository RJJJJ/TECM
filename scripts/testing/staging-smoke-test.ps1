param(
  [string]$BaseUrl,

  [string]$AutomationSecret,

  [string]$BookingId
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$results = New-Object System.Collections.Generic.List[object]

function Convert-UnicodeEscapes {
  param([string]$Value)
  return [System.Text.RegularExpressions.Regex]::Unescape($Value)
}

function Add-Result {
  param([string]$Name, [bool]$Passed, [string]$Message)
  $results.Add([pscustomobject]@{ Name = $Name; Passed = $Passed; Message = $Message }) | Out-Null
  if ($Passed) { Write-Host "[PASS] $Name" } else { Write-Host "[FAIL] $Name - $Message" }
}

function Invoke-JsonPost {
  param(
    [string]$Url,
    [hashtable]$Headers,
    [object]$Body
  )
  $json = $Body | ConvertTo-Json -Depth 10 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  Invoke-RestMethod -Method Post -Uri $Url -Headers $Headers -ContentType "application/json; charset=utf-8" -Body $bytes
}

if ([string]::IsNullOrWhiteSpace($BaseUrl) -or [string]::IsNullOrWhiteSpace($AutomationSecret) -or [string]::IsNullOrWhiteSpace($BookingId)) {
  Write-Host "[FAIL] Missing required parameter."
  Write-Host "Usage: .\scripts\testing\staging-smoke-test.ps1 -BaseUrl https://tecm-admin-staging.example.com -AutomationSecret <staging-secret> -BookingId <booking-uuid>"
  exit 2
}

$BaseUrl = $BaseUrl.TrimEnd('/')
$validHeaders = @{ "x-tecm-automation-secret" = $AutomationSecret }
$invalidHeaders = @{ "x-tecm-automation-secret" = "invalid-secret-for-staging-smoke-test" }

Write-Host "TECM staging smoke test"
Write-Host "BaseUrl: $BaseUrl"
Write-Host "AutomationSecret: <redacted length=$($AutomationSecret.Length)>"
Write-Host "BookingId: $BookingId"

try {
  $health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/health"
  $passed = ($health.ok -eq $true) -and ($health.service -eq "tecm-admin-web")
  Add-Result "Health endpoint ok" $passed "Expected ok=true and service=tecm-admin-web"
} catch {
  Add-Result "Health endpoint ok" $false $_.Exception.Message
}

try {
  Invoke-JsonPost -Url "$BaseUrl/api/automation/follow-up-digest" -Headers $invalidHeaders -Body @{ status = "open"; limit = 1 } | Out-Null
  Add-Result "Invalid secret rejected" $false "Request unexpectedly succeeded"
} catch {
  $statusCode = $null
  if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
  Add-Result "Invalid secret rejected" ($statusCode -eq 401) "Expected 401, got $statusCode"
}

try {
  $digest = Invoke-JsonPost -Url "$BaseUrl/api/automation/follow-up-digest" -Headers $validHeaders -Body @{ status = "open"; limit = 20 }
  Add-Result "Digest endpoint ok" ($digest.ok -eq $true) "Expected ok=true"
} catch {
  Add-Result "Digest endpoint ok" $false $_.Exception.Message
}

try {
  $preview = Invoke-JsonPost -Url "$BaseUrl/api/automation/follow-up-preview" -Headers $validHeaders -Body @{ booking_id = $BookingId }
  $passed = ($null -ne $preview.booking) -and ($null -ne $preview.recommended_prompt)
  Add-Result "Preview endpoint ok" $passed "Expected booking and recommended_prompt"
} catch {
  Add-Result "Preview endpoint ok" $false $_.Exception.Message
}

try {
  $taskBody = @{
    booking_id = $BookingId
    channel = "wechat_manual"
    priority = "medium"
    intent_summary = Convert-UnicodeEscapes "\u5206\u671f smoke test\uff1a\u8acb staff \u4eba\u5de5\u6aa2\u67e5\u9019\u7b46\u8ddf\u9032\u4efb\u52d9\u3002"
    suggested_message = Convert-UnicodeEscapes "\u60a8\u597d\uff0c\u6211\u5011\u6536\u5230\u60a8\u7684\u9810\u7d04\u8cc7\u6599\u3002\u9019\u662f staging \u9a57\u8b49\u8a0a\u606f\uff0c\u8acb staff \u4eba\u5de5\u78ba\u8a8d\u5f8c\u518d\u806f\u7d61\u5bb6\u9577\u3002"
    suggested_next_steps = @(
      (Convert-UnicodeEscapes "\u78ba\u8a8d staging \u8ddf\u9032\u4efb\u52d9"),
      (Convert-UnicodeEscapes "\u7531 staff \u4eba\u5de5\u6aa2\u67e5"),
      (Convert-UnicodeEscapes "\u9a57\u8b49\u5f8c\u53ef\u6a19\u8a18\u5b8c\u6210\u6216\u5ffd\u7565")
    )
    internal_note = "Staging smoke test created this task. Staff may dismiss after verification."
    source = "n8n"
  }
  $task = Invoke-JsonPost -Url "$BaseUrl/api/automation/follow-up-tasks" -Headers $validHeaders -Body $taskBody
  Add-Result "Create task endpoint ok" ($task.ok -eq $true) "Expected ok=true"
} catch {
  Add-Result "Create task endpoint ok" $false $_.Exception.Message
}

$failed = @($results | Where-Object { -not $_.Passed })
Write-Host "Summary: $($results.Count - $failed.Count)/$($results.Count) passed"
if ($failed.Count -gt 0) { exit 1 }
exit 0
