/* ============================================================
   대시보드 숫자 (순수 함수, 시험: test/metrics.test.ts)

   한 날의 숫자
   - 바리스타 · 베이커리 · 키친 · 기타 = 카페 POS 실매출을 팀별로 (기타 = 카페 기타 + 키즈 POS 의 입장권 외 매출)
   - 키즈입장료 = (네이버 입장권 + 현장 입장권) × 그날 단가 (평일 12,000 / 휴일 14,000)
       · 네이버 입장권 = 키즈 POS 0원 입장권 수량 — 관리자가 고친 값이 있으면 그 값 (Adjusts)
       · 현장 입장권 = 키즈 POS 에서 돈을 받은 입장권 수량 (환불은 -1 로 빠짐)
   - 총매출 = 위 다섯 상자의 합
   - 추정 방문자 = 음료·맥주 잔 수 × 0.96 (날마다 반올림), 1인 평균 = 총매출 ÷ 추정 방문자
   여러 날(누계)은 날마다의 값을 더함 (1인 평균은 합계 ÷ 합계)
   ============================================================ */
import { addDays, addMonths, dayRange, daysInMonth, monthOf, monthStart, sameDayYearsAgo, weekday, weekdayLabel } from "./dates";
import { kidsKind, teamOf } from "./classify";
import { cupsPerItem, isCup, isOffDay, kidsPrice, visitorsFromCups, VISITOR_FACTOR } from "./rules";
import { count, pct, won } from "./format";
import type { SalesIndex } from "./report";
import { seasonOf, temp, WEATHER_SOURCE_TEXT, type WeatherMap } from "./weather";

export type BoxKey = "바리스타" | "베이커리" | "키친" | "키즈입장료" | "기타";
export const BOXES: BoxKey[] = ["바리스타", "베이커리", "키친", "키즈입장료", "기타"];

export type MetricKey = "total" | BoxKey | "visitors" | "avgSpend" | "naver" | "walkIn" | "eventFree" | "tickets";

export const METRIC_LABEL: Record<MetricKey, string> = {
  total: "총 매출",
  바리스타: "바리스타",
  베이커리: "베이커리",
  키친: "키친",
  키즈입장료: "키즈 입장료",
  기타: "기타",
  visitors: "추정 방문자",
  avgSpend: "1인 평균 소비",
  naver: "네이버 예약",
  walkIn: "현장 구매",
  eventFree: "이벤트 무료입장",
  tickets: "키즈 입장권",
};

/** 금액인지 (아니면 사람·장 수) */
export function isMoney(key: MetricKey): boolean {
  return !["visitors", "naver", "walkIn", "eventFree", "tickets"].includes(key);
}

export function formatMetric(key: MetricKey, v: number | null): string {
  if (v == null) return "—";
  if (isMoney(key)) return won(v);
  return count(v, key === "visitors" ? "명" : key === "eventFree" ? "팀" : "장");
}

/** 관리자가 고친 네이버 입장권 수 (날짜별) */
export interface KidsAdjust {
  naver: number;
  /** 고친 사람 (적은 이름) */
  by?: string;
  /** 고친 시각 ISO */
  at?: string;
}
export type Adjusts = Record<string, KidsAdjust>;

export interface Metrics {
  from: string;
  to: string;
  /** 자료가 있는 날 수 (POS 별) */
  has: { cafe: number; kids: number };
  box: Record<BoxKey, number>;
  total: number;
  /** POS 실매출 합 (카페 + 키즈, 참고용) */
  posNet: number;
  cups: number;
  visitors: number;
  avgSpend: number | null;
  /** 0원 입장 발행 수 (네이버 + 현장 손님 모두) */
  issued: number;
  /** POS 로 계산한 네이버 예약 수 = 발행 − 현장 결제 */
  naverPos: number;
  /** 이벤트 무료입장 (쿠폰) 팀 수 */
  eventFree: number;
  /** 계산에 쓴 네이버 입장권 수 (고친 값 우선) */
  naver: number;
  /** 네이버 수를 고친 날 수 */
  naverAdjusted: number;
  walkIn: number;
  /** 현장 입장권 POS 실결제 금액 (참고용) */
  walkInPosNet: number;
  /** 키즈 입장료 중 네이버 · 현장 몫 */
  fee: { naver: number; walkIn: number };
  /** 키즈 POS 의 입장권 외 매출 (추가 인원 · 간식 등 — 기타에 들어감) */
  kidsOtherNet: number;
}

function empty(from: string, to: string): Metrics {
  return {
    from,
    to,
    has: { cafe: 0, kids: 0 },
    box: { 바리스타: 0, 베이커리: 0, 키친: 0, 키즈입장료: 0, 기타: 0 },
    total: 0,
    posNet: 0,
    cups: 0,
    visitors: 0,
    avgSpend: null,
    issued: 0,
    naverPos: 0,
    eventFree: 0,
    naver: 0,
    naverAdjusted: 0,
    walkIn: 0,
    walkInPosNet: 0,
    fee: { naver: 0, walkIn: 0 },
    kidsOtherNet: 0,
  };
}

export function valueOf(m: Metrics, key: MetricKey): number | null {
  if (key === "total") return m.total;
  if (key === "visitors") return m.visitors;
  if (key === "avgSpend") return m.avgSpend;
  if (key === "naver") return m.naver;
  if (key === "walkIn") return m.walkIn;
  if (key === "eventFree") return m.eventFree;
  if (key === "tickets") return m.naver + m.walkIn;
  return m.box[key];
}

/** 자료가 하나라도 있는지 */
export function hasData(m: Metrics): boolean {
  return m.has.cafe + m.has.kids > 0;
}

/** 기간 중 자료가 있는 날의 비율 (0~1) */
export function coverage(m: Metrics): number {
  const n = m.from > m.to ? 0 : dayRange(m.from, m.to).length;
  return n ? Math.max(m.has.cafe, m.has.kids) / n : 0;
}

/** 비교에 써도 될 만큼 자료가 있는지 — 기간의 80% 이상 (휴무일 감안). 작년 자료가 일부만 있으면 비교하지 않음 */
export function comparable(m: Metrics): boolean {
  return coverage(m) >= 0.8;
}

export class Board {
  private cache = new Map<string, Metrics>();

  constructor(
    readonly sales: SalesIndex,
    readonly adjusts: Adjusts = {},
  ) {}

  day(date: string): Metrics {
    const hit = this.cache.get(date);
    if (hit) return hit;
    const m = empty(date, date);
    const present = this.sales.present.get(date);
    m.has.cafe = present?.has("cafe") ? 1 : 0;
    m.has.kids = present?.has("kids") ? 1 : 0;
    let cups = 0;
    for (const s of this.sales.day(date)) {
      m.posNet += s.net;
      const team = teamOf(s.pos, s);
      if (isCup(s.pos, s, team)) cups += s.qty * cupsPerItem(s.name);
      if (s.pos === "cafe") {
        m.box[team === "키즈" ? "기타" : team] += s.net;
        continue;
      }
      const kind = kidsKind(s);
      if (kind === "입장발행") m.issued += s.qty;
      else if (kind === "이벤트무료") m.eventFree += s.qty;
      else if (kind === "현장결제") {
        m.walkIn += s.qty;
        m.walkInPosNet += s.net;
      } else {
        m.kidsOtherNet += s.net;
        m.box.기타 += s.net;
      }
    }
    m.naverPos = Math.max(0, m.issued - m.walkIn);
    const adj = this.adjusts[date];
    m.naver = adj && Number.isFinite(adj.naver) ? Math.max(0, Math.round(adj.naver)) : m.naverPos;
    m.naverAdjusted = adj ? 1 : 0;
    const { price } = kidsPrice(date);
    m.fee = { naver: m.naver * price, walkIn: m.walkIn * price };
    m.box.키즈입장료 = m.fee.naver + m.fee.walkIn;
    m.total = m.box.바리스타 + m.box.베이커리 + m.box.키친 + m.box.키즈입장료 + m.box.기타;
    m.cups = cups;
    m.visitors = visitorsFromCups(cups);
    m.avgSpend = m.visitors > 0 ? Math.round(m.total / m.visitors) : null;
    this.cache.set(date, m);
    return m;
  }

  range(from: string, to: string): Metrics {
    const m = empty(from, to);
    if (from > to) return m;
    for (const d of dayRange(from, to)) {
      const x = this.day(d);
      m.has.cafe += x.has.cafe;
      m.has.kids += x.has.kids;
      for (const b of BOXES) m.box[b] += x.box[b];
      m.total += x.total;
      m.posNet += x.posNet;
      m.cups += x.cups;
      m.visitors += x.visitors;
      m.issued += x.issued;
      m.naverPos += x.naverPos;
      m.eventFree += x.eventFree;
      m.naver += x.naver;
      m.naverAdjusted += x.naverAdjusted;
      m.walkIn += x.walkIn;
      m.walkInPosNet += x.walkInPosNet;
      m.fee.naver += x.fee.naver;
      m.fee.walkIn += x.fee.walkIn;
      m.kidsOtherNet += x.kidsOtherNet;
    }
    m.avgSpend = m.visitors > 0 ? Math.round(m.total / m.visitors) : null;
    return m;
  }
}

/* ---------- 대시보드 ---------- */

export interface Dashboard {
  date: string;
  weekday: string;
  day: Metrics;
  /** 지난주 같은 요일 */
  prevWeek: { date: string; m: Metrics };
  /** 당월 누계 (1일 ~ 기준일) */
  month: Metrics;
  /** 올해 누계 (1월 1일 ~ 기준일) */
  year: Metrics;
  /** 작년 같은 달 누계 (1일 ~ 작년 같은 날) */
  lyMonth: Metrics;
  /** 작년 같은 기간 누계 (작년 1월 1일 ~ 작년 같은 날) */
  lyYear: Metrics;
  lyDate: string;
  price: { price: number; kind: "평일" | "휴일" };
}

export function dashboard(board: Board, date: string): Dashboard {
  const ly = sameDayYearsAgo(date);
  const pw = addDays(date, -7);
  return {
    date,
    weekday: weekdayLabel(date),
    day: board.day(date),
    prevWeek: { date: pw, m: board.day(pw) },
    month: board.range(monthStart(date), date),
    year: board.range(`${date.slice(0, 4)}-01-01`, date),
    lyMonth: board.range(monthStart(ly), ly),
    lyYear: board.range(`${ly.slice(0, 4)}-01-01`, ly),
    lyDate: ly,
    price: kidsPrice(date),
  };
}

/* ---------- 추세 (상세 화면 그래프) ---------- */

export interface Point {
  /** 날짜 YYYY-MM-DD 또는 달 YYYY-MM */
  x: string;
  v: number | null;
}

/** 하루씩 (자료 없는 날은 null) */
export function dailySeries(board: Board, key: MetricKey, to: string, days: number): Point[] {
  return dayRange(addDays(to, -(days - 1)), to).map((d) => {
    const m = board.day(d);
    return { x: d, v: hasData(m) ? valueOf(m, key) : null };
  });
}

/** 이동 평균 (앞쪽 n 일, 자료 있는 날만 평균) */
export function movingAverage(points: Point[], n = 7): Point[] {
  return points.map((p, i) => {
    const win = points.slice(Math.max(0, i - n + 1), i + 1).filter((q) => q.v != null) as { x: string; v: number }[];
    return { x: p.x, v: win.length >= Math.min(n, 3) ? Math.round(win.reduce((s, q) => s + q.v, 0) / win.length) : null };
  });
}

/** 달별 — 올해(기준일이 든 달은 기준일까지)와 작년 같은 달(같은 기간) */
export function monthlySeries(board: Board, key: MetricKey, date: string, months = 12): { cur: Point[]; ly: Point[] } {
  const cur: Point[] = [];
  const ly: Point[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const month = addMonths(monthOf(date), -i);
    const from = `${month}-01`;
    const end = `${month}-${String(daysInMonth(from)).padStart(2, "0")}`;
    const to = end < date ? end : date;
    const m = board.range(from, to);
    cur.push({ x: month, v: hasData(m) ? valueOf(m, key) : null });
    const lyMonth = addMonths(month, -12);
    const lyFrom = `${lyMonth}-01`;
    const lyTo = i === 0 ? sameDayYearsAgo(date) : `${lyMonth}-${String(daysInMonth(lyFrom)).padStart(2, "0")}`;
    const lm = board.range(lyFrom, lyTo);
    ly.push({ x: month, v: hasData(lm) ? valueOf(lm, key) : null });
  }
  return { cur, ly };
}

/** 당월 누계를 날마다 쌓은 선 — 이번 달(기준일까지) · 작년 같은 달(한 달 전체) · 지난달 */
export function monthCumulative(board: Board, date: string) {
  const total = daysInMonth(date);
  const ly = sameDayYearsAgo(date);
  const pm = addMonths(monthOf(date), -1);
  const pmDays = daysInMonth(`${pm}-01`);
  const lyMonth = monthOf(ly);
  const lyDays = daysInMonth(`${lyMonth}-01`);
  const mk = (month: string, last: number, upto: number) => {
    let sum = 0;
    let any = false;
    const out: (number | null)[] = [];
    for (let d = 1; d <= total; d++) {
      if (d > last || d > upto) {
        out.push(null);
        continue;
      }
      const m = board.day(`${month}-${String(d).padStart(2, "0")}`);
      any = any || hasData(m);
      sum += m.total;
      out.push(sum);
    }
    return any ? out : out.map(() => null);
  };
  const day = Number(date.slice(8, 10));
  return {
    days: Array.from({ length: total }, (_, i) => i + 1),
    cur: mk(monthOf(date), total, day),
    ly: mk(lyMonth, lyDays, lyDays),
    prev: mk(pm, pmDays, pmDays),
  };
}

/** 올해 누계를 달마다 쌓은 선 — 올해(기준일까지) · 작년 */
export function yearCumulative(board: Board, date: string) {
  const y = date.slice(0, 4);
  const ly = String(Number(y) - 1);
  const curMonth = Number(date.slice(5, 7));
  const cur: (number | null)[] = [];
  const last: (number | null)[] = [];
  let a = 0;
  let b = 0;
  let anyA = false;
  let anyB = false;
  for (let mo = 1; mo <= 12; mo++) {
    const mm = String(mo).padStart(2, "0");
    if (mo <= curMonth) {
      const to = mo === curMonth ? date : `${y}-${mm}-${String(daysInMonth(`${y}-${mm}-01`)).padStart(2, "0")}`;
      const m = board.range(`${y}-${mm}-01`, to);
      anyA = anyA || hasData(m);
      a += m.total;
      cur.push(a);
    } else cur.push(null);
    const lm = board.range(`${ly}-${mm}-01`, `${ly}-${mm}-${String(daysInMonth(`${ly}-${mm}-01`)).padStart(2, "0")}`);
    anyB = anyB || hasData(lm);
    b += lm.total;
    last.push(b);
  }
  return { months: Array.from({ length: 12 }, (_, i) => i + 1), cur: anyA ? cur : cur.map(() => null), ly: anyB ? last : last.map(() => null) };
}

/* ---------- 분석 설명 (상세 화면 아래) ---------- */

const change = (now: number | null, before: number | null): number | null => (now == null || before == null || !(before > 0) ? null : Math.round(((now - before) / before) * 1000) / 10);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}(${weekdayLabel(d)})`;
const updown = (p: number | null, flat = 3) => (p == null ? "" : Math.abs(p) < flat ? "비슷합니다" : p > 0 ? `${pct(p)} 높습니다` : `${pct(p)} 낮습니다`);

/** 상세 화면 분석 문장들 — 숫자에서 바로 만든 설명 (추측 없음) */
export function analyze(board: Board, key: MetricKey, date: string): string[] {
  const f = (v: number | null) => formatMetric(key, v);
  const label = METRIC_LABEL[key];
  const out: string[] = [];
  const today = board.day(date);
  const v = hasData(today) ? valueOf(today, key) : null;
  if (v == null) return [`${md(date)} 자료가 없습니다 (휴무 또는 마감 송부 전).`];

  // 1) 지난주 같은 요일 · 최근 4주 같은 요일 평균
  const pw = board.day(addDays(date, -7));
  const pwv = hasData(pw) ? valueOf(pw, key) : null;
  if (pwv != null) out.push(`${md(date)} ${label} ${f(v)} — 지난주 ${md(addDays(date, -7))} ${f(pwv)}보다 ${updown(change(v, pwv))}.`);
  const same = [7, 14, 21, 28].map((n) => board.day(addDays(date, -n))).filter(hasData).map((m) => valueOf(m, key)).filter((x): x is number => x != null);
  const sameAvg = mean(same);
  if (same.length >= 2 && sameAvg != null) out.push(`최근 ${same.length}주 같은 ${weekdayLabel(date)}요일 평균 ${f(Math.round(sameAvg))}과 비교하면 ${updown(change(v, sameAvg))}.`);

  // 2) 최근 7일 흐름
  const s14 = dailySeries(board, key, date, 14).map((p) => p.v);
  const last7 = s14.slice(7).filter((x): x is number => x != null);
  const prev7 = s14.slice(0, 7).filter((x): x is number => x != null);
  const a7 = mean(last7);
  const b7 = mean(prev7);
  if (a7 != null && b7 != null && last7.length >= 4 && prev7.length >= 4) {
    const p = change(a7, b7);
    const word = p == null ? "" : Math.abs(p) < 3 ? "비슷한 흐름입니다" : p > 0 ? `오르는 흐름입니다 (${pct(p)})` : `내려가는 흐름입니다 (${pct(p)})`;
    out.push(`최근 7일 하루 평균 ${f(Math.round(a7))}, 그 전 7일 ${f(Math.round(b7))} — ${word}.`);
  }

  // 3) 최근 30일 최고 · 최저, 주말 대 평일
  const s30 = dailySeries(board, key, date, 30).filter((p) => p.v != null) as { x: string; v: number }[];
  if (s30.length >= 7) {
    const hi = s30.reduce((a, b) => (b.v > a.v ? b : a));
    const lo = s30.reduce((a, b) => (b.v < a.v ? b : a));
    out.push(`최근 30일 가장 높은 날 ${md(hi.x)} ${f(hi.v)}, 가장 낮은 날 ${md(lo.x)} ${f(lo.v)}.`);
    const off = mean(s30.filter((p) => isOffDay(p.x)).map((p) => p.v));
    const on = mean(s30.filter((p) => !isOffDay(p.x)).map((p) => p.v));
    if (off != null && on != null && on > 0 && key !== "avgSpend") out.push(`최근 30일 주말·공휴일 하루 평균은 평일의 ${(off / on).toFixed(1)}배입니다.`);
  }

  // 4) 누계 비교 (금액·수량 — 1인 평균 제외)
  if (key !== "avgSpend") {
    const month = valueOf(board.range(monthStart(date), date), key);
    const pmMonth = addMonths(monthOf(date), -1);
    const pmTo = `${pmMonth}-${String(Math.min(Number(date.slice(8)), daysInMonth(`${pmMonth}-01`))).padStart(2, "0")}`;
    const pmR = board.range(`${pmMonth}-01`, pmTo);
    const ly = sameDayYearsAgo(date);
    const lyR = board.range(monthStart(ly), ly);
    let line = `이달 누계 ${f(month)}`;
    if (comparable(pmR)) line += ` — 지난달 같은 기간 ${f(valueOf(pmR, key))}보다 ${updown(change(month, valueOf(pmR, key)))}`;
    if (comparable(lyR)) line += `${comparable(pmR) ? ", " : " — "}작년 같은 달 같은 기간 ${f(valueOf(lyR, key))}보다 ${updown(change(month, valueOf(lyR, key)))}`;
    out.push(line + ".");
  }

  // 5) 항목별 설명
  if (["바리스타", "베이커리", "키친", "키즈입장료", "기타"].includes(key) && today.total > 0)
    out.push(`이날 총 매출 중 ${label} 비중은 ${((v / today.total) * 100).toFixed(1)}%입니다.`);
  if (key === "키즈입장료" || key === "tickets" || key === "naver" || key === "walkIn" || key === "eventFree") {
    const t = today.naver + today.walkIn;
    const { price, kind } = kidsPrice(date);
    out.push(`${kind} 단가 ${won(price)} × 입장권 ${count(t, "장")} (네이버 ${count(today.naver, "장")} · 현장 ${count(today.walkIn, "장")}) = ${won(t * price)}.`);
    if (t > 0) out.push(`입장권 중 네이버 예약 비중은 ${((today.naver / t) * 100).toFixed(0)}%입니다.`);
    out.push(`네이버 예약 = 입장 발행 ${count(today.issued, "장")} − 현장 구매 ${count(today.walkIn, "장")} = ${count(today.naverPos, "장")}${today.eventFree ? ` · 이벤트 무료입장 ${count(today.eventFree, "팀")}은 입장료에서 뺌` : ""}.`);
    if (today.naverAdjusted) out.push(`네이버 예약은 ${count(today.naverPos, "장")}을 ${count(today.naver, "장")}으로 고친 값으로 계산했습니다.`);
  }
  if (key === "visitors") out.push(`음료·맥주 ${count(today.cups, "잔")} × ${VISITOR_FACTOR} = ${count(today.visitors, "명")} (두 잔 마시는 손님을 감안한 추정).`);
  if (key === "avgSpend") out.push(`총 매출 ${won(today.total)} ÷ 추정 방문자 ${count(today.visitors, "명")} = ${won(v)}.`);
  if (key === "기타" && today.kidsOtherNet !== 0) out.push(`기타에는 키즈 POS 의 입장권 외 매출(추가 인원·간식 등) ${won(today.kidsOtherNet)}이 들어 있습니다.`);
  if (key === "total" && today.walkInPosNet !== today.fee.walkIn)
    out.push(`키즈 현장 입장권은 POS 실결제 ${won(today.walkInPosNet)} 대신 단가 계산 ${won(today.fee.walkIn)}으로 넣었습니다 (네이버 입장권 ${won(today.fee.naver)} 포함).`);
  return out;
}

/** 요일 이름 (월~일) 순서용 */
export function weekdayOrder(date: string): number {
  return (weekday(date) + 6) % 7;
}

/* ---------- 누계 상세 ---------- */

export interface CumulativeView {
  kind: "month" | "year";
  /** 올해(이달) 누계 */
  cur: Metrics;
  /** 작년 같은 기간 */
  ly: Metrics;
  /** 작년 그 달(그 해) 전체 */
  lyFull: Metrics;
  /** 지난달 같은 기간 (월 누계일 때만) */
  prev: Metrics | null;
  lines: string[];
}

/** 당월 누계 · 올해 누계 상세 — 비교 숫자와 분석 문장 */
export function cumulative(board: Board, kind: "month" | "year", date: string): CumulativeView {
  const ly = sameDayYearsAgo(date);
  const from = kind === "month" ? monthStart(date) : `${date.slice(0, 4)}-01-01`;
  const lyFrom = kind === "month" ? monthStart(ly) : `${ly.slice(0, 4)}-01-01`;
  const lyEnd = kind === "month" ? `${monthOf(ly)}-${String(daysInMonth(ly)).padStart(2, "0")}` : `${ly.slice(0, 4)}-12-31`;
  const cur = board.range(from, date);
  const lyR = board.range(lyFrom, ly);
  const lyFull = board.range(lyFrom, lyEnd);
  let prev: Metrics | null = null;
  if (kind === "month") {
    const pm = addMonths(monthOf(date), -1);
    const pmTo = `${pm}-${String(Math.min(Number(date.slice(8)), daysInMonth(`${pm}-01`))).padStart(2, "0")}`;
    prev = board.range(`${pm}-01`, pmTo);
  }
  const what = kind === "month" ? "이달" : "올해";
  const days = dayRange(from, date).length;
  const lines: string[] = [];
  lines.push(`${what} ${md(from)}~${md(date)} ${days}일 누계 ${won(cur.total)}, 하루 평균 ${won(Math.round(cur.total / Math.max(1, days)))}.`);
  if (comparable(lyR)) lines.push(`작년 같은 기간 ${won(lyR.total)}보다 ${updown(change(cur.total, lyR.total))}.`);
  else if (hasData(lyR)) lines.push(`작년 같은 기간은 자료가 ${Math.max(lyR.has.cafe, lyR.has.kids)}일치뿐이라 비교하지 않았습니다 (지난 엑셀을 넣으면 비교됩니다).`);
  else lines.push("작년 같은 기간 자료가 없습니다 (지난 엑셀을 넣으면 비교됩니다).");
  if (prev && comparable(prev)) lines.push(`지난달 같은 기간 ${won(prev.total)}보다 ${updown(change(cur.total, prev.total))}.`);
  if (comparable(lyFull) && lyFull.total > 0)
    lines.push(`작년 ${kind === "month" ? `${Number(ly.slice(5, 7))}월 한 달` : "한 해"} 전체 ${won(lyFull.total)}의 ${((cur.total / lyFull.total) * 100).toFixed(1)}%를 채웠습니다.`);
  if (cur.total > 0) {
    const parts = BOXES.map((b) => `${b === "키즈입장료" ? "키즈 입장료" : b} ${((cur.box[b] / cur.total) * 100).toFixed(0)}%`).join(" · ");
    lines.push(`구성: ${parts}.`);
  }
  if (cur.visitors > 0) lines.push(`추정 방문자 ${count(cur.visitors, "명")}, 1인 평균 ${won(cur.avgSpend || 0)}.`);
  if (cur.naver + cur.walkIn > 0) lines.push(`키즈 입장권 ${count(cur.naver + cur.walkIn, "장")} (네이버 ${count(cur.naver, "장")} · 현장 ${count(cur.walkIn, "장")}).`);
  return { kind, cur, ly: lyR, lyFull, prev, lines };
}

/* ---------- 날씨와 함께 본 분석 ---------- */

/** 그날 날씨·기간 한 줄 + 최근 90일 비·눈 온 날과 맑은·구름 낀 날의 평균 비교 (날씨 자료가 있는 날만) */
export function analyzeWeather(board: Board, key: MetricKey, date: string, weather: WeatherMap): string[] {
  const out: string[] = [];
  const w = weather[date];
  const s = seasonOf(date);
  if (w)
    out.push(
      `이날 날씨 ${w.icon} ${w.label}, 최고 ${temp(w.tempMax)} · 최저 ${temp(w.tempMin)}${w.rainMm ? ` · 강수 ${w.rainMm}mm` : ""} (${WEATHER_SOURCE_TEXT[w.source]}) · ${s.emoji} ${s.kind}${s.name ? `(${s.name})` : ""}.`,
    );
  else out.push(`이날 날씨 자료가 없습니다 · ${s.emoji} ${s.kind}${s.name ? `(${s.name})` : ""}.`);
  const wet: number[] = [];
  const dry: number[] = [];
  for (const p of dailySeries(board, key, date, 90)) {
    const x = weather[p.x];
    if (p.v == null || !x) continue;
    (x.key === "rain" || x.key === "heavyrain" || x.key === "snow" ? wet : dry).push(p.v);
  }
  const a = mean(wet);
  const b = mean(dry);
  if (wet.length >= 3 && dry.length >= 3 && a != null && b != null && b > 0)
    out.push(`최근 90일 비·눈 온 날(${wet.length}일) 하루 평균 ${formatMetric(key, Math.round(a))} — 맑거나 흐린 날 ${formatMetric(key, Math.round(b))}보다 ${updown(change(a, b))}.`);
  return out;
}
