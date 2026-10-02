# ============================================================
#  매출 보내기(A) 지우기 — uninstall.bat 이 관리자 권한으로 부릅니다
#  OK포스·POS DB 는 건드리지 않습니다 (이 프로그램과 그 설정만 지움)
# ============================================================
$ErrorActionPreference = 'Continue'
$app = Join-Path $env:ProgramFiles 'PosReport'
$data = Join-Path $env:ProgramData 'PosReport'
Write-Host '매출 보내기 프로그램 지우기' -ForegroundColor Cyan
cmd /c "schtasks /Delete /TN PosReport-Logon /F >nul 2>&1"
cmd /c "schtasks /Delete /TN PosReport-Close /F >nul 2>&1"
Get-Process PosReport, PosReportW -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$lnk = Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) '매출 보내기.lnk'
if (Test-Path $lnk) { Remove-Item $lnk -Force }
if (Test-Path $app) { Remove-Item $app -Recurse -Force }
Write-Host '  프로그램 · 아이콘 · 자동 보내기를 지웠습니다.'
if (Test-Path $data) {
  $ans = Read-Host ('  설정·보관함(' + $data + ')도 지울까요? 보내기 계정과 아직 못 보낸 자료가 들어 있습니다. (Y/N)')
  if ($ans -match '^[Yy]') { Remove-Item $data -Recurse -Force; Write-Host '  설정·보관함도 지웠습니다.' }
  else { Write-Host '  설정·보관함은 남겨 두었습니다 (다시 설치하면 그대로 씀).' }
}
