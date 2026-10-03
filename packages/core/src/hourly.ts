/* ============================================================
   섹터 상세 — 시간대별 매출 (10시 ~ 22시, 한 시간씩) · 4주 같은 요일 비교 · 분석 · 다음 주 예측 · 하위 5개 상품
   (11-3 · 11-4) 숫자에서 바로 만든 설명만 씀 (추측 없음, 예측은 계산 방법을 밝힘)
   - 마감일 막대: 그 섹터의 시간대별 실매출, 막대 위 = 그 시간 추정 인원 (카페 음료 잔 × 0.96)
     키즈입장료는 시간대별 입장권(네이버 예약 시간 + 현장 결제 시각) × 단가, 막대 위 = 입장권 수
   - 4주 같은 요일 평균: 마감일 앞 7 · 14 · 21 · 28일 중 시간대 자료가 있는 날의 평균
   - 추세: 4주 전 → 마감일 다섯 번의 시간대별 매출 선 + 시간마다 오름 ▲ · 내림 ▼ (주당 5% 넘게 변하면)
   ============================================================ */
import { addDays, dayRange, monthStart, weekdayLabel } from "./dates";
import { holidayName, isOffDay, kidsPrice, kidsSales, VISITOR_FACTOR } from "./rules";
import { wonMan } from "./format";
import { HOURS, sum } from "./part";
import { valueOf, type Board, type BoxKey, type ProductRow } from "./metrics";
import type { WeatherMap } from "./weather";

export interface HourDay {
  date: string;
  /** 시간대별 매출 (HOURS 순서) */
  sales: number[];
  /** 시간대별 추정 인원 (키즈입장료는 입장권 수) */
  people: number[];
  total: number;
}

const zeros = () => HOURS.map(() => 0);
const add = (a: number[], b?: number[] | null) => (b ? a.map((x, i) => x + (b[i] || 0)) : a);

/** 그날 그 섹터의 시간대별 매출 (시간대 자료가 없으면 null) */
export function hourDay(board: Board, date: string, box: BoxKey): HourDay | null {
  const r = board.report(date);
  if (!r) return null;
  const ch = r.cafe?.hourly || null;
  const kh = r.kids?.kids?.hourly || null;
  const cafePeople = ch ? ch.cups.map((c) => Math.round(c * VISITOR_FACTOR)) : zeros();
  let sales: number[];
  let people: number[];
  if (box === "키즈입장료") {
    // 네이버는 예약 시간(30분 칸 두 개 = 한 시간), 현장은 결제 시각. 네이버를 안 넣은 날은 POS 입장 발행 시각
    let tickets: number[];
    if (r.naver) {
      if (!kh && !r.kids) return null;
      tickets = HOURS.map((_, i) => (r.naver!.tickets[i * 2] || 0) + (r.naver!.tickets[i * 2 + 1] || 0));
      tickets = add(tickets, kh?.walkIn);
    } else if (kh) tickets = [...kh.issued];
    else return null;
    const { price } = kidsPrice(date);
    sales = tickets.map((t) => t * price);
    people = tickets;
  } else if (box === "기타") {
    if (!ch && !kh) return null;
    sales = add(ch ? [...ch.sectors.기타] : zeros(), kidsSales(date) ? kh?.other : null);
    people = cafePeople;
  } else {
    if (!ch) return null;
    sales = [...ch.sectors[box]];
    people = cafePeople;
  }
  return { date, sales, people, total: sum(sales) };
}

/** 마감일 앞 같은 요일 (7 · 14 · 21 · 28일 전) */
export function sameWeekdays(date: string, n = 4): string[] {
  return Array.from({ length: n }, (_, i) => addDays(date, -7 * (i + 1)));
}

/** 지난 4주 같은 요일 시간대별 평균 (자료 있는 날만) */
export function weeksAverage(board: Board, date: string, box: BoxKey): { sales: (number | null)[]; people: (number | null)[]; dates: string[] } {
  const days = sameWeekdays(date)
    .map((d) => hourDay(board, d, box))
    .filter((x): x is HourDay => !!x);
  if (!days.length) return { sales: HOURS.map(() => null), people: HOURS.map(() => null), dates: [] };
  const avg = (f: (d: HourDay) => number[]) => HOURS.map((_, i) => Math.round(days.reduce((s, d) => s + f(d)[i], 0) / days.length));
  return { sales: avg((d) => d.sales), people: avg((d) => d.people), dates: days.map((d) => d.date) };
}

/** 최소제곱 기울기 (x 한 칸당) — 점이 2개 미만이면 null */
export function slope(points: [number, number][]): number | null {
  if (points.length < 2) return null;
  const mx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const my = points.reduce((s, p) => s + p[1], 0) / points.length;
  const den = points.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  return den ? points.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / den : 0;
}

export interface WeeksTrend {
  /** 오래된 것 → 마감일 (자료 있는 날만) */
  days: (HourDay & { weeksAgo: number })[];
  /** 시간마다 방향: 1 오름 · -1 내림 · 0 비슷 · null 자료 부족 */
  dir: (1 | 0 | -1 | null)[];
  /** 시간마다 주당 변화율 (%) */
  rate: (number | null)[];
}

/** 시간대별 4주 같은 요일 추세 (마감일 포함 다섯 번) */
export function weeksTrend(board: Board, date: string, box: BoxKey): WeeksTrend {
  const days = [4, 3, 2, 1, 0]
    .map((w) => {
      const h = hourDay(board, addDays(date, -7 * w), box);
      return h ? { ...h, weeksAgo: w } : null;
    })
    .filter((x): x is HourDay & { weeksAgo: number } => !!x);
  const rate: (number | null)[] = [];
  const dir: (1 | 0 | -1 | null)[] = [];
  const dayAvg = days.length ? days.reduce((s, d) => s + d.total, 0) / days.length / HOURS.length : 0;
  HOURS.forEach((_, i) => {
    if (days.length < 3) {
      rate.push(null);
      dir.push(null);
      return;
    }
    const pts = days.map((d) => [-d.weeksAgo, d.sales[i]] as [number, number]);
    const mean = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const k = slope(pts) || 0;
    // 아주 작은 시간(하루 시간당 평균의 15% 미만)은 방향을 따지지 않음
    if (mean <= 0 || mean < dayAvg * 0.15) {
      rate.push(null);
      dir.push(0);
      return;
    }
    const r = Math.round((k / mean) * 1000) / 10;
    rate.push(r);
    dir.push(r >= 5 ? 1 : r <= -5 ? -1 : 0);
  });
  return { days, dir, rate };
}

/* ---------- 분석 (11-4) ---------- */

export const BLOCKS = [
  { name: "오전", label: "10~12시", idx: [0, 1] },
  { name: "점심", label: "12~14시", idx: [2, 3] },
  { name: "디저트 시간", label: "14~15시", idx: [4] },
  { name: "오후", label: "15~17시", idx: [5, 6] },
  { name: "저녁", label: "17~20시", idx: [7, 8, 9] },
  { name: "밤", label: "20~22시", idx: [10, 11] },
];
export const PEAKS = [
  { name: "점심 피크", label: "12~14시", idx: [2, 3] },
  { name: "디저트 피크", label: "14~15시", idx: [4] },
  { name: "저녁 피크", label: "18~20시", idx: [8, 9] },
];

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const pctText = (v: number) => `${Math.round(v)}%`;
const share = (d: HourDay, idx: number[]) => (d.total > 0 ? (idx.reduce((s, i) => s + d.sales[i], 0) / d.total) * 100 : 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const changeWord = (now: number, base: number) => {
  if (!(base > 0)) return "";
  const p = Math.round(((now - base) / base) * 100);
  return Math.abs(p) < 5 ? "비슷합니다" : p > 0 ? `${p}% 높습니다` : `${-p}% 낮습니다`;
};
/** 하루 매출의 절반을 채운 시각 (시간 칸 끝, 예: 14 → '14시까지') */
function halfHour(sales: number[]): number | null {
  const t = sum(sales);
  if (!(t > 0)) return null;
  let acc = 0;
  for (let i = 0; i < sales.length; i++) {
    acc += sales[i];
    if (acc >= t / 2) return HOURS[i] + 1;
  }
  return null;
}
const upTo = (sales: number[], hour: number) => {
  const t = sum(sales);
  return t > 0 ? (sum(sales.slice(0, hour - HOURS[0])) / t) * 100 : 0;
};

const wet = (k?: string) => k === "rain" || k === "heavyrain" || k === "snow";

/** 4주 추세를 보고 쓴 분석 문장 */
export function hourlyInsights(board: Board, date: string, box: BoxKey, weather: WeatherMap = {}): string[] {
  const out: string[] = [];
  const D = hourDay(board, date, box);
  if (!D) return ["마감일 시간대 자료가 없습니다 — 영수증별 엑셀로 올린 날만 시간대 분석이 됩니다."];
  if (!(D.total > 0)) return ["마감일 이 섹터 매출이 없습니다."];
  const trend = weeksTrend(board, date, box);
  const prev = trend.days.filter((d) => d.weeksAgo > 0);
  const wd = weekdayLabel(date);

  // ① 시간대별 손님 선호 이동
  if (prev.length >= 2) {
    const pts = trend.days.filter((d) => d.total > 0);
    const moves = BLOCKS.map((b) => ({ ...b, k: slope(pts.map((d) => [-d.weeksAgo, share(d, b.idx)])) || 0, first: share(pts[0], b.idx), last: share(D, b.idx) }));
    const up = moves.reduce((a, b) => (b.k > a.k ? b : a));
    const down = moves.reduce((a, b) => (b.k < a.k ? b : a));
    const span = `${prev[0].weeksAgo}주 전(${md(prev[0].date)})`;
    if (up.k >= 1.5 && down.k <= -1.5)
      out.push(`손님이 몰리는 시간이 ${down.name}(${down.label})에서 ${up.name}(${up.label})로 옮겨가고 있습니다 — ${span}과 비교해 ${down.name} 비중 ${pctText(down.first)}→${pctText(down.last)}, ${up.name} ${pctText(up.first)}→${pctText(up.last)}.`);
    else if (up.k >= 1.5) out.push(`${up.name}(${up.label}) 비중이 커지고 있습니다 — ${span} ${pctText(up.first)} → 마감일 ${pctText(up.last)}.`);
    else if (down.k <= -1.5) out.push(`${down.name}(${down.label}) 비중이 줄고 있습니다 — ${span} ${pctText(down.first)} → 마감일 ${pctText(down.last)}.`);
    else {
      const top = BLOCKS.map((b) => ({ ...b, s: mean(pts.map((d) => share(d, b.idx))) })).reduce((a, b) => (b.s > a.s ? b : a));
      out.push(`4주 동안 시간대별 비중은 큰 변화가 없습니다 — 가장 많이 파는 때는 ${top.name}(${top.label}), 하루 매출의 ${pctText(top.s)}.`);
    }
  } else out.push(`같은 ${wd}요일 시간대 자료가 ${prev.length}주치뿐이라 4주 추세는 자료가 더 쌓이면 나옵니다.`);

  // ② 피크 집중도 (점심 · 2~3시 디저트 · 저녁)
  if (prev.length >= 2) {
    const parts: string[] = [];
    for (const p of PEAKS) {
      const vals = trend.days.map((d) => [-d.weeksAgo, p.idx.reduce((s, i) => s + d.sales[i], 0)] as [number, number]);
      const avgPrev = mean(prev.map((d) => p.idx.reduce((s, i) => s + d.sales[i], 0)));
      const now = p.idx.reduce((s, i) => s + D.sales[i], 0);
      if (!(avgPrev > 0) && !(now > 0)) continue;
      const k = slope(vals) || 0;
      const base = mean(vals.map((v) => v[1]));
      const r = base > 0 ? (k / base) * 100 : 0;
      const flow = r <= -5 ? `흐름 ▼ 주마다 약 ${Math.round(-r)}%씩 줄어듦` : r >= 5 ? `흐름 ▲ 주마다 약 ${Math.round(r)}%씩 늘어남` : "흐름 큰 변화 없음";
      const diff = avgPrev > 0 ? Math.round(((now - avgPrev) / avgPrev) * 100) : null;
      parts.push(`${p.name}(${p.label}) 4주 평균 ${wonMan(Math.round(avgPrev))} → 마감일 ${wonMan(now)}${diff == null ? "" : ` (${diff > 0 ? "+" : ""}${diff}%)`}, ${flow}`);
    }
    for (const t of parts) out.push(`${t}.`);
    const conc = (d: HourDay) => share(d, PEAKS.flatMap((p) => p.idx));
    const before = mean(prev.map(conc));
    const now = conc(D);
    if (Math.abs(now - before) >= 3)
      out.push(`세 피크 시간의 비중 합은 4주 평균 ${pctText(before)} → 마감일 ${pctText(now)}로 ${now < before ? "낮아져, 피크 집중이 약해지고 다른 시간으로 퍼졌습니다" : "높아져, 피크에 더 몰렸습니다"}.`);
  }

  // ③ 비슷한 날씨의 같은 요일 · 매출 속도
  const w = weather[date];
  const v = valueOf(board.day(date), box) || 0;
  let refHalf: { hour: number | null; label: string; at14: number } | null = null;
  if (w) {
    const similar = dayRange(addDays(date, -364), addDays(date, -7))
      .filter((d) => weekdayLabel(d) === wd)
      .filter((d) => {
        const x = weather[d];
        return x && wet(x.key) === wet(w.key) && w.tempMax != null && x.tempMax != null && Math.abs(x.tempMax - w.tempMax) <= 4;
      })
      .filter((d) => (board.report(d)?.cafe || board.report(d)?.kids) && valueOf(board.day(d), box) != null)
      .slice(-6);
    if (similar.length) {
      const avg = mean(similar.map((d) => valueOf(board.day(d), box) || 0));
      out.push(
        `비슷한 날씨(${w.icon} ${w.label}, 최고 ${Math.round(w.tempMax ?? 0)}° 안팎)였던 지난 ${wd}요일 ${similar.length}번(${similar.map(md).join("·")}) 평균 ${wonMan(Math.round(avg))} — 마감일 ${wonMan(v)}은 ${changeWord(v, avg) || "비교할 수 없습니다"}.`,
      );
      const hs = similar.map((d) => hourDay(board, d, box)).filter((x): x is HourDay => !!x && x.total > 0);
      if (hs.length >= 2) {
        const avgSales = HOURS.map((_, i) => mean(hs.map((h) => h.sales[i])));
        refHalf = { hour: halfHour(avgSales), label: "비슷한 날씨의 같은 요일", at14: upTo(avgSales, 14) };
      }
    } else out.push(`최근 1년 안에 날씨가 비슷한(${w.icon} ${w.label}, 최고 ±4°) ${wd}요일 자료가 없어 날씨 비교는 아직 못 합니다.`);
  } else out.push("마감일 날씨 자료가 없어 날씨 비교는 건너뜁니다.");
  if (!refHalf && prev.length >= 1) {
    const avgSales = HOURS.map((_, i) => mean(prev.map((h) => h.sales[i])));
    refHalf = { hour: halfHour(avgSales), label: `지난 ${prev.length}주 같은 요일`, at14: upTo(avgSales, 14) };
  }
  const myHalf = halfHour(D.sales);
  if (refHalf && myHalf && refHalf.hour) {
    const diff = myHalf - refHalf.hour;
    const word = diff === 0 ? "같은 속도였습니다" : diff > 0 ? `${diff}시간 늦게 붙었습니다` : `${-diff}시간 빨리 붙었습니다`;
    out.push(`매출 속도: 마감일은 ${myHalf}시까지 하루 매출의 절반을 채워 ${refHalf.label}(${refHalf.hour}시)보다 ${word} · 오후 2시까지 누적 ${pctText(upTo(D.sales, 14))} (${refHalf.label} ${pctText(refHalf.at14)}).`);
  }

  // ④ 다음 주 같은 요일 예측
  const f = forecastNext(board, date, box);
  if (f) {
    const hol = holidayName(f.date);
    const note = hol ? ` 그날은 공휴일(${hol})이라 평소 ${wd}요일과 다를 수 있습니다.` : isOffDay(f.date) !== isOffDay(date) ? ` 마감일과 휴일 여부가 달라 차이가 날 수 있습니다.` : "";
    out.push(
      `다음 주 ${md(f.date)}(${wd}) 예상 ${wonMan(f.value)} (${wonMan(f.low)}~${wonMan(f.high)})${f.peak != null ? ` · 가장 바쁜 시간 예상 ${f.peak}시` : ""} — 최근 ${f.n}번의 같은 요일 흐름으로 계산 (날씨는 넣지 않음).${note}`,
    );
  }
  return out;
}

/** 다음 주 같은 요일 예상 — 최근 5번(마감일 포함) 같은 요일 값의 평균과 직선 추세를 반씩 */
export function forecastNext(board: Board, date: string, box: BoxKey): { date: string; value: number; low: number; high: number; peak: number | null; n: number } | null {
  const pts: [number, number][] = [];
  for (const w of [4, 3, 2, 1, 0]) {
    const d = addDays(date, -7 * w);
    const r = board.report(d);
    if (!r || (!r.cafe && !r.kids && !r.naver)) continue;
    const v = valueOf(board.day(d), box);
    if (v != null) pts.push([-w, v]);
  }
  if (pts.length < 3) return null;
  const avg = mean(pts.slice(-4).map((p) => p[1]));
  const k = slope(pts) || 0;
  const mx = mean(pts.map((p) => p[0]));
  const my = mean(pts.map((p) => p[1]));
  const line = my + k * (1 - mx);
  const value = Math.max(0, Math.round((avg + line) / 2));
  const resid = Math.sqrt(mean(pts.map(([x, y]) => (y - (my + k * (x - mx))) ** 2)));
  const band = Math.max(resid, value * 0.1);
  const hours = [4, 3, 2, 1, 0].map((w) => hourDay(board, addDays(date, -7 * w), box)).filter((x): x is HourDay => !!x && x.total > 0);
  let peak: number | null = null;
  if (hours.length) {
    const prof = HOURS.map((_, i) => mean(hours.map((h) => h.sales[i])));
    peak = HOURS[prof.indexOf(Math.max(...prof))];
  }
  return { date: addDays(date, 7), value, low: Math.max(0, Math.round(value - band)), high: Math.round(value + band), peak, n: pts.length };
}

/* ---------- 상품 하위 5개 (11-4) ---------- */

/** 옵션 · 0원 · 결제 수단은 순위에서 뺌 (키즈 0원 입장 발행은 셈) */
const OPTION = /추가|변경|연하게|진하게|시럽|less|no ice|테이크아웃|포장|캐리어|소스 따로|종이쿠폰|상품권|교환권|금액권/i;
function rankable(p: ProductRow): boolean {
  if (OPTION.test(p.name)) return false;
  if (p.team === "입장발행") return p.qty > 0;
  return p.net > 0 && p.qty > 0;
}

/** 적게 팔린 순 5개 — 그날(마감일에 팔린 것 중) · 그달(최근 90일 안에 팔린 적 있는 상품 중, 이달 0개 포함) */
export function bottomProducts(board: Board, date: string, box: BoxKey, span: "day" | "month", n = 5): ProductRow[] {
  const byQty = (a: ProductRow, b: ProductRow) => a.qty - b.qty || a.net - b.net || a.name.localeCompare(b.name);
  if (span === "day") return board.products(date, date, box).filter(rankable).sort(byQty).slice(0, n);
  const month = board.products(monthStart(date), date, box).filter(rankable);
  const seen = board.products(addDays(date, -90), date, box).filter(rankable);
  const have = new Set(month.map((p) => `${p.store}|${p.name}`));
  const zero = seen.filter((p) => !have.has(`${p.store}|${p.name}`)).map((p) => ({ ...p, qty: 0, net: 0, days: 0 }));
  return [...month, ...zero].sort(byQty).slice(0, n);
}

