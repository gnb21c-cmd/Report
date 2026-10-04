/* ============================================================
   베이커리 작업지시 — 계획(plans) · 확정(orders) 문서와 그 규칙 (D 매니저 앱 · D-1 현장 태블릿 · 14시 예약 작업이 함께 씀)
   - 매일 14시 (전날 밤 22:10 수집 실적의 오차를 보정): 내일(확정안) · 모레(잠정 ±5%) · 글피(잠정 ±10%) 계획을 새로 셈 → plans/{날짜}
     어제 알려 준 범위를 벗어나지 않게 묶음: 어제 글피(±10%)였던 날은 오늘 그 범위 안, 어제 모레(±5%)였던 날은 그 범위 안
   - 매니저는 내일 생산량을 18시 전에 확정 (빵마다 또는 한꺼번에) → orders/{날짜}
   - 생산 = 확정 수량 (확정 안 한 빵은 18시가 지나면 계획 수량을 그대로 '자동'), 폐기 = 생산 − 판매
   ============================================================ */
import { addDays } from "./dates";
import { breadPlan, weeklyOutlook, withinBand, type DayKind, type Learned } from "./forecast";
import type { Board } from "./metrics";
import type { WeatherMap } from "./weather";

/** 계획을 새로 세는 시각 (한국 시간) */
export const PLAN_HOUR = 14;
/** 매니저 확정 마감 (한국 시간) */
export const CONFIRM_DEADLINE = "18:00";
/** 며칠 앞 → 범위 (1 = 내일 확정안, 2 = 모레 ±5%, 3 = 글피 ±10%) */
export const STAGE_BAND: Record<number, number> = { 1: 0, 2: 0.05, 3: 0.1 };
export const STAGE_LABEL: Record<number, string> = { 1: "확정안", 2: "잠정 ±5%", 3: "잠정 ±10%" };

export interface PlanItem {
  name: string;
  qty: number;
  /** 보정 배수 (1 이 아니면 지난 결과로 고친 것) */
  adj?: number;
  /** 보정 전 예측 수량 (다음 보정의 기준 — 보정이 되풀이해 쌓이지 않게) */
  base?: number;
  /** 잠정일 때 알려 주는 범위 */
  lo?: number;
  hi?: number;
}

export interface Outlook {
  week: number;
  from: string;
  to: string;
  weekday: number | null;
  holiday: number | null;
}

export interface PlanDoc {
  v: 1;
  date: string;
  /** 센 날 (한국 날짜) */
  madeOn: string;
  /** 며칠 앞 (1 · 2 · 3) */
  stage: number;
  kind: DayKind;
  /** 예상 손님 (명) */
  visitors: number;
  /** 날씨 칸 (모르면 '모름') */
  weather: string;
  items: PlanItem[];
  total: number;
  /** 센 날마다 빵별 수량 — 다음 날 범위 묶기에 씀 (최근 3번) */
  history: Record<string, Record<string, number>>;
  /** 내일 계획에만: 앞으로 1 ~ 4주차 평일 · 휴일 하루 생산 개수 */
  outlook?: Outlook[];
}

export interface OrderLine {
  qty: number;
  by: string;
  at: string;
}
export interface OrderDoc {
  v: 1;
  date: string;
  items: Record<string, OrderLine>;
}

/** 오늘(14시) 계획 세 장 — prev(날짜) = 이미 있던 계획 (범위 묶기) */
export function makePlans(
  board: Board,
  weather: WeatherMap,
  learned: Learned,
  today: string,
  asOf: string,
  prev: (date: string) => PlanDoc | undefined,
  /** 빵별 보정 배수 (지난 생산 대비 정가 판매 — corrections) */
  corr: Record<string, number> = {},
): PlanDoc[] {
  const out: PlanDoc[] = [];
  for (const stage of [1, 2, 3]) {
    const date = addDays(today, stage);
    const p = breadPlan(board, weather, asOf, date, learned);
    const old = prev(date);
    // 어제 알려 준 수량 · 범위 (어제는 stage + 1 이었음)
    const yesterday = old?.history?.[addDays(today, -1)];
    const yBand = STAGE_BAND[stage + 1] ?? 0;
    const items: PlanItem[] = p.items.map((it) => {
      let qty = Math.round(it.qty * (corr[it.name] ?? 1));
      const y = yesterday?.[it.name];
      if (y != null && yBand > 0) qty = withinBand(y, qty, yBand);
      const band = STAGE_BAND[stage];
      const adj = corr[it.name] != null && Math.abs(corr[it.name] - 1) >= 0.005 ? Math.round(corr[it.name] * 100) / 100 : undefined;
      const base = { name: it.name, qty, base: it.qty, ...(adj ? { adj } : {}) };
      return band ? { ...base, lo: Math.floor(qty * (1 - band)), hi: Math.ceil(qty * (1 + band)) } : base;
    });
    const history = { ...(old?.history || {}), [today]: Object.fromEntries(items.map((i) => [i.name, i.qty])) };
    for (const k of Object.keys(history).sort().slice(0, -3)) delete history[k];
    out.push({
      v: 1,
      date,
      madeOn: today,
      stage,
      kind: p.visitors.kind,
      visitors: p.visitors.value,
      weather: p.visitors.weather.cls,
      items,
      total: items.reduce((a, b) => a + b.qty, 0),
      history,
      ...(stage === 1 ? { outlook: weeklyOutlook(board, asOf, addDays(today, 1), learned) } : {}),
    });
  }
  return out;
}

export type OrderState = "확정" | "자동" | "확정 전";
export interface OrderRow {
  name: string;
  /** 계획 수량 */
  plan: number;
  /** 매니저가 확정한 수량 */
  confirmed: number | null;
  /** 만들 수량 (확정 · 자동) — 확정 전이면 null */
  qty: number | null;
  state: OrderState;
}

/** 그날 만들 목록 — 확정한 빵은 확정 수량, 안 한 빵은 마감(전날 18시)이 지나면 계획 수량 '자동' */
export function orderRows(plan: PlanDoc | null | undefined, order: OrderDoc | null | undefined, nowKst: { date: string; time: string }): OrderRow[] {
  const date = plan?.date || order?.date || "";
  if (!date) return [];
  const pastDeadline = nowKst.date > addDays(date, -1) || (nowKst.date === addDays(date, -1) && nowKst.time >= CONFIRM_DEADLINE);
  const names = new Map<string, number>();
  for (const it of plan?.items || []) names.set(it.name, it.qty);
  for (const n of Object.keys(order?.items || {})) if (!names.has(n)) names.set(n, 0);
  return [...names.entries()].map(([name, planQty]) => {
    const c = order?.items?.[name];
    if (c) return { name, plan: planQty, confirmed: c.qty, qty: c.qty, state: "확정" as const };
    return pastDeadline ? { name, plan: planQty, confirmed: null, qty: planQty, state: "자동" as const } : { name, plan: planQty, confirmed: null, qty: null, state: "확정 전" as const };
  });
}

/** 생산 합계 (확정 + 자동) — 확정 전이 하나라도 있으면 아는 만큼 */
export function madeTotal(rows: OrderRow[]): number | null {
  if (!rows.length) return null;
  return rows.reduce((a, r) => a + (r.qty || 0), 0);
}

/** 카톡으로 보낼 생산 명령서 글 */
export function orderText(date: string, rows: OrderRow[], label = "생산 명령서"): string {
  const [, m, d] = date.split("-").map(Number);
  const list = rows.filter((r) => (r.qty || 0) > 0);
  const total = list.reduce((a, r) => a + (r.qty || 0), 0);
  return [`[${m}월 ${d}일 ${label}] 총 ${total}개`, ...list.map((r) => `· ${r.name} ${r.qty}개${r.state === "자동" ? " (자동)" : ""}`)].join("\n");
}

/** 한국 시간 지금 */
export function nowKst(d = new Date()): { date: string; time: string } {
  const k = new Date(d.getTime() + 9 * 3600e3).toISOString();
  return { date: k.slice(0, 10), time: k.slice(11, 16) };
}

/* ---------- 결과 · 오차 → 다음 예측 ---------- */

/** 그날 빵별 결과 — 생산(확정 · 자동) · 판매 · 50% 할인 · 폐기(생산 − 판매) */
export interface BreadResult {
  name: string;
  made: number | null;
  /** 보정 전 예측 수량 (계획에 있으면) */
  base: number | null;
  sold: number;
  half: number;
  /** 정가로 팔린 개수 = 판매 − 50% 할인 */
  full: number;
  waste: number | null;
  /** 다 팔림 (판매 ≥ 생산 · 할인 없음) */
  soldOut: boolean;
}

export function dayResult(board: Board, date: string, plan: PlanDoc | null | undefined, order: OrderDoc | null | undefined): BreadResult[] {
  // 지난 날이라 확정 안 한 빵은 모두 '자동'
  const rows = orderRows(plan, order, { date: "9999-12-31", time: "00:00" });
  const made = new Map(rows.map((r) => [r.name, r.qty]));
  const sold = new Map(board.products(date, date, "베이커리").map((p) => [p.name, p.qty]));
  const halfBy = board.report(date)?.cafe?.bakeryHalfBy || {};
  const baseOf = new Map((plan?.items || []).map((i) => [i.name, i.base ?? i.qty]));
  const names = [...new Set([...made.keys(), ...sold.keys()])];
  return names
    .map((name) => {
      const m = made.get(name) ?? null;
      const s = sold.get(name) || 0;
      const h = Math.min(s, halfBy[name] || 0);
      return { name, made: m, base: baseOf.get(name) ?? null, sold: s, half: h, full: s - h, waste: m == null ? null : Math.max(0, m - s), soldOut: m != null && m > 0 && s >= m && h === 0 };
    })
    .sort((a, b) => (b.made ?? b.sold) - (a.made ?? a.sold) || a.name.localeCompare(b.name, "ko"));
}

/** 다 팔린 날 — 실제로는 더 팔 수 있었다고 보고 올리는 배수 */
export const SOLD_OUT_STEP = 1.1;

/**
 * 빵별 보정 배수 — 지난 날들(앱 수량대로 만든 날)의 '정가 판매 ÷ 보정 전 예측'
 * 목표: 저녁 7시쯤이면 거의 다 팔림 → 정가 판매가 예측만큼이면 1, 50% 할인 · 폐기가 나오면 그만큼 낮춤, 다 팔렸으면 만든 양보다 조금 올림
 * 보정 전 예측과 견주므로 보정이 날마다 되풀이해 쌓이지 않음
 * 최근 날일수록 무겁게(하루 0.85배씩), 날이 적으면 1 쪽으로 (2일이면 반반)
 */
export function corrections(days: { date: string; rows: BreadResult[] }[], asOf: string): Record<string, number> {
  const acc = new Map<string, { s: number; w: number; n: number }>();
  for (const d of days) {
    if (d.date > asOf) continue;
    const age = Math.max(0, Math.round((Date.parse(asOf) - Date.parse(d.date)) / 86400e3));
    const w = Math.pow(0.85, age);
    for (const r of d.rows) {
      if (!r.made) continue;
      const base = r.base || r.made;
      const ratio = Math.min(1.5, Math.max(0.3, r.soldOut ? (r.made / base) * SOLD_OUT_STEP : r.full / base));
      const a = acc.get(r.name) || { s: 0, w: 0, n: 0 };
      a.s += w * Math.log(ratio);
      a.w += w;
      a.n++;
      acc.set(r.name, a);
    }
  }
  const out: Record<string, number> = {};
  for (const [name, a] of acc) {
    const shrink = a.n / (a.n + 2);
    out[name] = Math.min(1.5, Math.max(0.6, Math.exp(shrink * (a.s / a.w))));
  }
  return out;
}
