import { describe, expect, it } from "vitest";
import { addDays, Board, dayKind, dayRange, DEFAULT_LEARNED, HOURS, makePlans, nowKst, orderRows, orderText, type DayReport, type OrderDoc, type PlanDoc, type StorePart } from "../src";

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
    return day(d, cups, [["소금빵", Math.round(cups * 0.3)], ["크루아상", Math.round(cups * 0.1)]]);
  });

describe("16시 계획 세 장", () => {
  const board = new Board([...make("2025-08-01", "2025-11-30", () => 1), ...make("2026-08-01", "2026-10-03", () => 1)]);
  const plans = makePlans(board, {}, DEFAULT_LEARNED, "2026-10-04", "2026-10-03", () => undefined);
  it("내일 확정안 · 모레 ±5% · 글피 ±10%, 내일 계획에만 1~4주 전망", () => {
    expect(plans.map((p) => [p.date, p.stage])).toEqual([["2026-10-05", 1], ["2026-10-06", 2], ["2026-10-07", 3]]);
    expect(plans[0].items[0].lo).toBeUndefined();
    const g = plans[2].items[0];
    expect(g.lo).toBe(Math.floor(g.qty * 0.9));
    expect(g.hi).toBe(Math.ceil(g.qty * 1.1));
    expect(plans[0].outlook).toHaveLength(4);
    expect(plans[1].outlook).toBeUndefined();
  });
  it("어제 알려 준 범위 밖으로 안 나감 — 어제 글피였던 날은 ±10%, 어제 모레였던 날은 ±5%", () => {
    // 어제(10-04) 알려 준 값: 10-06 은 글피(±10%) 로 100개, 10-05 는 모레(±5%) 로 100개 였다고 함
    const prev = (date: string): PlanDoc | undefined => {
      if (date !== "2026-10-06" && date !== "2026-10-07") return undefined;
      return { v: 1, date, madeOn: "2026-10-04", stage: 3, kind: "평일", visitors: 0, weather: "모름", items: [], total: 0, history: { "2026-10-04": { 소금빵: 100 } } };
    };
    const next = makePlans(board, {}, DEFAULT_LEARNED, "2026-10-05", "2026-10-04", prev);
    const salt = (p: PlanDoc) => p.items.find((i) => i.name === "소금빵")!.qty;
    expect(salt(next[0])).toBeLessThanOrEqual(110); // 10-06 이 모레 → 어제 글피 범위 ±10%
    expect(salt(next[0])).toBeGreaterThanOrEqual(90);
    expect(next[0].date).toBe("2026-10-06");
    expect(Object.keys(next[0].history)).toEqual(["2026-10-04", "2026-10-05"]);
  });
});

describe("만들 목록 — 확정 · 자동 · 확정 전", () => {
  const plan = { v: 1, date: "2026-10-05", items: [{ name: "소금빵", qty: 60 }, { name: "크루아상", qty: 20 }] } as PlanDoc;
  const order: OrderDoc = { v: 1, date: "2026-10-05", items: { 소금빵: { qty: 55, by: "매니저", at: "" } } };
  it("전날 18시 전 — 확정 안 한 빵은 '확정 전'", () => {
    const rows = orderRows(plan, order, { date: "2026-10-04", time: "17:30" });
    expect(rows).toEqual([
      { name: "소금빵", plan: 60, confirmed: 55, qty: 55, state: "확정" },
      { name: "크루아상", plan: 20, confirmed: null, qty: null, state: "확정 전" },
    ]);
  });
  it("전날 18시가 지나면 계획 수량 그대로 '자동'", () => {
    const rows = orderRows(plan, order, { date: "2026-10-04", time: "18:00" });
    expect(rows[1]).toMatchObject({ qty: 20, state: "자동" });
    expect(orderText("2026-10-05", rows)).toBe("[10월 5일 생산 명령서] 총 75개\n· 소금빵 55개\n· 크루아상 20개 (자동)");
  });
  it("계획 · 확정이 둘 다 없으면 빈 목록", () => {
    expect(orderRows(null, null, { date: "2026-10-04", time: "10:00" })).toEqual([]);
  });
  it("한국 시간", () => {
    expect(nowKst(new Date("2026-10-04T09:30:00Z"))).toEqual({ date: "2026-10-04", time: "18:30" });
    expect(addDays("2026-10-04", 1)).toBe("2026-10-05");
  });
});
