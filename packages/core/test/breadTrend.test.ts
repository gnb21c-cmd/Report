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

/* 2026-10-27 사장님 — 빵 예측을 같은 요일 추세로 (11-02 계획부터)
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
  ...dayRange("2026-08-01", "2026-10-28").map((d) => day(d, thisYear(d))),
];
const board = new Board(make());
const today = "2026-10-29"; // 발표하는 목요일
const asOf = "2026-10-28";

describe("같은 요일 추세 — 지난 4주 · 작년 추세선 · 비율", () => {
  it("11-02 계획부터 · 새 빵은 판매 28일이 안 된 빵", () => {
    expect(TREND_FROM).toBe("2026-11-02");
    expect(NEW_BREAD_DAYS).toBe(28);
  });

  it("지난 4주 = asOf 까지 같은 요일 · 같은 평일/휴일 (모르는 날 · 공휴일은 건너뜀)", () => {
    expect(trendPastDays(board, "2026-11-02", asOf)).toEqual(["2026-10-26", "2026-10-19", "2026-10-12", "2026-09-28"]); // 10-05 는 추석 뒤 대체휴일
    expect(trendPastDays(board, "2026-11-05", asOf)).toEqual(["2026-10-22", "2026-10-15", "2026-10-08", "2026-10-01"]); // 10-29 는 아직 모름
    expect(trendPastDays(board, "2026-11-07", asOf)).toEqual(["2026-10-24", "2026-10-17", "2026-10-10", "2026-10-03"]);
  });

  it("작년 추세선 — 작년 '오늘' 앞뒤 4주 같은 요일로 그은 곧은 줄", () => {
    const line = lyTrendLine(board, "2026-11-03", today)!;
    expect(line.n).toBeGreaterThanOrEqual(7);
    for (const d of ["2025-10-14", "2025-11-04", "2025-11-25"]) expect(line.at(d)).toBeCloseTo(lyTotal(d), 6);
    // 작년 10-07 은 추석 연휴(휴일)라 화요일 줄에서 빠짐 — 줄 위 값은 평일 줄
    expect(line.at("2025-10-07")).toBeCloseTo(lyCurve("2025-10-07", false), 6);
  });

  it("올해가 작년의 80% 면 다음 주도 작년 추세선의 80% — 빵마다 지난 4주 비율 그대로", () => {
    for (const D of dayRange("2026-11-02", "2026-11-08")) {
      const t = trendDay(board, asOf, today, D);
      const want = 0.8 * lyFor(D);
      const sum = t.items.reduce((a, i) => a + i.raw, 0);
      expect(sum).toBeCloseTo(want, 4);
      expect(t.items.find((i) => i.name === "소금빵")!.raw).toBeCloseTo(want * 0.5, 4);
      expect(t.newBreads).toEqual(["명란소금빵"]);
    }
  });

  it("작년에 튀는 날(연휴 직후 등) 하나가 있어도 추세선이 흔들리지 않음", () => {
    const b = new Board(make((d) => (d === "2025-10-21" ? lyTotal(d) * 3 : null)));
    const t = trendDay(b, asOf, today, "2026-11-03");
    const want = 0.8 * lyFor("2026-11-03");
    expect(Math.abs(t.items.reduce((a, i) => a + i.raw, 0) - want) / want).toBeLessThan(0.02);
  });

  it("신뢰도 — 지난 4주가 고르면 높음, 들쭉날쭉하면 낮음 · 최종안 때 예보 기온이 지난 4주보다 크게 다르면 낮음", () => {
    expect(trendTrust(trendDay(board, asOf, today, "2026-11-03")).level).toBe("높음");
    const wobbly = new Board(make().map((r) => (r.date === "2026-10-20" || r.date === "2026-10-06" ? day(r.date, thisYear(r.date, 1.3)) : r)));
    expect(trendTrust(trendDay(wobbly, asOf, today, "2026-11-03")).level).toBe("낮음");
    const w = (date: string, tempMax: number, source: "observed" | "forecast"): DayWeather => ({ date, key: "sunny", label: "맑음", icon: "", tempMax, tempMin: tempMax - 8, rainMm: 0, source });
    const weather: WeatherMap = { "2026-11-03": w("2026-11-03", 6, "forecast") };
    for (const d of trendPastDays(board, "2026-11-03", asOf)) weather[d] = w(d, 15, "observed");
    const cold = trendTrust(trendDay(board, asOf, today, "2026-11-03"), weather);
    expect(cold.level).toBe("낮음");
    expect(cold.why).toContain("추워짐");
    weather["2026-11-03"] = w("2026-11-03", 19, "forecast");
    expect(trendTrust(trendDay(board, asOf, today, "2026-11-03"), weather).level).toBe("보통");
  });
});

describe("주간안 (10-29 발표, 11-02 ~ 08) — 새 방식", () => {
  const week = makeWeek(board, {}, DEFAULT_LEARNED, today, asOf, { "2026-11-02": { 소금빵: 3 }, "2026-11-07": { 소금빵: -2 } });
  it("만드는 단위 · 생산 늘림 없음 · 같은 요일 칸 없음 · 평일 300 ~ 320 · 휴일은 추세 그대로", () => {
    expect(BREAD_BOOST.평일).toBe(1.5); // 10-26 ~ 11-01 계획에만 남음
    for (const w of week) {
      const st = w.week;
      expect(st.boost).toBeUndefined();
      expect(st.rainUp).toBeUndefined();
      for (const it of st.items) expect(it.step).toBeUndefined();
      expect(st.items.find((i) => i.name === "몽블랑")!.qty % 5).toBe(0);
      expect(st.items.find((i) => i.name === "시나몬롤")!.qty % 10).toBe(0);
      const auto = st.items.filter((i) => !i.manual).reduce((a, b) => a + b.qty, 0);
      if (dayKind(w.date) === "평일") {
        expect(st.band).toEqual([300, 320]);
        expect(auto).toBeGreaterThanOrEqual(300);
        expect(auto).toBeLessThanOrEqual(320);
      } else expect(st.band).toBeUndefined();
      if (hol(w.date)) {
        const t = trendDay(board, asOf, today, w.date);
        for (const r of t.items) expect(st.items.find((i) => i.name === r.name)!.qty).toBe(snapUnit(r.name, r.raw, undefined, undefined, w.date));
      }
      expect(st.trust?.level).toBeDefined();
    }
  });

  it("새 빵(판매 28일 안 됨)은 0개 · 매니저 기입 — 평일 범위 맞춤에서 빠짐", () => {
    for (const w of week) expect(w.week.items.find((i) => i.name === "명란소금빵")).toEqual({ name: "명란소금빵", qty: 0, manual: true });
  });

  it("1 ~ 4주 전망도 같은 방식 (생산 늘림 없음)", () => {
    const o = week[0].outlook!;
    expect(o).toHaveLength(4);
    expect(o[0].from).toBe("2026-11-02");
    const t = (d: string) => trendDay(board, asOf, today, d).items.reduce((a, i) => a + i.raw, 0);
    expect(o[0].holiday).toBe(Math.round((t("2026-11-07") + t("2026-11-08")) / 2));
    // 평일 칸 — 월 ~ 목은 300 ~ 320 범위 안으로 (실제 계획과 같게), 금요일은 추세 그대로
    const band = (d: string) => Math.min(320, Math.max(300, t(d)));
    expect(o[0].weekday).toBe(Math.round((band("2026-11-02") + band("2026-11-03") + band("2026-11-04") + band("2026-11-05") + t("2026-11-06")) / 5));
  });
});

describe("최종안(3일 전) — 11-02 부터는 다시 세지 않음 · 날씨 신뢰도만", () => {
  const [mon] = makeWeek(board, {}, DEFAULT_LEARNED, today, asOf);
  const plan: PlanDoc = { v: 2, date: mon.date, week: mon.week };
  const L = (qty: number) => ({ qty, by: "매니저", at: "t" });
  it("매니저 잠정 확정(없으면 주간안) 수량 그대로 — ±10% 범위 · 다시 셈 없음", () => {
    const changed = new Board(make().map((r) => (r.date >= "2026-10-20" ? day(r.date, thisYear(r.date, 1.2)) : r)));
    const f = makeFinal(changed, {}, DEFAULT_LEARNED, "2026-10-30", "2026-10-29", plan, { v: 2, date: mon.date, provisional: { 소금빵: L(150), 명란소금빵: L(12) }, final: {} })!;
    expect(f.items.find((i) => i.name === "소금빵")!.qty).toBe(150);
    expect(f.items.find((i) => i.name === "명란소금빵")).toMatchObject({ qty: 12, manual: true });
    for (const it of f.items) {
      expect(it.lo).toBeUndefined();
      if (it.name !== "소금빵" && it.name !== "명란소금빵") expect(it.qty).toBe(mon.week.items.find((i) => i.name === it.name)!.qty);
    }
    expect(f.total).toBe(f.items.reduce((a, b) => a + b.qty, 0));
  });
  it("그날 예보가 지난 4주 같은 요일보다 크게 추우면 신뢰도 낮음 (매니저가 보고 조정)", () => {
    const wx: WeatherMap = { "2026-11-02": { date: "2026-11-02", key: "sunny", label: "맑음", icon: "", tempMax: 4, tempMin: -3, rainMm: 0, source: "forecast" } };
    for (const d of trendPastDays(board, "2026-11-02", "2026-10-29")) wx[d] = { date: d, key: "sunny", label: "맑음", icon: "", tempMax: 16, tempMin: 8, rainMm: 0, source: "observed" };
    const f = makeFinal(board, wx, DEFAULT_LEARNED, "2026-10-30", "2026-10-29", plan, null)!;
    expect(f.trust?.level).toBe("낮음");
    expect(f.trust?.why).toContain("추워짐");
    expect(f.items.map((i) => i.qty)).toEqual(mon.week.items.map((i) => i.qty).filter((q, i) => q > 0 || mon.week.items[i].manual));
  });
});

describe("11-01 까지(이미 발표한 주)는 예전 그대로", () => {
  it("10-22 발표 주간안 — 10-26 ~ 11-01 은 생산 늘림 · 같은 요일 칸 그대로", () => {
    const old = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-22", "2026-10-21", { "2026-10-26": { 소금빵: 2 } });
    expect(old[0].week.boost).toBe(1.5);
    expect(old[0].week.items.find((i) => i.name === "소금빵")!.step).toBe(2);
    expect(old.every((w) => !w.week.items.some((i) => i.manual))).toBe(true);
  });
});
