# 처음 설정 · 설치 순서

우리가 운영하는 서버는 없습니다. A(POS PC)와 B(폰 앱) 사이의 우편함으로 **Google Firebase(무료 사용량 안)** 를 씁니다.
Firebase 는 Google 이 운영하므로 켜 두거나 관리할 컴퓨터가 없습니다.

```
[카페 메인 POS] ─A─┐   (PC 계정으로만 씀)                    ┌─▶ 대표이사 폰 (B)
                    ├─▶ Firebase 보관함 boards/{열쇠}/days ───┤
[키즈 POS]     ─A─┘                                          └─▶ 관리자 4명 폰 (B) — 설치 주소의 열쇠로 읽음
```

## ① Firebase 프로젝트 만들기 (사장님, 15분 · 처음 한 번)

1. https://console.firebase.google.com → 회사 구글 계정으로 로그인 → **프로젝트 추가** → 이름 예: `pos-report` (Google 애널리틱스는 꺼도 됨)
2. **Authentication** → 시작하기 → 로그인 방법 → **이메일/비밀번호** 사용 설정
3. Authentication → 사용자 → **사용자 추가** 로 POS PC 계정 2개를 만듭니다 (보는 사람은 계정이 필요 없음).
   | 계정                       | 쓰는 곳          |
   | -------------------------- | ---------------- |
   | `cafe-pos@회사도메인` (예) | 카페 메인 POS PC |
   | `kids-pos@회사도메인` (예) | 키즈 POS PC      |
   - 실제 메일함이 없어도 됩니다 (로그인 이름으로만 씀). 비밀번호는 PC 마다 따로.
4. **Firestore Database** → 데이터베이스 만들기 → 위치 **asia-northeast3 (서울)** → 프로덕션 모드
5. Firestore → **규칙** 탭 → 저장소의 `firebase/firestore.rules` 내용을 통째로 붙여 넣고 **게시**
6. **매장 열쇠** 정하기 — 32자 정도의 무작위 글자. 아무 PC 의 PowerShell 에서 `[guid]::NewGuid().ToString('N')` 를 실행하면 하나 나옵니다.
   - 이 열쇠가 곧 보고 앱 설치 주소의 일부입니다. 열쇠를 아는 사람만 자료를 볼 수 있습니다.
7. Firestore → 데이터 → 컬렉션 `senders` 에 문서 2개 (문서 ID = POS PC 계정 이메일 **소문자**)
   - `cafe-pos@…` : 칸 `pos` = `cafe`, 칸 `board` = 6번 열쇠
   - `kids-pos@…` : 칸 `pos` = `kids`, 칸 `board` = 6번 열쇠
8. 프로젝트 설정(⚙) → 일반 → **웹 앱 추가**(</>) → 나오는 `apiKey` 와 `projectId`, 그리고 6번 열쇠를 알려 주세요.
   - `apiKey`·`projectId` 는 비밀번호가 아닙니다. **열쇠는 회사 안에서만** 주고받아 주세요.

## ② 폰 앱(B) 올리기 (개발 측)

```bash
cd apps/view
VITE_FIREBASE_API_KEY=… VITE_FIREBASE_PROJECT_ID=… pnpm build
cd ../../firebase && npx firebase-tools deploy --only hosting,firestore:rules --project <projectId>
```

- **설치 주소: `https://<projectId>.web.app/b/<열쇠>/`** — 대표이사 · 관리자 4명에게 이 주소를 카톡 등으로 보냅니다.
- 폰에서 주소를 열고 **홈 화면에 추가**(아이폰 Safari 공유 버튼 / 안드로이드 Chrome ⋮ → 앱 설치). 로그인은 없습니다.
- 주소를 아는 사람은 누구나 볼 수 있으니 회사 밖으로 보내지 않습니다. 주소가 샜으면 새 열쇠를 정해
  `senders` 두 문서의 `board` 와 POS PC 설정(install.bat 다시)을 바꾸고 새 주소를 다시 보냅니다 (옛 자료는 옮겨 드림).
- GitHub 저장소 변수 `FIREBASE_API_KEY` · `FIREBASE_PROJECT_ID` 와 비밀 값 `REPORT_BOARD_KEY`(열쇠)를 넣어 두면 A 설치 묶음에 들어가 설치 때 묻지 않습니다.

## ②-1 기상청 날씨 (아스타나와 같은 키)

- 아스타나 때 공공데이터포털에서 받은 **기상청 인증키(Decoding)** 를 그대로 씁니다. 필요한 서비스: 단기예보 조회서비스 · 지상(종관, ASOS) 일자료 조회서비스
- 서버가 없으므로 **POS PC 의 A 가 송부할 때** 기상청에서 받아 보관함 `boards/{열쇠}/weather/{날짜}` 에 쌓습니다.
  - 지난 날: 관측 확정값 (관측소 119 수원). 처음 한 번은 2025-01-01 부터 모두 채움
  - 오늘: 단기예보 (매장 격자 61·119, 오늘 02시 발표의 최고·최저). 다음 날 관측값이 오면 관측으로 바뀜
  - 날씨가 실패해도 매출 송부는 그대로 됩니다 (보내기 창에 "⚠ 날씨: …" 로만 표시)
- 키는 GitHub 비밀 값 `KMA_SERVICE_KEY` 로 넣어 두면 A 설치 묶음에 들어갑니다 (또는 `PosReport.exe setup --kma-key …`).

## ③ POS PC 에 A 설치 (매장, PC 마다 10분)

1. GitHub → Actions → **Build sender** → Run workflow → 끝나면 `pos-report-sender` 내려받기 → USB 로 POS PC 에 옮겨 압축 풀기
2. `install.bat` 더블클릭 → [예] → 이 PC 가 카페(1)/키즈(2) → 그 PC 계정 이메일·비밀번호
3. 마지막 점검에 `[정상] 클라우드 보관함 로그인` 이 보이면 끝. 바탕화면에 **매출 보내기** 아이콘이 생깁니다.

## ④ 지난 매출 넣기 (작년 비교용, 한 번)

아스타나 때 받은 OK포스 "상품별 (일자별)" 엑셀(2025-09 ~)을 한 폴더에 모아:

```
"C:\Program Files\PosReport\PosReport.exe" import D:\지난엑셀 --pos cafe --dry   # 읽기만 (잘린 파일 확인)
"C:\Program Files\PosReport\PosReport.exe" import D:\지난엑셀 --pos cafe         # 올리기
```

- 7 · 8 · 9월 파일은 조회줄수 제한으로 잘려 있었습니다 (아스타나 `docs/POS_SALES.md`). 조회줄수 5000 · 한 달씩 다시 받아 넣어 주세요. 잘린 파일은 프로그램이 건너뜁니다.
- 키즈 매장(N53409) 엑셀은 `--pos kids` 로 따로 넣습니다.

## 마감 때 하는 일 (근무자)

| 지금 (엑셀 방식, DB 계정 없음)                                                                 | OK포스 DB 계정을 받은 뒤          |
| ---------------------------------------------------------------------------------------------- | --------------------------------- |
| OK포스 백오피스 → "상품별 (일자별)" → 오늘 → 엑셀로 `C:\PosReport\엑셀` 에 저장 → **매출 보내기** | **매출 보내기** 만 (카페는 22:10 에 저절로도) |

- 못 보낸 날은 PC 를 켤 때 저절로 보냅니다 (인터넷이 끊겼던 날 · 늦은 취소).
- 같은 날을 여러 번 보내도 매출이 두 배가 되지 않습니다 (그날을 통째로 바꿈).

## 비용

볼 사람 5명 · POS 2대 · 하루 2건이면 Firebase 무료 사용량(하루 읽기 5만 · 쓰기 2만, 저장 1GB) 안입니다.
처음 열 때 1년치(약 730건)를 받고, 그 뒤로는 새로 온 날만 받습니다.
