/* ============================================================
   베이커리 작업지시 — 계획(plans) · 확정(orders) 문서와 그 규칙 (D 매니저 앱 · D-1 현장 태블릿 · 16시 예약 작업이 함께 씀)
   - 매일 16시: 내일(확정안) · 모레(잠정 ±5%) · 글피(잠정 ±10%) 계획을 새로 셈 → plans/{날짜}
     어제 알려 준 범위를 벗어나지 않게 묶음: 어제 글피(±10%)였던 날은 오늘 그 범위 안, 어제 모레(±5%)였던 날은 그 범위 안
   - 매니저는 내일 생산량을 18시 전에 확정 (빵마다 또는 한꺼번에) → orders/{날짜}
   - 생산 = 확정 수량 (확정 안 한 빵은 18시가 지나면 계획 수량을 그대로 '자동'), 폐기 = 생산 − 판매
   ============================================================ */
import { addDays } from "./dates";
import { breadPlan, weeklyOutlook, withinBand, type DayKind, type Learned } from "./forecast";
import type { Board } from "./metrics";
import type { WeatherMap } from "./weather";

/** 계획을 새로 세는 시각 (한국 시간) */
export const PLAN_HOUR = 16;
/** 매니저 확정 마감 (한국 시간) */
export const CONFIRM_DEADLINE = "18:00";
/** 며칠 앞 → 범위 (1 = 내일 확정안, 2 = 모레 ±5%, 3 = 글피 ±10%) */
export const STAGE_BAND: Record<number, number> = { 1: 0, 2: 0.05, 3: 0.1 };
export const STAGE_LABEL: Record<number, string> = { 1: "확정안", 2: "잠정 ±5%", 3: "잠정 ±10%" };

export interface PlanItem {
  name: string;
  qty: number;
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

/** 오늘(16시) 계획 세 장 — prev(날짜) = 이미 있던 계획 (범위 묶기) */
export function makePlans(board: Board, weather: WeatherMap, learned: Learned, today: string, asOf: string, prev: (date: string) => PlanDoc | undefined): PlanDoc[] {
  const out: PlanDoc[] = [];
  for (const stage of [1, 2, 3]) {
    const date = addDays(today, stage);
    const p = breadPlan(board, weather, asOf, date, learned);
    const old = prev(date);
    // 어제 알려 준 수량 · 범위 (어제는 stage + 1 이었음)
    const yesterday = old?.history?.[addDays(today, -1)];
    const yBand = STAGE_BAND[stage + 1] ?? 0;
    const items: PlanItem[] = p.items.map((it) => {
      let qty = it.qty;
      const y = yesterday?.[it.name];
      if (y != null && yBand > 0) qty = withinBand(y, qty, yBand);
      const band = STAGE_BAND[stage];
      return band ? { name: it.name, qty, lo: Math.floor(qty * (1 - band)), hi: Math.ceil(qty * (1 + band)) } : { name: it.name, qty };
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
