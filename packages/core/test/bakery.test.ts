import { describe, expect, it } from "vitest";
import {
  addDays,
  asOrder,
  asPlan,
  bakeryProducts,
  producedOf,
  Board,
  breadTotals,
  dayKind,
  dayRange,
  dayResult,
  DEFAULT_LEARNED,
  nextSteps,
  sameGroupBefore,
  stepGroup,
  stepOf,
  STEP_LIMIT,
  SELL_OUT_TARGET,
  SELL_OUT_RULE_FROM,
  restep,
  RAIN_WEEKEND_UP,
  RAIN_WEEKEND_FROM,
  RAIN_WEEKEND_HOLD,
  rainUpOf,
  BREAD_BOOST,
  BREAD_BOOST_FROM,
  breadBoostOf,
  WEEKDAY_BREAD_BAND,
  breadBandOf,
  fitTotal,
  breadPlan,
  weeklyOutlook,
  displayDays,
  finalDay,
  floorCopy,
  validFloorKey,
  HOURS,
  madeTotal,
  makeFinal,
  makeWeek,
  snapUnit,
  BREAD_ORDER,
  reround,
  ROUND_UP_UNIT,
  ROUND_UP_FROM,
  planUnit,
  sortBread,
  nowKst,
  orderRows,
  orderText,
  weekDates,
  weekPlanDay,
  weekPlanOpen,
  visiblePlan,
  WEEK_PLAN_TIME,
  CONFIRM_DEADLINE,
  type BreadResult,
  type DayReport,
  type OrderDoc,
  type PlanDoc,
  type StorePart,
  type DayWeather,
  type WeatherMap,
} from "../src";

const H = () => HOURS.map(() => 0);
function day(date: string, cups: number, bread: [string, number][]): DayReport {
  const cafe: StorePart = {
    v: 1, store: "cafe", date, basis: "receipt", file: "t.xls", sheetNet: 0, posNet: 0, voucher: 0,
    sectors: { 바리스타: 0, 베이커리: 0, 키친: 0, 기타: 0 }, cups, teams: 0, teamSizes: [0, 0, 0, 0, 0, 0],
    hourly: { sectors: { 바리스타: H(), 베이커리: H(), 키친: H(), 기타: H() }, cups: H(), teams: H() },
    products: bread.map(([n, q]) => [n, "베이커리", q, q * 4000]), refunds: { receipts: 0, lines: 0, unmatched: 0, amount: 0 }, kids: null,
  };
  return { date, cafe };
}
const make = (from: string, to: string, k: (d: string) => number) =>
  dayRange(from, to).map((d) => {
    const cups = Math.round((dayKind(d) === "휴일" ? 200 : 100) * k(d));
    return day(d, cups, [["소금빵", Math.round(cups * 0.3)], ["크루아상", Math.round(cups * 0.1)], ["딸기잼", 3], ["블루베리잼", 2]]);
  });
const board = new Board([...make("2025-08-01", "2025-12-31", () => 1), ...make("2026-08-01", "2026-10-07", () => 1)]);
const L = (qty: number, at = "") => ({ qty, by: "매니저", at });
const T = (date: string, time: string) => ({ date, time });

describe("날짜 — 목요일 주간 · 3일 전 최종 · 아침 6시", () => {
  it("목요일(10-08)에 다음 주 월(10-12) ~ 일(10-18)", () => {
    expect(weekDates("2026-10-08")).toEqual(dayRange("2026-10-12", "2026-10-18"));
  });
  it("그 주의 주간 계획 날 = 앞 목요일", () => {
    for (const d of dayRange("2026-10-12", "2026-10-18")) expect(weekPlanDay(d)).toBe("2026-10-08");
    expect(weekPlanDay("2026-10-19")).toBe("2026-10-15");
  });
  it("최종 확정 날 — 금 → 월, 토 → 화, …, 목 → 일", () => {
    expect(finalDay("2026-10-12")).toBe("2026-10-09"); // 월 ← 금
    expect(finalDay("2026-10-13")).toBe("2026-10-10"); // 화 ← 토
    expect(finalDay("2026-10-18")).toBe("2026-10-15"); // 일 ← 목
  });
  it("현장 태블릿 — 6시 전에는 아직 어제와 오늘, 6시부터 오늘과 내일", () => {
    expect(displayDays(T("2026-10-18", "05:59"))).toEqual(["2026-10-17", "2026-10-18"]);
    expect(displayDays(T("2026-10-18", "06:00"))).toEqual(["2026-10-18", "2026-10-19"]);
  });
});

describe("주간 잠정안은 목요일 아침 6시에 열림 (나머지 시각은 그대로)", () => {
  const plan: PlanDoc = { v: 2, date: "2026-10-19", week: { madeOn: "2026-10-15", asOf: "2026-10-13", kind: "평일", visitors: 0, weather: "", total: 0, items: [] } };
  it("6시", () => expect(WEEK_PLAN_TIME).toBe("06:00"));
  it("목요일 새벽에 미리 계산해 둬도 6시 전에는 안 보이고, 6시부터 보임", () => {
    expect(weekPlanOpen(plan, T("2026-10-15", "05:10"))).toBe(false);
    expect(weekPlanOpen(plan, T("2026-10-15", "06:00"))).toBe(true);
    expect(weekPlanOpen(plan, T("2026-10-16", "01:00"))).toBe(true);
  });
  it("계획이 없으면 안 보임", () => {
    expect(weekPlanOpen({ v: 2, date: "2026-10-19" }, T("2026-10-15", "07:00"))).toBe(false);
  });
  it("매니저 앱은 6시 전에 주간안 · 전망을 못 봄 — 6시부터 그대로 (숫자는 바꾸지 않음)", () => {
    const withOutlook: PlanDoc = { ...plan, outlook: [{ week: 1, from: "2026-10-19", to: "2026-10-25", weekday: 100, holiday: 150 }] };
    const early = visiblePlan(withOutlook, T("2026-10-15", "05:59"))!;
    expect(early.week).toBeUndefined();
    expect(early.outlook).toBeUndefined();
    expect(early.date).toBe("2026-10-19");
    expect(visiblePlan(withOutlook, T("2026-10-15", "06:00"))).toBe(withOutlook);
    expect(visiblePlan(null, T("2026-10-15", "05:00"))).toBeNull();
  });
  it("최종안은 시각과 관계없이 그대로 (최종안이 있는 날의 주간안은 이미 지난 목요일 것)", () => {
    const fin: PlanDoc = { ...plan, date: "2026-10-12", week: { ...plan.week!, madeOn: "2026-10-08" }, final: { ...plan.week!, madeOn: "2026-10-09" } };
    expect(visiblePlan(fin, T("2026-10-09", "05:00"))).toBe(fin);
  });
  it("잠정 확정 마감은 그대로 목요일 18시 · 최종은 그대로 3일 전", () => {
    expect(CONFIRM_DEADLINE).toBe("18:00");
    expect(finalDay("2026-10-19")).toBe("2026-10-16");
  });
});

describe("주간 잠정안 (목 아침)", () => {
  const week = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-08", "2026-10-07");
  it("7일 · 월요일 문서에만 1~4주 전망 · 딸기잼 · 블루베리잼은 빠짐", () => {
    expect(week.map((w) => w.date)).toEqual(dayRange("2026-10-12", "2026-10-18"));
    expect(week[0].outlook).toHaveLength(4);
    expect(week[1].outlook).toBeUndefined();
    for (const w of week) {
      expect(w.week.madeOn).toBe("2026-10-08");
      expect(w.week.items.some((i) => i.name === "딸기잼")).toBe(false);
      expect(w.week.items.some((i) => i.name === "블루베리잼")).toBe(false);
      const s = w.week.items.find((i) => i.name === "소금빵")!;
      expect(s.base).toBe(s.qty);
    }
  });
  it("같은 요일 칸(±1)을 그날에만 더하고 예측 수량(base)을 남김", () => {
    const fixed = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-08", "2026-10-07", { "2026-10-12": { 소금빵: -2 } });
    const a = week[0].week.items.find((i) => i.name === "소금빵")!;
    const b = fixed[0].week.items.find((i) => i.name === "소금빵")!;
    expect(b.qty).toBe(a.qty - 2);
    expect(b.base).toBe(a.qty);
    expect(b.step).toBe(-2);
    // 화요일은 그대로
    expect(fixed[1].week.items.find((i) => i.name === "소금빵")!.qty).toBe(week[1].week.items.find((i) => i.name === "소금빵")!.qty);
  });
  it("칸은 예측의 ±30% 안으로 묶음 (끝없이 쌓이지 않게)", () => {
    const a = week[0].week.items.find((i) => i.name === "소금빵")!;
    const lim = Math.floor(a.qty * STEP_LIMIT);
    const up = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-08", "2026-10-07", { "2026-10-12": { 소금빵: 100 } })[0].week.items.find((i) => i.name === "소금빵")!;
    const down = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-08", "2026-10-07", { "2026-10-12": { 소금빵: -100 } })[0].week.items.find((i) => i.name === "소금빵")!;
    expect([up.qty, up.step]).toEqual([a.qty + lim, lim]);
    expect([down.qty, down.step]).toEqual([a.qty - lim, -lim]);
  });
});

describe("최종안 (3일 전 15시)", () => {
  const [mon] = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-08", "2026-10-07");
  const plan: PlanDoc = { v: 2, date: mon.date, week: mon.week };

  it("주간 잠정안이 없거나 다른 날이면 세지 않음", () => {
    expect(makeFinal(board, {}, DEFAULT_LEARNED, "2026-10-09", "2026-10-08", null, null)).toBeNull();
    expect(makeFinal(board, {}, DEFAULT_LEARNED, "2026-10-10", "2026-10-09", plan, null)).toBeNull(); // 10-13 이 아님
  });
  it("금(10-09) → 월(10-12) · 잠정 확정 수량 ±10% 안으로 묶음", () => {
    // 잠정 확정 = 주간 수량 그대로 (같은 요일 칸 ±30% 를 넣어도 최종은 잠정의 ±10% 안)
    const w = mon.week.items.find((i) => i.name === "소금빵")!.qty;
    const order: OrderDoc = { v: 2, date: mon.date, provisional: { 소금빵: L(w) }, final: {} };
    const [lo, hi] = [Math.floor(w * 0.9), Math.ceil(w * 1.1)];
    const f = makeFinal(board, {}, DEFAULT_LEARNED, "2026-10-09", "2026-10-08", plan, order, { 소금빵: 100 })!;
    const s = f.items.find((i) => i.name === "소금빵")!;
    expect(s.qty).toBe(hi); // 크게 늘어도 잠정의 +10%
    expect([s.lo, s.hi]).toEqual([lo, hi]);
    expect(s.step).toBeGreaterThan(0); // 다음 같은 요일로 이어 갈 칸
    const low = makeFinal(board, {}, DEFAULT_LEARNED, "2026-10-09", "2026-10-08", plan, order, { 소금빵: -100 })!;
    expect(low.items.find((i) => i.name === "소금빵")!.qty).toBe(lo); // 크게 줄어도 −10%
    // 잠정 확정이 없는 빵은 주간 수량이 기준
    const c = f.items.find((i) => i.name === "크루아상")!;
    const cw = mon.week.items.find((i) => i.name === "크루아상")!.qty;
    expect(c.qty).toBeGreaterThanOrEqual(Math.floor(cw * 0.9));
    expect(c.qty).toBeLessThanOrEqual(Math.ceil(cw * 1.1));
    expect(f.madeOn).toBe("2026-10-09");
  });
});

describe("비 예보 주말 — 홀드 (2026-10-21 사장님: 생산 늘림으로 모수가 커져 비가 많이 오면 도리어 손님이 줄 수 있음 · 늘림 결과를 보고 다음 주에 다시 정함)", () => {
  const week = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-22", "2026-10-07");
  const of = (d: string) => week.find((w) => w.date === d)!;
  const W = (date: string, key: DayWeather["key"], source: DayWeather["source"] = "forecast"): WeatherMap => ({ [date]: { date, key, label: key, icon: "", tempMax: 18, tempMin: 12, rainMm: key === "sunny" ? 0 : 6, source } });
  const q = (st: { items: { name: string; qty: number }[] }, n: string) => st.items.find((i) => i.name === n)!.qty;

  it("홀드 중 — 비 · 강우 예보 주말이어도 배수 없음", () => {
    expect(RAIN_WEEKEND_HOLD).toBe(true);
    expect(rainUpOf("2026-10-31", W("2026-10-31", "rain")["2026-10-31"])).toBeNull();
    expect(rainUpOf("2026-11-01", W("2026-11-01", "heavyrain")["2026-11-01"])).toBeNull();
  });

  it("토요일 비 예보여도 보통 최종안 — 잠정 확정 ±10% 안 · rainUp 없음 · 칸은 이어 감", () => {
    const sat = of("2026-10-31");
    const order: OrderDoc = { v: 2, date: sat.date, provisional: { 소금빵: L(40) }, final: {} };
    const f = makeFinal(board, W(sat.date, "rain"), DEFAULT_LEARNED, "2026-10-28", "2026-10-07", { v: 2, date: sat.date, week: sat.week }, order, { 소금빵: 2 })!;
    expect(f.rainUp).toBeUndefined();
    const s = f.items.find((i) => i.name === "소금빵")!;
    expect(s.qty).toBeGreaterThanOrEqual(36);
    expect(s.qty).toBeLessThanOrEqual(44);
    expect([s.lo, s.hi]).toEqual([36, 44]);
    expect(s.step).toBe(2);
    const cw = q(sat.week, "크루아상");
    expect(q(f, "크루아상")).toBeGreaterThanOrEqual(Math.floor(cw * 0.9));
    expect(q(f, "크루아상")).toBeLessThanOrEqual(Math.ceil(cw * 1.1));
  });

  // 다시 켤 때의 규칙 (홀드를 풀면 이대로) — 토 1.25 · 일 1.2 · 비 · 강우 예보만 · 10-26 계획부터
  it("규칙(홀드를 풀면) — 토 1.25 · 일 1.2 · 비 · 강우 예보만 (평일 · 맑음 · 구름 · 눈 · 관측은 아님)", () => {
    const on = (d: string, w?: DayWeather) => rainUpOf(d, w, false);
    expect(RAIN_WEEKEND_UP).toEqual({ 6: 1.25, 0: 1.2 });
    expect(on("2026-10-31", W("2026-10-31", "rain")["2026-10-31"])).toBe(1.25); // 토
    expect(on("2026-11-01", W("2026-11-01", "heavyrain")["2026-11-01"])).toBe(1.2); // 일
    expect(on("2026-10-30", W("2026-10-30", "rain")["2026-10-30"])).toBeNull(); // 금
    expect(on("2026-10-31", W("2026-10-31", "cloudy")["2026-10-31"])).toBeNull();
    expect(on("2026-10-31", W("2026-10-31", "snow")["2026-10-31"])).toBeNull();
    expect(on("2026-10-31", W("2026-10-31", "rain", "observed")["2026-10-31"])).toBeNull();
    expect(on("2026-10-31", undefined)).toBeNull();
    expect(RAIN_WEEKEND_FROM).toBe("2026-10-26");
    expect(on("2026-10-24", W("2026-10-24", "rain")["2026-10-24"])).toBeNull();
    expect(on("2026-10-25", W("2026-10-25", "heavyrain")["2026-10-25"])).toBeNull();
  });
});

describe("생산 수량 평일 × 1.5 · 휴일 × 1.3 — 빵별 · 요일 추세는 작년 기반 계산 그대로, 10-26 계획부터 (2026-10-21 사장님: 평일 300개 조금 넘게 · 휴일 900개 가까이)", () => {
  const raw = (date: string, name: string) => breadPlan(board, {}, "2026-10-07", date, DEFAULT_LEARNED).items.find((x) => x.name === name)!.qty;

  it("배수 평일 · 금요일 1.5 · 휴일(토 · 일 · 공휴일) 1.3 · 10-26 부터 (10-22 목요일에 세는 다음 주 계획)", () => {
    expect(BREAD_BOOST).toEqual({ 평일: 1.5, 금요일: 1.5, 휴일: 1.3 });
    expect(BREAD_BOOST_FROM).toBe("2026-10-26");
    expect(breadBoostOf("2026-10-25")).toBe(1); // 일 — 이번 주는 그대로
    expect(breadBoostOf("2026-10-26")).toBe(1.5); // 월
    expect(breadBoostOf("2026-10-30")).toBe(1.5); // 금
    expect(breadBoostOf("2026-10-31")).toBe(1.3); // 토
    expect(breadBoostOf("2026-11-01")).toBe(1.3); // 일
  });

  it("다음 주(10-26 ~ 11-01) 주간안 = 빵별 예측 × 그날 배수 (반올림) · 같은 요일 칸은 그 위에 · 몽블랑은 5개 단위", () => {
    const week = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-22", "2026-10-07", { "2026-10-30": { 소금빵: 2 } });
    expect(week.map((w) => w.date)).toEqual(dayRange("2026-10-26", "2026-11-01"));
    for (const w of week) {
      expect(w.week.boost).toBe(breadBoostOf(w.date));
      for (const it of w.week.items) {
        expect(it.base).toBe(Math.round(raw(w.date, it.name) * breadBoostOf(w.date)));
        expect(it.qty % (it.name === "몽블랑" ? 5 : 1)).toBe(0);
      }
      expect(w.week.total).toBe(w.week.items.reduce((a, b) => a + b.qty, 0));
    }
    // 금요일(하루 합계 범위 없음) — 수량 = 올린 예측 + 칸
    const s = week.find((w) => w.date === "2026-10-30")!.week.items.find((i) => i.name === "소금빵")!;
    expect([s.qty, s.step]).toEqual([s.base! + 2, 2]);
  });

  it("이번 주(10-19 ~ 10-25, 10-15 에 센 것)는 그대로", () => {
    for (const w of makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-15", "2026-10-07")) {
      expect(w.week.boost).toBeUndefined();
      for (const it of w.week.items) expect(it.base).toBe(raw(w.date, it.name));
    }
  });

  it("1 ~ 4주 전망도 평일 × 1.5 · 휴일 × 1.3 (재료 · 인원 준비)", () => {
    const got = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-22", "2026-10-07")[0].outlook!;
    const want = weeklyOutlook(board, "2026-10-07", "2026-10-26", DEFAULT_LEARNED);
    expect(got.map((w) => [w.weekday, w.holiday])).toEqual(want.map((w) => [w.weekday == null ? null : Math.round(w.weekday * 1.5), w.holiday == null ? null : Math.round(w.holiday * 1.3)]));
  });

  it("최종안(10-23 금 → 10-26 월)도 × 1.5 로 다시 센 수량을 잠정(주간 × 1.5)의 ±10% 안에 · 토요일 최종안은 × 1.3", () => {
    const [mon] = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-22", "2026-10-07");
    const f = makeFinal(board, {}, DEFAULT_LEARNED, "2026-10-23", "2026-10-07", { v: 2, date: mon.date, week: mon.week }, null)!;
    expect(f.boost).toBe(1.5);
    for (const it of f.items) {
      const a = mon.week.items.find((x) => x.name === it.name)!.qty;
      expect(it.qty).toBeGreaterThanOrEqual(Math.floor(a * 0.9));
      expect(it.qty).toBeLessThanOrEqual(Math.ceil(a * 1.1));
    }
    const sat = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-22", "2026-10-07").find((w) => w.date === "2026-10-31")!;
    expect(makeFinal(board, {}, DEFAULT_LEARNED, "2026-10-28", "2026-10-07", { v: 2, date: sat.date, week: sat.week }, null)!.boost).toBe(1.3);
  });
});

describe("평일(월 ~ 목) 하루 합계 300 ~ 320개 안 — 같은 요일 칸 · 날씨 추세로 움직이되 그 안에서 (2026-10-21 사장님, 10-26 계획부터)", () => {
  const sum = (xs: { qty: number }[]) => xs.reduce((a, b) => a + b.qty, 0);
  it("범위 300 ~ 320 · 월 ~ 목 평일만 (금요일 · 휴일 · 10-26 전은 없음)", () => {
    expect(WEEKDAY_BREAD_BAND).toEqual([300, 320]);
    expect(breadBandOf("2026-10-26")).toEqual([300, 320]); // 월
    expect(breadBandOf("2026-10-29")).toEqual([300, 320]); // 목
    expect(breadBandOf("2026-10-30")).toBeNull(); // 금
    expect(breadBandOf("2026-10-31")).toBeNull(); // 토
    expect(breadBandOf("2026-10-22")).toBeNull(); // 10-26 전
  });
  it("합계 맞추기 — 넘으면 320 · 모자라면 300 · 빵 사이 비율은 그대로 · 몽블랑 5개 단위 · 안이면 그대로", () => {
    const items = [{ name: "소금빵", qty: 120 }, { name: "크루아상", qty: 90 }, { name: "몽블랑", qty: 40 }, { name: "식빵", qty: 78 }]; // 328
    const down = fitTotal(items, 300, 320);
    expect(sum(down)).toBe(320);
    expect(down.find((i) => i.name === "몽블랑")!.qty % 5).toBe(0);
    expect(down.every((i, k) => i.qty <= items[k].qty)).toBe(true);
    const up = fitTotal(items.map((i) => ({ ...i, qty: Math.round(i.qty * 0.8) })), 300, 320); // 262
    expect(sum(up)).toBe(300);
    const mid = items.map((i) => ({ ...i, qty: i.name === "소금빵" ? 100 : i.qty })); // 308
    expect(fitTotal(mid, 300, 320)).toBe(mid);
  });
  it("다음 주(10-26 ~ 10-29) 주간안 — 같은 요일 칸을 크게 넣어도 300 ~ 320 · 금 · 토 · 일은 맞추지 않음", () => {
    const week = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-22", "2026-10-07", { "2026-10-26": { 소금빵: 100, 크루아상: 100 }, "2026-10-27": { 소금빵: -100 } });
    for (const w of week) {
      if (breadBandOf(w.date)) {
        expect(w.week.total).toBeGreaterThanOrEqual(300);
        expect(w.week.total).toBeLessThanOrEqual(320);
        expect(w.week.band).toEqual([300, 320]);
      } else expect(w.week.band).toBeUndefined();
      expect(w.week.total).toBe(sum(w.week.items));
    }
    // 칸이 큰 월요일이 칸이 작은 화요일보다 적지 않음 (추세는 범위 안에서 남음)
    expect(week[0].week.total).toBeGreaterThanOrEqual(week[1].week.total);
  });
  it("최종안(10-23 금 → 10-26 월)도 300 ~ 320", () => {
    const [mon] = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-22", "2026-10-07");
    const f = makeFinal(board, {}, DEFAULT_LEARNED, "2026-10-23", "2026-10-07", { v: 2, date: mon.date, week: mon.week }, null, { 소금빵: 100 })!;
    expect(f.total).toBeGreaterThanOrEqual(300);
    expect(f.total).toBeLessThanOrEqual(320);
    expect(f.total).toBe(sum(f.items));
  });
});

describe("제빵 품목 순서 · 시나몬롤 10개 · 우유모닝빵 2개 단위 올림 (2026-10-22 사장님 표)", () => {
  it("표 순서 — 우유모닝빵 · 고소한옛날맘모스 · 갈릭소시지빵 · 시나몬롤 … 티라미두유볼(소) · 생크림케이크 (POS 이름)", () => {
    expect(BREAD_ORDER.slice(0, 4)).toEqual(["우유모닝빵", "고소한옛날맘모스", "갈릭소시지빵", "시나몬롤"]);
    expect(BREAD_ORDER).toHaveLength(33);
    expect(new Set(BREAD_ORDER).size).toBe(33);
    const xs = [{ name: "소금빵" }, { name: "새 빵" }, { name: "스위트파누쪼" }, { name: "우유모닝빵" }, { name: "몽블랑" }, { name: "가 새 빵" }];
    // 띄어쓰기는 상관없음 ('스위트 파누쪼') · 표에 없는 빵은 맨 뒤 가나다
    expect(sortBread(xs).map((x) => x.name)).toEqual(["우유모닝빵", "소금빵", "몽블랑", "스위트파누쪼", "가 새 빵", "새 빵"]);
    expect(sortBread(["몽블랑", "우유모닝빵"], (x) => x)).toEqual(["우유모닝빵", "몽블랑"]);
    // 생크림케이크는 계절 과일로 이름만 바뀜 — '복숭아생크림케이크'도 맨 끝 생크림케이크 자리 (표에 없는 빵보다 앞)
    expect(sortBread(["없는빵", "복숭아생크림케이크", "티라미두유볼(소)"], (x) => x)).toEqual(["티라미두유볼(소)", "복숭아생크림케이크", "없는빵"]);
  });

  it("올림 단위 — 시나몬롤 10 · 우유모닝빵 2 · 10-26 계획부터 (그 전은 그대로 1개)", () => {
    expect(ROUND_UP_UNIT).toEqual({ 시나몬롤: 10, 우유모닝빵: 2 });
    expect(ROUND_UP_FROM).toBe("2026-10-26");
    expect(snapUnit("시나몬롤", 12, undefined, undefined, "2026-10-26")).toBe(20);
    expect(snapUnit("시나몬롤", 20, undefined, undefined, "2026-10-26")).toBe(20);
    expect(snapUnit("시나몬롤", 20.000001, undefined, undefined, "2026-10-26")).toBe(20); // 소수 오차로 30 이 되지 않게
    expect(snapUnit("시나몬롤", 21, undefined, undefined, "2026-10-27")).toBe(30);
    expect(snapUnit("우유모닝빵", 7, undefined, undefined, "2026-10-26")).toBe(8);
    expect(snapUnit("우유모닝빵", 8, undefined, undefined, "2026-10-26")).toBe(8);
    expect(snapUnit("시나몬롤", 12, undefined, undefined, "2026-10-25")).toBe(12);
    expect(snapUnit("시나몬롤", 12)).toBe(12);
    expect(snapUnit("시나몬롤", 0, undefined, undefined, "2026-10-26")).toBe(0);
    // 최종안 ±10% 범위가 있어도 올림 (사장님 '올림') — 범위 위로 넘어가도 다음 배수
    expect(snapUnit("시나몬롤", 13, 11, 14, "2026-10-26")).toBe(20);
    expect(planUnit("시나몬롤", "2026-10-26")).toBe(10);
    expect(planUnit("몽블랑", "2026-10-26")).toBe(5);
    expect(planUnit("소금빵", "2026-10-26")).toBe(1);
    expect(planUnit("시나몬롤", "2026-10-25")).toBe(1);
  });

  it("주간안 · 최종안에서 시나몬롤은 10개 · 우유모닝빵은 짝수로 올림 · 평일 300 ~ 320 은 다른 빵으로 맞춤", () => {
    const make2 = (from: string, to: string) =>
      dayRange(from, to).map((d) => {
        const cups = dayKind(d) === "휴일" ? 200 : 100;
        return day(d, cups, [["소금빵", Math.round(cups * 0.3)], ["크루아상", Math.round(cups * 0.1)], ["시나몬롤", Math.round(cups * 0.13)], ["우유모닝빵", Math.round(cups * 0.07)]]);
      });
    const board = new Board([...make2("2025-08-01", "2025-12-31"), ...make2("2026-08-01", "2026-10-07")]);
    const week = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-22", "2026-10-07");
    expect(week.flatMap((w) => w.week.items).some((i) => i.name === "시나몬롤")).toBe(true);
    for (const w of week)
      for (const it of w.week.items) {
        if (it.name === "시나몬롤") expect(it.qty % 10).toBe(0);
        if (it.name === "우유모닝빵") expect(it.qty % 2).toBe(0);
      }
    for (const w of week.filter((x) => breadBandOf(x.date))) {
      expect(w.week.total).toBeGreaterThanOrEqual(300);
      expect(w.week.total).toBeLessThanOrEqual(320);
    }
    const mon = week[0];
    const f = makeFinal(board, {}, DEFAULT_LEARNED, "2026-10-23", "2026-10-07", { v: 2, date: mon.date, week: mon.week }, null)!;
    for (const it of f.items) if (it.name === "시나몬롤") expect(it.qty % 10).toBe(0);
    // 이번 주(10-19 ~ 25)는 그대로
    const before = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-15", "2026-10-07");
    const c = before.flatMap((w) => w.week.items).filter((i) => i.name === "시나몬롤");
    expect(c.length).toBeGreaterThan(0);
    expect(c.some((i) => i.qty % 10 !== 0)).toBe(true);
  });

  it("이미 보인 10-26 주간안에 올림만 다시 — 시나몬롤 12 → 20 · 우유모닝빵 7 → 8 · 평일 합계는 다른 빵으로 320 안 · 칸 · 예측은 그대로", () => {
    const items = [
      { name: "소금빵", qty: 150, base: 140, step: 3 },
      { name: "쫀득크림빵", qty: 121, base: 121 },
      { name: "시나몬롤", qty: 12, base: 12 },
      { name: "우유모닝빵", qty: 7, base: 7 },
      { name: "몽블랑", qty: 30, base: 31 },
    ]; // 320
    const st = { madeOn: "2026-10-22", asOf: "2026-10-21", kind: "평일" as const, visitors: 235, weather: "모름", items, total: 320, boost: 1.5, band: [300, 320] as [number, number] };
    const r = reround(st, "2026-10-26");
    const q = (n: string) => r.items.find((i) => i.name === n)!;
    expect([q("시나몬롤").qty, q("우유모닝빵").qty]).toEqual([20, 8]);
    expect(r.total).toBe(320);
    expect(r.total).toBe(r.items.reduce((a, b) => a + b.qty, 0));
    expect(q("몽블랑").qty % 5).toBe(0);
    expect([q("소금빵").base, q("소금빵").step]).toEqual([140, 3]);
    expect(q("소금빵").qty + q("쫀득크림빵").qty).toBeLessThan(271);
    // 토요일(범위 없음)은 올림만
    const sat = reround({ ...st, kind: "휴일", band: undefined }, "2026-10-31");
    expect(sat.total).toBe(320 + 8 + 1);
    // 10-26 전은 그대로
    expect(reround(st, "2026-10-25").items).toEqual(items);
  });
});

describe("빵별 상태 — 한 주기 따라가기 (월 10-12)", () => {
  const [mon] = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-08", "2026-10-07");
  const weekQty = (n: string) => mon.week.items.find((i) => i.name === n)!.qty;
  const plan: PlanDoc = { v: 2, date: mon.date, week: mon.week };

  it("목 17시 — 잠정 확정 전이면 '확정 전'", () => {
    const rows = orderRows(plan, null, T("2026-10-08", "17:00"));
    expect(rows.every((r) => r.state === "확정 전" && r.qty == null)).toBe(true);
  });
  it("목 18시 지나면 잠정 확정 안 한 빵은 주간 수량 그대로 '잠정'", () => {
    const order: OrderDoc = { v: 2, date: mon.date, provisional: { 소금빵: L(70) }, final: {} };
    const rows = orderRows(plan, order, T("2026-10-08", "18:00"));
    expect(rows.find((r) => r.name === "소금빵")).toMatchObject({ qty: 70, state: "잠정", provisional: 70 });
    expect(rows.find((r) => r.name === "크루아상")).toMatchObject({ qty: weekQty("크루아상"), state: "잠정" });
  });
  it("금 18시 지나면 최종 확정 안 한 빵은 최종안 그대로 '자동', 확정한 빵은 '확정'", () => {
    const fin = { ...mon.week, madeOn: "2026-10-09", items: [{ name: "소금빵", qty: 72 }, { name: "크루아상", qty: 25 }] };
    const order: OrderDoc = { v: 2, date: mon.date, provisional: { 소금빵: L(70) }, final: { 크루아상: L(24) } };
    const before = orderRows({ ...plan, final: fin }, order, T("2026-10-09", "17:59"));
    expect(before.find((r) => r.name === "소금빵")).toMatchObject({ state: "잠정", qty: 70, suggested: 72 });
    const after = orderRows({ ...plan, final: fin }, order, T("2026-10-09", "18:00"));
    expect(after.find((r) => r.name === "소금빵")).toMatchObject({ state: "자동", qty: 72 });
    expect(after.find((r) => r.name === "크루아상")).toMatchObject({ state: "확정", qty: 24 });
    expect(madeTotal(after)).toBe(96);
    expect(madeTotal(before)).toBeNull(); // 최종 전에는 생산을 모름
    expect(orderText(mon.date, after)).toBe("[10월 12일 생산 명령서] 총 96개\n· 소금빵 72개 (자동)\n· 크루아상 24개");
  });
  it("클라우드에서 읽을 때부터 블루베리잼 · 딸기잼을 뺌 — 매니저 확정 화면 목록 · 합계 · 7일 일괄 확정 · 이미지가 모두 계획을 이렇게 읽음", () => {
    const raw = { ...plan, week: { ...mon.week, items: [...mon.week.items, { name: "블루베리잼", qty: 1 }], total: mon.week.total + 1 }, final: { ...mon.week, items: [{ name: "소금빵", qty: 60 }, { name: "딸기잼", qty: 2 }], total: 62 } };
    const p = asPlan(JSON.parse(JSON.stringify(raw)))!;
    expect(p.week!.items.some((i) => i.name === "블루베리잼")).toBe(false);
    expect(p.week!.total).toBe(mon.week.total);
    expect(p.final!.items.map((i) => i.name)).toEqual(["소금빵"]);
    expect(p.final!.total).toBe(60);
    const o = asOrder({ v: 2, date: mon.date, provisional: { 블루베리잼: L(1), 소금빵: L(70) }, final: { 딸기잼: L(2) } })!;
    expect(Object.keys(o.provisional)).toEqual(["소금빵"]);
    expect(Object.keys(o.final)).toEqual([]);
  });
  it("이미 만들어진 계획에 블루베리잼 · 딸기잼이 있어도 생산 목록 · 합계에서 빠짐 (잠정 확정해 둔 것도)", () => {
    const old: PlanDoc = { ...plan, week: { ...mon.week, items: [...mon.week.items, { name: "블루베리잼", qty: 1 }, { name: "딸기잼", qty: 2 }] } };
    const order: OrderDoc = { v: 2, date: mon.date, provisional: { 블루베리잼: L(1) }, final: {} };
    const rows = orderRows(old, order, T("2026-10-08", "15:19"));
    expect(rows.some((r) => r.name === "블루베리잼" || r.name === "딸기잼")).toBe(false);
    expect(rows.length).toBe(mon.week.items.length);
  });
  it("최종안 계산이 빠진 날 — 마감 뒤에는 잠정(없으면 주간) 수량으로 '자동'", () => {
    const order: OrderDoc = { v: 2, date: mon.date, provisional: { 소금빵: L(70) }, final: {} };
    const rows = orderRows(plan, order, T("2026-10-10", "09:00"));
    expect(rows.find((r) => r.name === "소금빵")).toMatchObject({ state: "자동", qty: 70 });
    expect(rows.find((r) => r.name === "크루아상")).toMatchObject({ state: "자동", qty: weekQty("크루아상") });
  });
  it("계획 · 확정이 없으면 빈 목록 · 예전 모양(v1) 문서는 버림", () => {
    expect(orderRows(null, null, T("2026-10-08", "10:00"))).toEqual([]);
    expect(asPlan({ v: 1, date: "2026-10-05", items: [] })).toBeNull();
    expect(asOrder({ v: 1, date: "2026-10-05", items: {} })).toBeNull();
    expect(asOrder({ v: 2, date: "2026-10-05" })).toEqual({ v: 2, date: "2026-10-05", provisional: {}, final: {} });
  });
  it("한국 시간", () => {
    expect(nowKst(new Date("2026-10-04T09:30:00Z"))).toEqual({ date: "2026-10-04", time: "18:30" });
  });
});

describe("결과 · 오차 → 다음 예측", () => {
  // 10-12: 소금빵 최종 60개(보정 전 60) 만들어 50개 팔림(그중 8개 50% 할인) · 크루아상 20개 만들어 다 팔림 · 딸기잼은 빠짐
  const r = day("2026-10-12", 100, [["소금빵", 50], ["크루아상", 20], ["딸기잼", 4], ["블루베리잼", 3]]);
  r.cafe!.bakeryHalfBy = { 소금빵: 8 };
  const b = new Board([r]);
  const step = { madeOn: "2026-10-09", asOf: "2026-10-08", kind: "평일" as const, visitors: 100, weather: "모름", total: 80 };
  const plan: PlanDoc = { v: 2, date: "2026-10-12", final: { ...step, items: [{ name: "소금빵", qty: 60, base: 60 }, { name: "크루아상", qty: 20, base: 20 }] } };
  const rows = dayResult(b, "2026-10-12", plan, null);

  it("생산(최종 자동) · 판매 · 50% 할인 · 폐기 = 생산 − 판매", () => {
    expect(rows.find((x) => x.name === "소금빵")).toMatchObject({ made: 60, sold: 50, half: 8, full: 42, waste: 10, soldOut: false });
    expect(rows.find((x) => x.name === "크루아상")).toMatchObject({ made: 20, sold: 20, waste: 0, soldOut: true });
    expect(rows.some((x) => x.name === "딸기잼")).toBe(false);
    expect(rows.some((x) => x.name === "블루베리잼")).toBe(false);
  });
});

describe("생산 단위 — 몽블랑은 5개 단위", () => {
  it("가까운 5의 배수, 0 보다 많으면 적어도 5개", () => {
    expect(snapUnit("몽블랑", 37)).toBe(35);
    expect(snapUnit("몽블랑", 38)).toBe(40);
    expect(snapUnit("몽블랑", 2)).toBe(5);
    expect(snapUnit("몽블랑", 0)).toBe(0);
    expect(snapUnit("소금빵", 37)).toBe(37);
  });
  it("범위가 있으면 범위 안의 5의 배수 (없으면 가장 가까운 배수)", () => {
    expect(snapUnit("몽블랑", 38, 36, 44)).toBe(40);
    expect(snapUnit("몽블랑", 36, 36, 44)).toBe(40); // 35 는 범위 밖
    expect(snapUnit("몽블랑", 41, 41, 44)).toBe(40); // 범위 안 배수가 없으면 가까운 쪽
  });
  it("주간 · 최종안에 적용", () => {
    const b = new Board([...make("2025-08-01", "2025-12-31", () => 1), ...make("2026-08-01", "2026-10-07", () => 1)].map((r) => ({ ...r, cafe: { ...r.cafe!, products: [...r.cafe!.products, ["몽블랑", "베이커리", 23, 0] as any] } })));
    const [mon] = makeWeek(b, {}, DEFAULT_LEARNED, "2026-10-08", "2026-10-07");
    expect(mon.week.items.find((i) => i.name === "몽블랑")!.qty % 5).toBe(0);
    const f = makeFinal(b, {}, DEFAULT_LEARNED, "2026-10-09", "2026-10-08", { v: 2, date: mon.date, week: mon.week }, null, { 몽블랑: 1 })!;
    expect(f.items.find((i) => i.name === "몽블랑")!.qty % 5).toBe(0);
  });
});

describe("현장 태블릿 복사본 — 수량 · 상태만", () => {
  it("예상 손님 · 날씨 · 보정 값은 빼고, 태블릿에서 같은 목록이 나옴", () => {
    const step = { madeOn: "2026-10-08", asOf: "2026-10-07", kind: "평일" as const, visitors: 321, weather: "쾌적", total: 50, items: [{ name: "소금빵", qty: 50, base: 47, step: 3 }] };
    const plan: PlanDoc = { v: 2, date: "2026-10-12", week: step, final: { ...step, madeOn: "2026-10-09", items: [{ name: "소금빵", qty: 52, base: 49, lo: 45, hi: 55 }] }, outlook: [] };
    const order: OrderDoc = { v: 2, date: "2026-10-12", provisional: { 소금빵: L(50) }, final: {} };
    const f = floorCopy(plan, order);
    expect(JSON.stringify(f)).not.toMatch(/321|쾌적|base|adj|step|outlook|매니저/);
    const now = T("2026-10-12", "07:00");
    expect(orderRows(f.plan, f.order, now)).toEqual(orderRows(plan, order, now));
  });
});

describe("태블릿 키 번호", () => {
  it("숫자 4 ~ 12자리만", () => {
    expect(validFloorKey("910278")).toBe(true);
    expect(validFloorKey("0123")).toBe(true);
    expect(validFloorKey("123")).toBe(false);
    expect(validFloorKey("1234567890123")).toBe(false);
    expect(validFloorKey("91a278")).toBe(false);
    expect(validFloorKey(" 910278")).toBe(false);
  });
});

describe("베이커리 결과 보고 (B 베이커리 상세) · 생산일 잠금", async () => {
  const { productionStarted } = await import("../src");
  it("합계: 총 생산 = 정가판매 + 할인판매 + 폐기 (현장에서 그날 수량이 바뀔 수 있어 지시 수량이 아님) · 폐기 = 지시(확정 · 자동) − 판매", () => {
    const rows = [
      { name: "소금빵", made: 50, base: null, sold: 48, half: 6, full: 42, waste: 2, soldOut: false },
      { name: "몽블랑", made: 20, base: null, sold: 23, half: 0, full: 23, waste: 0, soldOut: true }, // 지시보다 더 만들어 더 팔림
      { name: "딸기빵", made: null, base: null, sold: 3, half: 0, full: 3, waste: null, soldOut: false }, // 작업지시 없음 — 폐기 모름
    ];
    const t = breadTotals(rows);
    expect(t).toEqual({ made: 76, full: 68, half: 6, waste: 2 });
    expect(t.made).toBe(t.full + t.half + t.waste!);
    expect(rows.map(producedOf)).toEqual([50, 23, 3]);
    expect(breadTotals([{ name: "x", made: null, base: null, sold: 3, half: 1, full: 2, waste: null, soldOut: false }])).toEqual({ made: null, full: 2, half: 1, waste: null });
  });
  it("그날 아침 6시(현장 시작)부터는 그날 최종 수량을 못 바꿈 — 현장에 지시한 수량이 그날 생산 기록", () => {
    expect(productionStarted("2026-10-08", { date: "2026-10-08", time: "05:59" })).toBe(false);
    expect(productionStarted("2026-10-08", { date: "2026-10-08", time: "06:00" })).toBe(true);
    expect(productionStarted("2026-10-08", { date: "2026-10-09", time: "01:00" })).toBe(true);
    expect(productionStarted("2026-10-08", { date: "2026-10-07", time: "23:00" })).toBe(false);
  });
});

describe("베이커리 기본 기준 (2026-10-13 사장님) — 그날 만든 빵은 그날만 · 남으면 모두 폐기 · 총 생산 = 생산 명령, 더 팔리면 현장에서 더 만든 것", () => {
  const st = { madeOn: "2026-10-10", asOf: "2026-10-09", kind: "평일" as const, visitors: 100, weather: "모름", total: 60 };
  const plan: PlanDoc = { v: 2, date: "2026-10-13", final: { ...st, items: [{ name: "소금빵", qty: 20, base: 20 }, { name: "크루아상", qty: 20, base: 20 }, { name: "시나몬롤", qty: 20, base: 20 }] } };
  it("마감 전 — 총 생산은 생산 명령 수량, 남음 = 명령 − 지금까지 판매", () => {
    const b = new Board([day("2026-10-13", 100, [["소금빵", 5], ["크루아상", 0], ["시나몬롤", 12]])]);
    const rows = dayResult(b, "2026-10-13", plan, null);
    expect(rows.map(producedOf)).toEqual([20, 20, 20]);
    expect(breadTotals(rows)).toMatchObject({ made: 60, waste: 60 - 17 });
  });
  it("명령보다 더 팔림 — 현장에서 1 ~ 2개 더 만든 것으로 보고 총 생산을 판매만큼 올림 (폐기 0)", () => {
    const b = new Board([day("2026-10-13", 100, [["소금빵", 22], ["크루아상", 20], ["시나몬롤", 18]])]);
    const rows = dayResult(b, "2026-10-13", plan, null);
    const x = rows.find((r) => r.name === "소금빵")!;
    expect([producedOf(x), x.waste]).toEqual([22, 0]);
    expect(breadTotals(rows)).toMatchObject({ made: 62, waste: 2 });
  });
  it("마감 뒤 — 총 생산 = 정가판매 + 할인판매 + 폐기 (남은 빵은 모두 폐기)", () => {
    const r = day("2026-10-13", 100, [["소금빵", 18], ["크루아상", 20], ["시나몬롤", 21]]);
    r.cafe!.bakeryHalfBy = { 소금빵: 3 };
    const t = breadTotals(dayResult(new Board([r]), "2026-10-13", plan, null));
    expect(t).toEqual({ made: 61, full: 56, half: 3, waste: 2 });
    expect(t.made).toBe(t.full + t.half + t.waste!);
  });
});

describe("그날 개수가 마이너스인 빵(짝 못 찾은 반품 등) — 판매 · 할인 · 생산이 마이너스로 나오지 않음", () => {
  // 10-13 마감 전: 소금빵 5개 팔림 · 크루아상은 반품 2개만 잡혀 −2 · 할인 줄은 아직 없음
  const r = day("2026-10-13", 100, [["소금빵", 5], ["크루아상", -2]]);
  const b = new Board([r]);
  const st = { madeOn: "2026-10-10", asOf: "2026-10-09", kind: "평일" as const, visitors: 100, weather: "모름", total: 30 };
  const plan: PlanDoc = { v: 2, date: "2026-10-13", final: { ...st, items: [{ name: "소금빵", qty: 20, base: 20 }, { name: "크루아상", qty: 10, base: 10 }] } };
  const rows = dayResult(b, "2026-10-13", plan, null);
  it("반품만 잡힌 빵은 판매 0 · 할인 0 · 남음 = 지시 수량", () => {
    expect(rows.find((x) => x.name === "크루아상")).toMatchObject({ sold: 0, half: 0, full: 0, waste: 10 });
    const t = breadTotals(rows);
    expect(t).toEqual({ made: 30, full: 5, half: 0, waste: 25 });
  });
  it("상품 목록의 그날 · 4주 판매도 마이너스로 안 셈", () => {
    const x = bakeryProducts(b, "2026-10-13", plan, null).find((p) => p.name === "크루아상")!;
    expect([x.day, x.recent]).toEqual([0, 0]);
  });
});

describe("베이커리로 셈해진 상품 전체 (B 베이커리 상세 맨 아래 목록)", () => {
  // 9-01 에만 팔린 마카롱 · 10-10 ~ 10-12 소금빵 · 10-12 샌드위치(작업지시 없음) · 작업지시에만 있는 새 빵(바게트) · 잼은 기타
  const reps = [
    day("2026-09-01", 100, [["마카롱", 5]]),
    day("2026-10-10", 100, [["소금빵", 30], ["딸기잼", 2]]),
    day("2026-10-11", 100, [["소금빵", 40]]),
    day("2026-10-12", 100, [["소금빵", 50], ["샌드위치", 7]]),
    day("2026-10-13", 100, [["소금빵", 99]]),
  ];
  const b = new Board(reps);
  const step = { madeOn: "2026-10-09", asOf: "2026-10-08", kind: "평일" as const, visitors: 100, weather: "모름", total: 80 };
  const plan: PlanDoc = { v: 2, date: "2026-10-12", final: { ...step, items: [{ name: "소금빵", qty: 60, base: 60 }, { name: "바게트", qty: 10, base: 10 }] } };
  const list = bakeryProducts(b, "2026-10-12", plan, null);
  const get = (n: string) => list.find((x) => x.name === n);

  it("작업지시 수량 · 그날 판매 · 최근 4주 판매 · 마지막 판매일 (고른 날까지만)", () => {
    expect(get("소금빵")).toEqual({ name: "소금빵", order: 60, day: 50, recent: 120, last: "2026-10-12" });
    expect(get("샌드위치")).toEqual({ name: "샌드위치", order: null, day: 7, recent: 7, last: "2026-10-12" });
    expect(get("바게트")).toEqual({ name: "바게트", order: 10, day: 0, recent: 0, last: null });
  });
  it("4주 넘게 안 팔린 상품도 마지막 판매일과 함께 · 잼(생산품 아님)은 빠짐", () => {
    expect(get("마카롱")).toEqual({ name: "마카롱", order: null, day: 0, recent: 0, last: "2026-09-01" });
    expect(get("딸기잼")).toBeUndefined();
  });
  it("순서: 작업지시 있는 빵(지시 많은 순) → 그날 · 4주 많이 팔린 순 → 오래 안 팔린 것", () => {
    expect(list.map((x) => x.name)).toEqual(["소금빵", "바게트", "샌드위치", "마카롱"]);
  });
  it("작업지시가 없는 날은 지시 칸이 모두 비어 있음", () => {
    expect(bakeryProducts(b, "2026-10-11", null, null).every((x) => x.order === null)).toBe(true);
  });
});

describe("같은 요일 결과로 ±1 (2026-10-12 사장님 규칙)", () => {
  it("묶음 — 요일마다 따로, 평일에 낀 공휴일은 공휴일끼리 (주말은 그 요일)", () => {
    expect(stepGroup("2026-10-12")).toBe("월");
    expect(stepGroup("2026-10-13")).toBe("화");
    expect(stepGroup("2026-10-09")).toBe("공휴일"); // 한글날(금)
    expect(stepGroup("2026-10-05")).toBe("공휴일"); // 개천절 대체 휴일(월)
    expect(stepGroup("2026-10-10")).toBe("토");
    expect(stepGroup("2026-10-03")).toBe("토"); // 개천절이 토요일
  });
  it("앞선 같은 묶음 날 — 월요일은 월요일만, 공휴일 월요일은 건너뜀", () => {
    expect(sameGroupBefore("2026-10-19", 3)).toEqual(["2026-10-12", "2026-09-28", "2026-09-21"]);
    expect(sameGroupBefore("2026-10-16", 2)).toEqual(["2026-10-02", "2026-09-18"]); // 10-09 한글날 · 09-25 추석 건너뜀
    expect(sameGroupBefore("2026-10-09", 3)).toEqual(["2026-10-05", "2026-09-25", "2026-09-24"]);
  });
  const R = (made: number | null, sold: number, half = 0): BreadResult => ({ name: "x", made, base: made, sold, half, full: sold - half, waste: made == null ? null : Math.max(0, made - sold), soldOut: false });
  it("한 칸 — 할인 없이 매진 +1 · 할인 있으며 매진 그대로 · 폐기 −1", () => {
    expect(stepOf(R(20, 20), "2026-10-12")).toBe(1);
    expect(stepOf(R(20, 25), "2026-10-12")).toBe(1); // 더 만들어 다 팔림
    expect(stepOf(R(20, 20, 3), "2026-10-12")).toBe(0);
    expect(stepOf(R(60, 50, 8), "2026-10-12")).toBe(-1);
    expect(stepOf(R(60, 59), "2026-10-12")).toBe(-1);
    expect(stepOf(R(null, 5), "2026-10-12")).toBeNull(); // 작업지시에 없던 상품
    expect(stepOf(R(0, 0), "2026-10-12")).toBeNull();
  });
  const RT = (made: number, sold: number, half: number, last: string | null): BreadResult => ({ ...R(made, sold, half), last });
  it("매진 목표 20:40 (2026-10-16 사장님, 20:30 → 20:40) — 10-19 결과부터(= 10-26 계획부터): 20:40 전에 다 팔림 +1 · 20:40 뒤 다 팔림 그대로 · 폐기 −1", () => {
    expect(SELL_OUT_TARGET).toBe("20:40");
    expect(SELL_OUT_RULE_FROM).toBe("2026-10-19");
    const D = "2026-10-19";
    expect(stepOf(RT(20, 20, 0, "19:50:12"), D)).toBe(1); // 할인 전에 다 팔림
    expect(stepOf(RT(20, 20, 3, "20:33:00"), D)).toBe(1); // 할인으로 다 팔렸지만 20:40 전 (예전 규칙은 그대로)
    expect(stepOf(RT(20, 20, 3, "20:39:59"), D)).toBe(1);
    expect(stepOf(RT(20, 20, 3, "20:40:00"), D)).toBe(0); // 목표 시각에 다 팔림
    expect(stepOf(RT(20, 20, 5, "20:52"), D)).toBe(0);
    expect(stepOf(RT(20, 22, 0, "20:45:00"), "2026-11-02")).toBe(0); // 할인 없이 20:40 뒤 다 팔림
    expect(stepOf(RT(60, 59, 0, "20:59:00"), D)).toBe(-1); // 남음
    // 마지막 판매 시각을 모르면 예전 규칙 (할인 없이 매진 +1 · 할인 있으며 매진 그대로)
    expect(stepOf(RT(20, 20, 3, null), D)).toBe(0);
    expect(stepOf(RT(20, 20, 0, null), D)).toBe(1);
  });
  it("10-18 결과까지(= 10-19 ~ 10-25 계획)는 매진 시각을 알아도 예전 규칙 (2026-10-17 사장님 — 준비 시작한 주는 바꾸지 않음)", () => {
    expect(stepOf(RT(20, 20, 3, "20:33:00"), "2026-10-18")).toBe(0); // 할인 있으며 매진 → 그대로
    expect(stepOf(RT(20, 20, 0, "20:45:00"), "2026-10-13")).toBe(1); // 할인 없이 매진 → +1
    expect(stepOf(RT(20, 18, 2, "20:50:00"), "2026-10-14")).toBe(-1);
  });
  it("그날 결과에 빵별 마지막 판매 시각 (분까지, 모르면 null)", () => {
    const d = day("2026-10-13", 100, [["소금빵", 20], ["크루아상", 5]]);
    d.cafe!.bakeryLastBy = { 소금빵: "20:36:10" };
    const st0 = { madeOn: "2026-10-10", asOf: "2026-10-09", kind: "평일" as const, visitors: 100, weather: "모름", total: 25 };
    const rows = dayResult(new Board([d]), "2026-10-13", { v: 2, date: "2026-10-13", final: { ...st0, items: [{ name: "소금빵", qty: 20 }, { name: "크루아상", qty: 5 }] } }, null);
    expect(rows.map((x) => [x.name, x.last])).toEqual([["소금빵", "20:36"], ["크루아상", null]]);
    expect(stepOf(rows[0], "2026-10-19")).toBe(1);
    expect(stepOf(rows[0], "2026-10-13")).toBe(1); // 할인 없음 → 예전 규칙도 +1
  });
  it("이미 센 계획에 칸만 다시 (규칙이 바뀐 주간안 고치기) — 예측(base)은 그대로, 칸 × 단위 · ±30% · 합계 다시", () => {
    const st1 = {
      madeOn: "2026-10-15", asOf: "2026-10-14", kind: "평일" as const, visitors: 100, weather: "모름",
      items: [{ name: "소금빵", qty: 21, base: 20, step: 1 }, { name: "몽블랑", qty: 15, base: 15 }, { name: "크루아상", qty: 9, base: 10, step: -1 }, { name: "바게트", qty: 4, base: 4 }],
      total: 49,
    };
    const out = restep(st1, { 소금빵: 2, 몽블랑: 1, 크루아상: -1, 바게트: 9 });
    expect(out.items).toEqual([
      { name: "소금빵", qty: 22, base: 20, step: 2 },
      { name: "몽블랑", qty: 20, base: 15, step: 1 }, // 5개 단위
      { name: "크루아상", qty: 9, base: 10, step: -1 },
      { name: "바게트", qty: 5, base: 4, step: 1 }, // ±30% (적어도 1칸)
    ]);
    expect(out.total).toBe(56);
    expect(out.madeOn).toBe("2026-10-15");
    // 칸이 0 이 되면 step 은 뺌 · base 가 없던 예전 줄은 qty 를 예측으로
    expect(restep({ ...st1, items: [{ name: "소금빵", qty: 21, base: 20, step: 1 }, { name: "식빵", qty: 6 }] }, {}).items).toEqual([{ name: "소금빵", qty: 20, base: 20 }, { name: "식빵", qty: 6, base: 6 }]);
  });
  // 10-12(월): 소금빵 지시 60(칸 +2) → 50 팔림(폐기) · 크루아상 20 → 20 다 팔림(할인 없음) · 시나몬롤 10(칸 −1) → 10 팔림 중 2개 50% · 바게트 5 → 하나도 안 팔림
  const r = day("2026-10-12", 100, [["소금빵", 50], ["크루아상", 20], ["시나몬롤", 10]]);
  r.cafe!.bakeryHalfBy = { 소금빵: 8, 시나몬롤: 2 };
  const b = new Board([r]);
  const st = { madeOn: "2026-10-09", asOf: "2026-10-08", kind: "평일" as const, visitors: 100, weather: "모름", total: 95 };
  const plan: PlanDoc = { v: 2, date: "2026-10-12", final: { ...st, items: [{ name: "소금빵", qty: 60, base: 58, step: 2 }, { name: "크루아상", qty: 20, base: 20 }, { name: "시나몬롤", qty: 10, base: 11, step: -1 }, { name: "바게트", qty: 5, base: 5 }] } };
  it("다음 같은 요일 칸 = 그날 계획의 칸 + 그날 결과", () => {
    expect(nextSteps(b, "2026-10-13", { date: "2026-10-12", plan, order: null })).toEqual({ 소금빵: 1, 크루아상: 1, 시나몬롤: -1, 바게트: -1 });
  });
  it("매니저가 확정한 수량이 생산 기준", () => {
    const order: OrderDoc = { v: 2, date: "2026-10-12", provisional: {}, final: { 소금빵: L(50) } };
    expect(nextSteps(b, "2026-10-13", { date: "2026-10-12", plan, order }).소금빵).toBe(2); // 50 만들어 50 다 팔림(할인 8개 있음 → 그대로)
  });
  it("다음 같은 요일 칸 — 10-19 결과부터 20:40 규칙, 10-12 결과는 예전 규칙 (같은 매진 시각이라도)", () => {
    const mk = (date: string) => {
      const d = day(date, 100, [["소금빵", 20]]);
      d.cafe!.bakeryHalfBy = { 소금빵: 3 };
      d.cafe!.bakeryLastBy = { 소금빵: "20:33:00" };
      const st0 = { madeOn: "2026-10-01", asOf: "2026-10-01", kind: "평일" as const, visitors: 100, weather: "모름", total: 20 };
      const pl: PlanDoc = { v: 2, date, final: { ...st0, items: [{ name: "소금빵", qty: 20, base: 20 }] } };
      return { b: new Board([d]), pl };
    };
    const a = mk("2026-10-12");
    expect(nextSteps(a.b, "2026-10-30", { date: "2026-10-12", plan: a.pl, order: null })).toEqual({}); // 할인 있으며 매진 → 그대로
    const c = mk("2026-10-19");
    expect(nextSteps(c.b, "2026-10-30", { date: "2026-10-19", plan: c.pl, order: null })).toEqual({ 소금빵: 1 }); // 20:40 전에 다 팔림 → +1
  });
  it("실적이 아직 없거나(쓸 수 있는 날 뒤) 문 닫은 날은 칸만 이어 감", () => {
    expect(nextSteps(b, "2026-10-11", { date: "2026-10-12", plan, order: null })).toEqual({ 소금빵: 2, 시나몬롤: -1 });
    expect(nextSteps(new Board([]), "2026-10-13", { date: "2026-10-12", plan, order: null })).toEqual({ 소금빵: 2, 시나몬롤: -1 });
    expect(nextSteps(b, "2026-10-13", null)).toEqual({});
  });
});
