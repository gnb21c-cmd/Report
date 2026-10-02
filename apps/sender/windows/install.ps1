# ============================================================
#  매출 보내기(A) 설치 — install.bat 이 관리자 권한으로 부릅니다
#  1) 프로그램을 C:\Program Files\PosReport 에 복사
#  2) 이 PC 가 카페/키즈 어느 POS 인지, 보내기 계정을 물어 C:\ProgramData\PosReport\config.json 에 저장 (이 PC 에만)
#  3) 바탕화면 '매출 보내기' 아이콘
#  4) 작업 스케줄러: PC 켤 때 못 보낸 날 보내기 (카페는 22시 10분에도)
#  5) 점검
#  다시 실행해도 됩니다 (새 판으로 바꿀 때 — 설정은 그대로 둠). OK포스·POS DB 는 읽기만 합니다.
# ============================================================
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$app = Join-Path $env:ProgramFiles 'PosReport'
$data = Join-Path $env:ProgramData 'PosReport'
function Say([string]$s, [string]$c = 'Gray') { Write-Host $s -ForegroundColor $c }

try {
  Say '매출 보내기 프로그램 설치' 'Cyan'
  foreach ($f in @('PosReport.exe', 'PosReportW.exe')) {
    if (-not (Test-Path (Join-Path $here $f))) { throw ($f + ' 이 없습니다. 내려받은 압축 파일을 모두 푼 폴더에서 실행해 주세요.') }
  }

  Say '[1/5] 프로그램 복사'
  try { Get-ChildItem $here | Unblock-File -ErrorAction SilentlyContinue } catch {}
  New-Item -ItemType Directory -Force -Path $app | Out-Null
  New-Item -ItemType Directory -Force -Path $data | Out-Null
  Copy-Item (Join-Path $here 'PosReport.exe') $app -Force
  Copy-Item (Join-Path $here 'PosReportW.exe') $app -Force
  cmd /c "icacls `"$data`" /grant *S-1-5-32-545:(OI)(CI)M >nul"
  $exe = Join-Path $app 'PosReport.exe'
  $exeW = Join-Path $app 'PosReportW.exe'

  Say '[2/5] 설정'
  $conf = Join-Path $data 'config.json'
  $a = @('setup')
  $pos = $null
  if (Test-Path $conf) {
    Say '  이미 설정이 있습니다 (그대로 씀). 바꾸려면 C:\ProgramData\PosReport\config.json 을 지우고 다시 설치하세요.'
    $pos = (Get-Content $conf -Raw -Encoding UTF8 | ConvertFrom-Json).pos
  } else {
    do { $n = Read-Host '  이 PC 는? 1 = 카페 메인 POS, 2 = 키즈 POS' } while ($n -ne '1' -and $n -ne '2')
    $pos = @('cafe', 'kids')[[int]$n - 1]
    $a += @('--pos', $pos)
    $fbFile = Join-Path $here 'firebase.json'
    if (Test-Path $fbFile) {
      $fb = Get-Content $fbFile -Raw -Encoding UTF8 | ConvertFrom-Json
      $a += @('--apikey', $fb.apiKey, '--projectid', $fb.projectId)
      if ($fb.kmaKey) { $a += @('--kma-key', $fb.kmaKey) }
      if ($fb.board) { $a += @('--board', $fb.board) } else { $a += @('--board', (Read-Host '  매장 열쇠 (보고 앱 설치 주소의 /b/ 뒤 글자)')) }
    } else {
      $a += @('--apikey', (Read-Host '  클라우드 보관함 API 키'), '--projectid', (Read-Host '  클라우드 보관함 프로젝트 ID'))
      $a += @('--board', (Read-Host '  매장 열쇠 (보고 앱 설치 주소의 /b/ 뒤 글자)'))
    }
    $a += @('--email', (Read-Host ('  보내기 계정 이메일 (예: ' + $pos + '-pos@…)')))
    $sec = Read-Host '  보내기 계정 비밀번호' -AsSecureString
    $a += @('--password', [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)))
    $src = Join-Path $here 'source.json'
    if (Test-Path $src) { $a += @('--source-file', $src) } else { $a += @('--folder', 'C:\PosReport\엑셀') }
  }
  if ($a.Count -gt 1) {
    & $exe @a
    if ($LASTEXITCODE -ne 0) { throw '설정을 마치지 못했습니다. install.bat 을 다시 실행해 주세요.' }
  }
  New-Item -ItemType Directory -Force -Path 'C:\PosReport\엑셀' | Out-Null
  cmd /c "icacls `"C:\PosReport`" /grant *S-1-5-32-545:(OI)(CI)M >nul"

  Say '[3/5] 바탕화면 아이콘 "매출 보내기"'
  $desk = [Environment]::GetFolderPath('CommonDesktopDirectory')
  $sh = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desk '매출 보내기.lnk'))
  $sh.TargetPath = $exeW
  $sh.Arguments = 'window'
  $sh.WorkingDirectory = $app
  $sh.Save()

  Say '[4/5] 자동 보내기 등록'
  $user = $null
  try { $user = (Get-WmiObject -Class Win32_ComputerSystem).UserName } catch {}
  if (-not $user) { $user = $env:USERDOMAIN + '\' + $env:USERNAME }
  $act = New-ScheduledTaskAction -Execute $exeW -Argument 'auto' -WorkingDirectory $app
  $prin = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  $set = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
  # PC 켤 때(로그인 2분 뒤 — 인터넷 연결을 기다림): 못 보낸 날 · 늦은 취소 반영
  $logon = New-ScheduledTaskTrigger -AtLogOn -User $user
  $logon.Delay = 'PT2M'
  Register-ScheduledTask -TaskName 'PosReport-Logon' -Action $act -Principal $prin -Settings $set -Trigger $logon -Force | Out-Null
  if ($pos -eq 'cafe') {
    Register-ScheduledTask -TaskName 'PosReport-Close' -Action $act -Principal $prin -Settings $set -Trigger (New-ScheduledTaskTrigger -Daily -At '22:10') -Force | Out-Null
    Say '  PC 켤 때 · 매일 22:10 에 저절로 보냅니다 (바뀐 날만).'
  } else {
    Say '  PC 켤 때 못 보낸 날을 저절로 보냅니다. 마감 때는 바탕화면 "매출 보내기"를 눌러 주세요.'
  }

  Say '[5/5] 점검'
  & $exe check
  Say ''
  Say '설치를 마쳤습니다. 바탕화면 "매출 보내기" 아이콘으로 보낼 수 있습니다.' 'Green'
  Say ('기록 파일: ' + (Join-Path $data 'logs\send.log'))
} catch {
  Say ''
  Say ('설치 실패: ' + $_.Exception.Message) 'Red'
  exit 1
}
