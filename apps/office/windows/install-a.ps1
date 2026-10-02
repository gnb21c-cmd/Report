# ============================================================
#  직원 PC (A) — 바탕화면에 '매출 보고 입력' 아이콘 만들기 (관리자 권한 필요 없음)
#  프로그램을 따로 깔지 않습니다. 아이콘을 누르면 사무실 PC (C) 의 입력 화면이 전체 화면으로 열립니다
#  1) 사무실 공유기 안에서 C 를 찾음 (못 찾으면 C 이름 · 주소를 물음)
#  2) Edge (없으면 Chrome) 앱 창으로 여는 바로가기 — 임시저장은 이 PC 안에 남음
# ============================================================
$ErrorActionPreference = 'Stop'
function Say([string]$s, [string]$c = 'Gray') { Write-Host $s -ForegroundColor $c }

function Find-C {
  $u = New-Object System.Net.Sockets.UdpClient
  $u.EnableBroadcast = $true
  $u.Client.ReceiveTimeout = 1500
  $msg = [Text.Encoding]::ASCII.GetBytes('POSREPORT-C?')
  $found = $null
  for ($i = 0; $i -lt 3 -and -not $found; $i++) {
    try {
      [void]$u.Send($msg, $msg.Length, (New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Broadcast, 8771)))
      $ep = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
      $bytes = $u.Receive([ref]$ep)
      $j = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
      if ($j.app -eq 'posreport-c') { $found = @{ name = $j.name; port = [int]$j.port; ip = $ep.Address.ToString() } }
    } catch {}
  }
  $u.Close()
  return $found
}

function Test-C([string]$base) {
  try { $i = Invoke-RestMethod -Uri ($base + 'api/info') -TimeoutSec 5; return [bool]$i.version } catch { return $false }
}

function Find-Browser {
  foreach ($p in @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")) {
    if ($p -and (Test-Path $p)) { return $p }
  }
  return $null
}

try {
  Say '매출 보고 입력 (A) — 이 PC 에 아이콘 만들기' 'Cyan'
  Say '[1/2] 사무실 PC (C) 찾기'
  $base = $null
  $c = Find-C
  if ($c) {
    Say ('  찾았습니다: ' + $c.name + ' (' + $c.ip + ')')
    foreach ($h in @($c.name, $c.ip)) {
      $b = 'http://' + $h + ':' + $c.port + '/'
      if (Test-C $b) { $base = $b; break }
    }
  }
  while (-not $base) {
    $h = Read-Host '  C 를 찾지 못했습니다. C 의 PC 이름이나 주소를 넣어 주세요 (C 설치 끝에 나온 것, 예: 192.168.0.10)'
    if (-not $h) { throw 'C 주소가 없어 끝냅니다.' }
    $b = 'http://' + $h.Trim() + ':8770/'
    if (Test-C $b) { $base = $b } else { Say ('  ' + $b + ' 에 연결하지 못했습니다. C 가 켜져 있는지, 같은 공유기인지 확인해 주세요.') 'Yellow' }
  }
  Say ('  주소: ' + $base) 'Green'

  Say '[2/2] 바탕화면 아이콘'
  $br = Find-Browser
  if (-not $br) { throw 'Edge 나 Chrome 을 찾지 못했습니다.' }
  $desk = [Environment]::GetFolderPath('Desktop')
  $ws = New-Object -ComObject WScript.Shell
  $profileDir = Join-Path $env:LOCALAPPDATA 'PosReportA'
  $sh = $ws.CreateShortcut((Join-Path $desk '매출 보고 입력.lnk'))
  $sh.TargetPath = $br
  $sh.Arguments = "--app=$base --start-fullscreen --user-data-dir=`"$profileDir`" --no-first-run --no-default-browser-check"
  $sh.IconLocation = "$br,0"
  $sh.Description = '매출 보고 입력 (A) — 사무실 PC C'
  $sh.Save()
  $menu = Join-Path ([Environment]::GetFolderPath('Programs')) '매출 보고 입력.lnk'
  Copy-Item (Join-Path $desk '매출 보고 입력.lnk') $menu -Force
  Say ''
  Say '끝났습니다. 바탕화면 "매출 보고 입력" 을 누르면 전체 화면으로 열립니다 (닫기: 화면 오른쪽 위 [끝내기] 또는 Alt+F4).' 'Green'
  $ans = Read-Host '지금 열어 볼까요? (Y/N)'
  if ($ans -match '^[Yy]') { Start-Process -FilePath $br -ArgumentList $sh.Arguments }
} catch {
  Say ''
  Say ('실패: ' + $_.Exception.Message) 'Red'
  exit 1
}
