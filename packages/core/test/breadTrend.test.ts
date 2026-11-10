import { describe, expect, it } from "vitest";
import {
  addDays,
  Board,
  BREAD_BOOST,
  dayKind,
  dayRange,
  DEFAULT_LEARNED,
  lyTrendLine,
  makeFinal,
  makeWeek,
  NEW_BREAD_DAYS,
  dayResult,
  dayTarget,
  slowBreads,
  snapUnit,
  TREND_FROM,
  trendDay,
  trendPastDays,
  trendTrust,
  type DayReport,
  type DayWeather,
  type PlanDoc,
  type StorePart,
  type WeatherMap,
} from "../src";

/* 2026-10-27 사장님 — 빵 예측을 같은 요일 추세로 (11-09 계획부터 = 11-05 목 발표 주간안 — 10-29 에 한 주 미룸, 사장님)
   지난 4주 같은 요일 실적 ÷ 작년 '오늘' 앞뒤 4주 같은 요일 추세선 = 비율 → 다음 주 = 비율 × 작년 추세선 → 만드는 단위 · 평일 300 ~ 320
   생산 늘림 · 비 주말 · 20시 40분 칸은 없앰 · 판매 4주가 안 된 새 빵은 매니저 기입 · 최종안은 다시 세지 않음(날씨 신뢰도만) */

const H = () => Array.from({ length: 12 }, () => 0);
function day(date: string, bread: [string, number][]): DayReport {
  const cafe: StorePart = {
    v: 1, store: "cafe", date, basis: "receipt", file: "t.xls", sheetNet: 0, posNet: 0, voucher: 0,
    sectors: { 바리스타: 0, 베이커리: 0, 키친: 0, 기타: 0 }, cups: 100, teams: 0, teamSizes: [0, 0, 0, 0, 0, 0],
    hourly: { sectors: { 바리스타: H(), 베이커리: H(), 키친: H(), 기타: H() }, cups: H(), teams: H() },
    products: bread.map(([n, q]) => [n, "베이커리", q, q * 4000]), refunds: { receipts: 0, lines: 0, unmatched: 0, amount: 0 }, kids: null,
  };
  return { date, cafe };
}
const hol = (d: string) => dayKind(d) === "휴일";
/** 작년 빵 합계 곧은 줄 — 평일 · 휴일 따로 조금씩 줄어듦 (asHoliday = 어느 줄로 볼지) */
const lyCurve = (d: string, asHoliday: boolean) => {
  const t = (Date.parse(d) - Date.parse("2025-09-01")) / 864e5;
  return asHoliday ? 1000 - 2 * t : 400 - 0.5 * t;
};
/** 작년 하루 빵 합계 (그날 평일 · 휴일 줄) */
const lyTotal = (d: string) => lyCurve(d, hol(d));
/** 올해 날짜 D 의 작년 추세선 값 — 올해 그날이 평일이면 평일 줄 (작년 그날이 연휴였어도) */
const lyFor = (D: string) => lyCurve(addDays(D, -364), hol(D));
const SHARE: [string, number][] = [["소금빵", 0.5], ["크루아상", 0.3], ["몽블랑", 0.1], ["시나몬롤", 0.1]];
/** 올해 = 작년 같은 요일(364일 전) 추세의 80% · 명란소금빵은 10-20 부터 (새 빵) */
const thisYear = (d: string, k = 0.8): [string, number][] => {
  const t = lyFor(d) * k;
  const out = SHARE.map(([n, s]) => [n, t * s] as [string, number]);
  if (d >= "2026-10-20") out.push(["명란소금빵", 9]);
  return out;
};
const make = (fix?: (d: string) => number | null) => [
  ...dayRange("2025-08-01", "2025-12-31").map((d) => day(d, SHARE.map(([n, s]) => [n, (fix?.(d) ?? lyTotal(d)) * s]))),
  ...dayRange("2026-08-01", "2026-11-04").map((d) => day(d, thisYear(d))),
];
const board = new Board(make());
const today = "2026-11-05"; // 발표하는 목요일
const asOf = "2026-11-04";

describe("같은 요일 추세 — 지난 4주 · 작년 추세선 · 비율", () => {
  it("11-09 계획부터 · 새 빵은 판매 28일이 안 된 빵", () => {
    expect(TREND_FROM).toBe("2026-11-09");
    expect(NEW_BREAD_DAYS).toBe(28);
  });

  it("지난 4주 = asOf 까지 같은 요일 · 같은 평일/휴일 (모르는 날 · 공휴일은 건너뜀)", () => {
    expect(trendPastDays(board, "2026-11-09", asOf)).toEqual(["2026-11-02", "2026-10-26", "2026-10-19", "2026-10-12"]);
    expect(trendPastDays(board, "2026-11-12", asOf)).toEqual(["2026-10-29", "2026-10-22", "2026-10-15", "2026-10-08"]); // 11-05 는 아직 모름
    expect(trendPastDays(board, "2026-11-14", asOf)).toEqual(["2026-10-31", "2026-10-24", "2026-10-17", "2026-10-10"]);
    // 10-29 발표였다면(asOf 10-28) 월요일은 10-05 추석 뒤 대체휴일을 건너뜀
    expect(trendPastDays(board, "2026-11-02", "2026-10-28")).toEqual(["2026-10-26", "2026-10-19", "2026-10-12", "2026-09-28"]);
  });

  it("작년 추세선 — 작년 '오늘' 앞뒤 4주 같은 요일로 그은 곧은 줄", () => {
    const line = lyTrendLine(board, "2026-11-10", today)!;
    expect(line.n).toBeGreaterThanOrEqual(7);
    for (const d of ["2025-10-14", "2025-11-11", "2025-12-02"]) expect(line.at(d)).toBeCloseTo(lyTotal(d), 6);
    // 작년 10-07 은 추석 연휴(휴일)라 화요일 줄에서 빠짐 — 줄 위 값은 평일 줄
    expect(line.at("2025-10-07")).toBeCloseTo(lyCurve("2025-10-07", false), 6);
  });

  it("올해가 작년의 80% 면 다음 주도 작년 추세선의 80% — 빵마다 지난 4주 비율 그대로", () => {
    for (const D of dayRange("2026-11-09", "2026-11-15")) {
      const t = trendDay(board, asOf, today, D);
      const want = 0.8 * lyFor(D);
      const sum = t.items.reduce((a, i) => a + i.raw, 0);
      expect(sum).toBeCloseTo(want, 4);
      expect(t.items.find((i) => i.name === "소금빵")!.raw).toBeCloseTo(want * 0.5, 4);
      expect(t.newBreads).toEqual(["명란소금빵"]);
    }
  });

  it("작년에 튀는 날(연휴 직후 등) 하나가 있어도 추세선이 흔들리지 않음", () => {
    const b = new Board(make((d) => (d === "2025-10-28" ? lyTotal(d) * 3 : null)));
    const t = trendDay(b, asOf, today, "2026-11-10");
    const want = 0.8 * lyFor("2026-11-10");
    expect(Math.abs(t.items.reduce((a, i) => a + i.raw, 0) - want) / want).toBeLessThan(0.02);
  });

  it("신뢰도 — 지난 4주가 고르면 높음, 들쭉날쭉하면 낮음 · 최종안 때 예보 기온이 지난 4주보다 크게 다르면 낮음", () => {
    expect(trendTrust(trendDay(board, asOf, today, "2026-11-10")).level).toBe("높음");
    const wobbly = new Board(make().map((r) => (r.date === "2026-10-27" || r.date === "2026-10-13" ? day(r.date, thisYear(r.date, 1.3)) : r)));
    expect(trendTrust(trendDay(wobbly, asOf, today, "2026-11-10")).level).toBe("낮음");
    const w = (date: string, tempMax: number, source: "observed" | "forecast"): DayWeather => ({ date, key: "sunny", label: "맑음", icon: "", tempMax, tempMin: tempMax - 8, rainMm: 0, source });
    const weather: WeatherMap = { "2026-11-10": w("2026-11-10", 6, "forecast") };
    for (const d of trendPastDays(board, "2026-11-10", asOf)) weather[d] = w(d, 15, "observed");
    const cold = trendTrust(trendDay(board, asOf, today, "2026-11-10"), weather);
    expect(cold.level).toBe("낮음");
    expect(cold.why).toContain("추워짐");
    weather["2026-11-10"] = w("2026-11-10", 19, "forecast");
    expect(trendTrust(trendDay(board, asOf, today, "2026-11-10"), weather).level).toBe("보통");
  });
});

describe("주간안 (11-05 발표, 11-09 ~ 15) — 새 방식 · 하루 목표 (2026-11-05 사장님)", () => {
  // 평일 300 ~ 320 범위는 없앰 → 하루 목표: 월 270 → 금 320 차례로 · 토 800 · 일 750 (새 빵 어림 포함)
  // 지난 4주 할인 + 폐기 많은 빵은 추세 × 0.9 · 나머지 빵이 추세 비율대로 목표를 채움
  const week = makeWeek(board, {}, DEFAULT_LEARNED, today, asOf, { "2026-11-09": { 소금빵: 3 }, "2026-11-14": { 소금빵: -2 } }, new Set(["크루아상"]));
  it("하루 목표 — 월 270 · 화 283 · 수 295 · 목 308 · 금 320 · 토 800 · 일 750 (평일에 낀 공휴일은 일요일처럼)", () => {
    expect(week.map((w) => dayTarget(w.date))).toEqual([270, 283, 295, 308, 320, 800, 750]);
    expect(dayTarget("2026-11-08")).toBeNull(); // 이미 발표한 주는 없음
    // 11-16 계획부터는 반반 규칙 — 하루 목표 없음 (2026-11-10 사장님, breadBinary.test.ts)
    expect(dayTarget("2026-11-15")).toBe(750);
    expect(dayTarget("2026-11-16")).toBeNull();
    expect(dayTarget("2026-12-25")).toBeNull();
    for (const w of week) {
      const st = w.week;
      expect(st.target).toBe(dayTarget(w.date));
      expect(st.total).toBe(st.target! - 4); // 새 빵 어림 포함 · 빵별 조정: 소금빵 −4 (이 자료에 수수부꾸미 · 옥수수찰빵 · 에그타르트 없음)
      expect(st.band).toBeUndefined();
      expect(st.boost).toBeUndefined();
      expect(st.rainUp).toBeUndefined();
      for (const it of st.items) expect(it.step).toBeUndefined();
      expect(st.items.find((i) => i.name === "몽블랑")!.qty % 5).toBe(0);
      expect(st.items.find((i) => i.name === "시나몬롤")!.qty % 10).toBe(0);
      expect(st.trust?.level).toBeDefined();
    }
  });
  it("할인 · 폐기 많은 빵(크루아상)은 추세 × 0.9 · 나머지는 같은 배수로 늘어 목표를 채움 · 추세 그대로였다면도 남김", () => {
    for (const w of week) {
      const t = trendDay(board, asOf, today, w.date);
      const raw = (n: string) => t.items.find((i) => i.name === n)!.raw;
      const cro = w.week.items.find((i) => i.name === "크루아상")!;
      expect(cro).toMatchObject({ qty: snapUnit("크루아상", raw("크루아상") * 0.9), slow: true });
      // 나머지 빵 배수 f = (목표 − 새 빵 어림 − 줄인 빵) ÷ 나머지 추세 합 — 소금빵 = 추세 × f
      // (몽블랑 5 · 시나몬롤 10 단위로 생긴 차이는 1개 단위 늘리는 빵이 나눠 받음 — 이 시험 자료에는 소금빵 하나뿐이라 ±10 안)
      const rest = t.items.filter((i) => i.name !== "크루아상").reduce((a, i) => a + i.raw, 0);
      const f = (w.week.target! - Math.round(9 * t.ratio) - raw("크루아상") * 0.9) / rest;
      const salt = w.week.items.find((i) => i.name === "소금빵")!.qty + 4; // 맞춘 뒤 −4
      expect(Math.abs(salt - raw("소금빵") * f)).toBeLessThanOrEqual(10);
      expect(w.week.trendTotal).toBe(Math.round(t.items.reduce((a, i) => a + i.raw, 0) + Math.round(9 * t.ratio)));
    }
  });
  it("새 빵(판매 28일 안 됨) = 판 날의 같은 요일 판매 평균 × 작년 추세선 비율 (매니저가 고칠 수 있음) · 아직 안 팔린 포스 빵(클래식롤케이크)은 0 · 매니저 기입", () => {
    for (const w of week) {
      const q = Math.round(9 * trendDay(board, asOf, today, w.date).ratio);
      expect(w.week.items.find((i) => i.name === "명란소금빵")).toEqual({ name: "명란소금빵", qty: q, base: q, est: true, trend: q, tuned: q });
      expect(w.week.items.at(-1)).toEqual({ name: "클래식롤케이크", qty: 0, manual: true, trend: 0, tuned: 0 });
    }
  });
  it("빵별 조정 — 수수부꾸미 · 옥수수찰빵은 어림 + 2 (목표 위에 더함, 인기 시험) · 소금빵 −4", () => {
    const plusBoard = new Board(make().map((r) => (r.date >= "2026-10-20" ? day(r.date, [...thisYear(r.date), ["흑미로만든수수부꾸미", 7], ["옥수수찰빵(3EA)", 5]]) : r)));
    const [mon] = makeWeek(plusBoard, {}, DEFAULT_LEARNED, today, asOf);
    const r = trendDay(plusBoard, asOf, today, mon.date).ratio;
    expect(mon.week.items.find((i) => i.name === "흑미로만든수수부꾸미")).toMatchObject({ qty: Math.round(7 * r) + 2, base: Math.round(7 * r), est: true });
    expect(mon.week.items.find((i) => i.name === "옥수수찰빵(3EA)")).toMatchObject({ qty: Math.round(5 * r) + 2, base: Math.round(5 * r), est: true });
    expect(mon.week.total).toBe(270 + 4 - 4); // 수수부꾸미 · 옥수수찰빵 +2 · 소금빵 −4
  });
  it("에그타르트 = 평일(금요일 포함) 10 · 휴일 35 (목표에 맞춘 뒤 정한 수량, 2026-11-05 사장님)", () => {
    const egg = new Board(make().map((r) => (r.date >= "2026-09-01" ? day(r.date, [...thisYear(r.date), ["에그타르트", 20]]) : r)));
    const w = makeWeek(egg, {}, DEFAULT_LEARNED, today, asOf);
    expect(w.map((x) => x.week.items.find((i) => i.name === "에그타르트")!.qty)).toEqual([10, 10, 10, 10, 10, 35, 35]);
  });

  it("1 ~ 4주 전망 — 하루 목표 평균 + 더하기 빵", () => {
    const o = week[0].outlook!;
    expect(o).toHaveLength(4);
    expect(o[0].from).toBe("2026-11-09");
    expect(o[0].weekday).toBe(Math.round((270 + 283 + 295 + 308 + 320) / 5 + 0)); // 빵별 조정 합 +2 +2 −4 = 0
    expect(o[0].holiday).toBe(Math.round((800 + 750) / 2 + 0));
  });
});

describe("할인 · 폐기 많은 빵 — 내놓은 수량(생산 − 생산실패)에 견줌 (2026-11-05 사장님)", () => {
  it("생산 10 · 실패 1 · 정가 5 · 할인 2 → 폐기 2 · (할인 2 + 폐기 2) ÷ 내놓은 9 = 44% → 줄이는 빵 / 10개 내 9개 팔림 → 아님", () => {
    const days = dayRange("2026-10-07", "2026-11-03");
    const rep = (d: string): DayReport => {
      const r = day(d, [["레몬파운드", 7], ["소금빵", 9]]);
      r.cafe!.bakeryHalfBy = { 레몬파운드: 2 };
      return r;
    };
    const b = new Board(days.map(rep));
    const docs = (d: string) => ({
      plan: { v: 2 as const, date: d, final: { madeOn: d, asOf: d, kind: "평일" as const, visitors: 0, weather: "", total: 20, items: [{ name: "레몬파운드", qty: 10 }, { name: "소금빵", qty: 10 }] } },
      order: { v: 2 as const, date: d, provisional: {}, final: {}, fail: { 레몬파운드: { qty: 1, by: "현장", at: `${d}T03:00:00Z` } } },
    });
    const r = dayResult(b, "2026-11-03", docs("2026-11-03").plan, docs("2026-11-03").order).find((x) => x.name === "레몬파운드")!;
    expect([r.made, r.fail, r.full, r.half, r.waste]).toEqual([10, 1, 5, 2, 2]);
    expect([...slowBreads(b, "2026-11-03", docs)]).toEqual(["레몬파운드"]);
  });
});

describe("최종안(3일 전) — 11-09 부터는 다시 세지 않음 · 날씨 신뢰도만", () => {
  const [mon] = makeWeek(board, {}, DEFAULT_LEARNED, today, asOf);
  const plan: PlanDoc = { v: 2, date: mon.date, week: mon.week };
  const L = (qty: number) => ({ qty, by: "매니저", at: "t" });
  it("매니저 잠정 확정(없으면 주간안) 수량 그대로 — ±10% 범위 · 다시 셈 없음", () => {
    const changed = new Board(make().map((r) => (r.date >= "2026-10-27" ? day(r.date, thisYear(r.date, 1.2)) : r)));
    const f = makeFinal(changed, {}, DEFAULT_LEARNED, "2026-11-06", "2026-11-05", plan, { v: 2, date: mon.date, provisional: { 소금빵: L(150), 명란소금빵: L(12) }, final: {} })!;
    expect(f.items.find((i) => i.name === "소금빵")!.qty).toBe(150);
    expect(f.items.find((i) => i.name === "명란소금빵")).toMatchObject({ qty: 12 });
    for (const it of f.items) {
      expect(it.lo).toBeUndefined();
      if (it.name !== "소금빵" && it.name !== "명란소금빵") expect(it.qty).toBe(mon.week.items.find((i) => i.name === it.name)!.qty);
    }
    expect(f.total).toBe(f.items.reduce((a, b) => a + b.qty, 0));
  });
  it("그날 예보가 지난 4주 같은 요일보다 크게 추우면 신뢰도 낮음 (매니저가 보고 조정)", () => {
    const wx: WeatherMap = { "2026-11-09": { date: "2026-11-09", key: "sunny", label: "맑음", icon: "", tempMax: 4, tempMin: -3, rainMm: 0, source: "forecast" } };
    for (const d of trendPastDays(board, "2026-11-09", "2026-11-05")) wx[d] = { date: d, key: "sunny", label: "맑음", icon: "", tempMax: 16, tempMin: 8, rainMm: 0, source: "observed" };
    const f = makeFinal(board, wx, DEFAULT_LEARNED, "2026-11-06", "2026-11-05", plan, null)!;
    expect(f.trust?.level).toBe("낮음");
    expect(f.trust?.why).toContain("추워짐");
    expect(f.items.map((i) => i.qty)).toEqual(mon.week.items.map((i) => i.qty).filter((q, i) => q > 0 || mon.week.items[i].manual));
  });
});

describe("11-08 까지(이미 발표한 주 · 10-29 발표 주간안)는 예전 그대로 (2026-10-29 사장님 — 매니저가 11-02 주를 이미 확정)", () => {
  it("10-22 발표 주간안 — 10-26 ~ 11-01 은 생산 늘림 · 같은 요일 칸 그대로", () => {
    const old = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-22", "2026-10-21", { "2026-10-26": { 소금빵: 2 } });
    expect(old[0].week.boost).toBe(1.5);
    expect(old[0].week.items.find((i) => i.name === "소금빵")!.step).toBe(2);
    expect(old.every((w) => !w.week.items.some((i) => i.manual))).toBe(true);
  });

  it("10-29 발표 주간안(11-02 ~ 08) — 생산 늘림 · 같은 요일 칸 · 명란소금빵은 소보로팥소금빵 규칙(매니저 기입 아님) · 전망도 예전 그대로", () => {
    const w = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-29", "2026-10-28", { "2026-11-02": { 소금빵: 2 } });
    expect(w.map((x) => x.date)).toEqual(dayRange("2026-11-02", "2026-11-08"));
    expect(w[0].week.boost).toBe(1.5);
    expect(w[0].week.items.find((i) => i.name === "소금빵")!.step).toBe(2);
    expect(w.every((x) => !x.week.items.some((i) => i.manual) && x.week.trust == null)).toBe(true);
    // 최종안(3일 전)도 예전처럼 다시 셈 — 잠정 확정 ±10% 범위
    const f = makeFinal(board, {}, DEFAULT_LEARNED, "2026-10-30", "2026-10-29", { v: 2, date: w[0].date, week: w[0].week }, null)!;
    expect(f.trust).toBeUndefined();
    expect(f.items.some((i) => i.lo != null)).toBe(true);
  });
});

describe("두 계획 중 이번 주에 쓸 쪽 (2026-11-05 사장님 — 지난 견주기 결과로)", () => {
  it("평일 '추세'면 평일은 추세 수량 · 휴일은 조정 그대로 · 두 수량은 늘 남김 · 빵별 조정을 뺀 빵은 그 빵만 추세", () => {
    const tuned = makeWeek(board, {}, DEFAULT_LEARNED, today, asOf);
    const mixed = makeWeek(board, {}, DEFAULT_LEARNED, today, asOf, {}, undefined, { 평일: "추세", 휴일: "조정", drop: ["소금빵"] });
    for (const [i, w] of mixed.entries()) {
      expect(w.week.mode).toMatchObject({ 평일: "추세", 휴일: "조정" });
      for (const it of w.week.items) {
        const t = tuned[i].week.items.find((x) => x.name === it.name)!;
        expect([it.trend, it.tuned]).toEqual([t.trend, t.tuned]);
        const useTrend = dayKind(w.date) !== "휴일" || it.name === "소금빵";
        expect(it.qty).toBe(useTrend ? it.trend : it.tuned);
      }
    }
  });
});
