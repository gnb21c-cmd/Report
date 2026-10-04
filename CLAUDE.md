# report 작업 원칙

- **서브에이전트(Agent 도구)를 절대 사용하지 않는다.** 분석·작성·검증은 모두 직접 수행한다. (사용자 지시)
- 아스타나(`gnb21c-cmd/astana`)와는 **별도 운용**한다. POS 읽기 코드(`apps/pos-sync`)·점검 결과(`docs/POS_SYNC.md`)·보고 계산(`packages/domain/src/report.ts`)은 가져다 쓰되, 서로 의존하지 않는다.
- POS DB·OK포스 파일은 **읽기만** 한다. SELECT 외 쿼리 금지, OK포스 설정·암호화된 계정을 풀거나 바꾸지 않는다.
- 카드번호·전화번호 등 개인정보는 다루지 않는다. 영수증별 엑셀에서 쓰는 칸은 포스번호·영수증번호·구분·최초주문·상품명·수량·금액뿐.
- 매출 자료 파일(엑셀·CSV)은 저장소에 넣지 않는다.
- 상품별로 볼 때는 **상품명 기준** (2026-07-01 VAN 변경으로 상품코드가 모두 바뀜).
- 사용자에게 보이는 문구와 주석은 한국어로 쓴다.
- 개발 작업은 명령마다 새 브랜치(`feature/작업이름`)를 만들어 저장·검증·수정한다. 검증·수정이 끝나면 체험판 등으로 확인할 수 있게 보여주고 "main에 올릴까요?"라고 묻는다. 사용자가 "올려"라고 할 때만 main에 합쳐 `git push origin main` 하고, GitHub에 반영됐는지 확인해 알린다. 작업을 마칠 때마다 main에 아직 안 올라간 브랜치가 있는지 점검해 알린다. (사용자 지시)

## 명령

- `pnpm test` (core + 날씨 시험) / `pnpm typecheck`
- `pnpm demo` — 체험판 HTML 두 장 (B `apps/view/dist-demo/index.html`, A `apps/entry/dist-demo/index.html`)
- `pnpm build:hosting` — 올릴 화면 (B 안에 A 를 /a/ 로). 올리기는 main 에서 GitHub Deploy
- 구조: A(`apps/entry`, 직원 PC 입력 · 계산 · Firebase 에 직접) → Firebase → B(`apps/view`, 폰). 날씨는 `apps/weather` (GitHub Actions). 서버 · 24시간 PC 없음
- 베이커리 작업지시: D(`apps/bakery`, 매니저 폰 …/d/, 로그인) · D-1(같은 앱, 현장 태블릿 …/d1/<열쇠>/, 읽기만). 매출 금액은 보이지 않고 수량 · 예상 손님만. 예측은 `packages/core/src/forecast.ts`(방문객 = 작년 기준 × 올해 수준(2주 · 8주, 되돌림 λ=0.5) × 날씨 칸 × 기간 → 빵별 = 방문객 × 최근 4주 같은 날 유형 1명당 개수), 계획 · 확정 규칙은 `bakery.ts`. 매일 16시 GitHub(`bakery-plan.yml`)가 이틀 뒤 확정안 · 사흘 뒤 ±5% · 나흘 뒤 ±10% 를 plans/{날짜} 에 씀(확정 기준일 = 이틀 뒤 `CONFIRM_LEAD`, 어제 알려 준 범위 밖으로 안 나감). 그때 지난 2주 빵별 결과(생산 · 정가 판매 · 50% 할인 · 폐기, `dayResult`)로 보정 배수(`corrections`, 보정 전 예측 base 와 견줘 쌓이지 않음)를 곱함. 매니저가 그날 18시 전에 이틀 뒤 수량을 빵별 · 일괄 확정 → orders/{날짜}. 확정 안 한 빵은 마감(이틀 전 18시) 뒤 계획 수량 '자동'. 생산 = 확정, 폐기 = 생산 − 판매 (보고 앱 B 베이커리 4칸). 50% 할인 = 20:25 뒤(1~2분 일찍 집어 온 것 포함) 40% 이상 할인 줄(`rules.ts isHalfOff`), 빵별은 bakeryHalfBy
- POS 자동 수집: `apps/collector` (GitHub Actions `pos-collect.yml`, 매일 22:10 한국 시간). OKPOS 점주 웹(nice.okpos.co.kr)에 점주 계정으로 들어가 영수증별매출상세현황 엑셀(카페 · 키즈)을 받아 입력 화면과 같은 계산으로 cafe · kids 칸을 올림 (by "자동 수집 (OKPOS)"). DB 열람 계정 없이 화면만 읽음. 사람이 이미 올린 칸은 덮지 않고, 사람이 나중에 올리면 사람 것이 이김. 엑셀 합계와 다르면 올리지 않고 실패(메일). 저장소가 공개라 실행 기록에 매출 숫자 · 매장 이름 · 회사 이름을 남기지 않는다. 비밀값: OKPOS_ID · OKPOS_PW (+ 날씨와 같은 Firebase 계정)
- 계산 규칙은 자금 `packages/core/src/cash.ts`(전일 잔고 이어받기 · 외화 환산 · 대출 제외), `packages/core/src/rules.ts`(키즈 단가 · 2026-03-31 까지 교환권 방식: 키즈입장 = 네이버 × 3만원 + 현장 구매 − 카페에서 쓴 교환권 · 방문인원 × 0.96 · 잔 · 교환권 −금액은 결제 수단 · 4월부터 '[아키 2만원] 교환권'(사은권)은 키즈 매출에서 뺌), `receipt.ts`(영수증 엑셀 · 반품 지우기), `part.ts`(매장 하루치), `metrics.ts`(대시보드 · 누계, 작년 비교: 하루 · 올해 누계는 364일 전 = 같은 주 같은 요일 `dates.ts lyDay`, 월간(당월 · 달마다)은 달력 날짜 = 작년 같은 달 1일 ~ 같은 날짜 `lyCalendar`), `hourly.ts`(시간대 분석), `extra.ts`(POS 밖 카드 매출 — 자판기 · 인생네컷 · 주차, 나이스 통합거래조회 · 단말기 번호 → 종류, 기타 상자에 더함), 분류는 `classify.ts`. 2025-01 평일 교환권은 2만원, 2026-04 부터 숏타임은 평일 1만 · 휴일 1만1천. 바꾸면 `packages/core/test` 에 시험을 먼저 더한다.
- 폰 앱은 로그인 없음 — 설치 주소 `/b/{열쇠}/` 의 열쇠로 `boards/{열쇠}` 를 읽는다. 열쇠 · 기상청 키 · 서비스 계정은 저장소에 넣지 않는다 (GitHub Secrets).
- 대관(어린이집 · 유치원 등)은 키즈입장 매출: 키즈 POS '대관' 상품 + 자금 보고 입금(보낸 사람 어린이집 · 유치원, 또는 적요 '키즈 … 대관') — `cash.ts isRentalRow`, 정산완료 합계에는 '대관'.
- 보고 설정(기간 스티커 성수기 빨강 · 평상시 노랑 · 비수기 파랑, 휴일 더하기/빼기)은 `packages/core/src/settings.ts` — 입력 화면 ⚙ 설정에서 바꿔 클라우드 `settings/main` 에 저장, 보고 앱 · 입력 화면 모두 계산 전에 `applySettings`. 공휴일 표(대체공휴일 포함)는 `holidays.ts` 자동.
- 보고 문서 모양(`boards/{열쇠}/reports/{날짜}` 칸 cafe · kids · naver · cash(자금) · extra(자판기 · 네컷 · 주차) = 조각 JSON)은 A 쓰기(`apps/entry/src/cloud.ts`), B 읽기(`apps/view/src/data/firebase.ts toReport`), 규칙(`firebase/firestore.rules`)을 같이 바꾼다.
- 매출 자료 · 네이버 정리표(CSV)는 저장소에 넣지 않는다.
