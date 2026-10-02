/* ============================================================
   일일 보고 계산 (순수 함수, 시험: test/report.test.ts)
   - 기준일(어제 마감) · 당월 누계 · 예상 월매출 · 지난주/작년 비교 · 팀별 · 키즈 입장 · 상품 순위 · 추이
   - 금액은 모두 실매출액(net). 반품·취소는 음수 그대로 더함
   아스타나 대표자 일일보고(report.ts)에서 POS 자료만으로 되는 부분을 가져옴
   ============================================================ */
import { addDays, addMonths, dayRange, daysInMonth, monthOf, monthStart, sameDayYearsAgo, weekday, weekdayLabel } from "./dates";
import { kidsKind, teamOf, TEAMS, type Team } from "./classify";
import type { PosId, Sale } from "./types";

export interface Agg {
  /** 실매출 합계 */
  net: number;
  gross: number;
  discount: number;
  /** POS 별 실매출 */
  byPos: Record<PosId, number>;
  /** 팀별 실매출 */
  byTeam: Record<Team, number>;
  /** 자료가 있는 날 수 (영업일) */
  days: number;
}

export interface KidsAgg {
  /** 현장 결제 입장권 장수 */
  walkIn: number;
  /** 네이버 예약 입장권 발행 장수 (0원 코드) — 근무자 추가 발행이 섞일 수 있음 */
  naver: number;
  /** 추가 인원 */
  extra: number;
  /** 입장권 합계 = 현장 + 네이버 */
  tickets: number;
  /** 입장 매출 (현장 입장권 + 추가 인원, 실매출) */
  admissionNet: number;
  /** 그 밖 (간식·음료 등) 실매출 */
  otherNet: number;
}

export interface ProductRow {
  name: string;
  team: Team;
  pos: PosId;
  qty: number;
  net: number;
  /** 쓰인 상품코드 (VAN 변경 전후로 다를 수 있음) */
  codes: string[];
  firstDate: string;
  lastDate: string;
}

export interface TrendPoint {
  date: string;
  cafe: number;
  kids: number;
  /** 그날 자료가 하나라도 있는지 */
  has: boolean;
}

export interface DailyReport {
  date: string;
  weekday: string;
  day: Agg;
  /** 지난주 같은 요일 */
  prevWeek: { date: string; agg: Agg };
  month: { from: string; agg: Agg; daysElapsed: number; daysInMonth: number };
  /** 지난달 1일 ~ 같은 날 */
  prevMonth: { from: string; to: string; net: number };
  /** 작년 같은 달 1일 ~ 같은 날, 작년 같은 날 */
  lastYear: { sameDay: string; sameDayNet: number; monthNet: number; monthFullNet: number; has: boolean };
  forecast: { net: number; basis: string };
  kids: { day: KidsAgg; month: KidsAgg };
  top: { day: ProductRow[]; month: ProductRow[] };
  trend: TrendPoint[];
  /** 기준일에 자료가 없는 POS (마감 송부를 안 했을 수 있음) */
  missing: PosId[];
}

function emptyAgg(): Agg {
  const byTeam = {} as Record<Team, number>;
  for (const t of TEAMS) byTeam[t] = 0;
  return { net: 0, gross: 0, discount: 0, byPos: { cafe: 0, kids: 0 }, byTeam, days: 0 };
}

function emptyKids(): KidsAgg {
  return { walkIn: 0, naver: 0, extra: 0, tickets: 0, admissionNet: 0, otherNet: 0 };
}

/** 날짜별로 묶어 둔 자료 — 한 번 만들어 여러 계산에 씀 */
export class SalesIndex {
  readonly byDate = new Map<string, Sale[]>();
  /** 날짜 → POS 별 자료 있음 */
  readonly present = new Map<string, Set<PosId>>();
  readonly first: string | null;
  readonly last: string | null;

  constructor(sales: Sale[], presentDays: { pos: PosId; date: string }[] = []) {
    for (const s of sales) {
      let list = this.byDate.get(s.date);
      if (!list) this.byDate.set(s.date, (list = []));
      list.push(s);
      this.mark(s.date, s.pos);
    }
    // 묶음은 왔지만 판매가 0줄인 날(휴무 등)도 '받음'으로
    for (const p of presentDays) this.mark(p.date, p.pos);
    const keys = [...this.present.keys()].sort();
    this.first = keys[0] ?? null;
    this.last = keys[keys.length - 1] ?? null;
  }

  private mark(date: string, pos: PosId) {
    let set = this.present.get(date);
    if (!set) this.present.set(date, (set = new Set()));
    set.add(pos);
  }

  day(date: string): Sale[] {
    return this.byDate.get(date) || [];
  }

  agg(from: string, to: string): Agg {
    const a = emptyAgg();
    if (from > to) return a;
    for (const d of dayRange(from, to)) {
      if (this.present.has(d)) a.days++;
      for (const s of this.day(d)) {
        a.net += s.net;
        a.gross += s.gross;
        a.discount += s.discount;
        a.byPos[s.pos] += s.net;
        a.byTeam[teamOf(s.pos, s)] += s.net;
      }
    }
    return a;
  }

  net(from: string, to: string): number {
    let n = 0;
    if (from > to) return 0;
    for (const d of dayRange(from, to)) for (const s of this.day(d)) n += s.net;
    return n;
  }

  has(from: string, to: string): boolean {
    if (from > to) return false;
    return dayRange(from, to).some((d) => this.present.has(d));
  }

  kids(from: string, to: string): KidsAgg {
    const k = emptyKids();
    if (from > to) return k;
    for (const d of dayRange(from, to))
      for (const s of this.day(d)) {
        if (s.pos !== "kids") continue;
        const kind = kidsKind(s);
        if (kind === "현장입장") {
          k.walkIn += s.qty;
          k.admissionNet += s.net;
        } else if (kind === "네이버입장") k.naver += s.qty;
        else if (kind === "추가인원") {
          k.extra += s.qty;
          k.admissionNet += s.net;
        } else k.otherNet += s.net;
      }
    k.tickets = k.walkIn + k.naver;
    return k;
  }

  /** 상품별 합계 (상품명 기준 — 코드가 달라도 이름이 같으면 같은 상품) */
  products(from: string, to: string): ProductRow[] {
    const map = new Map<string, ProductRow & { codeSet: Set<string> }>();
    if (from > to) return [];
    for (const d of dayRange(from, to))
      for (const s of this.day(d)) {
        const key = `${s.pos}|${s.name}`;
        let r = map.get(key);
        if (!r) map.set(key, (r = { name: s.name, team: teamOf(s.pos, s), pos: s.pos, qty: 0, net: 0, codes: [], codeSet: new Set(), firstDate: d, lastDate: d }));
        r.qty += s.qty;
        r.net += s.net;
        if (s.code) r.codeSet.add(s.code);
        r.lastDate = d;
      }
    return [...map.values()].map(({ codeSet, ...r }) => ({ ...r, codes: [...codeSet].sort() }));
  }

  trend(to: string, days: number): TrendPoint[] {
    return dayRange(addDays(to, -(days - 1)), to).map((date) => {
      const p: TrendPoint = { date, cafe: 0, kids: 0, has: this.present.has(date) };
      for (const s of this.day(date)) p[s.pos] += s.net;
      return p;
    });
  }
}

/** 많이 팔린 순 (실매출, 같으면 수량) */
export function topProducts(rows: ProductRow[], n: number): ProductRow[] {
  return [...rows].sort((a, b) => b.net - a.net || b.qty - a.qty).slice(0, n);
}

/**
 * 예상 월매출 = 이달 누계 + 남은 날마다 '최근 4주 같은 요일 평균'
 * (주말 매출이 커서 단순 일평균보다 맞음. 같은 요일 자료가 없으면 이달 일평균)
 */
export function forecastMonth(idx: SalesIndex, date: string): { net: number; basis: string } {
  const from = monthStart(date);
  const sofar = idx.net(from, date);
  const elapsed = Number(date.slice(8, 10));
  const total = daysInMonth(date);
  if (elapsed >= total) return { net: sofar, basis: "이달 마지막 날까지 모두 받음" };
  const dailyAvg = elapsed ? sofar / elapsed : 0;
  const byWeekday = new Map<number, number>();
  for (let w = 0; w < 7; w++) {
    const vals: number[] = [];
    for (let back = 1; back <= 28; back++) {
      const d = addDays(date, -back + 1);
      if (weekday(d) !== w || !idx.present.has(d)) continue;
      vals.push(idx.net(d, d));
    }
    byWeekday.set(w, vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : dailyAvg);
  }
  let rest = 0;
  for (const d of dayRange(addDays(date, 1), `${monthOf(date)}-${String(total).padStart(2, "0")}`)) rest += byWeekday.get(weekday(d)) || 0;
  return { net: Math.round(sofar + rest), basis: `이달 ${elapsed}일 누계 + 남은 ${total - elapsed}일은 최근 4주 같은 요일 평균` };
}

export function dailyReport(idx: SalesIndex, date: string): DailyReport {
  const from = monthStart(date);
  const elapsed = Number(date.slice(8, 10));
  const pw = addDays(date, -7);

  const pmMonth = addMonths(monthOf(date), -1);
  const pmFrom = `${pmMonth}-01`;
  const pmLast = daysInMonth(pmFrom);
  const pmTo = `${pmMonth}-${String(Math.min(elapsed, pmLast)).padStart(2, "0")}`;

  const ly = sameDayYearsAgo(date);
  const lyFrom = monthStart(ly);
  const lyEnd = `${monthOf(ly)}-${String(daysInMonth(ly)).padStart(2, "0")}`;

  const present = idx.present.get(date);
  return {
    date,
    weekday: weekdayLabel(date),
    day: idx.agg(date, date),
    prevWeek: { date: pw, agg: idx.agg(pw, pw) },
    month: { from, agg: idx.agg(from, date), daysElapsed: elapsed, daysInMonth: daysInMonth(date) },
    prevMonth: { from: pmFrom, to: pmTo, net: idx.net(pmFrom, pmTo) },
    lastYear: { sameDay: ly, sameDayNet: idx.net(ly, ly), monthNet: idx.net(lyFrom, ly), monthFullNet: idx.net(lyFrom, lyEnd), has: idx.has(lyFrom, ly) },
    forecast: forecastMonth(idx, date),
    kids: { day: idx.kids(date, date), month: idx.kids(from, date) },
    top: { day: topProducts(idx.products(date, date), 10), month: topProducts(idx.products(from, date), 10) },
    trend: idx.trend(date, 35),
    missing: (["cafe", "kids"] as PosId[]).filter((p) => !present?.has(p)),
  };
}

export interface MonthRow {
  month: string;
  net: number;
  cafe: number;
  kids: number;
  days: number;
  /** 작년 같은 달 실매출 (자료 없으면 null) */
  lastYear: number | null;
}

/** 최근 n 개월 (기준일이 든 달 포함, 그 달은 기준일까지) */
export function monthlyRows(idx: SalesIndex, date: string, n = 13): MonthRow[] {
  const out: MonthRow[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const month = addMonths(monthOf(date), -i);
    const from = `${month}-01`;
    const end = `${month}-${String(daysInMonth(from)).padStart(2, "0")}`;
    const to = end < date ? end : date;
    const a = idx.agg(from, to);
    const lyMonth = addMonths(month, -12);
    const lyFrom = `${lyMonth}-01`;
    const lyTo = i === 0 ? sameDayYearsAgo(date) : `${lyMonth}-${String(daysInMonth(lyFrom)).padStart(2, "0")}`;
    out.push({ month, net: a.net, cafe: a.byPos.cafe, kids: a.byPos.kids, days: a.days, lastYear: idx.has(lyFrom, lyTo) ? idx.net(lyFrom, lyTo) : null });
  }
  return out;
}

/** 증감률(%) — 비교 값이 0 이하면 null */
export function changePct(now: number, before: number): number | null {
  if (!(before > 0)) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}
