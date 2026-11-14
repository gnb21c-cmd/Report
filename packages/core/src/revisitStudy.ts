/* ============================================================
   키즈 돈까스 재방문 이벤트 분석 (2026-11-14 사장님)
   - 자료: 키즈 포스 통합데스크 방문 기록 visit-history.json (astanakiz docs/REVISIT.md) — 날마다 네이버 이용완료 손님의 해시만
     (이름 · 전화번호 없음). 보고 앱 '재방문 자세히 분석' 화면에서 키즈 포스 PC 가 파일을 골라 그 브라우저 안에서만 계산
     → 클라우드에는 손님 해시가 없는 요약 숫자(RevisitStudy)만 저장 (deskStats/study-revisit)
   - 이벤트: 10-26 부터 방문 뒤 20일(그날 포함) 안에 다시 오면 수제돈까스 → 다음 방문까지 19일 안 (STUDY_DEADLINE)
   - 왜 평균 · 표준편차만으로 견주면 틀리나: ① 재방문 간격은 오른쪽으로 긴 꼬리(정규분포 아님) ② 이벤트 기간이 짧아
     빨리 다시 온 손님만 '간격'이 생김(아직 안 온 손님이 빠짐 = 중도절단) → 평균이 저절로 짧아 보임
     → 생존분석(Kaplan–Meier · 층화 로그순위 · 위험비)으로 'N일 안에 다시 올 확률'을 같은 조건에서 견줌
   - 같은 손님 견줌: 손님마다 평소(이벤트 전) N일 안 재방문 확률(적은 기록은 전체 평균 쪽으로 당김) = 기대 → 이벤트 때 실제와 견줌 (관측 ÷ 기대)
   - 날마다 '다시 온 손님 비율'의 추세 · 휴일을 빼고 이벤트 시작 뒤 바뀐 크기 (구간 회귀 — 단절 시계열)
   ============================================================ */
import { addDays, dayRange } from "./dates";
import { dayKind } from "./forecast";

export const STUDY_TYPE = "report-revisit-study";
/** 재방문 이벤트 시작일 */
export const STUDY_EVENT_FROM = "2026-10-26";
/** 돈까스 기한 — 방문 뒤 20일(그날 포함) = 다음 방문까지 19일 안 */
export const STUDY_DEADLINE = 19;
/** 같은 손님 평소 확률을 전체 평균 쪽으로 당기는 세기 (방문 2번어치) */
export const STUDY_SHRINK = 2;
/** 다시 온 손님 = 그 앞 이만큼(일) 안에 온 적이 있는 손님 */
export const STUDY_LOOKBACK = 60;

export type CustKind = "new" | "old" | "unknown";
export interface VisitData {
  from: string;
  to: string;
  days: number;
  /** 손님 해시 → 방문한 날 (오름차순, 하루 한 번) */
  visits: Map<string, string[]>;
  /** 신규(그 손님의 네이버 첫 이용이 기록 안) · 기존 · 모름 */
  kind: Map<string, CustKind>;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HASH = /^[\w:-]{6,80}$/;
const diff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/** visit-history.json → 손님별 방문 (모양이 틀리면 null) */
export function parseVisitHistory(raw: unknown): VisitData | null {
  let x: any = raw;
  if (typeof raw === "string") {
    try {
      x = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!x || typeof x !== "object" || x.v !== 1 || !x.days || typeof x.days !== "object") return null;
  const visits = new Map<string, Set<string>>();
  const cards = new Map<string, Map<string, [number, number, string]>>();
  const days: string[] = [];
  for (const [d, e] of Object.entries<any>(x.days)) {
    if (!DAY.test(d) || !e || !Array.isArray(e.k)) continue;
    days.push(d);
    for (const h of e.k) {
      if (typeof h !== "string" || !HASH.test(h)) continue;
      if (!visits.has(h)) visits.set(h, new Set());
      visits.get(h)!.add(d);
      const c = e.c?.[h];
      if (Array.isArray(c) && Number.isInteger(c[0]) && c[0] >= 0) {
        if (!cards.has(h)) cards.set(h, new Map());
        cards
          .get(h)!
          .set(d, [
            c[0],
            Number.isInteger(c[1]) && c[1] > 0 ? c[1] : 1,
            typeof c[2] === "string" && DAY.test(c[2]) ? c[2] : d,
          ]);
      }
    }
  }
  if (!days.length) return null;
  days.sort();
  const out = new Map<string, string[]>();
  const kind = new Map<string, CustKind>();
  for (const [h, s] of visits) {
    const v = [...s].sort();
    out.set(h, v);
    kind.set(h, kindOf(v, cards.get(h)));
  }
  return { from: days[0], to: days[days.length - 1], days: days.length, visits: out, kind };
}

/** 신규 · 기존 — 카드 '완료 n'(읽은 날까지 센 수)에서 첫 방문 앞 이용 수를 셈 (astanakiz docs/REVISIT.md 와 같은 셈) */
function kindOf(v: string[], c: Map<string, [number, number, string]> | undefined): CustKind {
  if (!c || !c.size) return "unknown";
  const first = v[0];
  const [d, [n, , read]] = c.has(first)
    ? [first, c.get(first)!]
    : [...c.entries()].sort((a, b) => a[0].localeCompare(b[0]))[0];
  void d;
  // 첫 방문 ~ 읽은 날 이용 건수 (그날 건수를 모르면 1)
  let used = 0;
  for (const x of v) if (x >= first && x <= read) used += c.get(x)?.[1] ?? 1;
  const prior = n - used;
  return prior < 0 ? "unknown" : prior === 0 ? "new" : "old";
}

/* ---------- 통계 도구 ---------- */
/** 표준정규 누적분포 (Abramowitz–Stegun 7.1.26) */
export function normCdf(z: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}
const pTwo = (z: number) => Math.max(0, Math.min(1, 2 * (1 - normCdf(Math.abs(z)))));
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r1 = (x: number) => Math.round(x * 10) / 10;

export interface Obs {
  /** 다음 방문까지 일수 (event) 또는 지켜본 일수 (중도절단) */
  t: number;
  event: boolean;
  /** 층 — 신규/기존 × 평일/휴일 */
  s: string;
}

/** Kaplan–Meier — t = 1..T 날마다 'T일 안에 다시 온 비율' F(t) = 1 − S(t) 와 그린우드 분산 · 그날 위험(다시 온 수 ÷ 아직 안 온 수) */
export function kaplanMeier(
  obs: Obs[],
  T: number,
): { F: number[]; varS: number[]; hazard: number[]; atRisk: number[] } {
  const F: number[] = [],
    varS: number[] = [],
    hazard: number[] = [],
    atRisk: number[] = [];
  let S = 1,
    g = 0;
  for (let t = 1; t <= T; t++) {
    const n = obs.filter((o) => o.t >= t).length;
    const d = obs.filter((o) => o.event && o.t === t).length;
    if (n > 0 && d > 0) {
      S *= 1 - d / n;
      if (n > d) g += d / (n * (n - d));
    }
    F.push(S === 1 ? 0 : 1 - S);
    varS.push(S * S * g);
    hazard.push(n > 0 ? d / n : 0);
    atRisk.push(n);
  }
  return { F, varS, hazard, atRisk };
}

/** 두 무리 층화 로그순위 검정 · 페토 위험비 (a 가 b 보다 빨리 다시 오면 > 1) */
export function logRank(
  a: Obs[],
  b: Obs[],
  T: number,
): { chi2: number; p: number; hr: number; lo: number; hi: number } {
  let O = 0,
    E = 0,
    V = 0;
  const strata = new Set([...a, ...b].map((o) => o.s));
  for (const s of strata) {
    const A = a.filter((o) => o.s === s),
      B = b.filter((o) => o.s === s);
    for (let t = 1; t <= T; t++) {
      const n1 = A.filter((o) => o.t >= t).length,
        n2 = B.filter((o) => o.t >= t).length;
      const d1 = A.filter((o) => o.event && o.t === t).length,
        d2 = B.filter((o) => o.event && o.t === t).length;
      const n = n1 + n2,
        d = d1 + d2;
      if (!d || n < 2) continue;
      O += d1;
      E += (d * n1) / n;
      V += (d * n1 * n2 * (n - d)) / (n * n * (n - 1));
    }
  }
  if (V <= 0) return { chi2: 0, p: 1, hr: 1, lo: 1, hi: 1 };
  const z = (O - E) / Math.sqrt(V);
  const ln = (O - E) / V,
    se = 1 / Math.sqrt(V);
  return {
    chi2: r3(z * z),
    p: r3(pTwo(z)),
    hr: r3(Math.exp(ln)),
    lo: r3(Math.exp(ln - 1.96 * se)),
    hi: r3(Math.exp(ln + 1.96 * se)),
  };
}

export interface Desc {
  n: number;
  mean: number;
  sd: number;
  variance: number;
  median: number;
  q1: number;
  q3: number;
  /** 왜도 — 0 이면 좌우 대칭(정규분포처럼), 1 넘으면 오른쪽 꼬리가 긺 */
  skew: number;
  /** 로그 간격의 평균 · 표준편차 (로그정규로 볼 때) → 기하평균 = e^logMean */
  geoMean: number;
}
const q = (s: number[], p: number) => {
  if (!s.length) return 0;
  const i = (s.length - 1) * p,
    lo = Math.floor(i),
    hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
};
/** 평균 · 표준편차 · 분산 · 가운데 값 · 사분위 · 왜도 · 기하평균 */
export function describe(xs: number[]): Desc {
  const n = xs.length;
  if (!n) return { n: 0, mean: 0, sd: 0, variance: 0, median: 0, q1: 0, q3: 0, skew: 0, geoMean: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(variance);
  const m2 = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / n,
    m3 = xs.reduce((a, x) => a + (x - mean) ** 3, 0) / n;
  const g1 = m2 > 0 ? m3 / m2 ** 1.5 : 0;
  const skew = n > 2 ? (Math.sqrt(n * (n - 1)) / (n - 2)) * g1 : 0;
  const geoMean = Math.exp(xs.reduce((a, x) => a + Math.log(Math.max(1, x)), 0) / n);
  return {
    n,
    mean: r1(mean),
    sd: r1(sd),
    variance: r1(variance),
    median: r1(q(s, 0.5)),
    q1: r1(q(s, 0.25)),
    q3: r1(q(s, 0.75)),
    skew: r3(skew),
    geoMean: r1(geoMean),
  };
}

/** 맨–휘트니 U (순위 견줌 — 분포 모양을 가정하지 않음) · 같은 값 보정 */
export function mannWhitney(a: number[], b: number[]): { z: number; p: number } {
  const n1 = a.length,
    n2 = b.length;
  if (!n1 || !n2) return { z: 0, p: 1 };
  const all = [...a.map((x) => ({ x, g: 0 })), ...b.map((x) => ({ x, g: 1 }))].sort((p, r) => p.x - r.x);
  const rank = new Array(all.length).fill(0);
  let tie = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].x === all[i].x) j++;
    for (let k = i; k <= j; k++) rank[k] = (i + j) / 2 + 1;
    const t = j - i + 1;
    tie += t ** 3 - t;
    i = j + 1;
  }
  const R1 = all.reduce((acc, o, i) => acc + (o.g === 0 ? rank[i] : 0), 0);
  const U = R1 - (n1 * (n1 + 1)) / 2,
    n = n1 + n2;
  const v = ((n1 * n2) / 12) * (n + 1 - tie / (n * (n - 1)));
  const z = v > 0 ? (U - (n1 * n2) / 2) / Math.sqrt(v) : 0;
  return { z: r3(z), p: r3(pTwo(z)) };
}

/* ---------- 무리 · 관측 ---------- */
const strataOf = (data: VisitData, h: string, d: string) =>
  `${data.kind.get(h) ?? "unknown"}|${dayKind(d) === "휴일" ? "휴일" : "평일"}`;
const nextAfter = (v: string[], d: string) => v.find((x) => x > d) ?? null;

/** 기준 방문(index) → 다음 방문까지 — 손님마다 기간 안 첫 방문 하나 · censor 뒤는 안 봄 · T 일까지 */
export function cohortObs(data: VisitData, from: string, to: string, censor: string, T: number): Obs[] {
  const out: Obs[] = [];
  for (const [h, v] of data.visits) {
    const i = v.find((d) => d >= from && d <= to);
    if (!i || i >= censor) continue;
    const nx = nextAfter(v, i);
    const s = strataOf(data, h, i);
    if (nx && nx <= censor && diff(i, nx) <= T) out.push({ t: diff(i, nx), event: true, s });
    else out.push({ t: Math.min(T, diff(i, censor)), event: false, s });
  }
  return out.filter((o) => o.t >= 1);
}

export interface Cohort {
  key: string;
  label: string;
  from: string;
  to: string;
  censor: string;
  n: number;
  /** t = 1..T 'T일 안에 다시 온 비율' (0 ~ 1) */
  F: number[];
  /** 7 · 14 · 19일 — 비율 · 95% 범위 */
  at: Record<string, { p: number; lo: number; hi: number }>;
  hazard: number[];
}
const AT = [7, 14, STUDY_DEADLINE];
function cohortOf(
  data: VisitData,
  key: string,
  label: string,
  from: string,
  to: string,
  censor: string,
  T: number,
): { c: Cohort; obs: Obs[]; varS: number[] } {
  const obs = cohortObs(data, from, to, censor, T);
  const km = kaplanMeier(obs, T);
  const at: Cohort["at"] = {};
  for (const t of AT) {
    const p = km.F[t - 1] ?? 0,
      se = Math.sqrt(km.varS[t - 1] ?? 0);
    at[t] = { p: r3(p), lo: r3(Math.max(0, p - 1.96 * se)), hi: r3(Math.min(1, p + 1.96 * se)) };
  }
  return {
    c: { key, label, from, to, censor, n: obs.length, F: km.F.map(r3), at, hazard: km.hazard.map(r3) },
    obs,
    varS: km.varS,
  };
}

/* ---------- 같은 손님 — 평소 대비 ---------- */
export interface OE {
  h: number;
  /** 견준 손님 수 (이벤트 전 기록 + 이벤트 때 h 일을 다 지켜본 방문) */
  n: number;
  observed: number;
  expected: number;
  ratio: number;
  lo: number;
  hi: number;
  p: number;
}
/** 손님마다 이벤트 전 'h 일 안 재방문' 비율(기록이 적으면 전체 평균 쪽으로) = 기대 ↔ 이벤트 첫 방문 뒤 h 일 안 실제 */
export function personalOE(data: VisitData, h: number, eventFrom = STUDY_EVENT_FROM): OE | null {
  const preEnd = addDays(eventFrom, -1);
  const lastIdx = addDays(preEnd, -h); // h 일을 이벤트 전 안에서 다 지켜본 방문만
  const per = new Map<string, { r: number; n: number }>();
  let R = 0,
    N = 0;
  for (const [k, v] of data.visits) {
    let r = 0,
      n = 0;
    for (const d of v) {
      if (d > lastIdx) break;
      const nx = nextAfter(v, d);
      n++;
      if (nx && diff(d, nx) <= h) r++;
    }
    if (n) {
      per.set(k, { r, n });
      R += r;
      N += n;
    }
  }
  if (!N) return null;
  const P = R / N;
  const evLast = addDays(data.to, -h);
  let O = 0,
    E = 0,
    V = 0,
    cnt = 0;
  for (const [k, v] of data.visits) {
    const me = per.get(k);
    if (!me) continue;
    const e = v.find((d) => d >= eventFrom && d <= evLast);
    if (!e) continue;
    const p = (me.r + STUDY_SHRINK * P) / (me.n + STUDY_SHRINK);
    const nx = nextAfter(v, e);
    O += nx && diff(e, nx) <= h ? 1 : 0;
    E += p;
    V += p * (1 - p);
    cnt++;
  }
  if (!cnt || E <= 0) return null;
  const sd = Math.sqrt(V);
  return {
    h,
    n: cnt,
    observed: O,
    expected: r1(E),
    ratio: r3(O / E),
    lo: r3(Math.max(0, (O - 1.96 * sd) / E)),
    hi: r3((O + 1.96 * sd) / E),
    p: r3(pTwo(sd > 0 ? (O - E) / sd : 0)),
  };
}

/* ---------- 날마다 다시 온 손님 비율 · 단절 시계열 ---------- */
export interface Its {
  lookback: number;
  from: string;
  to: string;
  /** 이벤트 전 4주 · 이벤트 때 평균 비율 */
  before: number;
  during: number;
  /** 추세 · 휴일을 빼고 이벤트 시작 뒤 바뀐 크기 (비율 포인트) · 95% 범위 · p */
  effect: number;
  lo: number;
  hi: number;
  p: number;
  daily: { d: string; n: number; share: number }[];
}
/** 4×4 이하 연립 — 가우스 소거 (역행렬) */
function inv(m: number[][]): number[][] | null {
  const n = m.length,
    a = m.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) return null;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++)
      if (r !== c) {
        const f = a[r][c];
        for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
      }
  }
  return a.map((r) => r.slice(n));
}
export function interruptedSeries(
  data: VisitData,
  eventFrom = STUDY_EVENT_FROM,
  lookback = STUDY_LOOKBACK,
): Its | null {
  const start = addDays(data.from, lookback);
  if (start >= eventFrom || data.to < eventFrom) return null;
  const byDay = new Map<string, string[]>();
  for (const [k, v] of data.visits) for (const d of v) (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(k);
  const daily: Its["daily"] = [];
  for (const d of dayRange(start, data.to)) {
    const ks = byDay.get(d);
    if (!ks?.length) continue;
    const back = addDays(d, -lookback);
    const ret = ks.filter((k) => data.visits.get(k)!.some((x) => x < d && x >= back)).length;
    daily.push({ d, n: ks.length, share: ret / ks.length });
  }
  // 가중 최소제곱: 비율 = a + b·날 + c·이벤트 + h·휴일 (무게 = 그날 손님 수)
  const X = daily.map((x) => [
    1,
    diff(start, x.d) / 30,
    x.d >= eventFrom ? 1 : 0,
    dayKind(x.d) === "휴일" ? 1 : 0,
  ]);
  const W = daily.map((x) => x.n),
    Y = daily.map((x) => x.share);
  const k = 4;
  const XtWX = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => X.reduce((a, r, n) => a + W[n] * r[i] * r[j], 0)),
  );
  const XtWY = Array.from({ length: k }, (_, i) => X.reduce((a, r, n) => a + W[n] * r[i] * Y[n], 0));
  const I = inv(XtWX);
  if (!I || daily.filter((x) => x.d >= eventFrom).length < 3) return null;
  const b = I.map((r) => r.reduce((a, v, j) => a + v * XtWY[j], 0));
  const res = Y.map((y, n) => y - X[n].reduce((a, v, j) => a + v * b[j], 0));
  const dof = Math.max(1, daily.length - k);
  const s2 = res.reduce((a, r, n) => a + W[n] * r * r, 0) / dof;
  const se = Math.sqrt(Math.max(0, s2 * I[2][2]));
  const avg = (xs: typeof daily) =>
    xs.length ? xs.reduce((a, x) => a + x.share * x.n, 0) / xs.reduce((a, x) => a + x.n, 0) : 0;
  const before = daily.filter((x) => x.d < eventFrom && x.d >= addDays(eventFrom, -28));
  const during = daily.filter((x) => x.d >= eventFrom);
  return {
    lookback,
    from: start,
    to: data.to,
    before: r3(avg(before)),
    during: r3(avg(during)),
    effect: r3(b[2]),
    lo: r3(b[2] - 1.96 * se),
    hi: r3(b[2] + 1.96 * se),
    p: r3(pTwo(se > 0 ? b[2] / se : 0)),
    daily: daily.map((x) => ({ ...x, share: r3(x.share) })),
  };
}

/* ---------- 한데 모음 ---------- */
export interface RevisitStudy {
  type: typeof STUDY_TYPE;
  v: 1;
  madeAt: string;
  data: {
    from: string;
    to: string;
    days: number;
    customers: number;
    visits: number;
    kinds: Record<CustKind, number>;
  };
  event: { from: string; deadline: number };
  /** 견주는 무리 — event(이벤트) · near(직전 같은 길이) · autumn(9/1 ~ 이벤트 전) · all(기록 처음 ~ 이벤트 전) */
  cohorts: Cohort[];
  /** 이벤트 ↔ 각 무리 (신규/기존 × 평일/휴일 층화) · 7 · 14 · 19일 차이 (비율 포인트 · 95% 범위) */
  compare: {
    base: string;
    hr: number;
    lo: number;
    hi: number;
    chi2: number;
    p: number;
    diff: Record<string, { d: number; lo: number; hi: number }>;
  }[];
  /** 같은 손님 — 평소 대비 실제 (7 · 14 · 19일, 지켜본 날이 모자라면 null) */
  paired: { both: number; h7: OE | null; h14: OE | null; h19: OE | null };
  /** 재방문 간격 (다음 방문까지 일수, 두 방문 모두 그 기간 안) — pre = 이벤트 전 모두(참고) · event = 이벤트 때 ·
      near = 이벤트와 같은 길이의 직전 기간 (기간이 짧으면 긴 간격이 안 잡히는 치우침이 같아 공정) · mw = event ↔ near 순위 견줌 */
  gaps: { pre: Desc; event: Desc; near: Desc; mw: { z: number; p: number } };
  its: (Omit<Its, "daily"> & { daily: Its["daily"] }) | null;
}

/** visit-history 자료 → 분석 요약 (손님 해시 없음) */
export function revisitStudy(
  data: VisitData,
  madeAt = new Date().toISOString(),
  eventFrom = STUDY_EVENT_FROM,
): RevisitStudy {
  const T = STUDY_DEADLINE;
  const preEnd = addDays(eventFrom, -1);
  const evLen = Math.max(1, diff(eventFrom, data.to) + 1);
  const ev = cohortOf(data, "event", "이벤트", eventFrom, data.to, data.to, T);
  const bases = [
    cohortOf(data, "near", "직전 같은 기간", addDays(eventFrom, -evLen), preEnd, preEnd, T),
    cohortOf(
      data,
      "autumn",
      "9월 ~ 이벤트 전",
      data.from > "2026-09-01" ? data.from : "2026-09-01",
      preEnd,
      preEnd,
      T,
    ),
    cohortOf(data, "all", "기록 처음 ~ 이벤트 전", data.from, preEnd, preEnd, T),
  ];
  const compare = bases.map((b) => {
    const lr = logRank(ev.obs, b.obs, T);
    const diffs: Record<string, { d: number; lo: number; hi: number }> = {};
    for (const t of AT) {
      const d = (ev.c.F[t - 1] ?? 0) - (b.c.F[t - 1] ?? 0);
      const se = Math.sqrt((ev.varS[t - 1] ?? 0) + (b.varS[t - 1] ?? 0));
      diffs[t] = { d: r3(d), lo: r3(d - 1.96 * se), hi: r3(d + 1.96 * se) };
    }
    return { base: b.c.key, ...lr, diff: diffs };
  });
  // 재방문 간격 — 두 방문 모두 그 기간 안
  const nearFrom = addDays(eventFrom, -evLen);
  const pre: number[] = [],
    evg: number[] = [],
    nearg: number[] = [];
  let both = 0,
    visits = 0;
  for (const [, v] of data.visits) {
    visits += v.length;
    if (v.some((d) => d < eventFrom) && v.some((d) => d >= eventFrom)) both++;
    for (let i = 1; i < v.length; i++) {
      const g = diff(v[i - 1], v[i]);
      if (v[i] <= preEnd) {
        pre.push(g);
        if (v[i - 1] >= nearFrom) nearg.push(g);
      } else if (v[i - 1] >= eventFrom) evg.push(g);
    }
  }
  const kinds: Record<CustKind, number> = { new: 0, old: 0, unknown: 0 };
  for (const k of data.kind.values()) kinds[k]++;
  return {
    type: STUDY_TYPE,
    v: 1,
    madeAt,
    data: { from: data.from, to: data.to, days: data.days, customers: data.visits.size, visits, kinds },
    event: { from: eventFrom, deadline: T },
    cohorts: [ev.c, ...bases.map((b) => b.c)],
    compare,
    paired: {
      both,
      h7: personalOE(data, 7, eventFrom),
      h14: personalOE(data, 14, eventFrom),
      h19: personalOE(data, T, eventFrom),
    },
    gaps: { pre: describe(pre), event: describe(evg), near: describe(nearg), mw: mannWhitney(evg, nearg) },
    its: interruptedSeries(data, eventFrom),
  };
}

/** 저장된 요약 검사 (모양이 틀리면 null) */
export function parseRevisitStudy(raw: unknown): RevisitStudy | null {
  let x: any = raw;
  if (typeof raw === "string") {
    try {
      x = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return x &&
    x.type === STUDY_TYPE &&
    x.v === 1 &&
    x.data &&
    Array.isArray(x.cohorts) &&
    Array.isArray(x.compare)
    ? (x as RevisitStudy)
    : null;
}
