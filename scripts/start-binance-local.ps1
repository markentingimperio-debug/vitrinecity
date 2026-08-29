$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$logPath = Join-Path $projectPath 'app\binance-local-executor.log'
Set-Location $projectPath
& node 'app\scripts\binance-local-executor.mjs' *>> $logPath
