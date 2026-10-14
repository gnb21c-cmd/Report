# 설문조사 — 통합데스크 → 보고 앱 (2026-10-14)

아스타나키즈 통합데스크(`gnb21c-cmd/astanakiz`, **1.38** 에서 시작 — 2026-10-14 main · 설치본 v1.38)가 손님에게 묻는 설문(예: "아스타나키즈를 어떻게 알게 되었나요")의
**항목별 응답 수**를 보고 앱 첫 화면 '설문조사' 칸에 보여 준다. 통합데스크 쪽 설명은 astanakiz `docs/SHARE.md` 3장.

## 흐름
1. 통합데스크가 **매일 20:00** POS PC 데스크 폴더에 그날까지의 기간 누적을 남긴다
   - `%APPDATA%\아스타나키즈 입장 데스크\report-outbox\survey-YYYY-MM-DD.json` (손님 이름 · 전화번호 없음)
   - 통합데스크 설정의 '보고앱 주소'(POST)는 보고 시스템에 받을 서버가 없어 **비워 둠** — 보고 시스템이 위 파일을 직접 읽음
2. 보고 시스템 마감 전 수집(`.github/workflows/live-collect.yml`, POS 메인 PC, 30분마다 10:15 ~ 22:45)의 마지막 단계가
   그 폴더의 `survey-*.json` 을 모두 읽어 **설문마다 가장 최근 날**의 누적을 클라우드 `boards/{열쇠}/settings/surveys` 에 올린다
   (`apps/collector/src/survey.ts` → `packages/core/src/survey.ts surveysFromDesk`, 바뀌었을 때만) → 20:00 파일은 보통 20:15 ~ 20:45 실행에서 올라감
3. 보고 앱 첫 화면: 카페 소비 인원 · 1인 평균소비 · **설문조사** 세 칸 — '현재 진행중 N건'
   - 누르면 설문마다 기간 · 대상 · 응답 수 · 제외 수, 항목은 **순위 순(응답이 가장 많은 것이 1위로 맨 위)** · 응답 수 · %
   - % = 항목 응답 ÷ 응답 합(제외 빼고) × 100, 소수 한 자리 반올림 (같은 응답 수는 늘 같은 % — 더하면 100% 에서 0.1 정도 다를 수 있음)
   - 설문은 진행 중인 것이 위, 그 안에서 최근 시작한 것이 맨 위 · 시작 전 · 끝난 설문은 아래

## 통합데스크 보고 파일 (`survey-YYYY-MM-DD.json`)
```jsonc
{ "type": "astanakiz-survey", "v": 1, "day": "2026-11-01", "sentAt": "2026-11-01 20:00",
  "question": "아스타나키즈를 어떻게 알게 되었나요", "period": { "from": "2026-11-01", "to": "2026-11-30" },
  "targets": { "naverNew": true, "walkin": false, "all": false },     // 신규고객 · 현장구매자 · 전체고객
  "options": [ { "no": 1, "label": "네이버 검색", "today": 3, "total": 12 }, … ],   // 번호별 오늘 · 기간 누적
  "excluded": { "today": 2, "total": 5 }, "answered": { "today": 10, "total": 40 } }
```
- 같은 설문 = `question` 과 `period.from` 이 같은 것 (날마다 파일이 하나씩 쌓임 → 가장 최근 `day` 의 `total` 을 씀)
- 이름이 비고 응답이 0 인 선택지는 뺌 · 모양이 틀린 파일은 건너뜀 (`type` · `day` · `question` · `period.from` · `options`)
- 진행 중 = `period.from` ≤ 오늘 ≤ `period.to`

## 클라우드 모양 (`settings/surveys` 의 `json`)
```jsonc
{ "v": 1, "at": "2026-11-01 20:00",
  "surveys": [ { "id": "desk-2026-11-01-…", "title": "…", "from": "2026-11-01", "to": "2026-11-30",
                 "options": [ { "no": 1, "label": "네이버 검색", "n": 12 } ],
                 "asOf": "2026-11-01", "answered": 40, "excluded": 5, "todayAnswered": 10, "targets": ["신규고객"] } ] }
```
- 공개 저장소의 수집 기록에는 파일 수 · 설문 수 · 항목 수만 남김 (설문 내용 · 응답 수 없음)
