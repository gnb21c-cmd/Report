# ============================================================
#  매출 보내기(A) 설치 — install.bat 이 관리자 권한으로 부릅니다
#  사무실 PC 한 대에 설치해 카페 · 키즈 매출을 함께 보냅니다 (매장 POS PC 에는 설치하지 않음)
#  1) 프로그램을 C:\Program Files\PosReport 에 복사
#  2) 보내기 계정을 물어 C:\ProgramData\PosReport\config.json 에 저장 (이 PC 에만). 없으면 Enter → 시험 모드
#  3) 매장별 엑셀 폴더 C:\PosReport\엑셀\카페 · 키즈 만들기
#  4) 바탕화면 '매출 보내기' 아이콘 · 엑셀 폴더 바로가기, PC 켤 때 못 보낸 엑셀 저절로 보내기
#  5) 점검
#  다시 실행해도 됩니다 (새 판으로 바꿀 때 — 설정은 그대로 둠)
# ============================================================
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$app = Join-Path $env:ProgramFiles 'PosReport'
$data = Join-Path $env:ProgramData 'PosReport'
$xls = 'C:\PosReport\엑셀'
function Say([string]$s, [string]$c = 'Gray') { Write-Host $s -ForegroundColor $c }

try {
  Say '매출 보내기 프로그램 설치 (사무실 PC — 카페 · 키즈 함께)' 'Cyan'
  foreach ($f in @('PosReport.exe', 'PosReportW.exe')) {
    if (-not (Test-Path (Join-Path $here $f))) { throw ($f + ' 이 없습니다. 내려받은 압축 파일을 모두 푼 폴더에서 실행해 주세요.') }
  }

  Say '[1/5] 프로그램 복사'
  try { Get-ChildItem $here | Unblock-File -ErrorAction SilentlyContinue } catch {}
  Get-Process PosReport, PosReportW -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $app | Out-Null
  New-Item -ItemType Directory -Force -Path $data | Out-Null
  Copy-Item (Join-Path $here 'PosReport.exe') $app -Force
  Copy-Item (Join-Path $here 'PosReportW.exe') $app -Force
  cmd /c "icacls `"$data`" /grant *S-1-5-32-545:(OI)(CI)M >nul"
  $exe = Join-Path $app 'PosReport.exe'
  $exeW = Join-Path $app 'PosReportW.exe'

  Say '[2/5] 설정'
  $conf = Join-Path $data 'config.json'
  $a = @('setup', '--root', $xls)
  if (Test-Path $conf) {
    Say '  이미 설정이 있습니다 (계정은 그대로 씀). 바꾸려면 C:\ProgramData\PosReport\config.json 을 지우고 다시 설치하세요.'
  } else {
    $fbFile = Join-Path $here 'firebase.json'
    $fb = $null
    if (Test-Path $fbFile) { $fb = Get-Content $fbFile -Raw -Encoding UTF8 | ConvertFrom-Json }
    if ($fb -and $fb.kmaKey) { $a += @('--kma-key', $fb.kmaKey) }
    Say '  (클라우드 보관함을 아직 만들지 않았으면 아래는 Enter 만 누르세요 — 보내지 않고 읽기만 하는 "시험 모드"로 설치됩니다)' 'Yellow'
    if ($fb -and $fb.apiKey) {
      $a += @('--apikey', $fb.apiKey, '--projectid', $fb.projectId)
      if ($fb.board) { $a += @('--board', $fb.board) } else { $a += @('--board', (Read-Host '  매장 열쇠 (보고 앱 설치 주소의 /b/ 뒤 글자)')) }
    } else {
      $k = Read-Host '  클라우드 보관함 API 키 (없으면 Enter)'
      if ($k) {
        $a += @('--apikey', $k, '--projectid', (Read-Host '  클라우드 보관함 프로젝트 ID'))
        $a += @('--board', (Read-Host '  매장 열쇠 (보고 앱 설치 주소의 /b/ 뒤 글자)'))
      }
    }
    $em = Read-Host '  보내기 계정 이메일 (없으면 Enter)'
    if ($em) {
      $a += @('--email', $em)
      $sec = Read-Host '  보내기 계정 비밀번호' -AsSecureString
      $a += @('--password', [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)))
    }
  }
  & $exe @a
  if ($LASTEXITCODE -ne 0) { throw '설정을 마치지 못했습니다. install.bat 을 다시 실행해 주세요.' }

  Say '[3/5] 매장별 엑셀 폴더'
  foreach ($n in @('카페', '키즈')) { New-Item -ItemType Directory -Force -Path (Join-Path $xls $n) | Out-Null }
  cmd /c "icacls `"C:\PosReport`" /grant *S-1-5-32-545:(OI)(CI)M >nul"
  Say ('  ' + $xls + '\카페 · ' + $xls + '\키즈')

  Say '[4/5] 바탕화면 아이콘 · 자동 보내기'
  $desk = [Environment]::GetFolderPath('CommonDesktopDirectory')
  $ws = New-Object -ComObject WScript.Shell
  $sh = $ws.CreateShortcut((Join-Path $desk '매출 보내기.lnk'))
  $sh.TargetPath = $exeW
  $sh.Arguments = 'window'
  $sh.WorkingDirectory = $app
  $sh.Save()
  $sh2 = $ws.CreateShortcut((Join-Path $desk '매출 엑셀 폴더.lnk'))
  $sh2.TargetPath = $xls
  $sh2.Save()
  $user = $null
  try { $user = (Get-WmiObject -Class Win32_ComputerSystem).UserName } catch {}
  if (-not $user) { $user = $env:USERDOMAIN + '\' + $env:USERNAME }
  $act = New-ScheduledTaskAction -Execute $exeW -Argument 'auto' -WorkingDirectory $app
  $prin = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  $set = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
  $logon = New-ScheduledTaskTrigger -AtLogOn -User $user
  $logon.Delay = 'PT2M'
  Register-ScheduledTask -TaskName 'PosReport-Logon' -Action $act -Principal $prin -Settings $set -Trigger $logon -Force | Out-Null
  Unregister-ScheduledTask -TaskName 'PosReport-Close' -Confirm:$false -ErrorAction SilentlyContinue
  Say '  PC 켤 때 아직 못 보낸 엑셀을 저절로 보냅니다.'

  Say '[5/5] 점검'
  & $exe check
  Say ''
  Say '설치를 마쳤습니다.' 'Green'
  Say '매일: 백오피스(nice.okpos.co.kr)에서 매장별 "상품별 (일자별)" 엑셀을 바탕화면 "매출 엑셀 폴더"의 카페 · 키즈에 저장 → "매출 보내기"'
  Say '(시험 모드면 보내지 않고, 결과 파일을 C:\PosReport\시험결과 에 남겨 바로 열어 줍니다)'
  Say ('기록 파일: ' + (Join-Path $data 'logs\send.log'))
} catch {
  Say ''
  Say ('설치 실패: ' + $_.Exception.Message) 'Red'
  exit 1
}
