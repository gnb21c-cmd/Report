# report — 아스타나 카페 일일 매출 보고 시스템

사무실 직원이 전날 마감 자료(네이버 예약 표 · 영수증별 매출 엑셀)를 넣으면, 대표이사 · 관리자 4명이 폰에서 **마감일 기준 보고**를 언제든 보는 내부용 시스템입니다.
따로 운영하는 서버는 없습니다. 사무실에 24시간 켜 둔 PC 한 대(C)가 서버 역할을 하고, 폰으로는 Google Firebase 를 우편함으로 써서 전합니다. 아스타나 앱(`gnb21c-cmd/astana`)과는 별도로 운용합니다.

```
직원 PC 1~5대 (A: 전체 화면 입력)                 사무실 PC (C: 24시간)                       대표 · 관리자 폰 (B)
  네이버 표 · 엑셀 2개 → A 에서 계산 ─(사무실 공유기)─▶ 받기 · 날짜별 합치기 · 날씨 ─(인터넷)─▶ Firebase ─▶ 보고 앱
                                                       └ 사무실 안에서는 http://C:8770/b/ 로 바로 보기
```

| 이름 | 경로            | 있는 곳                                  | 하는 일                                                                 |
| ---- | --------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| A    | `apps/entry`    | C 가 보여 주는 웹 화면 (직원 PC 아이콘)  | 네이버 시간대 표 · 영수증별 엑셀 읽기 · 반품 지우기 · 계산 · 임시저장 · 업로드 |
| C    | `apps/office`   | 사무실 PC 한 대 (Windows, 늘 켜 둠)      | A · B 화면 제공, 받은 자료 보관 · 합치기, 클라우드 올리기, 기상청 날씨   |
| B    | `apps/view`     | 볼 사람 폰 (설치형 웹앱)                 | 대시보드 · 섹터 시간대 그래프 · 4주 분석 · 누계 · 네이버/현장/이벤트     |
| —    | `packages/core` | (A · B 공통)                             | 계산 규칙 + 시험                                                        |
| —    | `firebase`      | Firebase 콘솔                            | 보안 규칙                                                               |

- 설계 · 계산 규칙 · 정한 것: [docs/PLAN.md](docs/PLAN.md)
- 처음 설정 · 설치 · 매일 하는 일: [docs/SETUP.md](docs/SETUP.md)

## 명령

- `pnpm install` 뒤 `pnpm test` (core 시험 + C 시험) · `pnpm typecheck`
- `pnpm demo` — 체험판 HTML 두 장: B `apps/view/dist-demo/index.html`(가짜 자료) · A `apps/entry/dist-demo/index.html`(C 없이 이 브라우저에만 저장)
- `pnpm office` — 이 컴퓨터에서 C 를 시험 모드로 띄움 (http://localhost:8770/ · /b/)
- C 설치 묶음: GitHub Actions **Build office** → `pos-report-office`
