# ============================================================
#  사무실 PC (C) 지우기 — uninstall-c.bat 이 관리자 권한으로 부릅니다
# ============================================================
$ErrorActionPreference = 'Continue'
$app = Join-Path $env:ProgramFiles 'PosReport'
$data = Join-Path $env:ProgramData 'PosReport'
Write-Host '매출 보고 — 사무실 PC (C) 지우기' -ForegroundColor Cyan
Stop-ScheduledTask -TaskName 'PosReport-C' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'PosReport-C' -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'PosReport-Logon' -Confirm:$false -ErrorAction SilentlyContinue
Get-Process PosReport, PosReportC, PosReportW -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-NetFirewallRule -DisplayName 'PosReport C *' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
foreach ($d in @([Environment]::GetFolderPath('CommonDesktopDirectory'), [Environment]::GetFolderPath('Desktop'))) {
  foreach ($n in @('매출 보고 입력 (A).lnk', '매출 보고 보기 (B).lnk', '매출 보내기.lnk', '매출 엑셀 폴더.lnk')) {
    $lnk = Join-Path $d $n
    if (Test-Path $lnk) { Remove-Item $lnk -Force }
  }
}
if (Test-Path $app) { Remove-Item $app -Recurse -Force }
Write-Host '  프로그램 · 아이콘 · 자동 시작 · 방화벽 규칙을 지웠습니다.'
if (Test-Path $data) {
  $ans = Read-Host ('  설정 · 보관함(' + $data + ')도 지울까요? 받은 매출 보고 자료가 모두 들어 있습니다. (Y/N)')
  if ($ans -match '^[Yy]') { Remove-Item $data -Recurse -Force; Write-Host '  설정 · 보관함도 지웠습니다.' }
  else { Write-Host '  설정 · 보관함은 남겨 두었습니다 (다시 설치하면 그대로 씀).' }
}
