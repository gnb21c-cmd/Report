# POS 상주 전송기 실행 — 작업 스케줄러가 매일 09:50 · PC 켤 때 이 파일을 SYSTEM 으로 실행 (설치: install.ps1)
# 같은 폴더의 secrets.bin(이 PC 에서만 풀리는 Windows 암호화) → 환경 변수 → node live.ts (22:30 에 스스로 끝남)
# 기록: logs\live-날짜.log (줄 수 · 일치 여부 · 로그인 횟수만, 매출 숫자 없음)
$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Add-Type -AssemblyName System.Security
$enc = [IO.File]::ReadAllBytes((Join-Path $dir "secrets.bin"))
$json = [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($enc, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine))
$cfg = $json | ConvertFrom-Json
foreach ($p in $cfg.PSObject.Properties) { [Environment]::SetEnvironmentVariable($p.Name, [string]$p.Value, "Process") }
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $dir "ms-playwright"
$node = (Get-Content (Join-Path $dir "node-path.txt") -Raw).Trim()
$logs = Join-Path $dir "logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$log = Join-Path $logs ("live-" + (Get-Date -Format "yyyy-MM-dd") + ".log")
# 30일 넘은 기록은 지움
Get-ChildItem $logs -Filter "live-*.log" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force
Set-Location (Join-Path $dir "app\apps\collector")
# node 의 경고(stderr)가 멈춤으로 바뀌지 않게 (PowerShell 5.1)
$ErrorActionPreference = "Continue"
& $node "node_modules\tsx\dist\cli.mjs" "src\live.ts" *>> $log
exit $LASTEXITCODE
