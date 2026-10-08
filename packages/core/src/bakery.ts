/* ============================================================
   베이커리 작업지시 — 계획(plans) · 확정(orders) 문서와 그 규칙 (D 매니저 앱 · D-1 현장 태블릿 · 15시 예약 작업이 함께 씀)
   [주간] 매주 목요일 아침 6시: 다음 주 월 ~ 일 7일치 계획(주간 잠정안) → 매니저가 목요일 18시 전에 잠정 확정
          (새벽 00:47 ~ 05:17 에 미리 계산해 두고 매니저 앱에는 6시부터 보임 — 수요일 실적은 아직 안 들어와
           화요일까지 실적 + 수요일은 지난주 · 지지난주 수요일 평균으로 채워 셈, forecast.ts estimateDay)
   [최종] 매일 15시: 3일 뒤 수량을 다시 셈(아침 09:10 수집한 어제까지 실적의 오차 보정 · 잠정 확정 수량 ±10% 안) → 매니저가 그날 18시 전에 최종 확정
          금 → 월 · 토 → 화 · 일 → 수 · 월 → 목 · 화 → 금 · 수 → 토 · 목 → 일 (목요일은 다음 주 주간 계획도 함께)
   마감이 지나도 확정이 없으면: 잠정 = 주간 계획 수량, 최종 = 최종 계산 수량을 그대로 '자동'
   [현장] 아침 6시부터 그날 — 오늘 생산(최종) + 내일 준비(최종, 하루 전에 미리 준비) 두 날을 함께 보여 줌
   생산 = 최종 수량, 폐기 = 생산 − 판매(정가 + 50% 할인). 그날 아침 6시부터는 최종 수량을 못 바꿈 (productionStarted)
   보고 앱(B)은 마감일의 plans · orders 를 그날 생산 기록으로 읽어 영수증 판매와 맞춤 (dayResult · breadTotals)
   ============================================================ */
import { addDays, weekday } from "./dates";
import { bandRange, breadPlan, weeklyOutlook, withinBand, type DayKind, type Learned } from "./forecast";
import type { Board } from "./metrics";
import { NOT_BREAD } from "./rules";
import type { WeatherMap } from "./weather";

/** 최종안을 세는 시각 (한국 시간, 매일) — 예약 작업은 조금 일찍 걸어 둠 */
export const PLAN_TIME = "15:00";
/** 주간 잠정안이 매니저 앱에 열리는 시각 (목요일, 한국 시간) — 계산은 새벽에 미리 */
export const WEEK_PLAN_TIME = "06:00";
/** 주간 계획을 세는 요일 (목) */
export const WEEK_PLAN_WEEKDAY = 4;
/** 최종 확정 = 3일 뒤 */
export const FINAL_LEAD = 3;
/** 매니저 확정 마감 (한국 시간, 잠정 · 최종 모두) */
export const CONFIRM_DEADLINE = "18:00";
/** 최종 수량은 잠정 확정 수량의 ±10% 안 (재료 · 인원 계획이 흔들리지 않게) */
export const FINAL_BAND = 0.1;
/** 현장 태블릿의 하루 시작 */
export const DAY_START = "06:00";

/** 만드는 단위 (적지 않은 빵은 1개 단위) */
export const PRODUCTION_UNIT: Readonly<Record<string, number>> = { 몽블랑: 5 };
export const breadUnit = (name: string) => PRODUCTION_UNIT[name] || 1;

/** 단위에 맞추기 — 가까운 배수 (0 보다 많으면 적어도 한 단위), 범위가 있으면 범위 안의 배수 중 가까운 것 */
export function snapUnit(name: string, qty: number, lo?: number, hi?: number): number {
  const u = breadUnit(name);
  const q = Math.max(0, Math.round(qty));
  if (u === 1 || q === 0) return q;
  let best = Math.max(u, Math.round(q / u) * u);
  if (lo != null && hi != null && (best < lo || best > hi)) {
    const inside: number[] = [];
    for (let m = Math.ceil(lo / u) * u; m <= hi; m += u) if (m > 0) inside.push(m);
    if (inside.length) best = inside.reduce((a, b) => (Math.abs(b - q) < Math.abs(a - q) ? b : a));
  }
  return best;
}

export interface PlanItem {
  name: string;
  qty: number;
  /** 보정 전 예측 수량 (다음 보정의 기준 — 보정이 되풀이해 쌓이지 않게) */
  base?: number;
  /** 보정 배수 (1 이 아니면 지난 결과로 고친 것) */
  adj?: number;
  /** 최종 계산에서: 잠정 수량 ±10% 범위 */
  lo?: number;
  hi?: number;
}

/** 한 번 센 계획 (주간 또는 최종) */
export interface PlanStep {
  /** 센 날 (한국 날짜) */
  madeOn: string;
  /** 쓴 실적의 마지막 날 */
  asOf: string;
  kind: DayKind;
  /** 예상 손님 (명) */
  visitors: number;
  /** 날씨 칸 (모르면 '모름') */
  weather: string;
  items: PlanItem[];
  total: number;
}

export interface Outlook {
  week: number;
  from: string;
  to: string;
  weekday: number | null;
  holiday: number | null;
}

export interface PlanDoc {
  v: 2;
  date: string;
  /** 주간 잠정안 (그 주 앞 목요일 아침 6시) */
  week?: PlanStep;
  /** 최종안 (3일 전 15시) */
  final?: PlanStep;
  /** 주간 계획의 월요일 문서에만: 그 주부터 1 ~ 4주차 평일 · 휴일 하루 생산 개수 */
  outlook?: Outlook[];
}

export interface OrderLine {
  qty: number;
  by: string;
  at: string;
}
export interface OrderDoc {
  v: 2;
  date: string;
  /** 목요일 잠정 확정 */
  provisional: Record<string, OrderLine>;
  /** 3일 전 최종 확정 */
  final: Record<string, OrderLine>;
}

/** 베이커리 생산품이 아닌 상품(NOT_BREAD — 딸기잼 · 블루베리잼)을 뺀 계획 단계 (합계도 다시) — 이미 만든 계획을 읽을 때 */
function breadOnly(st: PlanStep | undefined): PlanStep | undefined {
  if (!st || !st.items?.some((i) => NOT_BREAD.has(i.name))) return st;
  const items = st.items.filter((i) => !NOT_BREAD.has(i.name));
  return { ...st, items, total: items.reduce((a, b) => a + b.qty, 0) };
}
const breadLines = (m: Record<string, OrderLine> | undefined) => Object.fromEntries(Object.entries(m || {}).filter(([n]) => !NOT_BREAD.has(n)));

/** 클라우드 문서 → 계획 (예전 모양 v1 은 버림). 생산품이 아닌 상품은 여기서 뺌 — 매니저 앱 · 현장 태블릿 · 보고 앱 · 계획 작업이 모두 이렇게 읽음 */
export function asPlan(x: unknown): PlanDoc | null {
  const o = x as PlanDoc | null;
  if (!(o && o.v === 2 && typeof o.date === "string")) return null;
  const week = breadOnly(o.week);
  const final = breadOnly(o.final);
  return week === o.week && final === o.final ? o : { ...o, ...(week ? { week } : {}), ...(final ? { final } : {}) };
}
export function asOrder(x: unknown): OrderDoc | null {
  const o = x as OrderDoc | null;
  return o && o.v === 2 && typeof o.date === "string" ? { ...o, provisional: breadLines(o.provisional), final: breadLines(o.final) } : null;
}
export const emptyOrder = (date: string): OrderDoc => ({ v: 2, date, provisional: {}, final: {} });

/* ---------- 날짜 ---------- */

/** 그 날이 든 주의 주간 계획을 세는 목요일 (그 주 월요일의 나흘 전) */
export function weekPlanDay(date: string): string {
  const monday = addDays(date, -((weekday(date) + 6) % 7));
  return addDays(monday, -4);
}
/** 목요일 → 다음 주 월 ~ 일 */
export function weekDates(thursday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(thursday, 4 + i));
}
/** 주간 잠정안을 매니저에게 보여 줄지 — 계산한 목요일 아침 6시부터 (새벽에 미리 계산돼 있어도 6시 전에는 숨김) */
export function weekPlanOpen(plan: PlanDoc | null | undefined, now: { date: string; time: string }): boolean {
  const made = plan?.week?.madeOn;
  if (!made) return false;
  return now.date > made || (now.date === made && now.time >= WEEK_PLAN_TIME);
}
/** 매니저 앱이 보는 계획 — 6시 전이면 새벽에 미리 계산한 주간 잠정안 · 1~4주 전망을 숨김 (최종안은 그대로) */
export function visiblePlan(plan: PlanDoc | null, now: { date: string; time: string }): PlanDoc | null {
  if (!plan?.week || weekPlanOpen(plan, now)) return plan;
  const { week: _w, outlook: _o, ...rest } = plan;
  return rest;
}
/** 최종 확정하는 날 (3일 전) */
export const finalDay = (date: string) => addDays(date, -FINAL_LEAD);

type Now = { date: string; time: string };
const passed = (now: Now, day: string) => now.date > day || (now.date === day && now.time >= CONFIRM_DEADLINE);

/** 현장 태블릿이 보여 줄 두 날 — 아침 6시 전에는 아직 어제 */
export function displayDays(now: Now): [string, string] {
  const today = now.time < DAY_START ? addDays(now.date, -1) : now.date;
  return [today, addDays(today, 1)];
}

/* ---------- 계획 세기 ---------- */

function step(board: Board, weather: WeatherMap, learned: Learned, madeOn: string, asOf: string, date: string, corr: Record<string, number>): PlanStep {
  const p = breadPlan(board, weather, asOf, date, learned);
  const items: PlanItem[] = p.items.map((it) => {
    const c = corr[it.name] ?? 1;
    const adj = Math.abs(c - 1) >= 0.005 ? Math.round(c * 100) / 100 : undefined;
    return { name: it.name, qty: snapUnit(it.name, it.qty * c), base: it.qty, ...(adj ? { adj } : {}) };
  });
  return { madeOn, asOf, kind: p.visitors.kind, visitors: p.visitors.value, weather: p.visitors.weather.cls, items, total: items.reduce((a, b) => a + b.qty, 0) };
}

/** 목요일 아침 — 다음 주 월 ~ 일 주간 잠정안 (있던 최종안은 그대로 두도록 week 만 돌려줌) */
export function makeWeek(board: Board, weather: WeatherMap, learned: Learned, thursday: string, asOf: string, corr: Record<string, number> = {}): { date: string; week: PlanStep; outlook?: Outlook[] }[] {
  const dates = weekDates(thursday);
  return dates.map((date, i) => ({
    date,
    week: step(board, weather, learned, thursday, asOf, date, corr),
    ...(i === 0 ? { outlook: weeklyOutlook(board, asOf, date, learned) } : {}),
  }));
}

/**
 * 매일 15시 — 3일 뒤 최종안. 주간 잠정안이 없으면 null (작업지시를 쓰기 전 날)
 * 빵마다 기준 = 매니저 잠정 확정 수량(없으면 주간 수량) → 새로 센 수량을 그 ±10% 안으로 묶음
 * 새로 생긴 빵(잠정에 없던 빵)은 새로 센 수량 그대로
 */
export function makeFinal(board: Board, weather: WeatherMap, learned: Learned, today: string, asOf: string, plan: PlanDoc | null, order: OrderDoc | null, corr: Record<string, number> = {}): PlanStep | null {
  const date = addDays(today, FINAL_LEAD);
  if (!plan?.week || plan.date !== date) return null;
  const now = step(board, weather, learned, today, asOf, date, corr);
  const fresh = new Map(now.items.map((i) => [i.name, i]));
  const anchor = new Map<string, number>();
  for (const it of plan.week.items) anchor.set(it.name, it.qty);
  for (const [n, l] of Object.entries(order?.provisional || {})) anchor.set(n, l.qty);
  const names = [...new Set([...anchor.keys(), ...fresh.keys()])];
  const items: PlanItem[] = names
    .map((name) => {
      const f = fresh.get(name);
      const a = anchor.get(name);
      if (a == null) return f!;
      const [lo, hi] = bandRange(a, FINAL_BAND);
      const qty = snapUnit(name, withinBand(a, f?.qty ?? 0, FINAL_BAND), lo, hi);
      return { name, qty, base: f?.base ?? a, ...(f?.adj ? { adj: f.adj } : {}), lo, hi };
    })
    .filter((i) => i.qty > 0)
    .sort((x, y) => y.qty - x.qty || x.name.localeCompare(y.name, "ko"));
  return { ...now, items, total: items.reduce((a, b) => a + b.qty, 0) };
}

/* ---------- 현장 태블릿 복사본 ---------- */

/** 태블릿 주소 뒤 키 번호 — 숫자 4 ~ 12자리 (매니저 앱에서 정하고 바꿈, 바꾸면 예전 주소는 막힘) */
export const validFloorKey = (k: string) => /^[0-9]{4,12}$/.test(k);

/**
 * 현장 태블릿(D-1)에 주는 복사본 — 빵 이름 · 수량 · 정한 날만 (예상 손님 · 날씨 · 보정 · 누가 확정했는지는 뺌)
 * 태블릿 주소에는 매장 열쇠 대신 태블릿 열쇠를 써서, 직원이 매출 보고(B)를 열 수 없게 함
 */
export function floorCopy(plan: PlanDoc | null | undefined, order: OrderDoc | null | undefined): { plan: PlanDoc | null; order: OrderDoc | null } {
  const lite = (st?: PlanStep): PlanStep | undefined =>
    st && { madeOn: st.madeOn, asOf: st.asOf, kind: st.kind, visitors: 0, weather: "", total: st.total, items: st.items.map((i) => ({ name: i.name, qty: i.qty })) };
  const lines = (m: Record<string, OrderLine>) => Object.fromEntries(Object.entries(m).map(([k, l]) => [k, { qty: l.qty, by: "", at: "" }]));
  return {
    plan: plan ? { v: 2, date: plan.date, ...(plan.week ? { week: lite(plan.week) } : {}), ...(plan.final ? { final: lite(plan.final) } : {}) } : null,
    order: order ? { v: 2, date: order.date, provisional: lines(order.provisional), final: lines(order.final) } : null,
  };
}

/* ---------- 만들 목록 ---------- */

export type OrderState = "확정" | "자동" | "잠정" | "확정 전";
export interface OrderRow {
  name: string;
  /** 주간 잠정안 수량 */
  week: number | null;
  /** 매니저 잠정 확정 수량 (없으면 null) */
  provisional: number | null;
  /** 최종안 수량 (3일 전 15시) */
  suggested: number | null;
  /** 매니저 최종 확정 수량 */
  confirmed: number | null;
  /** 지금 기준 만들 수량 — 확정 · 자동 = 최종, 잠정 = 잠정 수량, 확정 전 = null */
  qty: number | null;
  state: OrderState;
}

/**
 * 그날 빵별 상태 (지금 시각 기준)
 * 확정: 매니저 최종 확정 · 자동: 최종 마감(3일 전 18시)이 지나 최종안(없으면 잠정 · 주간) 그대로
 * 잠정: 매니저 잠정 확정 또는 잠정 마감(목 18시)이 지나 주간 수량 그대로 · 확정 전: 아직 아무것도 없음
 */
export function orderRows(plan: PlanDoc | null | undefined, order: OrderDoc | null | undefined, now: Now): OrderRow[] {
  const date = plan?.date || order?.date || "";
  if (!date) return [];
  const week = new Map((plan?.week?.items || []).map((i) => [i.name, i.qty]));
  const fin = new Map((plan?.final?.items || []).map((i) => [i.name, i.qty]));
  const prov = order?.provisional || {};
  const conf = order?.final || {};
  const finalPassed = passed(now, finalDay(date));
  const provPassed = passed(now, plan?.week?.madeOn || weekPlanDay(date));
  // 베이커리 생산품이 아닌 상품(딸기잼 · 블루베리잼 — rules.ts NOT_BREAD)은 이미 만든 계획 · 확정에 있어도 생산 목록에서 뺌
  const names = [...new Set([...fin.keys(), ...week.keys(), ...Object.keys(prov), ...Object.keys(conf)])].filter((n) => !NOT_BREAD.has(n));
  const rows = names.map((name): OrderRow => {
    const base = { name, week: week.get(name) ?? null, provisional: prov[name]?.qty ?? null, suggested: fin.get(name) ?? null, confirmed: conf[name]?.qty ?? null };
    if (conf[name]) return { ...base, qty: conf[name].qty, state: "확정" };
    if (finalPassed) {
      const q = plan?.final ? (fin.get(name) ?? 0) : (prov[name]?.qty ?? week.get(name) ?? 0);
      return { ...base, qty: q, state: "자동" };
    }
    if (prov[name]) return { ...base, qty: prov[name].qty, state: "잠정" };
    if (provPassed && week.has(name)) return { ...base, qty: week.get(name)!, state: "잠정" };
    return { ...base, qty: null, state: "확정 전" };
  });
  // 최종이 정해졌는데 0 개인 빵은 뺌 (최종안에서 빠진 빵)
  return rows
    .filter((r) => !((r.state === "자동" || r.state === "확정") && !r.qty))
    .sort((a, b) => (b.qty ?? b.week ?? 0) - (a.qty ?? a.week ?? 0) || a.name.localeCompare(b.name, "ko"));
}

/** 생산 합계 — 최종(확정 · 자동)만. 최종 전이면 null */
export function madeTotal(rows: OrderRow[]): number | null {
  const fin = rows.filter((r) => r.state === "확정" || r.state === "자동");
  if (!fin.length || fin.length !== rows.length) return null;
  return fin.reduce((a, r) => a + (r.qty || 0), 0);
}

/** 카톡으로 보낼 생산 명령서 글 */
export function orderText(date: string, rows: OrderRow[], label = "생산 명령서"): string {
  const [, m, d] = date.split("-").map(Number);
  const list = rows.filter((r) => (r.qty || 0) > 0);
  const total = list.reduce((a, r) => a + (r.qty || 0), 0);
  return [`[${m}월 ${d}일 ${label}] 총 ${total}개`, ...list.map((r) => `· ${r.name} ${r.qty}개${r.state === "확정" ? "" : ` (${r.state})`}`)].join("\n");
}

/** 한국 시간 지금 */
export function nowKst(d = new Date()): Now {
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
  // 지난 날이라 최종 확정 안 한 빵은 모두 '자동'
  const rows = orderRows(plan, order, { date: "9999-12-31", time: "00:00" });
  const made = new Map(rows.map((r) => [r.name, r.qty]));
  const sold = new Map(board.products(date, date, "베이커리").filter((p) => !NOT_BREAD.has(p.name)).map((p) => [p.name, p.qty]));
  const halfBy = board.report(date)?.cafe?.bakeryHalfBy || {};
  const baseOf = new Map<string, number>();
  for (const it of plan?.week?.items || []) baseOf.set(it.name, it.base ?? it.qty);
  for (const it of plan?.final?.items || []) baseOf.set(it.name, it.base ?? it.qty);
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

/** 그날 합계 (B 베이커리 상세 맨 위) — 총 생산 · 정가판매 · 할인판매 · 폐기. 작업지시가 없는 빵뿐이면 생산 · 폐기는 null */
export function breadTotals(rows: BreadResult[]): { made: number | null; full: number; half: number; waste: number | null } {
  const planned = rows.filter((r) => r.made != null);
  return {
    made: planned.length ? planned.reduce((a, r) => a + (r.made || 0), 0) : null,
    full: rows.reduce((a, r) => a + r.full, 0),
    half: rows.reduce((a, r) => a + r.half, 0),
    waste: planned.length ? planned.reduce((a, r) => a + (r.waste || 0), 0) : null,
  };
}

/** 그날 생산이 시작됐는지 (아침 6시 = 현장 태블릿 하루 시작) — 그 뒤로는 그날 최종 수량을 못 바꿈 (현장에 지시한 수량 = 그날 생산 기록) */
export function productionStarted(date: string, now: Now): boolean {
  return now.date > date || (now.date === date && now.time >= DAY_START);
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
