/* ============================================================
   두 가지 생산계획 견주기 (2026-11-05 사장님) — 11-09 계획부터
   가 = 추세 계획 (같은 요일 추세 그대로 · 만드는 단위만)
   나 = 조정 계획 (사장님 조정: 하루 목표 월 270 → 금 320 · 토 800 · 일 750 · 할인 · 폐기 많은 빵 × 0.9 · 빵별 조정)
   다음 주 판매 실적으로 어느 쪽이 맞았는지 빵마다 · 날마다 견주고, 목요일 주간안이 그 결과로 다음 주를 정함
   - 수요(어림) = 판매 개수 · 저녁 8시 40분(SELL_OUT_TARGET) 전에 다 팔린 빵은 다 팔린 시각까지의 몫을
     그날 같은 요일 빵 시간대 판매 비율로 늘림 (15시에 다 팔렸고 평소 15시까지 하루의 60% 가 팔리면 판매 ÷ 0.6, 판매의 2.5배까지)
   - 어긋남 = |계획 − 생산실패 − 수요| (계획에서 생산실패를 빼야 판매를 시작한 수량 — 두 계획 같게)
     남음 = 계획 − 생산실패 − 수요 (+) · 모자람 = 수요 − (계획 − 생산실패) (+)
   - 판정: 평일 · 휴일 따로, 어긋남 합이 작은 쪽 (3% 안이면 비슷 — 조정 유지) · 빵별 조정 빵은 빵마다 따로
   ============================================================ */
import { breadNewName } from "./breadNames";
import { trendPastDays } from "./breadTrend";
import { dayResult, SELL_OUT_TARGET, snapUnit, type OrderDoc, type PlanDoc, type PlanItem } from "./bakery";
import { dayKind } from "./forecast";
import type { Board } from "./metrics";
import { HOURS } from "./part";

/** 비슷하다고 볼 차이 (어긋남 합의 3%) */
export const VERDICT_TIE = 0.03;
/** 다 팔린 빵 수요를 늘릴 때 최대 배수 · 최소 비율 */
const DEMAND_MAX = 2.5;
const SHARE_MIN = 0.25;

export type PlanMode = "조정" | "추세";

/** 계획 줄의 추세 수량 (가) — 저장된 trend, 없으면(11-09 주 — 처음 셈) 추세 수치(base)를 만드는 단위로 · 새 빵은 어림 그대로 · 매니저 기입은 0 */
export function trendQtyOf(it: PlanItem, date: string): number {
  if (it.trend != null) return it.trend;
  if (it.manual) return 0;
  if (it.est) return it.base ?? it.qty;
  return snapUnit(it.name, it.base ?? it.qty, undefined, undefined, date);
}
/** 계획 줄의 조정 수량 (나) — 저장된 tuned, 없으면 계획 수량 */
export function tunedQtyOf(it: PlanItem): number {
  return it.tuned ?? it.qty;
}

/** 그날 빵 시간대 누적 판매 비율 (지난 4주 같은 요일 · 같은 평일/휴일 평균, 10 ~ 21시 12칸 끝 기준) — 자료가 없으면 null */
export function breadHourShare(board: Board, date: string, asOf: string): number[] | null {
  const days = trendPastDays(board, date, asOf);
  const curves: number[][] = [];
  for (const d of days) {
    const h = board.report(d)?.cafe?.hourly?.sectors?.베이커리;
    const tot = h?.reduce((a, b) => a + Math.max(0, b), 0) ?? 0;
    if (!h || tot <= 0) continue;
    let c = 0;
    curves.push(h.map((v) => (c += Math.max(0, v)) / tot));
  }
  if (!curves.length) return null;
  return HOURS.map((_, i) => curves.reduce((a, c) => a + c[i], 0) / curves.length);
}
/** "HH:MM" 까지 팔린 비율 (칸 안은 분으로 나눔) */
export function shareAt(cum: number[], hm: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(hm || "");
  if (!m) return 1;
  const i = Number(m[1]) - HOURS[0];
  if (i < 0) return 0;
  if (i >= HOURS.length) return 1;
  const before = i > 0 ? cum[i - 1] : 0;
  return before + (cum[i] - before) * (Number(m[2]) / 60);
}

export interface CompareRow {
  name: string;
  /** 가 추세 계획 · 나 조정 계획 · 실제 생산(작업지시) */
  trend: number;
  tuned: number;
  made: number | null;
  fail: number;
  sold: number;
  half: number;
  /** 다 팔린 시각 (저녁 8시 40분 전에 다 팔렸을 때) */
  soldOutAt: string | null;
  /** 어림 수요 */
  demand: number;
  overTrend: number;
  shortTrend: number;
  overTuned: number;
  shortTuned: number;
}
export interface DayCompare {
  date: string;
  kind: "평일" | "휴일";
  rows: CompareRow[];
  trend: number;
  tuned: number;
  sold: number;
  demand: number;
  errTrend: number;
  errTuned: number;
}

/** 그날 두 계획 견주기 — 주간안에 추세 수치가 있는 날(11-09 계획부터) · 그날 판매 자료가 있을 때만 */
export function compareDay(board: Board, date: string, plan: PlanDoc | null | undefined, order: OrderDoc | null | undefined, asOf: string = date): DayCompare | null {
  const week = plan?.week;
  if (!week || week.target == null || !board.report(date)?.cafe) return null;
  const results = new Map(dayResult(board, date, plan, order).map((r) => [r.name, r]));
  const cum = breadHourShare(board, date, asOf);
  const rows: CompareRow[] = [];
  for (const it of week.items) {
    if (it.kitchen) continue;
    const trend = trendQtyOf(it, date);
    const tuned = tunedQtyOf(it);
    if (!trend && !tuned) continue;
    const r = results.get(it.name);
    const made = r?.made ?? null;
    const fail = r?.fail ?? 0;
    const sold = r?.sold ?? 0;
    const avail = made == null ? null : made - fail;
    const early = avail != null && avail > 0 && sold >= avail && r?.last && r.last < SELL_OUT_TARGET ? r.last : null;
    const demand = early && cum ? Math.min(Math.round(sold * DEMAND_MAX), Math.round(sold / Math.max(SHARE_MIN, shareAt(cum, early)))) : sold;
    const gap = (q: number) => q - fail - demand;
    rows.push({ name: it.name, trend, tuned, made, fail, sold, half: r?.half ?? 0, soldOutAt: early, demand, overTrend: Math.max(0, gap(trend)), shortTrend: Math.max(0, -gap(trend)), overTuned: Math.max(0, gap(tuned)), shortTuned: Math.max(0, -gap(tuned)) });
  }
  const sum = (f: (r: CompareRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  return {
    date,
    kind: dayKind(date) === "휴일" ? "휴일" : "평일",
    rows,
    trend: sum((r) => r.trend),
    tuned: sum((r) => r.tuned),
    sold: sum((r) => r.sold),
    demand: sum((r) => r.demand),
    errTrend: sum((r) => r.overTrend + r.shortTrend),
    errTuned: sum((r) => r.overTuned + r.shortTuned),
  };
}

export interface Verdict {
  /** 다음 주에 쓸 계획 */
  mode: PlanMode;
  /** 어긋남 합 (가 추세 · 나 조정) · 견준 날 */
  errTrend: number;
  errTuned: number;
  days: string[];
  /** 비슷해서 조정 유지 */
  tie?: boolean;
}
/** 판정 — 어긋남 합이 작은 쪽 · 3% 안이면 조정 유지 · 견준 날이 없으면 null (지금 쓰는 그대로) */
export function verdictOf(days: DayCompare[]): Verdict | null {
  if (!days.length) return null;
  const errTrend = days.reduce((a, d) => a + d.errTrend, 0);
  const errTuned = days.reduce((a, d) => a + d.errTuned, 0);
  const tie = Math.abs(errTrend - errTuned) <= VERDICT_TIE * Math.max(errTrend, errTuned, 1);
  return { mode: !tie && errTrend < errTuned ? "추세" : "조정", errTrend, errTuned, days: days.map((d) => d.date), ...(tie ? { tie: true } : {}) };
}
/** 빵 하나만 판정 (빵별 조정 빵 — 수수부꾸미 · 옥수수찰빵 · 소금빵 · 에그타르트) — 어긋남이 추세 쪽이 작으면 "추세" */
export function breadVerdictOf(days: DayCompare[], name: string): Verdict | null {
  const key = breadNewName(name);
  const picked = days.map((d) => ({ ...d, rows: d.rows.filter((r) => breadNewName(r.name) === key) })).filter((d) => d.rows.length);
  if (!picked.length) return null;
  return verdictOf(picked.map((d) => ({ ...d, errTrend: d.rows.reduce((a, r) => a + r.overTrend + r.shortTrend, 0), errTuned: d.rows.reduce((a, r) => a + r.overTuned + r.shortTuned, 0) })));
}
