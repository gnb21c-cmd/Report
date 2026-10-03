# 처음 설정 · 매일 하는 일

켜 두거나 관리할 서버 · PC 는 없습니다. **Google Firebase(무료 Spark 요금제)** 를 보관함으로 쓰고, 화면 올리기와 날씨는 GitHub 가 대신 합니다.

```
직원 PC: 바탕화면 아이콘 → https://astana-report.web.app/a/ (전체 화면, 처음 한 번 로그인)
   네이버 표 · 영수증별 엑셀 2개 → A 에서 계산 → Firebase boards/{열쇠}/reports/{날짜} (보낸 칸만 바뀜)
GitHub (1시간마다): 기상청 → Firebase boards/{열쇠}/weather/{날짜}
폰: https://astana-report.web.app/b/{열쇠}/ (홈 화면에 추가, 로그인 없음)
```

## ① Firebase 프로젝트 (완료 — `astana-report`)

console.firebase.google.com → 프로젝트 만들기 → ⚙ 프로젝트 설정 → **일반** → 맨 아래 "내 앱" → **</> (웹)** → 별명 `report` → 등록 → `apiKey` · `projectId`

## ② 로그인 계정 (A 로 올리는 사람 + 날씨)

1. **Authentication** → 시작하기 → 로그인 방법 → **이메일/비밀번호** 사용
2. 사용자 → 사용자 추가: 직원마다 하나 (예: `kim@astana.report`, 실제 메일함 없어도 됨) + 날씨용 `weather@astana.report`
3. 비밀번호는 각 직원에게만. A 에서 PC 마다 처음 한 번 로그인

## ③ 저장소 · 매장 열쇠

1. **Firestore Database** → 데이터베이스 만들기 → 위치 **asia-northeast3 (서울)** → **프로덕션 모드**
2. 매장 열쇠: PowerShell 에서 `[guid]::NewGuid().ToString('N')` — 폰 설치 주소의 일부. 회사 안에서만 주고받기
3. 데이터 → 컬렉션 `senders` → 문서 ID = ② 계정 이메일(**소문자**), 필드 `board`(문자열) = 열쇠. 계정마다 하나씩

## ④ 보안 규칙

Firestore → **규칙** 탭에 `firebase/firestore.rules` 를 통째로 붙여 넣고 **게시** (⑤ 를 마치면 GitHub Deploy 가 저절로 올림)

## ⑤ GitHub 에 맡기기 (화면 올리기 · 날씨)

Firebase ⚙ 프로젝트 설정 → **서비스 계정** → **새 비공개 키 생성** → JSON 파일.
GitHub `gnb21c-cmd/Report` → Settings → Secrets and variables → Actions:

| 종류     | 이름                        | 값                                    |
| -------- | --------------------------- | ------------------------------------- |
| Variable | `FIREBASE_API_KEY`          | ① apiKey                              |
| Variable | `FIREBASE_PROJECT_ID`       | `astana-report`                       |
| Secret   | `FIREBASE_SERVICE_ACCOUNT`  | 받은 JSON 파일 내용 통째로            |
| Secret   | `REPORT_BOARD_KEY`          | 매장 열쇠                             |
| Secret   | `WEATHER_EMAIL` · `WEATHER_PASSWORD` | 날씨용 계정                  |
| Secret   | `KMA_SERVICE_KEY`           | 기상청 인증키 (아스타나 때 것, Decoding) |

**JSON · 비밀번호 · 키는 대화창에 붙여 넣지 말고 GitHub 에만.** 그 뒤 Actions → **Deploy** → Run workflow 로 화면을 올리고, **Weather** → Run workflow 로 날씨를 처음 채움 (2025-01-01 부터).

- 서비스 계정 권한이 모자라 Deploy 가 실패하면: Google Cloud 콘솔 → IAM → 그 계정에 `Firebase Hosting 관리자` · `Firebase 규칙 관리자` 역할 추가

## ⑥ 직원 PC · 폰

- 직원 PC: Edge 로 `https://astana-report.web.app/a/` → 바탕화면 아이콘: 주소창 오른쪽 … → 앱 → **이 사이트를 앱으로 설치** (전체 화면은 F11)
- 폰: `https://astana-report.web.app/b/{열쇠}/` → 아이폰 Safari 공유 → 홈 화면에 추가 / 안드로이드 Chrome ⋮ → 앱 설치

## ⑦ 지난 자료 빨리 채우기 (한 번) — A 화면 아래 '지난 자료 한꺼번에 넣기', 파일 여러 개를 한 번에

1. **상품별 (일자별)** — 먼저. 카페아스타나는 조회줄수(5000) 때문에 **한 달씩 12개**, 아스타나키즈는 **6개월씩 2개**. 하루 합계 + 카페 상품 분류표
2. **영수증별 매출 상세현황** — 하루씩만 받아짐. 시간대 분석은 **최근 5주**면 충분 (≈ 70개)
3. **네이버 지난 자료** — 낮(10:00~17:30) 주 단위 캡처 · 야간(18:00~19:30) 월 단위 캡처를 Claude 가 표로 정리 → 올림. 신규방문자는 지난 자료로는 알 수 없음('—')

## 매일 하는 일 (각자 맡은 칸만 넣어도 됨 — 날짜별로 합쳐짐)

1. **매출 보고 입력** 아이콘 → 어제 날짜로 열림
2. ① 네이버 예약 표: 10:00 ~ 19:30, 30분마다 판매입장권 수 · 신규방문자 수
3. ② 백오피스 **영수증별 매출 상세현황** → 매장 **[카페아스타나]** 하루 → 왼쪽 칸 / **[아스타나키즈]** 하루 → 오른쪽 칸 ([전체]로 받으면 섞여서 안 받음)
4. ③ 처음 보는 상품만 분류 확인 → ④ 미리보기 확인 → **입력완료 · 보고자료 업로드**
   - 중간에 멈출 때는 **임시저장** (그 PC 에만, 인터넷이 끊겼을 때도)
- 같은 날을 다시 올리면 그 칸이 통째로 바뀜 (두 번 더해지지 않음)

## 비용

직원 5명 · 볼 사람 5명 · 하루 보고 1건 · 날씨 24번이면 Firebase 무료 사용량(하루 읽기 5만 · 쓰기 2만, 저장 1GB) 안입니다. GitHub Actions 도 무료 시간 안입니다.
