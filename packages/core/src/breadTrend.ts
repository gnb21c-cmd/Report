/* ============================================================
   빵 예측 — 같은 요일 추세 (2026-10-27 사장님, 11-02 계획부터 = 10-29 목요일 발표 주간안부터)
   - 지난 4주 같은 요일 실적(판매 개수) — asOf 까지 · 같은 평일/휴일인 날만 (공휴일 · 대체휴일은 건너뛰고 그 앞 주)
   - 작년 추세선 — 작년 '오늘'(발표하는 날의 364일 전) 앞뒤 4주의 같은 요일 · 같은 평일/휴일 빵 합계로 곧은 줄
     두 점씩 기울기의 가운데 값 · 가운데 높이 (작년 10-10 추석 직후 금요일이 평소의 두 배였던 것처럼 튀는 날 하나에 흔들리지 않게)
   - 비율 = 다음 주 그날의 작년 추세선 값 ÷ 지난 4주 날들의 작년 추세선 값 평균
     빵마다 = 지난 4주 같은 요일 평균 × 비율 (지난 4주 실적을 작년 추세선에 맞춘 배수로 다음 주 추세 수치)
   - 만드는 단위(몽블랑 5 · 팥앙금샌드 4 · 시나몬롤 10 · 우유모닝빵 2) · 평일 하루 300 ~ 320 은 bakery.ts 에서
   - 처음 판 날부터 28일(4주)이 안 된 빵 = 새 빵 → 예측하지 않고 매니저가 기입 (매니저 회의에서 정해 받음)
   - 쓰지 않음: 생산 늘림(평일 × 1.5 · 휴일 × 1.3) · 비 예보 주말(125% · 120%) · 매진 20시 40분 같은 요일 칸 · 자동 날씨 배수
   - 신뢰도: 지난 4주 실적이 작년 추세선에 고르게 맞는지 + (예보가 있으면) 그날 예보 최고기온이 지난 4주 같은 요일보다 크게 다른지
     — 날씨가 급격히 추워지거나 더워지면 지난 실적 · 작년 추세로 센 수치를 덜 믿을 수 있어 매니저가 보고 조정
   ============================================================ */
import { breadSold } from "./breadNames";
import { addDays, dayRange, weekday } from "./dates";
import { dayKind } from "./forecast";
import type { Board } from "./metrics";
import { NOT_BREAD } from "./rules";
import type { WeatherMap } from "./weather";

/** 새 방식으로 세는 첫 계획 날 (그 전 날짜 — 이미 발표한 주의 최종안은 예전 방식 그대로) */
export const TREND_FROM = "2026-11-02";
/** 지난 몇 주 같은 요일 */
export const TREND_WEEKS = 4;
/** 작년 '오늘' 앞뒤 며칠 */
export const TREND_LY_DAYS = 28;
/** 처음 판 날부터 이만큼(일)이 안 된 빵은 새 빵 — 매니저 기입 */
export const NEW_BREAD_DAYS = 28;
/** 최근 이만큼(일) 안에 팔린 빵만 계획에 */
export const TREND_ACTIVE_DAYS = 14;
/** 새 빵을 가릴 때 거슬러 보는 날 수 (그 전에 팔았다 다시 나온 빵도 새 빵으로) */
const FIRST_LOOKBACK = 90;
/** 신뢰도 — 지난 4주 배수가 들쭉날쭉한 정도(변동계수)가 이 아래면 높음 · 보통 */
export const TRUST_SPREAD = { 높음: 0.1, 보통: 0.2 } as const;
/** 신뢰도 — 그날 예보 최고기온이 지난 4주 같은 요일 평균과 이만큼(도) 넘게 다르면 보통 · 낮음 */
export const TRUST_TEMP = { 보통: 3, 낮음: 5 } as const;

const isHol = (d: string) => dayKind(d) === "휴일";

/* 같은 Board 로 여러 번 셀 때 하루 판매를 다시 모으지 않게 */
const cache = new WeakMap<Board, Map<string, Map<string, number>>>();
/** 그날 빵 판매 — 계획 날(asName) 기준 이름으로 묶음, 생산품이 아닌 상품(잼 등) · 0 개 빼고 */
function soldOn(board: Board, d: string, asName: string): Map<string, number> {
  let byKey = cache.get(board);
  if (!byKey) cache.set(board, (byKey = new Map()));
  const key = `${d}|${asName}`;
  let m = byKey.get(key);
  if (!m) {
    m = new Map();
    if (board.report(d)?.cafe) for (const [n, q] of breadSold(board, d, asName)) if (!NOT_BREAD.has(n) && q > 0) m.set(n, q);
    byKey.set(key, m);
  }
  return m;
}
const totalOn = (board: Board, d: string) => [...soldOn(board, d, "9999-12-31").values()].reduce((a, b) => a + b, 0);

/** 그 날짜(D)의 지난 4주 같은 요일 — asOf 까지 · 같은 평일/휴일 · 빵 자료가 있는 날 (가까운 것부터) */
export function trendPastDays(board: Board, date: string, asOf: string): string[] {
  const out: string[] = [];
  for (let d = addDays(date, -7); out.length < TREND_WEEKS && d > addDays(date, -7 * (TREND_WEEKS + 8)); d = addDays(d, -7)) {
    if (d <= asOf && isHol(d) === isHol(date) && totalOn(board, d) > 0) out.push(d);
  }
  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export interface TrendLine {
  /** 줄을 그은 작년 날 수 */
  n: number;
  /** 그 날짜(작년)의 줄 위 값 */
  at: (d: string) => number;
}
/** 작년 추세선 — 작년 '오늘'(today − 364) 앞뒤 28일의 같은 요일 · 같은 평일/휴일 빵 합계 (3점이 안 되면 null) */
export function lyTrendLine(board: Board, date: string, today: string): TrendLine | null {
  const center = addDays(today, -364);
  const pts: [number, number][] = [];
  for (let k = -TREND_LY_DAYS; k <= TREND_LY_DAYS; k++) {
    const d = addDays(center, k);
    if (weekday(d) !== weekday(date) || isHol(d) !== isHol(date)) continue;
    const t = totalOn(board, d);
    if (t > 0) pts.push([k, t]);
  }
  if (pts.length < 3) return null;
  const slopes: number[] = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) slopes.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
  const b = median(slopes);
  const c = median(pts.map(([x, y]) => y - b * x));
  const c0 = Date.parse(center);
  return { n: pts.length, at: (d) => c + b * ((Date.parse(d) - c0) / 864e5) };
}

export interface TrendDay {
  date: string;
  /** 지난 4주 같은 요일 */
  past: string[];
  /** 다음 주 그날 ÷ 지난 4주 (작년 추세선 기준, 작년 자료가 없으면 1) */
  ratio: number;
  /** 작년 추세선 점 수 (0 = 작년 자료 없음) */
  lyPoints: number;
  /** 지난 4주 날마다 실적 ÷ 작년 추세선 — 고른지 (신뢰도) */
  weekRatios: number[];
  /** 빵마다 예측 (단위 · 범위 맞추기 전) */
  items: { name: string; raw: number }[];
  /** 판매 4주가 안 된 새 빵 — 매니저 기입 */
  newBreads: string[];
}

/** 그날(date) 빵마다 예측 — asOf 까지 실적, today = 발표하는 날 (작년 '오늘') */
export function trendDay(board: Board, asOf: string, today: string, date: string): TrendDay {
  const past = trendPastDays(board, date, asOf);
  const line = lyTrendLine(board, date, today);
  let ratio = 1;
  const weekRatios: number[] = [];
  if (line && past.length) {
    const ly = past.map((p) => line.at(addDays(p, -364)));
    const m = ly.reduce((a, b) => a + b, 0) / ly.length;
    if (m > 0) ratio = Math.max(0, line.at(addDays(date, -364)) / m);
    past.forEach((p, i) => ly[i] > 0 && weekRatios.push(totalOn(board, p) / ly[i]));
  }
  // 최근 2주에 팔린 빵 — 계획 날 기준 이름
  const active = new Set<string>();
  for (const d of dayRange(addDays(asOf, -(TREND_ACTIVE_DAYS - 1)), asOf)) for (const n of soldOn(board, d, date).keys()) active.add(n);
  // 새 빵 — 처음 판 날(90일 안)부터 28일이 안 됨
  const first = new Map<string, string>();
  for (const d of dayRange(addDays(asOf, -(FIRST_LOOKBACK - 1)), asOf)) for (const n of soldOn(board, d, date).keys()) if (!first.has(n)) first.set(n, d);
  const isNew = (n: string) => (first.get(n) ?? asOf) > addDays(asOf, -NEW_BREAD_DAYS);
  const names = [...active].sort((a, b) => a.localeCompare(b, "ko"));
  const items = names
    .filter((n) => !isNew(n))
    .map((name) => ({ name, raw: past.length ? (past.reduce((a, p) => a + (soldOn(board, p, date).get(name) || 0), 0) / past.length) * ratio : 0 }));
  return { date, past, ratio, lyPoints: line?.n ?? 0, weekRatios, items, newBreads: names.filter(isNew) };
}

export type TrustLevel = "높음" | "보통" | "낮음";
export interface Trust {
  level: TrustLevel;
  why: string;
}
const RANK: Record<TrustLevel, number> = { 높음: 0, 보통: 1, 낮음: 2 };

/** 예측 신뢰도 — 지난 4주가 작년 추세에 고르게 맞는지 · (weather 를 주면) 그날 예보 기온이 지난 4주 같은 요일과 크게 다른지 */
export function trendTrust(t: TrendDay, weather?: WeatherMap): Trust {
  let level: TrustLevel = "높음";
  const why: string[] = [];
  const worse = (l: TrustLevel, w: string) => {
    if (RANK[l] > RANK[level]) level = l;
    why.push(w);
  };
  if (t.lyPoints < 4 || t.weekRatios.length < 2) worse("보통", t.lyPoints < 4 ? "작년 같은 시기 자료가 적음" : "지난 같은 요일 실적이 적음");
  else {
    const m = t.weekRatios.reduce((a, b) => a + b, 0) / t.weekRatios.length;
    const sd = Math.sqrt(t.weekRatios.reduce((a, b) => a + (b - m) ** 2, 0) / t.weekRatios.length);
    const cv = m > 0 ? sd / m : 1;
    if (cv > TRUST_SPREAD.보통) worse("낮음", "지난 4주 실적이 들쭉날쭉");
    else if (cv > TRUST_SPREAD.높음) worse("보통", "지난 4주 실적이 조금 들쭉날쭉");
  }
  const w = weather?.[t.date];
  if (w && w.source === "forecast" && w.tempMax != null) {
    const temps = t.past.map((p) => weather?.[p]?.tempMax).filter((x): x is number => typeof x === "number");
    if (temps.length) {
      const avg = temps.reduce((a, b) => a + b, 0) / temps.length;
      const diff = Math.round(w.tempMax - avg);
      const text = `예보 최고 ${Math.round(w.tempMax)}도 — 지난 4주 같은 요일(평균 ${Math.round(avg)}도)보다 ${Math.abs(diff)}도 ${diff < 0 ? "낮음, 급격히 추워짐" : "높음, 급격히 더워짐"}`;
      if (Math.abs(diff) >= TRUST_TEMP.낮음) worse("낮음", text);
      else if (Math.abs(diff) >= TRUST_TEMP.보통) worse("보통", text.replace("급격히 ", ""));
    }
  }
  return { level, why: why.length ? why.join(" · ") : "지난 4주 실적이 작년 추세에 고르게 맞음" };
}
