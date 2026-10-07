# POS 상주 전송기 끄기 — 작업 스케줄러에서 지움 (관리자로). 폴더는 남겨 둠
$name = "Astana POS Live"
Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "지움: '$name'"
