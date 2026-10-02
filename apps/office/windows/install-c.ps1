# ============================================================
#  사무실 PC (C) 설치 — install-c.bat 이 관리자 권한으로 부릅니다
#  24시간 켜 둘 사무실 PC 한 대에만 설치합니다 (직원 PC 에는 install-a.bat)
#  1) 프로그램을 C:\Program Files\PosReport 에 복사 (예전 '매출 보내기'는 지움)
#  2) 설정: 클라우드 올리기 계정 · 사무실 비밀번호 → C:\ProgramData\PosReport\config.json (이 PC 에만)
#  3) 방화벽: 사무실 공유기 안에서만 A·B 화면(TCP 8770) · PC 찾기(UDP 8771) 열기
#  4) 늘 켜 두기: 전원 연결 상태에서 절전 · 최대 절전 끔
#  5) PC 를 켜면 로그인 없이 저절로 C 서버 시작 (꺼지면 1분 뒤 다시)
#  6) 바탕화면 아이콘 · 점검
#  다시 실행해도 됩니다 (새 판으로 바꿀 때 — 설정 · 자료는 그대로 둠)
# ============================================================
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$app = Join-Path $env:ProgramFiles 'PosReport'
$data = Join-Path $env:ProgramData 'PosReport'
$port = 8770
function Say([string]$s, [string]$c = 'Gray') { Write-Host $s -ForegroundColor $c }

function Find-Browser {
  foreach ($p in @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe")) {
    if ($p -and (Test-Path $p)) { return $p }
  }
  return $null
}

try {
  Say '매출 보고 — 사무실 PC (C) 설치' 'Cyan'
  foreach ($f in @('PosReport.exe', 'PosReportC.exe')) {
    if (-not (Test-Path (Join-Path $here $f))) { throw ($f + ' 이 없습니다. 내려받은 압축 파일을 모두 푼 폴더에서 실행해 주세요.') }
  }

  Say '[1/6] 프로그램 복사'
  try { Get-ChildItem $here | Unblock-File -ErrorAction SilentlyContinue } catch {}
  Stop-ScheduledTask -TaskName 'PosReport-C' -ErrorAction SilentlyContinue
  Get-Process PosReport, PosReportC, PosReportW -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  # 예전 판(매출 보내기) 정리
  Unregister-ScheduledTask -TaskName 'PosReport-Logon' -Confirm:$false -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName 'PosReport-Close' -Confirm:$false -ErrorAction SilentlyContinue
  $desk = [Environment]::GetFolderPath('CommonDesktopDirectory')
  $myDesk = [Environment]::GetFolderPath('Desktop')
  foreach ($n in @('매출 보내기.lnk', '매출 엑셀 폴더.lnk')) { $l = Join-Path $desk $n; if (Test-Path $l) { Remove-Item $l -Force } }
  if (Test-Path (Join-Path $app 'PosReportW.exe')) { Remove-Item (Join-Path $app 'PosReportW.exe') -Force }
  New-Item -ItemType Directory -Force -Path $app | Out-Null
  New-Item -ItemType Directory -Force -Path $data | Out-Null
  Copy-Item (Join-Path $here 'PosReport.exe') $app -Force
  Copy-Item (Join-Path $here 'PosReportC.exe') $app -Force
  $exe = Join-Path $app 'PosReport.exe'
  $exeC = Join-Path $app 'PosReportC.exe'

  Say '[2/6] 설정'
  $conf = Join-Path $data 'config.json'
  $a = @('setup')
  $fbFile = Join-Path $here 'firebase.json'
  $fb = $null
  if (Test-Path $fbFile) { $fb = Get-Content $fbFile -Raw -Encoding UTF8 | ConvertFrom-Json }
  if ($fb -and $fb.kmaKey) { $a += @('--kma-key', $fb.kmaKey) }
  $old = $null
  if (Test-Path $conf) { $old = Get-Content $conf -Raw -Encoding UTF8 | ConvertFrom-Json }
  if ($old -and $old.firebase -and $old.firebase.email) {
    Say '  이미 클라우드 올리기 계정이 있습니다 (그대로 씀). 바꾸려면 C:\ProgramData\PosReport\config.json 을 지우고 다시 설치하세요.'
  } else {
    Say '  (클라우드 보관함을 아직 만들지 않았으면 Enter 만 누르세요 — "시험 모드": 자료는 C 에만 쌓이고 사무실에서 http://이PC:8770/b/ 로 봄)' 'Yellow'
    if ($fb -and $fb.apiKey) {
      $a += @('--apikey', $fb.apiKey, '--projectid', $fb.projectId)
      if ($fb.board) { $a += @('--board', $fb.board) }
    }
    $em = Read-Host '  클라우드 올리기 계정 이메일 (없으면 Enter)'
    if ($em) {
      if (-not ($fb -and $fb.apiKey)) {
        $a += @('--apikey', (Read-Host '  클라우드 보관함 API 키'), '--projectid', (Read-Host '  클라우드 보관함 프로젝트 ID'))
      }
      if (-not ($fb -and $fb.board)) { $a += @('--board', (Read-Host '  매장 열쇠 (보고 앱 설치 주소의 /b/ 뒤 글자)')) }
      $a += @('--email', $em)
      $sec = Read-Host '  올리기 계정 비밀번호' -AsSecureString
      $a += @('--password', [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)))
    }
  }
  if (-not ($old -and $old.PSObject.Properties.Name -contains 'officePin')) {
    $pin = Read-Host '  사무실 비밀번호 (직원이 A 에서 한 번 넣음. 손님 와이파이가 사무실 공유기와 같으면 꼭 정하기. 없으면 Enter)'
    if ($pin) { $a += @('--pin', $pin) }
  }
  & $exe @a
  if ($LASTEXITCODE -ne 0) { throw '설정을 마치지 못했습니다. install-c.bat 을 다시 실행해 주세요.' }

  Say '[3/6] 방화벽 (사무실 공유기 안에서만)'
  Get-NetFirewallRule -DisplayName 'PosReport C *' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName 'PosReport C (A·B 화면)' -Direction Inbound -Protocol TCP -LocalPort $port -RemoteAddress LocalSubnet -Action Allow -Profile Any | Out-Null
  New-NetFirewallRule -DisplayName 'PosReport C (PC 찾기)' -Direction Inbound -Protocol UDP -LocalPort 8771 -RemoteAddress LocalSubnet -Action Allow -Profile Any | Out-Null

  Say '[4/6] 늘 켜 두기 (전원 연결 상태에서 절전 끔 — 화면만 꺼짐)'
  cmd /c "powercfg /change standby-timeout-ac 0 >nul 2>&1"
  cmd /c "powercfg /change hibernate-timeout-ac 0 >nul 2>&1"

  Say '[5/6] PC 를 켜면 저절로 C 서버 시작'
  $act = New-ScheduledTaskAction -Execute $exeC -Argument 'serve' -WorkingDirectory $app
  $prin = New-ScheduledTaskPrincipal -UserId 'S-1-5-18' -LogonType ServiceAccount -RunLevel Highest
  $set = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
  $boot = New-ScheduledTaskTrigger -AtStartup
  Register-ScheduledTask -TaskName 'PosReport-C' -Action $act -Principal $prin -Settings $set -Trigger $boot -Force | Out-Null
  Start-ScheduledTask -TaskName 'PosReport-C'

  Say '[6/6] 바탕화면 아이콘 · 점검'
  $ws = New-Object -ComObject WScript.Shell
  $br = Find-Browser
  if ($br) {
    $sh = $ws.CreateShortcut((Join-Path $myDesk '매출 보고 입력 (A).lnk'))
    $sh.TargetPath = $br
    $sh.Arguments = "--app=http://localhost:$port/ --start-fullscreen --user-data-dir=`"$env:LOCALAPPDATA\PosReportA`" --no-first-run --no-default-browser-check"
    $sh.IconLocation = "$br,0"
    $sh.Save()
    $sh2 = $ws.CreateShortcut((Join-Path $myDesk '매출 보고 보기 (B).lnk'))
    $sh2.TargetPath = $br
    $sh2.Arguments = "http://localhost:$port/b/"
    $sh2.IconLocation = "$br,0"
    $sh2.Save()
  }
  Start-Sleep -Seconds 4
  $ok = $false
  try { $i = Invoke-RestMethod -Uri "http://localhost:$port/api/info" -TimeoutSec 10; $ok = $true } catch {}
  & $exe check
  $ips = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress) -join ', '
  Say ''
  if ($ok) { Say '설치를 마쳤습니다. C 서버가 돌고 있습니다.' 'Green' } else { Say 'C 서버 응답을 아직 못 받았습니다. 잠시 뒤 바탕화면 "매출 보고 입력 (A)" 를 열어 보세요.' 'Yellow' }
  Say ('이 PC 이름: ' + $env:COMPUTERNAME + '   주소: ' + $ips)
  Say ('직원 PC: install-a.bat 을 실행하면 이 PC 를 저절로 찾습니다 (못 찾으면 위 주소를 넣으면 됨).')
  Say ('사무실에서 보고 보기: http://' + $env:COMPUTERNAME + ':' + $port + '/b/')
  Say ('기록 파일: ' + (Join-Path $data 'logs\office.log'))
  Say '이 PC 는 끄지 말고 켜 두세요 (화면은 꺼져도 됨). 재부팅해도 저절로 다시 시작합니다.' 'Yellow'
} catch {
  Say ''
  Say ('설치 실패: ' + $_.Exception.Message) 'Red'
  exit 1
}
