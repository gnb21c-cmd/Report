import { describe, expect, it } from "vitest";
import { asOrder, asPlan, Board, breadLabel, breadNameOn, breadNewName, breadOrderAt, breadSold, floorCopy, isRenamedBread, type DayReport, type OrderDoc, type PlanDoc, type StorePart } from "../src";

/* 2026-11-12 사장님 — 저당팥빵 → 단팥빵: 포스에 단팥빵으로 팔리기 시작한 날(11-12)부터
   이미 발표한 계획 · 확정이든 앞으로 발표할 계획이든 그날부터의 이름을 모두 단팥빵으로 (읽을 때 바꿈 — 매니저 앱 · 현장 태블릿 · 보고 앱 · 계획 작업)
   인절미팥빵 → 저당팥빵(11-02) → 단팥빵(11-12) 한 줄로 이어서 셈 · 그 전 날짜는 그날 이름 + (변경명칭:단팥빵) */

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

describe("저당팥빵 → 단팥빵 (11-12 부터, 이미 발표한 계획도)", () => {
  it("그날 이름 — 인절미팥빵(11-01 까지) → 저당팥빵(11-02 ~ 11-11) → 단팥빵(11-12 부터), 어느 이름으로 물어도", () => {
    for (const n of ["인절미팥빵", "저당팥빵", "단팥빵"]) {
      expect(breadNameOn(n, "2026-11-01")).toBe("인절미팥빵");
      expect(breadNameOn(n, "2026-11-11")).toBe("저당팥빵");
      expect(breadNameOn(n, "2026-11-12")).toBe("단팥빵");
      expect(breadNameOn(n, "2026-11-20")).toBe("단팥빵");
      expect(breadNewName(n)).toBe("단팥빵");
      expect(isRenamedBread(n)).toBe(true);
    }
  });

  it("화면 표기 — 11-12 부터는 단팥빵(저당팥빵으로 발표된 것도) · 그 전 날짜는 그날 이름 (변경명칭:단팥빵)", () => {
    expect(breadLabel("저당팥빵", "2026-11-12")).toBe("단팥빵");
    expect(breadLabel("저당팥빵", "2026-11-16")).toBe("단팥빵");
    expect(breadLabel("저당팥빵", "2026-11-11")).toBe("저당팥빵 (변경명칭:단팥빵)");
    expect(breadLabel("인절미팥빵", "2026-10-30")).toBe("인절미팥빵 (변경명칭:단팥빵)");
    expect(breadLabel("소금빵", "2026-11-12")).toBe("소금빵");
  });

  it("순서 — 단팥빵은 저당팥빵 자리 그대로 (맨 뒤로 가지 않음)", () => {
    expect(breadOrderAt("단팥빵")).toBe(breadOrderAt("저당팥빵"));
    expect(breadOrderAt("단팥빵")).toBe(breadOrderAt("인절미팥빵"));
    expect(breadOrderAt("단팥빵")).toBeLessThan(breadOrderAt("없는빵"));
  });

  it("이미 발표한 계획 — 11-12 부터 날짜의 저당팥빵 줄을 단팥빵으로 (수량 · 합계 그대로), 그 전 날짜는 그대로", () => {
    const plan = (date: string): PlanDoc => ({
      v: 2,
      date,
      week: { madeOn: "2026-11-05", asOf: "2026-11-04", kind: "평일", visitors: 0, weather: "", total: 15, items: [{ name: "저당팥빵", qty: 7, trend: 6, last: 8, bin: 7 }, { name: "소금빵", qty: 8 }] },
      final: { madeOn: "2026-11-09", asOf: "2026-11-08", kind: "평일", visitors: 0, weather: "", total: 15, items: [{ name: "저당팥빵", qty: 7 }, { name: "소금빵", qty: 8 }] },
    });
    const p = asPlan(plan("2026-11-12"))!;
    expect(p.week!.items.map((i) => i.name)).toEqual(["단팥빵", "소금빵"]);
    expect(p.week!.items[0]).toMatchObject({ name: "단팥빵", qty: 7, trend: 6, last: 8, bin: 7 });
    expect(p.final!.items.map((i) => i.name)).toEqual(["단팥빵", "소금빵"]);
    expect(p.week!.total).toBe(15);
    const old = asPlan(plan("2026-11-11"))!;
    expect(old.week!.items.map((i) => i.name)).toEqual(["저당팥빵", "소금빵"]);
  });

  it("이미 한 확정(잠정 · 최종 · 생산실패)도 11-12 부터 날짜는 단팥빵 줄로 — 계획 줄과 짝이 맞음", () => {
    const line = { qty: 7, by: "매니저", at: "2026-11-09T06:00:00Z" };
    const order = (date: string): OrderDoc => ({ v: 2, date, provisional: { 저당팥빵: line, 소금빵: line }, final: { 저당팥빵: line }, fail: { 저당팥빵: { qty: 1, by: "현장", at: "" } } });
    const o = asOrder(order("2026-11-12"))!;
    expect(Object.keys(o.provisional)).toEqual(["단팥빵", "소금빵"]);
    expect(o.final.단팥빵).toEqual(line);
    expect(o.fail!.단팥빵.qty).toBe(1);
    expect(Object.keys(asOrder(order("2026-11-10"))!.provisional)).toEqual(["저당팥빵", "소금빵"]);
    // 매니저가 이미 단팥빵으로 적은 줄이 있으면 그 줄이 이김 (두 줄이 되지 않음)
    const both = asOrder({ v: 2, date: "2026-11-13", provisional: { 저당팥빵: line, 단팥빵: { ...line, qty: 9 } }, final: {} })!;
    expect(both.provisional).toEqual({ 단팥빵: { ...line, qty: 9 } });
  });

  it("현장 태블릿 복사본도 단팥빵 (읽을 때 · 쓸 때 모두)", () => {
    const p = asPlan({ v: 2, date: "2026-11-14", week: { madeOn: "2026-11-05", asOf: "2026-11-04", kind: "휴일", visitors: 0, weather: "", total: 20, items: [{ name: "저당팥빵", qty: 20 }] } });
    const c = floorCopy(p, null);
    expect(c.plan!.week!.items[0].name).toBe("단팥빵");
    expect(asPlan(JSON.parse(JSON.stringify({ v: 2, date: "2026-11-14", week: { ...c.plan!.week, items: [{ name: "저당팥빵", qty: 20 }] } })))!.week!.items[0].name).toBe("단팥빵");
  });

  it("판매 기록을 이어서 셈 — 11-16 계획 기준이면 저당팥빵 · 인절미팥빵으로 팔린 것도 단팥빵", () => {
    const b = new Board([day("2026-10-20", [["인절미팥빵", 5]]), day("2026-11-10", [["저당팥빵", 6]]), day("2026-11-12", [["단팥빵", 7]])]);
    expect(breadSold(b, "2026-10-20", "2026-11-16").get("단팥빵")).toBe(5);
    expect(breadSold(b, "2026-11-10", "2026-11-16").get("단팥빵")).toBe(6);
    expect(breadSold(b, "2026-11-12", "2026-11-16").get("단팥빵")).toBe(7);
    // 11-10 결과는 그날 이름(저당팥빵)으로 — 단팥빵으로 팔린 11-12 판매도 11-10 기준이면 저당팥빵
    expect(breadSold(b, "2026-11-12", "2026-11-10").get("저당팥빵")).toBe(7);
  });
});
