# report — 아스타나 카페 일일 매출 보고 시스템

사무실 직원이 전날 마감 자료(네이버 예약 표 · 영수증별 매출 엑셀)를 넣으면, 대표이사 · 관리자 4명이 폰에서 **마감일 기준 보고**를 언제든 보는 내부용 시스템입니다.
따로 운영하거나 켜 둘 서버 · PC 는 없습니다. Google Firebase(무료 사용량 안)를 보관함으로 쓰고, 날씨는 GitHub 가 1시간마다 받아 넣습니다. 아스타나 앱(`gnb21c-cmd/astana`)과는 별도로 운용합니다.

```
직원 PC (A: …/a/ 전체 화면, 로그인)                       대표 · 관리자 폰 (B: …/b/<열쇠>/, 로그인 없음)
  네이버 표 · 엑셀 2개 → A 에서 계산 ─(인터넷)─▶ Firebase ─▶ 보고 앱
                                  GitHub(1시간마다) 기상청 날씨 ─▶ ┘
```

| 이름 | 경로            | 있는 곳                              | 하는 일                                                                 |
| ---- | --------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| A    | `apps/entry`    | `https://<프로젝트>.web.app/a/`      | 네이버 시간대 표 · 영수증별 엑셀 읽기 · 반품 지우기 · 계산 · 임시저장 · 올리기 · 지난 자료 넣기 |
| B    | `apps/view`     | `https://<프로젝트>.web.app/b/<열쇠>/` | 대시보드 · 섹터 시간대 그래프 · 4주 분석 · 누계 · 네이버/현장/이벤트     |
| —    | `apps/weather`  | GitHub Actions (1시간마다)           | 기상청 관측 · 예보 → Firebase                                           |
| —    | `packages/core` | (A · B 공통)                         | 계산 규칙 + 시험                                                        |
| —    | `firebase`      | Firebase                             | 보안 규칙 · 화면 올리기 설정                                            |

- 설계 · 계산 규칙 · 정한 것: [docs/PLAN.md](docs/PLAN.md)
- 처음 설정 · 매일 하는 일: [docs/SETUP.md](docs/SETUP.md)

## 명령

- `pnpm install` 뒤 `pnpm test` (core 시험 + 날씨 시험) · `pnpm typecheck`
- `pnpm demo` — 체험판 HTML 두 장: B `apps/view/dist-demo/index.html`(가짜 자료) · A `apps/entry/dist-demo/index.html`(이 브라우저에만 저장)
- `pnpm build:hosting` — 올릴 화면(A · B) 만들기. 올리기는 main 에 올라가면 GitHub **Deploy** 가 저절로
