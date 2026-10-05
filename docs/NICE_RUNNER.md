# 나이스 자동 수집 — POS 메인 PC에 GitHub 실행기 설치

자판기 · 인생네컷 · 주차정산기 매출(나이스 NIBS)은 해외(GitHub 서버)에서 접속하면 나이스가 연결을 자주 끊습니다.
그래서 **한국에 있는 POS 메인 PC**에서 돌립니다. (`.github/workflows/extra-collect.yml`)

- 매일 **09:10** (안 되면 **09:20** 한 번 더): 지난 7일 ~ 어제를 받아 클라우드에 올림 — 밤늦은 결제, PC가 꺼져 있던 날까지. 사람이 A에서 올린 칸은 그대로
  (POS 메인 PC는 늦어도 9시 10분에 켜짐. 아직 안 켜졌으면 실행이 GitHub 에서 기다렸다가 켜지면 돎)
- 저녁 예약이 PC가 꺼져 있어 다음 날 켜질 때 늦게 돌면 건너뜀 (아침 실행이 받으므로)

- 아이디 · 비밀번호는 PC에 저장하지 않습니다. 실행할 때만 GitHub Secrets에서 넘어옵니다.
- 며칠 꺼져 있어도 다시 켜진 다음 09:10 실행이 지난 7일을 채웁니다 (7일보다 길게 꺼져 있었으면 A에서 직접 올리거나 날짜를 정해 손으로 돌림).
- GitHub 예약은 몇 분 늦게 시작할 수 있습니다.

## 0. 시험은 사장님 PC에서 먼저 (서비스로 설치하지 않음)

시험해서 접속 · 다운로드가 문제없고 main 에 올리기까지 끝나면, 그때 POS 메인 PC에 서비스로 설치합니다.
시험할 때는 아래 2번과 같게 하되 이것만 다르게:

| 질문 | 시험(사장님 PC) |
|---|---|
| name of runner | `my-pc` |
| additional labels | `nice-pos` (같게 — 같은 일을 받음) |
| run as service? | **N** |

등록이 끝나면 같은 PowerShell 창에서 `./run.cmd` → **Listening for Jobs** 가 나오면 기다리던 시험이 바로 돕니다.
창을 닫으면 멈춥니다. 시험이 끝나면 POS PC로 옮기기 전에 `./config.cmd remove --token ...` 으로 지웁니다
(토큰은 Runners 화면 → my-pc → Remove 에서 받음). 두 PC가 같은 라벨로 동시에 있으면 어느 쪽이 받을지 모르기 때문.

## 1. 먼저 — 공개 저장소 안전 설정 (꼭)

GitHub → Report 저장소 → **Settings → Actions → General**
→ **Fork pull request workflows from outside collaborators** → **Require approval for all outside collaborators** 선택 → Save

> 공개 저장소라, 모르는 사람이 보낸 변경 요청(PR)이 이 PC에서 실행되지 않게 막는 설정입니다.

## 2. 실행기 내려받기 · 등록 (POS 메인 PC에서)

1. GitHub → Report 저장소 → **Settings → Actions → Runners → New self-hosted runner**
2. **Windows**, **x64** 선택 → 화면에 나오는 명령을 **PowerShell**에 차례로 붙여 넣습니다.
   - `mkdir actions-runner; cd actions-runner` (폴더는 `C:\actions-runner` 권장)
   - 내려받기 · 압축 풀기 명령 2줄
   - `./config.cmd --url https://github.com/gnb21c-cmd/Report --token ...`
     (토큰은 그 화면에만 있고 1시간 뒤 만료됩니다. 대화창에 붙여 넣지 마세요.)
3. `config.cmd` 가 묻는 것:
   | 질문 | 입력 |
   |---|---|
   | runner group | 그냥 Enter |
   | name of runner | `pos-main` |
   | additional labels | **`nice-pos`** (꼭 이대로) |
   | work folder | 그냥 Enter (`_work`) |
   | run as service? | **Y** (PC를 켜면 자동으로 시작) |
   | service account | 그냥 Enter (NETWORK SERVICE — 권한이 낮은 계정) |
4. 끝나면 GitHub의 Runners 목록에 `pos-main` 이 **Idle(초록)** 으로 보입니다.

## 3. 확인

- Runners 목록에서 `pos-main` 이 Idle 이면 준비 끝.
- 작업 브랜치 시험(확인만, 올리지 않음)이 기다리고 있으면 바로 이 PC에서 돕니다.
- 처음 한 번은 크롬(약 150MB)과 Node를 받느라 몇 분 더 걸립니다.

## 참고

- **절전 모드 끄기 (POS 메인 PC):** Windows 설정 → 시스템 → 전원 → 화면 · 절전 → '절전 모드로 전환' **안 함**. 절전 중이면 09:10에 돌지 못함.
- 사장님 PC 시험(`run.cmd` 창)에서는 창 안을 마우스로 누르면 Windows가 프로그램을 일시 정지합니다(선택 모드). 그러면 Esc.

- PC에 따로 설치할 것 없음 (Node · pnpm · 크롬은 실행할 때 실행기가 받아 둠). Git for Windows 는 있으면 더 빠름.
- 실행기를 멈추려면: Windows **서비스** 에서 `GitHub Actions Runner (…pos-main)` 중지.
- 지우려면: `C:\actions-runner` 에서 `./config.cmd remove --token ...` (토큰은 Runners 화면에서 새로 받음).
