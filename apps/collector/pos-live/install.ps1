# POS 상주 전송기 — 작업 스케줄러에 등록 (POS 메인 PC 에서 관리자로 한 번)
# 먼저 GitHub '마감 전 전송기 설치' 작업이 이 폴더에 앱 · 크롬 · secrets.bin 을 깔아 둠 (apps/collector/pos-live, .github/workflows/pos-live-install.yml)
# 등록: 매일 09:50 과 PC 를 켤 때 SYSTEM 으로 run.ps1 · 끊기면 5분 뒤 다시(10번까지) · 한 번에 하나만 · 14시간 넘으면 끔
$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Write-Host "관리자로 실행해 주세요 (마우스 오른쪽 → 관리자 권한으로 실행)"; exit 1 }
foreach ($f in @("run.ps1", "secrets.bin", "node-path.txt")) { if (-not (Test-Path (Join-Path $dir $f))) { Write-Host "$f 가 없습니다 — GitHub '마감 전 전송기 설치' 작업을 먼저 돌려 주세요"; exit 1 } }
$name = "Astana POS Live"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"" + (Join-Path $dir "run.ps1") + "`"")
$triggers = @((New-ScheduledTaskTrigger -Daily -At "09:50"), (New-ScheduledTaskTrigger -AtStartup))
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 5) -ExecutionTimeLimit (New-TimeSpan -Hours 14) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$who = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $name -Action $action -Trigger $triggers -Settings $settings -Principal $who -Force | Out-Null
Write-Host "등록됨: 작업 스케줄러 '$name' (매일 09:50 · PC 켤 때). 지금 한 번 시작합니다."
Start-ScheduledTask -TaskName $name
