import { describe, expect, it } from "vitest";
import {
  Board,
  breadOrderAt,
  breadTotals,
  dayResult,
  HOURS,
  isKitchenBread,
  KITCHEN_BREAD,
  KITCHEN_FROM,
  kitchenQty,
  orderRows,
  orderText,
  platterSold,
  producedOf,
  sortBread,
  withKitchen,
  type DayReport,
  type OrderDoc,
  type PlanDoc,
  type StorePart,
} from "../src";

/* 2026-11-04 사장님 — 키친용 모닝빵 (판매용 아님)
   시그니처 플래터(키친)에 모닝빵 2피스가 같이 나감 · 우유모닝빵 1개 = 6피스 → 1개로 플래터 3개
   평일 2개(플래터 6개) · 휴일 5개(플래터 15개) — 매니저 생산 결정 · 작업지시 맨 위
   플래터가 더 팔리면 판매 중인 우유모닝빵을 3등분해 씀 → 우유모닝빵 폐기 = 생산 − 판매 − 플래터에 쓴 것
   키친용 모닝빵은 판매용이 아니라 보고 자료의 생산 · 판매 · 폐기에 넣지 않음 */
const H = () => HOURS.map(() => 0);
function day(date: string, bread: [string, number][], platters: number): DayReport {
  const cafe: StorePart = {
    v: 1, store: "cafe", date, basis: "receipt", file: "t.xls", sheetNet: 0, posNet: 0, voucher: 0,
    sectors: { 바리스타: 0, 베이커리: 0, 키친: 0, 기타: 0 }, cups: 100, teams: 0, teamSizes: [0, 0, 0, 0, 0, 0],
    hourly: { sectors: { 바리스타: H(), 베이커리: H(), 키친: H(), 기타: H() }, cups: H(), teams: H() },
    products: [...bread.map(([n, q]) => [n, "베이커리", q, q * 4000] as [string, string, number, number]), ["시그니처 플래터", "키친", platters, platters * 29000]],
    refunds: { receipts: 0, lines: 0, unmatched: 0, amount: 0 }, kids: null,
  } as StorePart;
  return { date, cafe };
}
const st = { madeOn: "2026-11-04", asOf: "2026-11-03", kind: "휴일" as const, visitors: 0, weather: "", total: 60 };
const planOf = (date: string, items: [string, number][]): PlanDoc => ({ v: 2, date, final: { ...st, items: items.map(([name, qty]) => ({ name, qty, base: qty })) } });
const L = (qty: number) => ({ qty, by: "매니저", at: "2026-11-04T06:00:00Z" });

describe("키친용 모닝빵 — 평일 2 · 휴일 5 · 맨 위 · 판매용 아님", () => {
  it("수량 — 11-05 부터, 평일(금요일 포함) 2 · 휴일(토 · 일 · 공휴일) 5 · 그 전 날은 없음", () => {
    expect(KITCHEN_BREAD).toBe("키친용 모닝빵");
    expect(KITCHEN_FROM).toBe("2026-11-05");
    expect(["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"].map(kitchenQty)).toEqual([null, 2, 2, 5, 5]);
    expect(isKitchenBread("키친용 모닝빵")).toBe(true);
    expect(isKitchenBread("우유모닝빵")).toBe(false);
  });
  it("순서 — 우유모닝빵보다 위, 가장 처음", () => {
    expect(breadOrderAt(KITCHEN_BREAD)).toBeLessThan(breadOrderAt("우유모닝빵"));
    expect(sortBread([{ name: "우유모닝빵" }, { name: "소금빵" }, { name: KITCHEN_BREAD }]).map((x) => x.name)).toEqual([KITCHEN_BREAD, "우유모닝빵", "소금빵"]);
  });
  it("매니저 결정 화면 — 계획 줄에 붙임 (이미 있으면 그대로) · 11-05 전 날은 안 붙임", () => {
    const items = [{ name: "우유모닝빵", qty: 24 }];
    expect(withKitchen(items, "2026-11-07")).toEqual([{ name: "우유모닝빵", qty: 24 }, { name: KITCHEN_BREAD, qty: 5, base: 5, kitchen: true }]);
    expect(withKitchen(items, "2026-11-04")).toBe(items);
    const had = [...items, { name: KITCHEN_BREAD, qty: 3 }];
    expect(withKitchen(had, "2026-11-07")).toBe(had);
  });
  it("작업지시(현장 표 · 명령서) — 계획이 있는 날에 자동 수량 · 매니저가 고친 수량 · 명령서 합계에는 안 넣음", () => {
    const plan = planOf("2026-11-07", [["우유모닝빵", 24], ["소금빵", 80]]);
    const later = { date: "2026-11-07", time: "07:00" };
    const k = orderRows(plan, null, later).find((r) => r.name === KITCHEN_BREAD)!;
    expect([k.qty, k.state]).toEqual([5, "자동"]);
    const o: OrderDoc = { v: 2, date: "2026-11-07", provisional: {}, final: { [KITCHEN_BREAD]: L(4) } };
    expect(orderRows(plan, o, later).find((r) => r.name === KITCHEN_BREAD)!.qty).toBe(4);
    expect(orderRows(planOf("2026-11-04", [["우유모닝빵", 8]]), null, later).some((r) => r.name === KITCHEN_BREAD)).toBe(false);
    expect(orderRows(null, null, later)).toEqual([]);
    const text = orderText("2026-11-07", sortBread(orderRows(plan, null, later)), "오늘 생산");
    expect(text.split("\n")[0]).toBe("[11월 7일 오늘 생산] 총 104개"); // 키친용 5개는 합계에 안 넣음
    expect(text.split("\n")[1]).toBe("· 키친용 모닝빵 5개 (판매용 아님 · 시그니처 플래터용) (자동)");
  });
  it("목요일 잠정 확정 때 키친용을 고쳤으면 최종안 · 자동 수량도 그 수량 (다른 빵처럼 이어 감) · 최종안 계산 줄에는 안 들어감", () => {
    const plan: PlanDoc = { ...planOf("2026-11-14", [["우유모닝빵", 30]]), week: { ...st, items: [{ name: "우유모닝빵", qty: 30, base: 30 }] } };
    const o: OrderDoc = { v: 2, date: "2026-11-14", provisional: { [KITCHEN_BREAD]: L(3) }, final: {} };
    const before = orderRows(plan, o, { date: "2026-11-11", time: "16:00" }).find((r) => r.name === KITCHEN_BREAD)!;
    expect([before.week, before.provisional, before.suggested]).toEqual([5, 3, 3]);
    const after = orderRows(plan, o, { date: "2026-11-14", time: "07:00" }).find((r) => r.name === KITCHEN_BREAD)!;
    expect([after.qty, after.state]).toEqual([3, "자동"]);
    expect(withKitchen([{ name: "우유모닝빵", qty: 30 }], "2026-11-14", 3)[1]).toEqual({ name: KITCHEN_BREAD, qty: 3, base: 5, kitchen: true });
    expect(withKitchen([{ name: "우유모닝빵", qty: 30 }], "2026-11-14", null)[1].qty).toBe(5);
  });
});

describe("시그니처 플래터 — 우유모닝빵 폐기에서 플래터에 쓴 것을 뺌 · 키친용은 보고 숫자에 없음", () => {
  const plan = planOf("2026-11-07", [["우유모닝빵", 25], ["소금빵", 80]]);
  it("플래터 판매 수 (POS '시그니처 플래터', 키친)", () => {
    expect(platterSold(new Board([day("2026-11-07", [], 19)]), "2026-11-07")).toBe(19);
  });
  it("휴일 키친용 5개 = 플래터 15개분 — 19개 팔리면 4개 모자람 → 우유모닝빵 2개(3등분)를 씀: 폐기 4 → 2 · 플래터용 2", () => {
    const b = new Board([day("2026-11-07", [["우유모닝빵", 21], ["소금빵", 80]], 19)]);
    const rows = dayResult(b, "2026-11-07", plan, null);
    expect(rows.some((r) => r.name === KITCHEN_BREAD)).toBe(false);
    const m = rows.find((r) => r.name === "우유모닝빵")!;
    expect([m.sold, m.platter, m.waste, producedOf(m)]).toEqual([21, 2, 2, 25]);
    const t = breadTotals(rows);
    expect(t).toMatchObject({ made: 105, full: 101, half: 0, waste: 2, platter: 2 });
    expect(t.made).toBe(t.full + t.half + t.waste! + t.platter);
  });
  it("플래터가 키친용으로 다 덮이면 그대로 · 쓸 것이 폐기보다 많으면 폐기만큼 · 키친용을 매니저가 고쳤으면 그 수량으로", () => {
    const ok = dayResult(new Board([day("2026-11-07", [["우유모닝빵", 21]], 12)]), "2026-11-07", plan, null).find((r) => r.name === "우유모닝빵")!;
    expect([ok.platter, ok.waste]).toEqual([0, 4]);
    const many = dayResult(new Board([day("2026-11-07", [["우유모닝빵", 24]], 30)]), "2026-11-07", plan, null).find((r) => r.name === "우유모닝빵")!;
    expect([many.platter, many.waste]).toEqual([1, 0]); // 15개 모자람 → 5개가 필요하지만 남은 것이 1개
    const o: OrderDoc = { v: 2, date: "2026-11-07", provisional: {}, final: { [KITCHEN_BREAD]: L(3) } };
    const edited = dayResult(new Board([day("2026-11-07", [["우유모닝빵", 21]], 12)]), "2026-11-07", plan, o).find((r) => r.name === "우유모닝빵")!;
    expect([edited.platter, edited.waste]).toEqual([1, 3]); // 키친용 3개 = 플래터 9개 → 3개 모자람 → 1개
  });
  it("11-04 까지는 예전 그대로 (키친용 모닝빵을 따로 만들기 전 — 플래터용을 빼지 않음)", () => {
    const old = dayResult(new Board([day("2026-11-01", [["우유모닝빵", 21]], 19)]), "2026-11-01", planOf("2026-11-01", [["우유모닝빵", 25]]), null).find((r) => r.name === "우유모닝빵")!;
    expect([old.platter ?? 0, old.waste]).toEqual([0, 4]);
  });
});
