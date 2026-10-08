/* ============================================================
   베이커리 작업지시 — 손님 수를 먼저 맞히고(①), 빵별 '손님 1명당 몇 개'를 곱해(②) 빵마다 몇 개 만들지 정함
   ① 예상 방문객 = 작년 기준 × 올해 수준(최근 2주 · 8주, 되돌림) × 날씨 × 기간 스티커
      - 작년 추종: 특별한 이벤트 · 홍보가 없으면 작년을 따라감 → 364일 전 앞뒤 같은 날 유형(평일 · 금요일 · 휴일)
      - 최근 동향 + 되돌림: 사람들은 1주 단위로 계획 · 월초에 많이 쓰면 월말엔 덜 씀
        → 올해 수준 = 8주 비율 + λ × (2주 비율 − 8주 비율). λ < 1 이면 최근 2주의 '뜻밖'이 일부 되돌아감
      - 날씨: 약한 · 중간 비, 아주 덥거나 추우면 실내로(손님 ↑) · 폭우 · 눈, 봄가을 쾌적한 날은 밖으로(손님 ↓)
        방향은 사장님 규칙, 크기는 지난 자료에서 배움(learnWeather). 작년 기준일 날씨와 견줘 비율로 곱함
      - 기간: 설정의 기간 스티커(성수기 · 평상시 · 비수기). 작년 기준일과 스티커가 다르면 그만큼 곱함
   ② 빵 총 개수 (2026-10 부터, forecastBread) — 비율은 A ⚙ 설정 (처음 30 · 30 · 40, 7 ~ 9월 · 4 ~ 6월 모두 오차 10% 안팎)
      = 작년 같은 날 무렵(364일 전 앞뒤 같은 날 유형 3일) × 추세 · 최근 같은 날 유형 2번 평균 · 작년 같은 주와 다음 주 × 추세
      추세 = 최근 28일 올해 빵 판매 ÷ 작년 같은 날. 그 위에 빵용 날씨 배수(breadWeatherFactor, 예보가 있는 날만) · 기간 배수
      ①의 손님용 날씨 배수는 빵에는 오히려 오차를 키워(시험 11.6% → 안 쓰면 10.5%) 손님 수 표시에만 씀
   ③ 빵별 수량 = 빵 총 개수 × 최근 14일 같은 날 유형에서 그 빵의 비율 (최근 날일수록 무겁게, 7일 지나면 반)
      작년 · 최근 빵 자료가 없으면 예전처럼 예상 방문객 × 방문객 1명당 개수
   계산은 여기 한 곳 — 작업지시 앱 · GitHub 예약 작업이 같은 식을 씀
   ============================================================ */
import { addDays, dayRange, weekday } from "./dates";
import type { Board } from "./metrics";
import { holidayName, NOT_BREAD } from "./rules";
import { currentSettings, DEFAULT_BREAD_WEIGHTS, type BreadWeights } from "./settings";
import { seasonOf, type DayWeather, type WeatherMap } from "./weather";

export type DayKind = "평일" | "금요일" | "휴일";
export type WeatherClass = "쾌적" | "보통" | "더움" | "추움" | "약한비" | "중간비" | "폭우" | "눈" | "모름";

/** 날씨 칸별 손님 배수 — 자료가 없을 때 쓰는 사장님 규칙 (방향) */
export const WEATHER_PRIOR: Record<WeatherClass, number> = {
  쾌적: 0.95,
  보통: 1,
  더움: 1.05,
  추움: 1.05,
  약한비: 1.05,
  중간비: 1.05,
  폭우: 0.85,
  눈: 0.85,
  모름: 1,
};
export const WEATHER_CLASSES = Object.keys(WEATHER_PRIOR) as WeatherClass[];

/** 되돌림 세기 λ — 최근 2주의 '뜻밖'을 얼마나 믿나 (1 = 그대로, 0 = 8주 수준으로 완전히 되돌림) */
export const TREND_LAMBDA = 0.5;
/** 빵 선호도를 보는 기간 (같은 날 유형만) */
export const RATE_DAYS = 28;

export function dayKind(date: string): DayKind {
  const w = weekday(date);
  if (w === 0 || w === 6 || holidayName(date)) return "휴일";
  return w === 5 ? "금요일" : "평일";
}

export function weatherClass(w?: DayWeather | null): WeatherClass {
  if (!w) return "모름";
  const rain = w.rainMm ?? 0;
  if (w.key === "snow") return "눈";
  if (w.key === "heavyrain" || rain >= 30) return "폭우";
  if (w.key === "rain" || rain >= 1) return rain >= 10 ? "중간비" : "약한비";
  if (w.tempMax != null && w.tempMax >= 30) return "더움";
  if (w.tempMax != null && w.tempMax <= 3) return "추움";
  if (w.tempMax != null && w.tempMax >= 15 && w.tempMax <= 27) return "쾌적";
  return w.tempMax == null ? "모름" : "보통";
}

/** 카페 방문객 (카페 자료가 없는 날은 null) */
function visitorsOn(board: Board, d: string): number | null {
  const r = board.report(d);
  if (!r?.cafe) return null;
  const v = board.day(d).visitors;
  return v > 0 ? v : null;
}

/** 작년 기준일 — 364일 전 앞뒤 2주 안에서 같은 날 유형, 가까운 3일 */
export function lyDays(board: Board, date: string): string[] {
  const kind = dayKind(date);
  const center = addDays(date, -364);
  const cands: { d: string; gap: number }[] = [];
  for (let k = -14; k <= 14; k++) {
    const d = addDays(center, k);
    if (dayKind(d) === kind && visitorsOn(board, d) != null) cands.push({ d, gap: Math.abs(k) });
  }
  return cands
    .sort((a, b) => a.gap - b.gap || (a.d < b.d ? -1 : 1))
    .slice(0, 3)
    .map((c) => c.d)
    .sort();
}

/** 올해 ÷ 작년 (asOf 까지 n 일, 둘 다 자료 있는 날만) */
export function yoyRatio(board: Board, asOf: string, n: number): number | null {
  let cur = 0;
  let ly = 0;
  let days = 0;
  for (const d of dayRange(addDays(asOf, -(n - 1)), asOf)) {
    const a = visitorsOn(board, d);
    const b = visitorsOn(board, addDays(d, -364));
    if (a == null || b == null) continue;
    cur += a;
    ly += b;
    days++;
  }
  return days >= Math.min(5, n) && ly > 0 ? cur / ly : null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export interface Learned {
  /** 날씨 칸별 손님 배수 (지난 자료로 배운 값, 자료 적으면 사장님 규칙 쪽) */
  weather: Record<WeatherClass, number>;
  /** 칸마다 배운 날 수 */
  weatherDays: Record<WeatherClass, number>;
  /** 기간 스티커별 배수 */
  season: Record<string, number>;
  /** 되돌림 세기 (없으면 TREND_LAMBDA) */
  lambda?: number;
}

export const DEFAULT_LEARNED: Learned = {
  weather: { ...WEATHER_PRIOR },
  weatherDays: Object.fromEntries(WEATHER_CLASSES.map((c) => [c, 0])) as Record<WeatherClass, number>,
  season: { 성수기: 1, 평상시: 1, 비수기: 1 },
};

export interface VisitorForecast {
  date: string;
  kind: DayKind;
  value: number;
  /** 작년 기준 (기준일 평균) */
  base: number;
  baseDays: string[];
  /** 기준이 작년이 아니라 최근 4주일 때 */
  baseFrom: "작년" | "최근";
  trend: { r14: number | null; r56: number | null; used: number };
  weather: { cls: WeatherClass; lyCls: WeatherClass[]; factor: number };
  season: { kind: string; lyKind: string; factor: number };
}

/** 그날 방문객 예측 — asOf 까지의 실적만 씀 */
export function forecastVisitors(board: Board, weather: WeatherMap, asOf: string, date: string, learned: Learned = DEFAULT_LEARNED): VisitorForecast {
  const kind = dayKind(date);
  const ly = lyDays(board, date);
  const r14 = yoyRatio(board, asOf, 14);
  const r56 = yoyRatio(board, asOf, 56);
  let base: number;
  let baseFrom: VisitorForecast["baseFrom"] = "작년";
  let used = 1;
  if (ly.length && (r14 != null || r56 != null)) {
    base = avg(ly.map((d) => visitorsOn(board, d)!));
    const long = r56 ?? r14!;
    const short = r14 ?? long;
    used = clamp(long + (learned.lambda ?? TREND_LAMBDA) * (short - long), 0.5, 2);
  } else {
    // 작년 자료가 없으면 최근 4주 같은 날 유형 평균
    const recent = dayRange(addDays(asOf, -27), asOf)
      .filter((d) => dayKind(d) === kind)
      .map((d) => visitorsOn(board, d))
      .filter((v): v is number => v != null);
    base = avg(recent);
    baseFrom = "최근";
  }
  const cls = weatherClass(weather[date]);
  const lyCls = baseFrom === "작년" ? ly.map((d) => weatherClass(weather[d])) : [];
  const lyW = lyCls.length ? avg(lyCls.map((c) => learned.weather[c])) : 1;
  const wf = clamp(learned.weather[cls] / (lyW || 1), 0.6, 1.5);
  const sk = seasonOf(date).kind;
  const lyK = baseFrom === "작년" && ly.length ? seasonOf(ly[Math.floor(ly.length / 2)]).kind : sk;
  const sf = clamp((learned.season[sk] ?? 1) / (learned.season[lyK] ?? 1), 0.6, 1.6);
  const value = Math.max(0, Math.round(base * used * wf * sf));
  return { date, kind, value, base: Math.round(base), baseDays: ly, baseFrom, trend: { r14, r56, used }, weather: { cls, lyCls, factor: wf }, season: { kind: sk, lyKind: lyK, factor: sf } };
}

/** 지난 자료로 날씨 · 기간 배수 배우기 — until 까지, 작년 기준이 있는 날만 (예측과 실제의 비) */
export function learnWeather(board: Board, weather: WeatherMap, from: string, until: string): Learned {
  const logs: Record<string, number[]> = {};
  const slogs: Record<string, number[]> = {};
  for (const d of dayRange(from, until)) {
    const actual = visitorsOn(board, d);
    if (actual == null) continue;
    const f = forecastVisitors(board, weather, addDays(d, -2), d, { ...DEFAULT_LEARNED, weather: Object.fromEntries(WEATHER_CLASSES.map((c) => [c, 1])) as Record<WeatherClass, number> });
    if (f.baseFrom !== "작년" || !f.value) continue;
    const r = Math.log(actual / f.value);
    (logs[f.weather.cls] ||= []).push(r);
    (slogs[f.season.kind] ||= []).push(r);
  }
  const out: Learned = { weather: { ...WEATHER_PRIOR }, weatherDays: { ...DEFAULT_LEARNED.weatherDays }, season: { ...DEFAULT_LEARNED.season } };
  // 전체 평균을 빼서 칸 사이 차이만 봄 (작년보다 많이 온 해 전체 효과는 '올해 수준'이 이미 잡음)
  const all = Object.values(logs).flat();
  const mid = avg(all);
  for (const c of WEATHER_CLASSES) {
    const xs = logs[c] || [];
    out.weatherDays[c] = xs.length;
    if (!xs.length || c === "모름") continue;
    // 자료가 적으면 사장님 규칙 쪽으로 (8일이면 반반)
    const w = xs.length / (xs.length + 8);
    out.weather[c] = Math.exp(w * (avg(xs) - mid) + (1 - w) * Math.log(WEATHER_PRIOR[c]));
  }
  for (const k of Object.keys(out.season)) {
    const xs = slogs[k] || [];
    if (!xs.length) continue;
    const w = xs.length / (xs.length + 15);
    out.season[k] = Math.exp(w * (avg(xs) - mid));
  }
  return out;
}

export interface BreadLine {
  name: string;
  qty: number;
  /** 방문객 1명당 개수 */
  rate: number;
  /** 최근 같은 날 유형에 팔린 개수 (오래된 것 → 최근) */
  recent: number[];
}

export interface BreadPlan {
  date: string;
  visitors: VisitorForecast;
  /** 빵 총 개수 계산 (작년 · 최근 · 작년 다음 주) */
  bread?: BreadForecast;
  items: BreadLine[];
  total: number;
}

/* ---------- 빵 총 개수 (작년 · 최근 · 작년 다음 주) ---------- */

/** 추세를 보는 날 수 · 최근 같은 날 유형 몇 번 · 작년 앞뒤 몇 날 · 빵 비율을 보는 날 수 · 반감 날 수 */
export const BREAD_TREND_DAYS = 28;
export const BREAD_RECENT_SAME = 2;
/** 시험용(합치지 않음) */
export const RECENT_SAME = { weekday: false };
export const BREAD_LY_NEAR = 3;
export const SHARE_DAYS = 14;
export const SHARE_HALF_LIFE = 7;

/** 그날 빵 판매 개수 (베이커리 생산품만, 카페 자료가 없으면 null) */
function breadOn(board: Board, d: string): number | null {
  if (!board.report(d)?.cafe) return null;
  return board.products(d, d, "베이커리").reduce((a, p) => a + (NOT_BREAD.has(p.name) ? 0 : Math.max(0, p.qty)), 0);
}

/** center 앞뒤 10일 안에서 date 와 같은 날 유형 · 빵 자료가 있는 가까운 n 일 */
function nearSameKind(board: Board, date: string, center: string, n: number): string[] {
  const kind = dayKind(date);
  const c: { d: string; gap: number }[] = [];
  for (let k = -10; k <= 10; k++) {
    const d = addDays(center, k);
    if (dayKind(d) === kind && (breadOn(board, d) || 0) > 0) c.push({ d, gap: Math.abs(k) });
  }
  return c.sort((a, b) => a.gap - b.gap || (a.d < b.d ? -1 : 1)).slice(0, n).map((x) => x.d);
}

/** 추세 = asOf 까지 n 일 올해 빵 판매 ÷ 작년 같은 날 (둘 다 자료 있는 날만, 모르면 1) */
export function breadTrend(board: Board, asOf: string, n = BREAD_TREND_DAYS): number {
  let a = 0;
  let b = 0;
  for (const d of dayRange(addDays(asOf, -(n - 1)), asOf)) {
    const x = breadOn(board, d);
    const y = breadOn(board, addDays(d, -364));
    if (x == null || y == null) continue;
    a += x;
    b += y;
  }
  return b > 0 ? clamp(a / b, 0.5, 2) : 1;
}

export interface BreadForecast {
  date: string;
  /** 빵 총 개수 (날씨 · 기간 배수 전, 자료가 없으면 null) */
  value: number | null;
  weights: BreadWeights;
  trend: number;
  parts: { ly: number | null; recent: number | null; lyNext: number | null };
  days: { ly: string[]; recent: string[]; lyNext: string[] };
}

/** 그날 빵 총 개수 — asOf 까지 실적만. 비율은 A ⚙ 설정 (없는 몫은 빼고 나머지 비율로) */
export function forecastBread(board: Board, asOf: string, date: string): BreadForecast {
  const weights = currentSettings().bakeryWeights || DEFAULT_BREAD_WEIGHTS;
  const trend = breadTrend(board, asOf);
  const mean = (ds: string[]) => (ds.length ? avg(ds.map((d) => breadOn(board, d) || 0)) : null);
  const ly = nearSameKind(board, date, addDays(date, -364), BREAD_LY_NEAR);
  const lyNext = [...ly, ...nearSameKind(board, date, addDays(date, -357), BREAD_LY_NEAR)];
  const recent: string[] = [];
  // 시험용(합치지 않음): RECENT_SAME.weekday 면 최근 같은 '요일' 두 번 (평일 공휴일 대상은 날 유형만)
  const sameDow = RECENT_SAME.weekday && !(dayKind(date) === "휴일" && weekday(date) !== 0 && weekday(date) !== 6);
  for (let d = asOf; recent.length < BREAD_RECENT_SAME && d > addDays(asOf, -60); d = addDays(d, -1)) if (dayKind(d) === dayKind(date) && (!sameDow || weekday(d) === weekday(date)) && (breadOn(board, d) || 0) > 0) recent.push(d);
  const lyV = mean(ly);
  const parts = { ly: lyV == null ? null : lyV * trend, recent: mean(recent), lyNext: ly.length ? mean(lyNext)! * trend : null };
  let w = 0;
  let sum = 0;
  for (const k of ["ly", "recent", "lyNext"] as const) {
    const v = parts[k];
    if (v == null || !weights[k]) continue;
    w += weights[k];
    sum += weights[k] * v;
  }
  return { date, value: w ? sum / w : null, weights, trend, parts, days: { ly, recent, lyNext } };
}

/**
 * 빵용 날씨 배수 — 앞뒤 2주 같은 날 유형 대비 실적을 날씨별로 모은 시험(2025-01 ~ 2026-10, 642일)에서 뚜렷했던 칸만
 * 눈 −6% · 33도 넘음 +8% · 약한 비(0.5 ~ 5mm) −4% · 비 안 오는 20 ~ 30도(나들이 날씨) −4%. 나머지 · 날씨 모름은 1
 * 실측 날씨로 시험하면 빵 총 개수 오차 10.4% → 9.9% (7~9월), 10.2% → 9.5% (4~6월). 기상청 예보가 있는 날(3 ~ 4일 앞)만 효과
 */
export function breadWeatherFactor(w?: DayWeather | null): number {
  if (!w) return 1;
  const t = w.tempMax ?? 20;
  const r = w.rainMm ?? 0;
  if (w.key === "snow") return 0.94;
  if (t >= 33) return 1.08;
  if (r >= 0.5 && r < 5) return 0.96;
  if (r < 0.5 && t >= 20 && t < 30) return 0.96;
  return 1;
}

/** 빵별 비율 — 최근 SHARE_DAYS 일 같은 날 유형(2일 안 되면 모든 날)에서 그날 빵 판매 중 그 빵 몫, 최근 날일수록 무겁게 */
function breadShares(board: Board, asOf: string, kind: DayKind, active: Set<string>): Map<string, number> {
  const all = dayRange(addDays(asOf, -(SHARE_DAYS - 1)), asOf).filter((d) => (breadOn(board, d) || 0) > 0);
  let days = all.filter((d) => dayKind(d) === kind);
  if (days.length < 2) days = all;
  const m = new Map<string, number>();
  let t = 0;
  for (const d of days) {
    const age = (Date.parse(asOf) - Date.parse(d)) / 864e5;
    const wt = Math.pow(0.5, age / SHARE_HALF_LIFE);
    const total = breadOn(board, d) || 0;
    for (const p of board.products(d, d, "베이커리")) {
      if (!active.has(p.name) || p.qty <= 0) continue;
      const s = (wt * p.qty) / total;
      m.set(p.name, (m.get(p.name) || 0) + s);
      t += s;
    }
  }
  return new Map([...m].map(([n, s]) => [n, t ? s / t : 0]));
}

/** 빵별 수량 — 빵 총 개수(forecastBread × 날씨 · 기간 배수) × 빵별 비율. 빵 자료가 없으면 방문객 × 1명당 개수 */
export function breadPlan(board: Board, weather: WeatherMap, asOf: string, date: string, learned: Learned = DEFAULT_LEARNED): BreadPlan {
  const v = forecastVisitors(board, weather, asOf, date, learned);
  const fb = forecastBread(board, asOf, date);
  const days = dayRange(addDays(asOf, -(RATE_DAYS - 1)), asOf).filter((d) => visitorsOn(board, d) != null);
  let same = days.filter((d) => dayKind(d) === v.kind);
  if (same.length < 2) same = days;
  // 최근 2주에 팔린 빵 (딸기잼 같은 베이커리 생산품이 아닌 상품은 빼고 — 지난 자료엔 베이커리로 남아 있을 수 있음)
  const active = new Set(board.products(addDays(asOf, -13), asOf, "베이커리").map((p) => p.name).filter((n) => !NOT_BREAD.has(n)));
  let vis = 0;
  const qty = new Map<string, number[]>();
  for (const d of same) {
    vis += visitorsOn(board, d)!;
    const sold = new Map(board.products(d, d, "베이커리").map((p) => [p.name, p.qty]));
    for (const name of active) {
      const xs = qty.get(name) || [];
      xs.push(sold.get(name) || 0);
      qty.set(name, xs);
    }
  }
  const shares = fb.value != null ? breadShares(board, asOf, v.kind, active) : null;
  const total = fb.value != null ? fb.value * breadWeatherFactor(weather[date]) * v.season.factor : null;
  const items: BreadLine[] = [...qty.entries()]
    .map(([name, xs]) => {
      const rate = vis > 0 ? xs.reduce((a, b) => a + b, 0) / vis : 0;
      const q = shares && total != null ? (shares.get(name) || 0) * total : rate * v.value;
      return { name, rate, qty: Math.round(q), recent: xs };
    })
    .filter((x) => x.qty > 0)
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, "ko"));
  return { date, visitors: v, bread: fb, items, total: items.reduce((a, b) => a + b.qty, 0) };
}

/** 앞으로 1 ~ 4주차 — 평일 · 휴일 하루 평균 생산 개수 (날씨는 모름으로) */
export function weeklyOutlook(board: Board, asOf: string, start: string, learned: Learned = DEFAULT_LEARNED): { week: number; from: string; to: string; weekday: number | null; holiday: number | null }[] {
  const out: { week: number; from: string; to: string; weekday: number | null; holiday: number | null }[] = [];
  for (let w = 0; w < 4; w++) {
    const from = addDays(start, w * 7);
    const to = addDays(from, 6);
    const wd: number[] = [];
    const hd: number[] = [];
    for (const d of dayRange(from, to)) {
      const p = breadPlan(board, {}, asOf, d, learned);
      (p.visitors.kind === "휴일" ? hd : wd).push(p.total);
    }
    out.push({ week: w + 1, from, to, weekday: wd.length ? Math.round(avg(wd)) : null, holiday: hd.length ? Math.round(avg(hd)) : null });
  }
  return out;
}

/** 잠정 수량 묶기 — 처음 알려 준 수량에서 ±band 안으로만 (D+2 는 5%, D+3 은 10%) */
export function withinBand(first: number, now: number, band: number): number {
  const [lo, hi] = bandRange(first, band);
  return clamp(now, lo, hi);
}

/** 범위 — 소수 오차(50 × 1.1 = 55.000…01)로 한 개 더 넓어지지 않게 */
export function bandRange(first: number, band: number): [number, number] {
  return [Math.floor(first * (1 - band) + 1e-9), Math.ceil(first * (1 + band) - 1e-9)];
}

/** 시험 — 그날 lead 일 전에 예측했다면 얼마나 틀렸을까 (방문객 · 빵 총 개수, 절대 % 오차) */
export function backtest(board: Board, weather: WeatherMap, from: string, to: string, lead = 2, learned: Learned = DEFAULT_LEARNED) {
  const rows: { date: string; kind: DayKind; visitors: number; predicted: number; bread: number; breadPredicted: number }[] = [];
  for (const d of dayRange(from, to)) {
    const actual = visitorsOn(board, d);
    if (actual == null) continue;
    const p = breadPlan(board, weather, addDays(d, -lead), d, learned);
    const bread = board.products(d, d, "베이커리").reduce((a, x) => a + x.qty, 0);
    rows.push({ date: d, kind: p.visitors.kind, visitors: actual, predicted: p.visitors.value, bread, breadPredicted: p.total });
  }
  const mape = (xs: typeof rows, a: "visitors" | "bread", b: "predicted" | "breadPredicted") => {
    const ok = xs.filter((r) => r[a] > 0);
    return ok.length ? Math.round((avg(ok.map((r) => Math.abs(r[b] - r[a]) / r[a])) * 1000)) / 10 : null;
  };
  const by = (k?: DayKind) => {
    const xs = k ? rows.filter((r) => r.kind === k) : rows;
    return { days: xs.length, visitors: mape(xs, "visitors", "predicted"), bread: mape(xs, "bread", "breadPredicted") };
  };
  return { rows, all: by(), 평일: by("평일"), 금요일: by("금요일"), 휴일: by("휴일") };
}
