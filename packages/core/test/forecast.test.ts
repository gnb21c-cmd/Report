import { describe, expect, it } from "vitest";
import { addDays, backtest, Board, breadPlan, dayKind, dayRange, forecastVisitors, HOURS, lyDays, weatherClass, withinBand, yoyRatio, type DayReport, type DayWeather, type ProductTuple, type StorePart } from "../src";

const H = () => HOURS.map(() => 0);
/** 카페 하루 — 잔 수(→ 방문객 = 잔 × 0.96)와 빵 판매 */
function day(date: string, cups: number, bread: [string, number][] = []): DayReport {
  const products: ProductTuple[] = bread.map(([n, q]) => [n, "베이커리", q, q * 4000]);
  const net = bread.reduce((a, [, q]) => a + q * 4000, 0);
  const cafe: StorePart = {
    v: 1,
    store: "cafe",
    date,
    basis: "receipt",
    file: "t.xls",
    sheetNet: net,
    posNet: net,
    voucher: 0,
    sectors: { 바리스타: 0, 베이커리: net, 키친: 0, 기타: 0 },
    cups,
    teams: 0,
    teamSizes: [0, 0, 0, 0, 0, 0],
    hourly: { sectors: { 바리스타: H(), 베이커리: H(), 키친: H(), 기타: H() }, cups: H(), teams: H() },
    products,
    refunds: { receipts: 0, lines: 0, unmatched: 0, amount: 0 },
    kids: null,
  };
  return { date, cafe };
}
const W = (date: string, o: Partial<DayWeather>): DayWeather => ({ date, key: "sunny", label: "", icon: "", tempMax: 20, tempMin: 10, rainMm: 0, source: "observed", ...o });

/** 작년 · 올해 같은 모양 — 평일 100잔, 금 120잔, 휴일 200잔 (올해는 × k) */
function make(from: string, to: string, k: (d: string) => number, bread = true): DayReport[] {
  return dayRange(from, to).map((d) => {
    const kind = dayKind(d);
    const cups = Math.round((kind === "휴일" ? 200 : kind === "금요일" ? 120 : 100) * k(d));
    return day(d, cups, bread ? [["소금빵", Math.round(cups * 0.3)], ["크루아상", Math.round(cups * 0.1)]] : []);
  });
}

describe("날 유형 · 날씨 칸", () => {
  it("토 · 일 · 공휴일은 휴일, 금요일은 따로", () => {
    expect(dayKind("2026-10-03")).toBe("휴일"); // 토 · 개천절
    expect(dayKind("2026-10-09")).toBe("휴일"); // 금 · 한글날
    expect(dayKind("2026-10-16")).toBe("금요일");
    expect(dayKind("2026-10-14")).toBe("평일");
  });
  it("사장님 규칙 칸 — 약 · 중간 비, 폭우, 눈, 더움 · 추움, 쾌적", () => {
    expect(weatherClass(W("x", { key: "rain", rainMm: 4 }))).toBe("약한비");
    expect(weatherClass(W("x", { key: "rain", rainMm: 15 }))).toBe("중간비");
    expect(weatherClass(W("x", { key: "heavyrain", rainMm: 45 }))).toBe("폭우");
    expect(weatherClass(W("x", { key: "snow" }))).toBe("눈");
    expect(weatherClass(W("x", { tempMax: 33 }))).toBe("더움");
    expect(weatherClass(W("x", { tempMax: 1 }))).toBe("추움");
    expect(weatherClass(W("x", { tempMax: 21 }))).toBe("쾌적");
    expect(weatherClass(W("x", { tempMax: 10 }))).toBe("보통");
    expect(weatherClass(null)).toBe("모름");
  });
});

describe("방문객 예측", () => {
  // 2025 · 2026 모두 같은 모양, 올해는 작년의 0.9배
  const reports = [...make("2025-08-01", "2025-11-30", () => 1), ...make("2026-08-01", "2026-10-03", () => 0.9)];
  const board = new Board(reports);

  it("작년 기준일 — 364일 전 근처 같은 날 유형", () => {
    const ly = lyDays(board, "2026-10-14"); // 수
    expect(ly.length).toBe(3);
    for (const d of ly) expect(dayKind(d)).toBe("평일");
  });

  it("올해 ÷ 작년 비율", () => {
    expect(yoyRatio(board, "2026-10-03", 14)).toBeCloseTo(0.9, 1);
  });

  it("작년 × 올해 수준 — 평일 100잔 × 0.96 × 0.9 ≈ 86명", () => {
    const f = forecastVisitors(board, {}, "2026-10-03", "2026-10-06"); // 화
    expect(f.baseFrom).toBe("작년");
    expect(f.value).toBeGreaterThan(80);
    expect(f.value).toBeLessThan(92);
  });

  it("되돌림 — 최근 2주만 뜻밖에 많으면 절반만 믿음", () => {
    const hot = new Board([...make("2025-08-01", "2025-11-30", () => 1), ...make("2026-08-01", "2026-10-03", (d) => (d >= "2026-09-20" ? 1.3 : 1))]);
    const f = forecastVisitors(hot, {}, "2026-10-03", "2026-10-06");
    expect(f.trend.r14!).toBeGreaterThan(1.25);
    expect(f.trend.used).toBeLessThan(f.trend.r14!);
    expect(f.trend.used).toBeGreaterThan(f.trend.r56!);
  });

  it("날씨 — 폭우는 줄이고, 약한 비는 늘림 (작년 기준일 날씨와 견줌)", () => {
    const base = forecastVisitors(board, {}, "2026-10-03", "2026-10-06").value;
    const heavy = forecastVisitors(board, { "2026-10-06": W("2026-10-06", { key: "heavyrain", rainMm: 50 }) }, "2026-10-03", "2026-10-06").value;
    const light = forecastVisitors(board, { "2026-10-06": W("2026-10-06", { key: "rain", rainMm: 3 }) }, "2026-10-03", "2026-10-06").value;
    expect(heavy).toBeLessThan(base);
    expect(light).toBeGreaterThan(base);
  });

  it("작년 자료가 없으면 최근 4주 같은 날 유형 평균", () => {
    const only = new Board(make("2026-08-01", "2026-10-03", () => 1));
    const f = forecastVisitors(only, {}, "2026-10-03", "2026-10-10"); // 토
    expect(f.baseFrom).toBe("최근");
    expect(f.value).toBe(192);
  });
});

describe("빵별 수량", () => {
  const board = new Board([...make("2025-08-01", "2025-11-30", () => 1), ...make("2026-08-01", "2026-10-03", () => 1)]);
  it("방문객 × 1명당 개수 — 소금빵이 크루아상의 약 3배", () => {
    const p = breadPlan(board, {}, "2026-10-03", "2026-10-06");
    const salt = p.items.find((x) => x.name === "소금빵")!;
    const cro = p.items.find((x) => x.name === "크루아상")!;
    expect(salt.qty / cro.qty).toBeCloseTo(3, 0);
    expect(p.total).toBe(salt.qty + cro.qty);
  });
  it("최근 2주에 안 팔린 빵은 빠짐", () => {
    const b = new Board([...make("2026-08-01", "2026-10-03", () => 1), day("2026-08-05", 100, [["단종빵", 10]])]);
    expect(breadPlan(b, {}, "2026-10-03", "2026-10-06").items.some((x) => x.name === "단종빵")).toBe(false);
  });
});

describe("잠정 수량 묶기 · 시험", () => {
  it("D+2 는 처음 수량 ±5%, D+3 은 ±10%", () => {
    expect(withinBand(100, 120, 0.05)).toBe(105);
    expect(withinBand(100, 80, 0.1)).toBe(90);
    expect(withinBand(100, 103, 0.05)).toBe(103);
    expect(withinBand(50, 80, 0.1)).toBe(55); // 50 × 1.1 소수 오차로 56 이 되지 않게
    expect(withinBand(30, 0, 0.1)).toBe(27);
  });
  it("모양이 같으면 오차가 작음", () => {
    const board = new Board([...make("2025-08-01", "2025-11-30", () => 1), ...make("2026-08-01", "2026-10-03", () => 1)]);
    const r = backtest(board, {}, "2026-09-01", "2026-10-03");
    expect(r.all.days).toBeGreaterThan(20);
    expect(r.all.visitors!).toBeLessThan(5);
    expect(r.all.bread!).toBeLessThan(6);
    expect(addDays("2026-10-03", 1)).toBe("2026-10-04");
  });
});

describe("빵 총 개수 = 작년 같은 날 무렵 · 최근 · 작년 다음 주 (비율은 A ⚙ 설정, 처음 30 · 30 · 40)", async () => {
  const { applySettings, breadTrend, breadWeatherFactor, cleanSettings, DEFAULT_BREAD_WEIGHTS, forecastBread } = await import("../src");
  // 작년: 빵 = 잔 × 0.4 · 올해: 1.2 배
  const board = new Board([...make("2025-08-01", "2025-11-30", () => 1), ...make("2026-08-01", "2026-10-07", () => 1.2)]);
  it("처음 비율 30 · 30 · 40 (7~9월 · 4~6월 모두 오차 10% 안팎), 합이 100 이 아니거나 이상하면 처음 값", () => {
    expect(DEFAULT_BREAD_WEIGHTS).toEqual({ ly: 30, recent: 30, lyNext: 40 });
    expect(cleanSettings({}).bakeryWeights).toEqual({ ly: 30, recent: 30, lyNext: 40 });
    expect(cleanSettings({ bakeryWeights: { ly: 50, recent: 30, lyNext: 20 } }).bakeryWeights).toEqual({ ly: 50, recent: 30, lyNext: 20 });
    expect(cleanSettings({ bakeryWeights: { ly: 50, recent: 30, lyNext: 30 } }).bakeryWeights).toEqual({ ly: 30, recent: 30, lyNext: 40 });
    expect(cleanSettings({ bakeryWeights: { ly: -10, recent: 80, lyNext: 30 } }).bakeryWeights).toEqual({ ly: 30, recent: 30, lyNext: 40 });
  });
  it("추세 = 최근 28일 올해 빵 ÷ 작년 같은 날", () => {
    expect(breadTrend(board, "2026-10-07")).toBeCloseTo(1.2, 1);
  });
  it("작년 × 추세 · 최근 · 작년 다음 주 × 추세 — 모양이 같으면 모두 작년 × 1.2", () => {
    applySettings(null);
    const f = forecastBread(board, "2026-10-07", "2026-10-13"); // 화 (평일 100잔 × 0.4 = 40개 → 48개)
    expect(f.weights).toEqual({ ly: 30, recent: 30, lyNext: 40 });
    expect(f.value).toBeGreaterThan(45);
    expect(f.value).toBeLessThan(51);
  });
  it("A 에서 바꾼 비율을 씀 — 최근만 100% 면 최근 같은 날 유형 2번 평균", () => {
    const b = new Board([...make("2025-08-01", "2025-11-30", () => 1), ...make("2026-08-01", "2026-10-07", (d) => (d >= "2026-09-28" ? 2 : 1))]);
    applySettings(cleanSettings({ bakeryWeights: { ly: 0, recent: 100, lyNext: 0 } }));
    expect(forecastBread(b, "2026-10-07", "2026-10-13").value).toBe(80); // 최근 평일 = 200잔 × 0.4
    applySettings(cleanSettings({ bakeryWeights: { ly: 100, recent: 0, lyNext: 0 } }));
    expect(forecastBread(b, "2026-10-07", "2026-10-13").value).toBeLessThan(80);
    applySettings(null);
  });
  it("빵 나누기 — 최근 14일, 최근 날일수록 무겁게 (요즘 늘어난 빵을 빨리 따라감)", () => {
    const days = dayRange("2026-09-01", "2026-10-07").map((d) =>
      day(d, 100, d >= "2026-10-01" ? [["소금빵", 20], ["새빵", 20]] : [["소금빵", 30], ["새빵", 10]]),
    );
    const p = breadPlan(new Board(days), {}, "2026-10-07", "2026-10-13");
    const salt = p.items.find((x) => x.name === "소금빵")!.qty;
    const neu = p.items.find((x) => x.name === "새빵")!.qty;
    expect(neu / salt).toBeGreaterThan(0.6); // 14일 단순 평균이면 0.6
  });
});

describe("빵용 날씨 배수 (2025-01 ~ 2026-10 날씨 대비 판매 시험에서 뚜렷했던 칸만)", async () => {
  const { breadWeatherFactor, breadPlan: bp } = await import("../src");
  it("눈 −6% · 33도 넘음 +8% · 약한 비(0.5~5mm) −4% · 비 안 오는 20~30도 −4% · 나머지 · 날씨 모름은 그대로", () => {
    expect(breadWeatherFactor(W("d", { key: "snow", tempMax: 0 }))).toBe(0.94);
    expect(breadWeatherFactor(W("d", { tempMax: 34 }))).toBe(1.08);
    expect(breadWeatherFactor(W("d", { key: "rain", rainMm: 2 }))).toBe(0.96);
    expect(breadWeatherFactor(W("d", { tempMax: 25 }))).toBe(0.96);
    expect(breadWeatherFactor(W("d", { key: "rain", rainMm: 20, tempMax: 25 }))).toBe(1);
    expect(breadWeatherFactor(W("d", { tempMax: 12 }))).toBe(1);
    expect(breadWeatherFactor(undefined)).toBe(1);
  });
  it("계획에 곱함 — 예보가 있는 날만 (주간 계획 때는 대개 모름 → 그대로)", () => {
    const board = new Board([...make("2025-08-01", "2025-11-30", () => 1), ...make("2026-08-01", "2026-10-07", () => 1)]);
    const plain = bp(board, {}, "2026-10-07", "2026-10-13").total;
    const hot = bp(board, { "2026-10-13": W("2026-10-13", { tempMax: 35 }) }, "2026-10-07", "2026-10-13").total;
    expect(hot / plain).toBeCloseTo(1.08, 1);
  });
});

