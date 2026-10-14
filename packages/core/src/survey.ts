/* ============================================================
   설문조사 — 아스타나키즈 통합데스크(gnb21c-cmd/astanakiz)가 손님에게 묻는 설문의 집계 (2026-10-14 사장님)
   - 통합데스크(1.38~)가 매일 20:00 POS PC 데스크 폴더 report-outbox\survey-날짜.json 에 그날까지의 기간 누적을 남김
     (질문 하나 · 기간 · 대상 · 번호별 오늘 · 누적 · 제외 · 응답 수 — 손님 이름 · 전화 없음, astanakiz docs/SHARE.md 3장)
   - POS 메인 PC 의 마감 전 수집(live-collect)이 그 파일들을 읽어(설문마다 가장 최근 날) 클라우드 settings/surveys 에 올림 (apps/collector/src/survey.ts)
   - 보고 앱 첫 화면 '설문조사' 칸: 현재 진행 중 N건 → 누르면 설문마다 항목 · 응답 수 · %(응답 합 = 100%)
     항목은 순위 순(응답이 많은 것이 1위로 맨 위), 설문은 진행 중인 것이 위 · 그 안에서 최근 시작한 것이 맨 위
   파일 모양은 docs/SURVEY.md
   ============================================================ */
import { addDays } from "./dates";

/** POS PC 데스크 폴더(%APPDATA%\아스타나키즈 입장 데스크\) 안 설문 보고 폴더 · 파일 이름 */
export const SURVEY_OUTBOX = "report-outbox";
export const SURVEY_FILE_RE = /^survey-.*\.json$/i;

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
  /** 통합데스크 보고 — 누적 기준 날 · 응답 수 · 제외 수 · 그날 응답 수 · 대상 (신규고객 · 현장구매자 · 전체고객) */
  asOf?: string;
  answered?: number;
  excluded?: number;
  todayAnswered?: number;
  targets?: string[];
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
    const sv: Survey = { id, title, from: r.from, to, options };
    const cnt = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);
    if (isDate(r.asOf)) sv.asOf = r.asOf;
    for (const k of ["answered", "excluded", "todayAnswered"] as const) {
      const v = cnt(r[k]);
      if (v !== undefined) sv[k] = v;
    }
    if (Array.isArray(r.targets)) sv.targets = r.targets.map((t) => text(t, 20)).filter(Boolean).slice(0, 5);
    surveys.push(sv);
  }
  return { v: 1, at: typeof o.at === "string" ? o.at.slice(0, 40) : "", surveys };
}

/** 통합데스크 report-outbox\survey-날짜.json 들 → 설문 묶음 (질문 · 기간 시작일이 같으면 같은 설문, 가장 최근 날의 누적, 맞는 파일이 없으면 null)
    빈 선택지(이름 없고 응답 0)는 뺌 · 손님 정보는 원래 없음 */
export function surveysFromDesk(files: unknown[]): SurveyDoc | null {
  const latest = new Map<string, Record<string, any>>();
  for (const f of files) {
    if (!f || typeof f !== "object") continue;
    const o = f as Record<string, any>;
    const question = text(o.question, 120);
    if (o.type !== "astanakiz-survey" || !isDate(o.day) || !question || !o.period || !isDate(o.period.from) || !Array.isArray(o.options)) continue;
    const key = `${o.period.from}|${question}`;
    const had = latest.get(key);
    if (!had || o.day > had.day || (o.day === had.day && String(o.sentAt || "") > String(had.sentAt || ""))) latest.set(key, o);
  }
  if (!latest.size) return null;
  const hash = (t: string) => {
    let h = 5381;
    for (const ch of t) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
    return h.toString(36);
  };
  const T: [string, string][] = [["naverNew", "신규고객"], ["walkin", "현장구매자"], ["all", "전체고객"]];
  let at = "";
  const raw = [...latest.values()].map((o) => {
    if (String(o.sentAt || "") > at) at = String(o.sentAt || "");
    const question = text(o.question, 120);
    return {
      id: `desk-${o.period.from}-${hash(question)}`,
      title: question,
      from: o.period.from,
      to: isDate(o.period.to) ? o.period.to : null,
      options: (o.options as any[])
        .filter((x) => x && (text(x.label, 80) || Number(x.total) > 0))
        .map((x) => ({ no: x.no, label: text(x.label, 80) || `${x.no}번`, n: x.total })),
      asOf: o.day,
      answered: o.answered?.total,
      excluded: o.excluded?.total,
      todayAnswered: o.answered?.today,
      targets: T.filter(([k]) => o.targets?.[k]).map(([, v]) => v),
    };
  });
  return cleanSurveys({ v: 1, at, surveys: raw });
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

/** 항목별 % (소수 한 자리) — 응답 합을 100% 로 항목마다 반올림. 같은 응답 수는 늘 같은 % (더하면 100% 에서 0.1 정도 다를 수 있음) */
export function surveyShares(options: SurveyOption[]): number[] {
  const total = options.reduce((a, o) => a + o.n, 0);
  return options.map((o) => (total ? Math.round((o.n / total) * 1000 + 1e-9) / 10 : 0));
}

/** 보여 줄 순서 — 응답이 많은 항목이 1위로 맨 위 (2026-10-14 사장님), 같은 수는 같은 순위 · 번호 순 */
export function surveyRanked(options: SurveyOption[]): (SurveyOption & { rank: number; share: number })[] {
  const shares = surveyShares(options);
  const rows = options.map((o, i) => ({ ...o, share: shares[i], rank: 0 })).sort((a, b) => b.n - a.n || a.no - b.no);
  rows.forEach((r, i) => (r.rank = i > 0 && rows[i - 1].n === r.n ? rows[i - 1].rank : i + 1));
  return rows;
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
        to: addDays(today, 25),
        targets: ["신규고객", "현장구매자"],
        answered: 104,
        excluded: 9,
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
        targets: ["전체고객"],
        answered: 158,
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
