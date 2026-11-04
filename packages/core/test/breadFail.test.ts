import { describe, expect, it } from "vitest";
import {
  asFailInbox,
  asOrder,
  Board,
  breadTotals,
  dayChanged,
  dayResult,
  FAIL_BY_FLOOR,
  FAIL_INBOX_KIND,
  failInboxPut,
  failOpen,
  failQty,
  failSyncLines,
  floorCopy,
  HOURS,
  KITCHEN_BREAD,
  producedOf,
  stepOf,
  withInbox,
  type DayReport,
  type OrderDoc,
  type PlanDoc,
  type StorePart,
} from "../src";

/* 2026-11-04 사장님 — 생산 실패 (생산실패)
   생산 계획 발표 → 매니저 확정 → 그날 생산자가 생산. 생산 중 상품성이 떨어지게 구워져 판매 전에 버리는 수량이 있음
   생산한 날 매니저가 실패 수량을 적음 (11-01 에 만든 '생산한 날 수량 바꾸기'를 바꿈) → 판매를 시작한 수량 = 생산 − 실패
   보고 앱: 생산 · 생산실패 · 정가판매 · 할인판매 · 남음(폐기) / 현장 명령서: 오늘 생산 · 생산실패 · 내일 · 3일 뒤 */
const H = () => HOURS.map(() => 0);
function day(date: string, bread: [string, number][], platters = 0): DayReport {
  const cafe: StorePart = {
    v: 1, store: "cafe", date, basis: "receipt", file: "t.xls", sheetNet: 0, posNet: 0, voucher: 0,
    sectors: { 바리스타: 0, 베이커리: 0, 키친: 0, 기타: 0 }, cups: 100, teams: 0, teamSizes: [0, 0, 0, 0, 0, 0],
    hourly: { sectors: { 바리스타: H(), 베이커리: H(), 키친: H(), 기타: H() }, cups: H(), teams: H() },
    products: [...bread.map(([n, q]) => [n, "베이커리", q, q * 4000] as [string, string, number, number]), ...(platters ? [["시그니처 플래터", "키친", platters, platters * 29000] as [string, string, number, number]] : [])],
    refunds: { receipts: 0, lines: 0, unmatched: 0, amount: 0 }, kids: null,
  } as StorePart;
  return { date, cafe };
}
const st = { madeOn: "2026-11-04", asOf: "2026-11-03", kind: "휴일" as const, visitors: 0, weather: "", total: 60 };
const planOf = (date: string, items: [string, number][]): PlanDoc => ({ v: 2, date, final: { ...st, items: items.map(([name, qty]) => ({ name, qty, base: qty })) } });
const L = (qty: number) => ({ qty, by: "매니저", at: "2026-11-04T05:00:00Z" });
const orderOf = (date: string, fail: Record<string, number>): OrderDoc => ({ v: 2, date, provisional: {}, final: {}, fail: Object.fromEntries(Object.entries(fail).map(([n, q]) => [n, L(q)])) });

describe("생산 실패 — 문서 · 현장 복사본", () => {
  it("확정 문서에 실패 줄을 그대로 둠 (없으면 칸도 없음) · 현장 복사본에는 수량 · 시각만", () => {
    const o = asOrder(orderOf("2026-11-04", { 소금빵: 3 }))!;
    expect(o.fail).toEqual({ 소금빵: L(3) });
    expect("fail" in asOrder({ v: 2, date: "2026-11-04", provisional: {}, final: {} })!).toBe(false);
    expect(floorCopy(null, o).order!.fail).toEqual({ 소금빵: { qty: 3, by: "", at: L(3).at } });
  });
  it("빵마다 실패 수 — 0 은 빼고, 새 이름으로 묶을 수 있음", () => {
    const o = orderOf("2026-11-01", { 인절미팥빵: 2, 소금빵: 0 });
    expect([...failQty(o)]).toEqual([["인절미팥빵", 2]]);
    expect([...failQty(o, true)]).toEqual([["저당팥빵", 2]]);
    expect(failQty(null).size).toBe(0);
  });
});

describe("생산 실패 — 판매를 시작한 수량 = 생산 − 실패", () => {
  const plan = planOf("2026-11-04", [["소금빵", 20], ["몽블랑", 10]]);
  it("소금빵 생산 20 · 실패 3 · 판매 15 → 생산실패 3 · 남음 2 · 생산 20 (= 판매 + 생산실패 + 남음)", () => {
    const r = dayResult(new Board([day("2026-11-04", [["소금빵", 15], ["몽블랑", 10]])]), "2026-11-04", plan, orderOf("2026-11-04", { 소금빵: 3 }));
    const s = r.find((x) => x.name === "소금빵")!;
    expect([s.made, s.fail, s.sold, s.waste, s.soldOut, producedOf(s)]).toEqual([20, 3, 15, 2, false, 20]);
    // 실패를 안 적은 빵은 0
    expect(r.find((x) => x.name === "몽블랑")!.fail).toBe(0);
  });
  it("판매 시작 17개가 다 팔리면 매진 · 남음 0 (실패가 남은 빵으로 잡히지 않음)", () => {
    const r = dayResult(new Board([day("2026-11-04", [["소금빵", 17]])]), "2026-11-04", plan, orderOf("2026-11-04", { 소금빵: 3 }));
    const s = r.find((x) => x.name === "소금빵")!;
    expect([s.waste, s.soldOut, producedOf(s)]).toEqual([0, true, 20]);
    // 같은 요일 칸: 실패를 빼면 다 팔림 → −1 이 아님 (실패를 안 적었으면 3개 남은 것으로 −1)
    expect(stepOf(s, "2026-11-04")).toBe(1);
    const noFail = dayResult(new Board([day("2026-11-04", [["소금빵", 17]])]), "2026-11-04", plan, null).find((x) => x.name === "소금빵")!;
    expect([noFail.waste, stepOf(noFail, "2026-11-04")]).toEqual([3, -1]);
    expect("fail" in noFail).toBe(false);
  });
  it("생산보다 많이 적힌 실패는 생산까지만 · 합계 총 생산 = 정가 + 할인 + 생산실패 + 폐기", () => {
    const r = dayResult(new Board([day("2026-11-04", [["소금빵", 5], ["몽블랑", 4]])]), "2026-11-04", plan, orderOf("2026-11-04", { 몽블랑: 99, 소금빵: 2 }));
    const m = r.find((x) => x.name === "몽블랑")!;
    // 몽블랑 생산 10 을 모두 실패로 적었는데 4개가 팔림 → 남음 0, 생산 = 판매 4 + 실패 10 = 14 (판매가 더 있으면 현장에서 더 만든 것 — 2026-10-13 원칙 그대로)
    expect([m.fail, m.waste, producedOf(m)]).toEqual([10, 0, 14]);
    // 소금빵 20 − 실패 2 − 판매 5 = 남음 13
    expect(breadTotals(r)).toEqual({ made: 34, full: 9, half: 0, waste: 13, platter: 0, fail: 12 });
  });
  it("키친용 모닝빵이 실패하면 플래터에 쓸 우유모닝빵이 그만큼 늘어남 (휴일 키친용 5 − 실패 1 = 플래터 12개분)", () => {
    const p = planOf("2026-11-07", [["우유모닝빵", 24]]);
    const b = new Board([day("2026-11-07", [["우유모닝빵", 20]], 15)]);
    // 실패 없음: 플래터 15 = 키친용 5 × 3 → 우유모닝빵 그대로 (남음 4)
    expect(dayResult(b, "2026-11-07", p, null).find((x) => x.name === "우유모닝빵")!.platter).toBe(0);
    // 키친용 1개 실패: 12개분 → 3개 모자람 → 우유모닝빵 1개
    const m = dayResult(b, "2026-11-07", p, orderOf("2026-11-07", { [KITCHEN_BREAD]: 1 })).find((x) => x.name === "우유모닝빵")!;
    expect([m.platter, m.waste, producedOf(m)]).toEqual([1, 3, 24]);
  });
});

/* 2026-11-04 사장님 — 생산한 작업자가 현장 명령서에서 바로 적음 (매니저 앱 기입도 그대로, 늦게 적은 쪽이 이김) */
describe("현장 생산실패 기입함 — 현장 명령서에서 적고 수집이 작업지시 확정으로 옮김", () => {
  const at1 = "2026-11-04T01:00:00Z"; // 10:00
  const at2 = "2026-11-04T03:00:00Z"; // 12:00
  it("기입함 글 검사 — 모양이 다르면 버림 · 이상한 줄(음수 · 소수 · 1000 이상 · 시각 없음 · 잼)은 뺌", () => {
    const ok = asFailInbox({ kind: FAIL_INBOX_KIND, v: 1, date: "2026-11-04", lines: { 소금빵: { qty: 3, at: at1 }, 몽블랑: { qty: -1, at: at1 }, 시나몬롤: { qty: 1.5, at: at1 }, 에그타르트: { qty: 1000, at: at1 }, 초코바게트: { qty: 2 }, 딸기잼: { qty: 1, at: at1 } } }, "2026-11-04");
    expect(ok?.lines).toEqual({ 소금빵: { qty: 3, at: at1 } });
    expect(asFailInbox({ kind: FAIL_INBOX_KIND, v: 1, date: "2026-11-03", lines: {} }, "2026-11-04")).toBeNull();
    expect(asFailInbox({ kind: "x", v: 1, date: "2026-11-04", lines: {} }, "2026-11-04")).toBeNull();
    expect(asFailInbox(null, "2026-11-04")).toBeNull();
  });
  it("빵 하나 적기 — 있던 줄에 더해 씀 · 다른 날 기입함은 버리고 새로", () => {
    const a = failInboxPut(null, "2026-11-04", "소금빵", 3, at1);
    const b = failInboxPut(a, "2026-11-04", "몽블랑", 2, at2);
    expect(b.lines).toEqual({ 소금빵: { qty: 3, at: at1 }, 몽블랑: { qty: 2, at: at2 } });
    expect(failInboxPut(b, "2026-11-05", "소금빵", 1, at2).lines).toEqual({ 소금빵: { qty: 1, at: at2 } });
  });
  it("옮길 줄 — 확정 쪽에 없거나 현장이 더 늦게 적은 줄만 · 매니저가 더 늦게 고쳤으면 매니저 것", () => {
    const inbox = failInboxPut(failInboxPut(null, "2026-11-04", "소금빵", 3, at2), "2026-11-04", "몽블랑", 2, at1);
    const order: OrderDoc = { v: 2, date: "2026-11-04", provisional: {}, final: {}, fail: { 몽블랑: { qty: 4, by: "매니저", at: at2 } } };
    expect(failSyncLines(order, inbox)).toEqual({ 소금빵: { qty: 3, by: FAIL_BY_FLOOR, at: at2 } });
    // 한 번 옮기면 더 옮길 것 없음
    const merged = withInbox(order, inbox, "2026-11-04")!;
    expect(merged.fail).toEqual({ 몽블랑: { qty: 4, by: "매니저", at: at2 }, 소금빵: { qty: 3, by: FAIL_BY_FLOOR, at: at2 } });
    expect(failSyncLines(merged, inbox)).toBeNull();
    expect(withInbox(merged, inbox, "2026-11-04")).toBe(merged);
    // 확정 문서가 아직 없는 날도
    expect(withInbox(null, inbox, "2026-11-04")!.fail!.몽블랑.qty).toBe(2);
    expect(withInbox(order, null, "2026-11-04")).toBe(order);
  });
  it("현장에서 적은 실패도 보고 숫자에 — 판매 시작 = 생산 − 실패", () => {
    const plan = planOf("2026-11-04", [["소금빵", 20]]);
    const order = withInbox(null, failInboxPut(null, "2026-11-04", "소금빵", 3, at1), "2026-11-04");
    const s = dayResult(new Board([day("2026-11-04", [["소금빵", 15]])]), "2026-11-04", plan, order).find((x) => x.name === "소금빵")!;
    expect([s.fail, s.waste, producedOf(s)]).toEqual([3, 2, 20]);
  });
  it("적을 수 있는 때 — 그날 아침 6시 뒤 ~ 다음 날 (그 전 · 이틀 뒤는 못 적음)", () => {
    expect(failOpen("2026-11-04", { date: "2026-11-04", time: "05:59" })).toBe(false);
    expect(failOpen("2026-11-04", { date: "2026-11-04", time: "06:00" })).toBe(true);
    expect(failOpen("2026-11-04", { date: "2026-11-05", time: "23:59" })).toBe(true);
    expect(failOpen("2026-11-04", { date: "2026-11-06", time: "00:00" })).toBe(false);
  });
});

describe("'변경' 표시 — 생산날 아침 6시 뒤 수량이 최종안과 달라진 빵만", () => {
  it("같은 수량 그대로 일괄 확정한 줄에는 안 붙음 · 생산 전에 고친 줄도 아님", () => {
    const plan = planOf("2026-11-04", [["시나몬롤", 20], ["우유모닝빵", 6], ["소금빵", 30]]);
    const late = "2026-11-04T04:58:00Z"; // 13:58
    const order: OrderDoc = { v: 2, date: "2026-11-04", provisional: {}, final: { 시나몬롤: { qty: 10, by: "매니저", at: late }, 우유모닝빵: { qty: 6, by: "매니저", at: late }, 소금빵: { qty: 28, by: "매니저", at: "2026-11-03T08:00:00Z" } } };
    expect([...dayChanged(plan, order, "2026-11-04")]).toEqual([["시나몬롤", "13:58"]]);
  });
});
