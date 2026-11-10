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
