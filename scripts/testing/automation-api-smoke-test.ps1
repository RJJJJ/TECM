param(
  [string]$BaseUrl = "http://localhost:3000",
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

function Require-Param {
  param([string]$Value, [string]$Name)
  if ([string]::IsNullOrWhiteSpace($Value)) {
    Write-Host "[FAIL] Missing required parameter: $Name"
    Write-Host "Usage: .\scripts\testing\automation-api-smoke-test.ps1 -BaseUrl http://localhost:3000 -AutomationSecret <secret> -BookingId <booking_uuid>"
    exit 2
  }
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

Require-Param $AutomationSecret "AutomationSecret"
Require-Param $BookingId "BookingId"

$BaseUrl = $BaseUrl.TrimEnd('/')
$validHeaders = @{ "x-tecm-automation-secret" = $AutomationSecret }
$invalidHeaders = @{ "x-tecm-automation-secret" = "invalid-secret-for-smoke-test" }

Write-Host "TECM automation API smoke test"
Write-Host "BaseUrl: $BaseUrl"
Write-Host "AutomationSecret: <redacted length=$($AutomationSecret.Length)>"
Write-Host "BookingId: $BookingId"

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
  $previewNote = Convert-UnicodeEscapes "\u5bb6\u9577\u60f3\u4e86\u89e3 Python \u8ab2\u7a0b"
  $preview = Invoke-JsonPost -Url "$BaseUrl/api/automation/follow-up-preview" -Headers $validHeaders -Body @{ booking_id = $BookingId; note = $previewNote }
  $passed = ($null -ne $preview.booking) -or ($null -ne $preview.recommended_prompt)
  Add-Result "Preview endpoint ok" $passed "Expected booking or recommended_prompt in response"
} catch {
  Add-Result "Preview endpoint ok" $false $_.Exception.Message
}

try {
  $taskBody = @{
    booking_id = $BookingId
    channel = "wechat_manual"
    priority = "medium"
    intent_summary = Convert-UnicodeEscapes "\u81ea\u52d5\u5316 smoke test\uff1a\u5bb6\u9577\u60f3\u4e86\u89e3 Python \u8ab2\u7a0b\uff0c\u9700\u8981 staff \u4eba\u5de5\u78ba\u8a8d\u3002"
    suggested_message = Convert-UnicodeEscapes "\u60a8\u597d\uff0c\u6211\u5011\u6536\u5230\u60a8\u7684\u8ab2\u7a0b\u67e5\u8a62\u3002\u8acb\u554f\u60a8\u65b9\u4fbf\u78ba\u8a8d\u5b69\u5b50\u5e74\u7d1a\u548c\u5e0c\u671b\u9810\u7d04\u7684\u6642\u6bb5\u55ce\uff1f"
    suggested_next_steps = @(
      (Convert-UnicodeEscapes "\u78ba\u8a8d\u5b69\u5b50\u5e74\u7d1a"),
      (Convert-UnicodeEscapes "\u78ba\u8a8d\u53ef\u9810\u7d04\u6642\u6bb5"),
      (Convert-UnicodeEscapes "\u7531 staff \u4eba\u5de5\u8ddf\u9032")
    )
    internal_note = "Automation API smoke test created this task. Staff may dismiss after verification."
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
