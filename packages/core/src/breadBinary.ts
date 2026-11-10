/* ============================================================
   빵 예측 — 반반(바이너리) 규칙 (2026-11-10 사장님, 11-12 목 발표 주간안 = 11-16 계획부터)
   - 목요일에 다음 주 월 ~ 일을 발표할 때 빵마다
       발표 = 반올림((지난 같은 요일 판매 + 추세) ÷ 2)  → 만드는 단위(몽블랑 5 · 시나몬롤 10 …)
     지난 판매에서 추세 쪽으로 차이의 반만 움직임 — 늘릴 때도 줄일 때도 보수적으로
     예) 남음 7 · 추세 12 → 9.5 → 10 / 매진 10 · 추세 12 → 11 / 매진 10 · 추세 8 → 9
   - 추세 = 지금까지의 같은 요일 추세(breadTrend.ts trendDay — 작년 '오늘' 앞뒤 4주 같은 요일 추세선 × 올해 지난 4주 같은 요일 판매)
   - 지난 같은 요일 = 발표 때 이미 끝난 가장 최근 같은 요일 · 같은 평일/휴일 (trendPastDays 의 첫째)
       다음 주 월 ~ 수 → 이번 주 월 ~ 수 (1주 전 목요일 발표분) · 목 ~ 일 → 지난주 목 ~ 일 (2주 전 목요일 발표분)
   - 지난 판매 = 정가 + 할인 × 0.5 — 웬만하면 할인까지 갈 필요는 없지만 정가로 팔 수량이 너무 빨리 없어져도 안 됨
     매진된 날은 판 개수 그대로 · 그 요일에 안 판 빵은 추세 그대로 · 새 빵(판매 28일이 안 됨)은 예전처럼 어림 · 매니저 기입
   - 하루 목표 · 빵별 더하기(수수부꾸미 · 옥수수찰빵 +2 · 소금빵 −4) · 정한 수량(에그타르트 10 · 35) · 할인 많은 빵 × 0.9 ·
     두 계획 견주기는 그만 (사장님 '가' — 반씩 움직이는 것 자체가 보수적인 조정)
   - 적중률 — 목요일마다 지난주 목 ~ 일(2주 전 발표) + 이번 주 월 ~ 수(1주 전 발표)의 발표 수량을 실제 판매 수요와 견줌
       적중률 = 1 − Σ|발표 − 수요| ÷ Σ수요 (수요 = 정가 + 할인 × 0.5) → 100% 에 다가가게 계속 적용
   ============================================================ */
import { breadSold, renameSum } from "./breadNames";
import { addDays, dayRange } from "./dates";
import type { Board } from "./metrics";
import type { PlanDoc } from "./bakery";

/** 반반 규칙으로 세는 첫 계획 날 (11-12 목 발표 주간안부터 — 그 전 주는 이미 발표한 그대로) */
export const BINARY_FROM = "2026-11-16";
/** 지난 판매에 할인 판매를 얼마만큼 셀지 */
export const HALF_WEIGHT = 0.5;
/** 적중률 빵별 목록 — 많이 어긋난 빵부터 이만큼 */
export const HIT_TOP = 10;

/* ---------- 기온 미세 조정 (2026-11-10 사장님) ----------
   다음 주 그날 예보 최고 기온이 28도 이상(더운 날) 또는 15도 이하(추운 날)면 반반 결과 × 110% → 반올림 → 만드는 단위
   (2025 수원: 최고 28 이상 84일 · 15 이하 136일 — 12 ~ 2월은 거의 매일). 빵 생산량은 ① 추세 반반 ② 기온 미세 조정 두 가지로만
   예보 = 기상청 중기 기온예보(수원 11B20601, 06 · 18시 발표, 4 ~ 10일 뒤) — 목요일 새벽 계산 때는 수요일 18시 발표라 다음 주 일요일이 빠짐
   → 그날은 반반 그대로 '기다림'(pending), 목요일 낮 계산(06:41 · 14:35 · 15:20)이 목요일 06시 발표로 채움 (매니저가 잠정 확정하기 전인 날만) */
export const TEMP_UP = 1.1;
/** 더운 날 — 예보 최고 기온 이만큼 이상 */
export const TEMP_HOT = 28;
/** 추운 날 — 예보 최고 기온 이만큼 이하 */
export const TEMP_COLD = 15;
/** 기상청 중기 기온예보 지역 — 수원 */
export const MID_TA_REGION = "11B20601";

/** 그날 예보 기온 (중기예보 발표 tmFc = YYYYMMDDHHMM) */
export interface MidTemp {
  max: number | null;
  min: number | null;
  tmFc: string;
}

/** 예보 최고 기온 → 기온 조정 (아니면 null) */
export function tempUpOf(max: number | null | undefined): { up: number; why: "더움" | "추움" } | null {
  if (max == null || !Number.isFinite(max)) return null;
  if (max >= TEMP_HOT) return { up: TEMP_UP, why: "더움" };
  if (max <= TEMP_COLD) return { up: TEMP_UP, why: "추움" };
  return null;
}

/** 중기 기온예보 한 줄(getMidTa item) → 날짜마다 최저 · 최고 (발표 날 + N일, taMinN · taMaxN). 빈 칸은 뺌 */
export function parseMidTa(item: Record<string, unknown> | null | undefined, tmFc: string): Record<string, MidTemp> {
  const out: Record<string, MidTemp> = {};
  if (!item || !/^\d{12}$/.test(tmFc)) return out;
  const base = `${tmFc.slice(0, 4)}-${tmFc.slice(4, 6)}-${tmFc.slice(6, 8)}`;
  const num = (v: unknown): number | null => {
    const x = typeof v === "string" ? (v.trim() === "" ? NaN : Number(v)) : typeof v === "number" ? v : NaN;
    return Number.isFinite(x) ? x : null;
  };
  for (const k of Object.keys(item)) {
    const m = /^taMax(\d+)$/.exec(k);
    if (!m) continue;
    const n = Number(m[1]);
    const max = num(item[k]);
    if (max == null || n < 1 || n > 14) continue;
    out[addDays(base, n)] = { max, min: num(item[`taMin${n}`]), tmFc };
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** 지난 판매(수요) = 정가 + 할인 × 0.5 */
export const demandOf = (full: number, half: number): number => full + half * HALF_WEIGHT;

/** 반반 — 지난 판매와 추세의 가운데를 반올림 (0.5 는 올림) */
export const halfway = (last: number, trend: number): number => Math.max(0, Math.round((last + trend) / 2 + 1e-9));

/** 그날(d) 빵마다 정가 · 할인 · 수요 — 이름은 계획 날(date) 기준 (판매가 마이너스면 0) */
export function demandOn(board: Board, d: string, date: string = d): Map<string, { full: number; half: number; demand: number }> {
  const sold = breadSold(board, d, date);
  const halfBy = renameSum(board.report(d)?.cafe?.bakeryHalfBy || {}, date);
  const out = new Map<string, { full: number; half: number; demand: number }>();
  for (const [name, q] of sold) {
    const s = Math.max(0, q);
    const h = Math.max(0, Math.min(s, halfBy[name] || 0));
    out.set(name, { full: s - h, half: h, demand: demandOf(s - h, h) });
  }
  return out;
}

export interface HitBread {
  name: string;
  /** 발표 수량 */
  plan: number;
  /** 실제 판매 수요 (정가 + 할인 × 0.5) */
  demand: number;
  /** |발표 − 수요| */
  miss: number;
}
export interface HitDay {
  date: string;
  /** 발표한 목요일 */
  madeOn: string;
  plan: number;
  demand: number;
  miss: number;
  /** 1 − 어긋남 ÷ 수요 (수요가 0 이면 null) */
  rate: number | null;
  breads: HitBread[];
}
export interface HitReport {
  /** 견준 7일 (목 ~ 수) */
  from: string;
  to: string;
  days: HitDay[];
  plan: number;
  demand: number;
  miss: number;
  rate: number | null;
  /** 많이 어긋난 빵부터 (HIT_TOP 개) */
  breads: HitBread[];
}

const rateOf = (miss: number, demand: number): number | null => (demand > 0 ? Math.max(0, 1 - miss / demand) : null);
const r1 = (x: number) => Math.round(x * 10) / 10;

/** 그날 발표(주간 잠정안) 수량 대 실제 판매 수요 — 매니저 기입 0 · 키친용은 뺌. 판매 자료나 발표가 없으면 null */
export function hitDay(board: Board, date: string, plan: PlanDoc | null | undefined): HitDay | null {
  const week = plan?.week;
  if (!week || !board.report(date)?.cafe) return null;
  const dem = demandOn(board, date, date);
  const breads: HitBread[] = [];
  for (const it of week.items) {
    if (it.kitchen || it.qty <= 0 || /키친용/.test(it.name)) continue;
    const demand = r1(dem.get(it.name)?.demand ?? 0);
    breads.push({ name: it.name, plan: it.qty, demand, miss: r1(Math.abs(it.qty - demand)) });
  }
  if (!breads.length) return null;
  const sum = (f: (b: HitBread) => number) => r1(breads.reduce((a, b) => a + f(b), 0));
  const p = sum((b) => b.plan), d = sum((b) => b.demand), m = sum((b) => b.miss);
  return { date, madeOn: week.madeOn, plan: p, demand: d, miss: m, rate: rateOf(m, d), breads };
}

/** 목요일 발표 때 견주는 7일 — 지난주 목 ~ 일 + 이번 주 월 ~ 수 */
export const hitWeekDays = (thursday: string): string[] => dayRange(addDays(thursday, -7), addDays(thursday, -1));

/** 한 주 적중률 (목요일 발표 때) — docs = 날짜 → 그날 계획. 견줄 날이 하나도 없으면 null */
export function hitReport(board: Board, thursday: string, docs: (date: string) => PlanDoc | null | undefined): HitReport | null {
  const days = hitWeekDays(thursday)
    .map((d) => hitDay(board, d, docs(d)))
    .filter((x): x is HitDay => !!x);
  if (!days.length) return null;
  const by = new Map<string, HitBread>();
  for (const d of days)
    for (const b of d.breads) {
      const a = by.get(b.name) || { name: b.name, plan: 0, demand: 0, miss: 0 };
      by.set(b.name, { name: b.name, plan: r1(a.plan + b.plan), demand: r1(a.demand + b.demand), miss: r1(a.miss + b.miss) });
    }
  const sum = (f: (d: HitDay) => number) => r1(days.reduce((a, d) => a + f(d), 0));
  const p = sum((d) => d.plan), dm = sum((d) => d.demand), m = sum((d) => d.miss);
  const all = hitWeekDays(thursday);
  return {
    from: all[0],
    to: all[all.length - 1],
    days,
    plan: p,
    demand: dm,
    miss: m,
    rate: rateOf(m, dm),
    breads: [...by.values()].sort((a, b) => b.miss - a.miss || a.name.localeCompare(b.name, "ko")).slice(0, HIT_TOP),
  };
}
