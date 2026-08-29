$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$logPath = Join-Path $projectPath 'app\binance-demo-analyst.log'
Set-Location $projectPath
while ($true) {
  try { & node 'app\scripts\binance-demo-analyst.mjs' *>> $logPath }
  catch { $_ | Out-String | Add-Content $logPath }
  Start-Sleep -Seconds 900
}
