import { describe, expect, it } from "vitest";
import {
  Board,
  breadVerdictOf,
  compareDay,
  dayRange,
  DEFAULT_LEARNED,
  HOURS,
  makeWeek,
  shareAt,
  snapUnit,
  trendQtyOf,
  verdictOf,
  type DayCompare,
  type DayReport,
  type OrderDoc,
  type PlanDoc,
  type StorePart,
} from "../src";

/* 2026-11-05 사장님 — 두 가지 생산계획(가 추세 · 나 조정)을 다음 주 판매 실적과 견줌
   조정이 틀렸으면 다음 주는 추세 수량으로 되돌리고, 맞았으면 조정을 이어 감 (평일 · 휴일 따로, 빵별 조정은 빵마다) */
const flat = (v: number) => HOURS.map(() => v);
function day(date: string, bread: [string, number][], opt: { last?: Record<string, string>; half?: Record<string, number> } = {}): DayReport {
  const cafe: StorePart = {
    v: 1, store: "cafe", date, basis: "receipt", file: "t.xls", sheetNet: 0, posNet: 0, voucher: 0,
    sectors: { 바리스타: 0, 베이커리: 0, 키친: 0, 기타: 0 }, cups: 100, teams: 0, teamSizes: [0, 0, 0, 0, 0, 0],
    // 빵 판매가 시간대마다 같다고 (12칸 고르게 — 15:00 까지 5/12)
    hourly: { sectors: { 바리스타: flat(0), 베이커리: flat(100), 키친: flat(0), 기타: flat(0) }, cups: flat(0), teams: flat(0) },
    products: bread.map(([n, q]) => [n, "베이커리", q, q * 4000]), refunds: { receipts: 0, lines: 0, unmatched: 0, amount: 0 }, kids: null,
    bakeryLastBy: opt.last || {}, bakeryHalfBy: opt.half || {},
  } as StorePart;
  return { date, cafe };
}
const st = { madeOn: "2026-11-05", asOf: "2026-11-04", kind: "평일" as const, visitors: 0, weather: "", total: 0, target: 270, trendTotal: 250 };
const planOf = (date: string, items: { name: string; qty: number; trend?: number; base?: number; est?: boolean; manual?: boolean }[]): PlanDoc => ({ v: 2, date, week: { ...st, items } });
const noOrder = (date: string): OrderDoc => ({ v: 2, date, provisional: {}, final: {} });

describe("시간대 판매 비율", () => {
  it("12칸 고르게 팔리면 15:00 까지 5/12 · 15:30 은 5.5/12", () => {
    const cum = HOURS.map((_, i) => (i + 1) / 12);
    expect(shareAt(cum, "15:00")).toBeCloseTo(5 / 12);
    expect(shareAt(cum, "15:30")).toBeCloseTo(5.5 / 12);
    expect(shareAt(cum, "09:30")).toBe(0);
  });
});

describe("두 계획 견주기 — 빵마다 |계획 − 생산실패 − 수요|", () => {
  // 지난 같은 요일 4번 (시간대 비율용)
  const past = dayRange("2026-10-12", "2026-11-02").filter((d) => new Date(d).getUTCDay() === 1).map((d) => day(d, [["소금빵", 20]]));
  const mon = "2026-11-09";
  it("다 안 팔림 → 수요 = 판매 · 남음 = 계획 − 수요 / 15:00 에 다 팔림 → 수요 = 판매 ÷ 5/12 (2.5배까지)", () => {
    const b = new Board([...past, day(mon, [["소금빵", 20], ["몽블랑", 10]], { last: { 소금빵: "18:00", 몽블랑: "15:00" } })]);
    // 가 추세: 소금빵 22 · 몽블랑 10 / 나 조정: 소금빵 26 · 몽블랑 14 — 실제는 조정대로 만듦
    const plan = planOf(mon, [{ name: "소금빵", qty: 26, trend: 22 }, { name: "몽블랑", qty: 14, trend: 10 }]);
    plan.final = { ...st, items: [{ name: "소금빵", qty: 26 }, { name: "몽블랑", qty: 10 }] };
    const c = compareDay(b, mon, plan, noOrder(mon), "2026-11-08")!;
    const salt = c.rows.find((r) => r.name === "소금빵")!;
    expect([salt.demand, salt.overTrend, salt.overTuned, salt.shortTrend]).toEqual([20, 2, 6, 0]);
    // 몽블랑 실제 10개 만들어 15:00 에 다 팔림 → 수요 10 ÷ (5/12) = 24 → 25 (2.5배) 중 작은 쪽 24
    const mont = c.rows.find((r) => r.name === "몽블랑")!;
    expect([mont.soldOutAt, mont.demand, mont.shortTrend, mont.shortTuned]).toEqual(["15:00", 24, 14, 10]);
    expect([c.errTrend, c.errTuned]).toEqual([2 + 14, 6 + 10]);
  });
  it("생산실패는 두 계획에서 똑같이 뺌 (판매를 시작한 수량)", () => {
    const b = new Board([...past, day(mon, [["소금빵", 18]], { last: { 소금빵: "19:00" } })]);
    const plan = planOf(mon, [{ name: "소금빵", qty: 22, trend: 20 }]);
    const order: OrderDoc = { ...noOrder(mon), fail: { 소금빵: { qty: 2, by: "현장", at: "t" } } };
    const r = compareDay(b, mon, plan, order, "2026-11-08")!.rows[0];
    // 실제 22 − 실패 2 = 20 내놓아 18 팔림 → 수요 18 · 가 20−2−18 = 0 · 나 22−2−18 = 2
    expect([r.fail, r.demand, r.overTrend, r.overTuned]).toEqual([2, 18, 0, 2]);
  });
  it("주간안에 하루 목표가 없는 날(11-08 까지)은 견주지 않음 · 저장된 추세 수량이 없으면 추세 수치를 만드는 단위로", () => {
    const b = new Board([day("2026-11-02", [["소금빵", 10]])]);
    expect(compareDay(b, "2026-11-02", { v: 2, date: "2026-11-02", week: { ...st, target: undefined, items: [{ name: "소금빵", qty: 10 }] } }, null)).toBeNull();
    expect(trendQtyOf({ name: "몽블랑", qty: 20, base: 17 }, mon)).toBe(snapUnit("몽블랑", 17));
    expect(trendQtyOf({ name: "명란소금빵", qty: 6, base: 6, est: true }, mon)).toBe(6);
    expect(trendQtyOf({ name: "클래식롤케이크", qty: 0, manual: true }, mon)).toBe(0);
  });
});

describe("판정 — 어긋남 합이 작은 쪽 · 3% 안이면 조정 유지", () => {
  const d = (errTrend: number, errTuned: number, rows: DayCompare["rows"] = []): DayCompare => ({ date: "2026-11-09", kind: "평일", rows, trend: 0, tuned: 0, sold: 0, demand: 0, errTrend, errTuned });
  it("추세가 더 맞으면 추세 · 조정이 더 맞거나 비슷하면 조정", () => {
    expect(verdictOf([d(40, 60)])?.mode).toBe("추세");
    expect(verdictOf([d(60, 40)])?.mode).toBe("조정");
    expect(verdictOf([d(99, 100)])).toMatchObject({ mode: "조정", tie: true });
    expect(verdictOf([])).toBeNull();
  });
  it("빵별 조정 빵은 빵마다 따로", () => {
    const row = (name: string, t: number, u: number) => ({ name, trend: 0, tuned: 0, made: 0, fail: 0, sold: 0, half: 0, soldOutAt: null, demand: 0, overTrend: t, shortTrend: 0, overTuned: u, shortTuned: 0 });
    const days = [d(10, 10, [row("소금빵", 2, 6), row("흑미로만든수수부꾸미", 3, 1)])];
    expect(breadVerdictOf(days, "소금빵")?.mode).toBe("추세");
    expect(breadVerdictOf(days, "흑미로만든수수부꾸미")?.mode).toBe("조정");
    expect(breadVerdictOf(days, "에그타르트")).toBeNull();
  });
});
