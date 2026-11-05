import { describe, expect, it } from "vitest";
import { asOrder, asPlan, Board, DISCONTINUED, HOURS, isDiscontinued, orderRows, trendDay, type DayReport, type OrderDoc, type PlanDoc, type StorePart } from "../src";

/* 2026-11-05 매니저 요청 (사장님 전달) — 단종: 초코바게트 11-05(목)까지 · 감계무량샌드위치 11-08(일)까지
   그 뒤 날짜의 계획 · 확정 · 추세 · 현장 표 · 매니저 앱에서 뺌 (이미 만든 계획 · 확정에 있어도 읽을 때 뺌) */
const H = () => HOURS.map(() => 0);
function day(date: string, bread: [string, number][]): DayReport {
  const cafe: StorePart = {
    v: 1, store: "cafe", date, basis: "receipt", file: "t.xls", sheetNet: 0, posNet: 0, voucher: 0,
    sectors: { 바리스타: 0, 베이커리: 0, 키친: 0, 기타: 0 }, cups: 100, teams: 0, teamSizes: [0, 0, 0, 0, 0, 0],
    hourly: { sectors: { 바리스타: H(), 베이커리: H(), 키친: H(), 기타: H() }, cups: H(), teams: H() },
    products: bread.map(([n, q]) => [n, "베이커리", q, q * 4000]), refunds: { receipts: 0, lines: 0, unmatched: 0, amount: 0 }, kids: null,
  } as StorePart;
  return { date, cafe };
}
const st = { madeOn: "2026-11-02", asOf: "2026-11-01", kind: "평일" as const, visitors: 0, weather: "", total: 0 };
const planOf = (date: string): PlanDoc => ({ v: 2, date, final: { ...st, total: 27, items: [{ name: "초코바게트", qty: 7 }, { name: "감계무량샌드위치", qty: 4 }, { name: "소금빵", qty: 16 }] } });
const L = (qty: number) => ({ qty, by: "매니저", at: "t" });

describe("단종 빵 — 마지막으로 만드는 날까지만", () => {
  it("초코바게트 11-05 · 감계무량샌드위치 11-08 까지 (띄어쓰기 상관없음)", () => {
    expect(DISCONTINUED).toEqual({ 초코바게트: "2026-11-05", 감계무량샌드위치: "2026-11-08" });
    expect(["2026-11-05", "2026-11-06"].map((d) => isDiscontinued("초코바게트", d))).toEqual([false, true]);
    expect(["2026-11-08", "2026-11-09"].map((d) => isDiscontinued("감계무량 샌드위치", d))).toEqual([false, true]);
    expect(isDiscontinued("소금빵", "2026-12-01")).toBe(false);
  });
  it("이미 만든 계획 · 확정에 있어도 그 뒤 날짜에서는 읽을 때 뺌 (합계도 다시) — 마지막 날까지는 그대로", () => {
    expect(asPlan(planOf("2026-11-05"))!.final!.items.map((i) => i.name)).toEqual(["초코바게트", "감계무량샌드위치", "소금빵"]);
    const fri = asPlan(planOf("2026-11-06"))!;
    expect(fri.final!.items.map((i) => i.name)).toEqual(["감계무량샌드위치", "소금빵"]);
    expect(fri.final!.total).toBe(20);
    expect(asPlan(planOf("2026-11-09"))!.final!.items.map((i) => i.name)).toEqual(["소금빵"]);
    const o: OrderDoc = { v: 2, date: "2026-11-09", provisional: { 초코바게트: L(0), 감계무량샌드위치: L(0), 소금빵: L(16) }, final: {} };
    expect(Object.keys(asOrder(o)!.provisional)).toEqual(["소금빵"]);
    // 현장 표 · 명령서 (키친용 모닝빵은 11-05 부터 따로 붙음)
    expect(orderRows(asPlan(planOf("2026-11-09")), asOrder(o), { date: "2026-11-09", time: "07:00" }).map((r) => r.name).filter((n) => n !== "키친용 모닝빵")).toEqual(["소금빵"]);
  });
  it("추세 계산에서도 뺌 — 최근 2주에 팔렸어도 그 날짜에는 계획에 안 들어감", () => {
    const days: DayReport[] = [];
    for (let i = 0; i < 40; i++) {
      const d = new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
      days.push(day(d, [["초코바게트", 7], ["감계무량샌드위치", 3], ["소금빵", 20]]));
    }
    const b = new Board(days);
    expect(trendDay(b, "2026-11-04", "2026-11-05", "2026-11-07").items.map((i) => i.name)).toEqual(["감계무량샌드위치", "소금빵"]);
    expect(trendDay(b, "2026-11-04", "2026-11-05", "2026-11-09").items.map((i) => i.name)).toEqual(["소금빵"]);
  });
});
