# report — 매장 POS 일일 보고 시스템

카페 메인 POS · 키즈 POS(OK포스)의 매출을 마감 때 보내, 대표이사·관리자 4명이 폰에서 **어제 마감 기준 보고**를 언제든 보는 내부용 시스템입니다. 폰 앱은 로그인 없이 설치 주소로 엽니다.
우리가 운영하는 서버는 없고, Google Firebase 를 우편함으로 씁니다. 아스타나 앱(`gnb21c-cmd/astana`)과는 별도로 운용합니다.

| 이름 | 경로            | 설치 위치                      | 하는 일                                         |
| ---- | --------------- | ------------------------------ | ----------------------------------------------- |
| A    | `apps/sender`   | 카페 메인 POS · 키즈 POS (Windows) | POS 매출 읽기(엑셀 폴더 · Firebird) → 보내기   |
| B    | `apps/view`     | 볼 사람 폰 (설치형 웹앱)       | 달력 · 대시보드 · 추세 그래프 · 분석 설명       |
| —    | `packages/core` | (A·B 공통 모양, B 의 계산)     | 보고 계산 규칙 + 시험                           |
| —    | `firebase`      | Firebase 콘솔                  | 보안 규칙                                       |

- 검토 · 계획 · 정한 것: [docs/PLAN.md](docs/PLAN.md)
- 처음 설정 · 설치 · 마감 절차: [docs/SETUP.md](docs/SETUP.md)

## 명령

- `pnpm install` 뒤 `pnpm test` (core 시험 + A 시험) · `pnpm typecheck`
- `pnpm dev` — B 개발 화면 (Firebase 값이 없으면 '설정 필요')
- `pnpm demo` — 체험판 HTML (`apps/view/dist-demo/index.html`, 가짜 자료)
- A 설치 묶음: GitHub Actions **Build sender**
