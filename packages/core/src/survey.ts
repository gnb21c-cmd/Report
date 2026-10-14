/* ============================================================
   설문조사 — 아스타나키즈 통합데스크(gnb21c-cmd/astanakiz)가 손님에게 묻는 설문의 집계 (2026-10-14 사장님)
   - 통합데스크가 매일 20시에 POS PC 데스크 폴더에 집계 파일을 남김 (SURVEY_FILE) — 항목별 응답 수만, 손님 이름 · 전화 없음
   - POS 메인 PC 의 마감 전 수집(live-collect)이 그 파일을 읽어 클라우드 settings/surveys 에 올림 (apps/collector/src/survey.ts)
   - 보고 앱 첫 화면 '설문조사' 칸: 현재 진행 중 N건 → 누르면 설문마다 항목(번호 · 내용) · 응답 수 · %(합 100%)
     진행 중인 설문이 위, 그 안에서 최근 시작한 것이 맨 위 (다른 설문을 더해도 같은 순서)
   파일 모양은 docs/SURVEY.md
   ============================================================ */
import { addDays } from "./dates";

/** POS PC 데스크 폴더(%APPDATA%\아스타나키즈 입장 데스크\) 안 파일 이름 */
export const SURVEY_FILE = "survey-state.json";

export interface SurveyOption {
  /** 화면에 보이는 번호 (1, 2, 3 …) */
  no: number;
  label: string;
  /** 응답 수 */
  n: number;
}
export interface Survey {
  /** 설문 이름표 (바뀌지 않음) */
  id: string;
  title: string;
  /** 시작일 YYYY-MM-DD */
  from: string;
  /** 끝일 (진행 중이면 null) */
  to: string | null;
  options: SurveyOption[];
}
export interface SurveyDoc {
  v: 1;
  /** 통합데스크가 집계한 시각 */
  at: string;
  surveys: Survey[];
}

const isDate = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x);
const text = (x: unknown, max: number) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** 받은 값 → 설문 묶음 (모양이 틀린 설문 · 항목은 뺌, 전체가 틀리면 null) */
export function cleanSurveys(x: unknown): SurveyDoc | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o.surveys)) return null;
  const seen = new Set<string>();
  const surveys: Survey[] = [];
  for (const raw of o.surveys) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = text(r.id, 60);
    const title = text(r.title, 120);
    if (!id || !title || seen.has(id) || !isDate(r.from)) continue;
    seen.add(id);
    const to = isDate(r.to) ? r.to : null;
    const options: SurveyOption[] = [];
    const nos = new Set<number>();
    for (const op of Array.isArray(r.options) ? r.options : []) {
      if (!op || typeof op !== "object") continue;
      const p = op as Record<string, unknown>;
      const no = Math.round(Number(p.no));
      const label = text(p.label, 80);
      if (!Number.isFinite(no) || no < 0 || !label || nos.has(no)) continue;
      nos.add(no);
      const n = Number(p.n);
      options.push({ no, label, n: Number.isFinite(n) && n > 0 ? Math.round(n) : 0 });
    }
    options.sort((a, b) => a.no - b.no);
    surveys.push({ id, title, from: r.from, to, options });
  }
  return { v: 1, at: typeof o.at === "string" ? o.at.slice(0, 40) : "", surveys };
}

/** 그날 진행 중인지 — 시작일 ~ 끝일(없으면 계속) */
export const surveyOpen = (s: Survey, today: string) => s.from <= today && (!s.to || s.to >= today);

/** 보여 줄 순서 — 진행 중인 것이 위, 그 안에서 최근 시작한 것이 맨 위 · 시작 전 · 끝난 것은 아래 (역시 최근 것 먼저) */
export function surveyList(doc: SurveyDoc | null, today: string): { survey: Survey; open: boolean }[] {
  if (!doc) return [];
  return doc.surveys
    .map((survey) => ({ survey, open: surveyOpen(survey, today) }))
    .sort((a, b) => Number(b.open) - Number(a.open) || (a.survey.from < b.survey.from ? 1 : a.survey.from > b.survey.from ? -1 : a.survey.id.localeCompare(b.survey.id)));
}

/** 항목별 % (소수 한 자리) — 응답 합을 100% 로, 버림한 뒤 남는 0.1 은 나머지가 큰 항목부터 더해 합이 꼭 100.0 */
export function surveyShares(options: SurveyOption[]): number[] {
  const total = options.reduce((a, o) => a + o.n, 0);
  if (!total) return options.map(() => 0);
  const raw = options.map((o) => (o.n / total) * 1000);
  const base = raw.map((x) => Math.floor(x + 1e-9));
  let left = 1000 - base.reduce((a, x) => a + x, 0);
  const order = raw.map((x, i) => ({ i, r: x - base[i] })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    base[i]++;
    left--;
  }
  return base.map((x) => x / 10);
}

/** 체험판 설문 (가짜) — 보고 앱 체험판 · 시험. 날짜는 today 기준 (진행 중 2건 · 끝난 1건) */
export const SURVEY_SAMPLE_TODAY = "2026-10-20";
export function sampleSurveys(today: string = SURVEY_SAMPLE_TODAY): SurveyDoc {
  return {
    v: 1,
    at: `${addDays(today, -1)}T20:00:00+09:00`,
    surveys: [
      {
        id: "how-know",
        title: "아스타나키즈를 어떻게 알게 되셨나요?",
        from: addDays(today, -5),
        to: null,
        options: [
          { no: 1, label: "네이버 검색 · 지도", n: 46 },
          { no: 2, label: "인스타그램", n: 21 },
          { no: 3, label: "지인 소개", n: 17 },
          { no: 4, label: "맘카페 · 블로그", n: 11 },
          { no: 5, label: "지나가다 · 간판", n: 6 },
          { no: 6, label: "기타", n: 3 },
        ],
      },
      {
        id: "kids-age",
        title: "함께 온 아이 나이는?",
        from: addDays(today, -12),
        to: null,
        options: [
          { no: 1, label: "3세 이하", n: 38 },
          { no: 2, label: "4 ~ 6세", n: 71 },
          { no: 3, label: "7 ~ 9세", n: 40 },
          { no: 4, label: "10세 이상", n: 9 },
        ],
      },
      {
        id: "visit-again",
        title: "다음에 또 오실 건가요?",
        from: addDays(today, -30),
        to: addDays(today, -13),
        options: [
          { no: 1, label: "네, 꼭 올게요", n: 58 },
          { no: 2, label: "가끔 올 것 같아요", n: 27 },
          { no: 3, label: "잘 모르겠어요", n: 5 },
        ],
      },
    ],
  };
}
