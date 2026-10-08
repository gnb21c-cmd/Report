# POS 상주 전송기 깔기 — GitHub '마감 전 전송기 설치' 작업이 POS 메인 PC 에서 실행 (환경 변수 DEST · 비밀값은 그 작업이 넣어 줌)
# 앱 · 크롬을 도구 폴더에 복사하고, 비밀값은 이 PC 에서만 풀리는 Windows 암호화(LocalMachine)로 secrets.bin 에만 씀 — 기록에 남기지 않음
# 그다음 사람이 POS 에서 pos-live-install.cmd 를 관리자로 한 번 실행하면 작업 스케줄러에 등록됨 (install.ps1)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path "$env:DEST\app" | Out-Null
robocopy . "$env:DEST\app" /MIR /XD .git /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "복사 실패" }
$global:LASTEXITCODE = 0  # robocopy 는 복사했으면 1 을 돌려줌 (실패 아님)
Copy-Item apps\collector\pos-live\*.ps1 $env:DEST -Force
(Get-Command node).Source | Set-Content "$env:DEST\node-path.txt"
Add-Type -AssemblyName System.Security
$cfg = @{ OKPOS_ID = $env:OKPOS_ID; OKPOS_PW = $env:OKPOS_PW; FIREBASE_API_KEY = $env:FIREBASE_API_KEY; FIREBASE_PROJECT_ID = $env:FIREBASE_PROJECT_ID; REPORT_BOARD_KEY = $env:REPORT_BOARD_KEY; WEATHER_EMAIL = $env:WEATHER_EMAIL; WEATHER_PASSWORD = $env:WEATHER_PASSWORD } | ConvertTo-Json -Compress
$enc = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($cfg), $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
[IO.File]::WriteAllBytes("$env:DEST\secrets.bin", $enc)
$cmd = "@echo off`r`nchcp 65001 >nul`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"$env:DEST\install.ps1`"`r`npause`r`n"
Set-Content -Path "$env:DEST\pos-live-install.cmd" -Value $cmd -Encoding ascii
$root = Resolve-Path "$env:RUNNER_TOOL_CACHE\..\.."
try { Set-Content -Path "$root\pos-live-install.cmd" -Value $cmd -Encoding ascii } catch { }
Write-Host "깔기 끝 — POS 에서 pos-live-install.cmd 를 관리자로 한 번 실행하면 작업 스케줄러에 등록됨"
exit 0
