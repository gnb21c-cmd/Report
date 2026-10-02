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

- `pnpm test` (core + C 시험) / `pnpm typecheck`
- `pnpm demo` — 체험판 HTML 두 장 (B `apps/view/dist-demo/index.html`, A `apps/entry/dist-demo/index.html`)
- `pnpm office` — C 를 이 컴퓨터에서 시험 모드로 (http://localhost:8770/ · /b/)
- C 시험만: `cd apps/office && PYTHONPATH=src python3 -m unittest discover -s tests`
- 구조: A(`apps/entry`, 직원 PC 입력 · 계산) → C(`apps/office`, 사무실 PC 서버 · 보관 · 합치기 · 날씨) → Firebase → B(`apps/view`, 폰)
- 계산 규칙은 `packages/core/src/rules.ts`(키즈 단가 · 방문인원 × 0.96 · 잔), `receipt.ts`(영수증 엑셀 · 반품 지우기), `part.ts`(매장 하루치), `metrics.ts`(대시보드 · 누계), `hourly.ts`(시간대 분석), 분류는 `classify.ts`. 바꾸면 `packages/core/test` 에 시험을 먼저 더한다.
- 폰 앱은 로그인 없음 — 설치 주소 `/b/{열쇠}/` 의 열쇠로 `boards/{열쇠}` 를 읽는다. 열쇠 · 기상청 키는 저장소에 넣지 않는다.
- A 가 보내는 모양(`packages/core/src/part.ts` StorePart · NaverPart · DayReport), C 가 받는 확인(`apps/office/src/report_office/store.py` check_part), C 가 올리는 칸(`relay.py report_doc`), B 가 읽는 칸(`apps/view/src/data/firebase.ts toReport`)은 같이 바꾼다.
