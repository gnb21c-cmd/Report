import { describe, expect, it } from "vitest";
import {
  Board,
  BREAD_ORDER,
  breadBandOf,
  breadLabel,
  breadNameOn,
  breadNewName,
  breadOrderAt,
  dayKind,
  dayRange,
  dayResult,
  DEFAULT_LEARNED,
  fitTotal,
  HOURS,
  makeFinal,
  makeWeek,
  FIXED_QTY,
  fixedQtyOf,
  NEW_BREAD,
  newBreadEarly,
  orderText,
  roundUnitOnly,
  roundUnitOrder,
  roundUpUnit,
  snapUnit,
  sortBread,
  type DayReport,
  type OrderDoc,
  type PlanDoc,
  type PlanStep,
  type StorePart,
} from "../src";

/* 2026-10-25 사장님 — 인절미팥빵 → 저당팥빵 · 고소한옛날맘모스 → 팥앙금샌드(4개 단위) · 명란소금빵 새로 */

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
/** 판매 — 인절미팥빵은 10-23 까지 · 10-24 부터 저당팥빵(rename = false 면 늘 인절미팥빵), 맘모스는 10-27 까지 · 10-28 부터 팥앙금샌드, 명란소금빵은 10-24 부터 (평일 9 · 휴일 26) */
const sales = (d: string, rename = true): [string, number][] => {
  const hol = dayKind(d) === "휴일";
  const cups = hol ? 200 : 100;
  const out: [string, number][] = [["소금빵", Math.round(cups * 0.3)], ["소보로팥소금빵", Math.round(cups * 0.06)], ["크루아상", Math.round(cups * 0.1)]];
  out.push([d < "2026-10-24" || !rename ? "인절미팥빵" : "저당팥빵", Math.round(cups * 0.08)]);
  out.push([d < "2026-10-28" ? "고소한옛날맘모스" : "팥앙금샌드", Math.round(cups * 0.03)]);
  if (d >= "2026-10-24") out.push(["명란소금빵", hol ? 26 : 9]);
  return out;
};
const make = (from: string, to: string, rename = true) => dayRange(from, to).map((d) => day(d, dayKind(d) === "휴일" ? 200 : 100, sales(d, rename)));
const board = new Board([...make("2025-08-01", "2025-12-31"), ...make("2026-08-01", "2026-12-10")]);
const names = (st: PlanStep) => st.items.map((i) => i.name);
const qtyOf = (st: PlanStep, n: string) => st.items.find((i) => i.name === n)?.qty;

describe("빵 이름 바꿈 — 11-02 계획부터 새 이름, 그 전은 옛 이름 + (변경명칭)", () => {
  it("그날 계획 이름 — 옛 · 새 · 다른 이름 모두 날짜로", () => {
    expect(breadNameOn("저당팥빵", "2026-11-01")).toBe("인절미팥빵");
    expect(breadNameOn("인절미팥빵", "2026-11-02")).toBe("저당팥빵");
    expect(breadNameOn("팥앙금샌드", "2026-10-29")).toBe("고소한옛날맘모스");
    expect(breadNameOn("맘모스", "2026-11-03")).toBe("팥앙금샌드");
    expect(breadNameOn("팥앙금빵", "2026-11-03")).toBe("팥앙금샌드");
    expect(breadNameOn("소금빵", "2026-11-03")).toBe("소금빵");
    expect(breadNewName("고소한옛날맘모스")).toBe("팥앙금샌드");
  });

  it("화면 표기 — 11-01 까지(이미 발표한 계획) 옛 이름 (변경명칭:새 이름) · 11-02 부터 새 이름만", () => {
    expect(breadLabel("인절미팥빵", "2026-10-30")).toBe("인절미팥빵 (변경명칭:저당팥빵)");
    expect(breadLabel("고소한옛날맘모스", "2026-11-01")).toBe("고소한옛날맘모스 (변경명칭:팥앙금샌드)");
    expect(breadLabel("저당팥빵", "2026-11-02")).toBe("저당팥빵");
    expect(breadLabel("팥앙금샌드", "2026-11-08")).toBe("팥앙금샌드");
    expect(breadLabel("소금빵", "2026-10-30")).toBe("소금빵");
  });

  it("순서 — 옛 이름도 새 이름 자리 · 명란소금빵은 소보로팥소금빵 바로 다음", () => {
    expect(breadOrderAt("인절미팥빵")).toBe(breadOrderAt("저당팥빵"));
    expect(breadOrderAt("고소한옛날맘모스")).toBe(1);
    expect(BREAD_ORDER[breadOrderAt("소보로팥소금빵") + 1]).toBe("명란소금빵");
    expect(sortBread(["명란소금빵", "소금빵", "소보로팥소금빵", "고소한옛날맘모스", "우유모닝빵"], (x) => x)).toEqual(["우유모닝빵", "고소한옛날맘모스", "소금빵", "소보로팥소금빵", "명란소금빵"]);
  });

  it("계획 — 판매 기록을 이어서 셈: 11-01 까지 날짜는 옛 이름 하나, 11-02 부터 새 이름 하나 (두 줄로 나뉘지 않음)", () => {
    const before = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-22", "2026-10-28");
    for (const w of before) {
      expect(names(w.week)).toContain("인절미팥빵");
      expect(names(w.week)).not.toContain("저당팥빵");
      expect(names(w.week)).toContain("고소한옛날맘모스");
      expect(names(w.week)).not.toContain("팥앙금샌드");
    }
    const after = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-29", "2026-10-28");
    for (const w of after) {
      expect(names(w.week)).toContain("저당팥빵");
      expect(names(w.week)).not.toContain("인절미팥빵");
      expect(names(w.week)).toContain("팥앙금샌드");
      expect(names(w.week)).not.toContain("고소한옛날맘모스");
    }
  });

  it("저당팥빵 수량 = 인절미팥빵 추세 · 예측 그대로 (이름만 바뀜 — 2026-10-25 사장님)", () => {
    // 이름을 안 바꾸고 계속 인절미팥빵으로 팔았을 때와 같은 수량
    const same = new Board([...make("2025-08-01", "2025-12-31", false), ...make("2026-08-01", "2026-12-10", false)]);
    const a = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-29", "2026-10-28");
    const b = makeWeek(same, {}, DEFAULT_LEARNED, "2026-10-29", "2026-10-28");
    for (let i = 0; i < 7; i++) {
      expect(qtyOf(a[i].week, "저당팥빵")).toBeGreaterThan(0);
      expect(qtyOf(a[i].week, "저당팥빵")).toBe(qtyOf(b[i].week, "저당팥빵"));
    }
    // 이미 발표한 주(10-29 ~ 11-01 최종안) — 저당팥빵으로 판 것도 인절미팥빵 실적으로
    const c = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-22", "2026-10-28");
    const e = makeWeek(same, {}, DEFAULT_LEARNED, "2026-10-22", "2026-10-28");
    for (let i = 0; i < 7; i++) expect(qtyOf(c[i].week, "인절미팥빵")).toBe(qtyOf(e[i].week, "인절미팥빵"));
  });

  it("같은 요일 칸 — 옛 이름 칸을 새 이름 계획이 이어 받음", () => {
    const [mon] = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-29", "2026-10-28", { "2026-11-02": { 인절미팥빵: 1 } });
    expect(mon.week.items.find((i) => i.name === "저당팥빵")?.step).toBe(1);
  });

  it("결과 — 10-27 계획(인절미팥빵)과 저당팥빵 판매를 한 줄로 견줌", () => {
    const plan: PlanDoc = { v: 2, date: "2026-10-27", week: { madeOn: "2026-10-22", asOf: "2026-10-21", kind: "평일", visitors: 0, weather: "", total: 10, items: [{ name: "인절미팥빵", qty: 10 }] } };
    const rows = dayResult(board, "2026-10-27", plan, null);
    expect(rows.find((r) => r.name === "저당팥빵")).toBeUndefined();
    const r = rows.find((x) => x.name === "인절미팥빵")!;
    expect([r.made, r.sold]).toEqual([10, 8]);
  });

  it("카톡 명령서 글 — 11-01 까지 옛 이름 (변경명칭)", () => {
    const t = orderText("2026-10-30", [{ name: "인절미팥빵", week: 11, provisional: 11, suggested: null, confirmed: null, qty: 11, state: "잠정" }]);
    expect(t).toContain("· 인절미팥빵 (변경명칭:저당팥빵) 11개 (잠정)");
  });
});

describe("팥앙금샌드 4개 단위 올림 — 예측 6개면 8개 · 지금 나간 명령서(10-26 부터)도", () => {
  it("옛 이름(고소한옛날맘모스)도 10-26 부터 4개 단위 · 시나몬롤 · 우유모닝빵은 그대로 11-02 부터", () => {
    expect(roundUpUnit("고소한옛날맘모스", "2026-10-26")).toBe(4);
    expect(roundUpUnit("팥앙금샌드", "2026-11-02")).toBe(4);
    expect(roundUpUnit("고소한옛날맘모스", "2026-10-25")).toBe(1);
    expect(roundUpUnit("시나몬롤", "2026-10-30")).toBe(1);
    expect(snapUnit("팥앙금샌드", 6, undefined, undefined, "2026-11-02")).toBe(8);
    expect(snapUnit("고소한옛날맘모스", 3, undefined, undefined, "2026-10-29")).toBe(4);
    expect(snapUnit("고소한옛날맘모스", 8, undefined, undefined, "2026-10-29")).toBe(8);
  });

  it("평일 합계 맞춤 때 올림 단위 빵은 올린 수량 그대로 — 범위는 다른 빵으로 (예측 11 → 올림 20 이 다시 늘어 30 이 되지 않게)", () => {
    const items = [{ name: "시나몬롤", qty: 20 }, { name: "팥앙금샌드", qty: 4 }, { name: "우유모닝빵", qty: 10 }, { name: "소금빵", qty: 180 }, { name: "크루아상", qty: 66 }];
    const f = fitTotal(items, 300, 320, "2026-11-02");
    expect(f.slice(0, 3)).toEqual(items.slice(0, 3));
    expect(f.reduce((a, b) => a + b.qty, 0)).toBe(300);
    // 넘칠 때도 다른 빵으로 줄임
    const g = fitTotal([...items.slice(0, 3), { name: "소금빵", qty: 250 }, { name: "크루아상", qty: 90 }], 300, 320, "2026-11-02");
    expect(g.slice(0, 3)).toEqual(items.slice(0, 3));
    expect(g.reduce((a, b) => a + b.qty, 0)).toBe(320);
  });

  it("10-28 까지(정해 둔 수량 전) 주간안 — 맘모스 실적 그대로 센 수량에서 4의 배수로 올림", () => {
    for (const w of makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-22", "2026-10-21").slice(0, 3)) expect(qtyOf(w.week, "고소한옛날맘모스")! % 4).toBe(0);
  });

  it("이미 나간 계획 — 그 빵만 올림 (다른 빵 · 합계 범위 그대로) · 오늘(생산 시작) 전 날짜는 그대로", () => {
    const st: PlanStep = { madeOn: "2026-10-22", asOf: "2026-10-21", kind: "평일", visitors: 0, weather: "", total: 27, items: [{ name: "고소한옛날맘모스", qty: 3 }, { name: "소금빵", qty: 24 }] };
    const r = roundUnitOnly(st, "2026-10-29");
    expect(r.items).toEqual([{ name: "고소한옛날맘모스", qty: 4 }, { name: "소금빵", qty: 24 }]);
    expect(r.total).toBe(28);
    expect(roundUnitOnly(st, "2026-10-25")).toBe(st);
    expect(roundUnitOnly({ ...st, items: [{ name: "고소한옛날맘모스", qty: 4 }] }, "2026-10-29").items[0].qty).toBe(4);
  });

  it("이미 확정한 수량 — 계획 그대로 확정했으면 올림, 매니저가 고친 수량이면 그대로", () => {
    const plan: PlanDoc = { v: 2, date: "2026-10-30", week: { madeOn: "2026-10-22", asOf: "2026-10-21", kind: "금요일", visitors: 0, weather: "", total: 6, items: [{ name: "고소한옛날맘모스", qty: 6 }] } };
    const L = (qty: number) => ({ qty, by: "매니저", at: "t" });
    const same: OrderDoc = { v: 2, date: "2026-10-30", provisional: { 고소한옛날맘모스: L(6), 소금빵: L(38) }, final: {} };
    const r = roundUnitOrder(same, plan, "4개 단위 올림", "t2");
    expect(r.order.provisional.고소한옛날맘모스).toEqual({ qty: 8, by: "4개 단위 올림", at: "t2" });
    expect(r.order.provisional.소금빵).toEqual(L(38));
    expect([r.changed, r.kept]).toEqual([["고소한옛날맘모스"], []]);
    // 매니저가 4의 배수로 고쳤으면 그대로 · 4의 배수가 아닌 수로 고쳤어도 매니저 수량이라 그대로 (kept)
    expect(roundUnitOrder({ ...same, provisional: { 고소한옛날맘모스: L(12) } }, plan, "x", "y").changed).toEqual([]);
    const k = roundUnitOrder({ ...same, provisional: { 고소한옛날맘모스: L(7) } }, plan, "x", "y");
    expect([k.changed, k.kept, k.order.provisional.고소한옛날맘모스.qty]).toEqual([[], ["고소한옛날맘모스"], 7]);
  });
});

describe("팥앙금샌드 정해 둔 수량 — 평일 12개 · 휴일 16개 (10-29 ~ 11-01 최종안만, 2026-10-25 사장님)", () => {
  it("정해 둔 값 · 옛 이름도 · 금요일은 평일 · 11-02 부터는 없음", () => {
    expect(FIXED_QTY).toEqual({ 팥앙금샌드: { from: "2026-10-29", to: "2026-11-01", weekday: 12, holiday: 16 } });
    expect(fixedQtyOf("고소한옛날맘모스", "2026-10-28")).toBeNull();
    expect(fixedQtyOf("고소한옛날맘모스", "2026-10-29")).toBe(12); // 목
    expect(fixedQtyOf("고소한옛날맘모스", "2026-10-30")).toBe(12); // 금
    expect(fixedQtyOf("고소한옛날맘모스", "2026-10-31")).toBe(16); // 토
    expect(fixedQtyOf("팥앙금샌드", "2026-11-01")).toBe(16); // 일
    expect(fixedQtyOf("팥앙금샌드", "2026-11-02")).toBeNull();
    expect(fixedQtyOf("소금빵", "2026-10-30")).toBeNull();
  });

  it("10-29 ~ 11-01 날짜를 셀 때 — 예측 · 같은 요일 칸 없이 그 수량 · 평일 합계 300 ~ 320 은 다른 빵으로 맞춤", () => {
    const week = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-22", "2026-10-21", { "2026-10-29": { 고소한옛날맘모스: 3 }, "2026-10-31": { 고소한옛날맘모스: -2 } }).filter((w) => w.date >= "2026-10-29");
    expect(week.length).toBe(4);
    for (const w of week) {
      const it = w.week.items.find((i) => i.name === "고소한옛날맘모스")!;
      expect(it.qty).toBe(dayKind(w.date) === "휴일" ? 16 : 12);
      expect(it.step).toBeUndefined();
      if (breadBandOf(w.date)) {
        const m = qtyOf(w.week, "명란소금빵") ?? 0;
        expect(w.week.total - m).toBeGreaterThanOrEqual(300);
        expect(w.week.total - m).toBeLessThanOrEqual(320);
      }
    }
  });

  it("11-02 주간안(10-29 발표)부터는 10-28 까지 판매로 예측 — 정해 둔 수량 아님 · 4개 단위 올림 · 같은 요일 칸도 씀", () => {
    const week = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-29", "2026-10-28");
    for (const w of week) {
      const it = w.week.items.find((i) => i.name === "팥앙금샌드")!;
      expect(it.qty % 4).toBe(0);
      expect(it.qty).toBe(snapUnit("팥앙금샌드", it.base!, undefined, undefined, w.date));
    }
    const withStep = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-29", "2026-10-28", { "2026-11-07": { 고소한옛날맘모스: 2 } });
    expect(withStep[5].week.items.find((i) => i.name === "팥앙금샌드")?.step).toBe(2);
  });

  it("10-29 최종안 — 이미 나간 주간안(4개)이어도 12개 · 매니저가 잠정 확정 때 고친 수량이면 그대로 · 10-28 최종안은 그대로 4개 단위", () => {
    const old = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-22", "2026-10-21");
    const thu = old.find((w) => w.date === "2026-10-29")!;
    const wk = { ...thu.week, items: thu.week.items.map((i) => (i.name === "고소한옛날맘모스" ? { ...i, qty: 4 } : i)) };
    const plan: PlanDoc = { v: 2, date: "2026-10-29", week: wk };
    const L = (qty: number) => ({ qty, by: "매니저", at: "t" });
    const f = makeFinal(board, {}, DEFAULT_LEARNED, "2026-10-26", "2026-10-25", plan, { v: 2, date: "2026-10-29", provisional: { 고소한옛날맘모스: L(4) }, final: {} })!;
    expect(qtyOf(f, "고소한옛날맘모스")).toBe(12);
    expect(f.items.find((i) => i.name === "고소한옛날맘모스")?.lo).toBeUndefined();
    expect(f.total).toBeGreaterThanOrEqual(300);
    expect(f.total).toBeLessThanOrEqual(320);
    const kept = makeFinal(board, {}, DEFAULT_LEARNED, "2026-10-26", "2026-10-25", plan, { v: 2, date: "2026-10-29", provisional: { 고소한옛날맘모스: L(8) }, final: {} })!;
    expect(qtyOf(kept, "고소한옛날맘모스")).toBe(8);
    const sat = old.find((w) => w.date === "2026-10-31")!;
    const fs = makeFinal(board, {}, DEFAULT_LEARNED, "2026-10-28", "2026-10-27", { v: 2, date: "2026-10-31", week: sat.week }, null)!;
    expect(qtyOf(fs, "고소한옛날맘모스")).toBe(16);
    const wed = old.find((w) => w.date === "2026-10-28")!;
    const fw = makeFinal(board, {}, DEFAULT_LEARNED, "2026-10-25", "2026-10-24", { v: 2, date: "2026-10-28", week: wed.week }, null)!;
    expect(qtyOf(fw, "고소한옛날맘모스")! % 4).toBe(0);
  });
});

describe("명란소금빵 — 11-02 계획부터 · 처음 4주는 그날 소보로팥소금빵과 같은 수량 · 범위 밖 (2026-10-25 사장님)", () => {
  const rule = NEW_BREAD.명란소금빵;
  it("정해 둔 값", () => {
    expect(rule).toEqual({ from: "2026-11-02", same: "소보로팥소금빵", learnDays: 28 });
  });

  it("11-01 까지 날짜(이미 발표한 주 · 그 최종안)에는 안 넣음", () => {
    for (const w of makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-22", "2026-10-28")) expect(names(w.week)).not.toContain("명란소금빵");
  });

  it("10-29 발표 주간안 — 그날 소보로팥소금빵과 같은 수량 (매진 더하기 · 같은 요일 칸 없음) · 평일 300 ~ 320 은 다른 빵만 (명란은 그 위에)", () => {
    const week = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-29", "2026-10-28", { "2026-11-02": { 명란소금빵: 5 }, "2026-11-07": { 명란소금빵: 5 } });
    for (const w of week) {
      const m = w.week.items.find((i) => i.name === "명란소금빵")!;
      expect(m.qty).toBe(qtyOf(w.week, "소보로팥소금빵"));
      expect(m.qty).toBeGreaterThan(0);
      expect(m.step).toBeUndefined();
      expect("add" in m).toBe(false);
      if (breadBandOf(w.date)) {
        expect(w.week.total - m.qty).toBeGreaterThanOrEqual(300);
        expect(w.week.total - m.qty).toBeLessThanOrEqual(320);
      }
    }
  });

  it("최종안(3일 전) — 최종안의 소보로팥소금빵과 같은 수량 · 매니저가 잠정 확정 때 고친 수량이면 그대로", () => {
    const [mon] = makeWeek(board, {}, DEFAULT_LEARNED, "2026-11-05", "2026-11-04");
    const f = makeFinal(board, {}, DEFAULT_LEARNED, "2026-11-06", "2026-11-05", { v: 2, date: mon.date, week: mon.week }, null)!;
    expect(qtyOf(f, "명란소금빵")).toBe(qtyOf(f, "소보로팥소금빵"));
    expect(f.total - qtyOf(f, "명란소금빵")!).toBeLessThanOrEqual(320);
    // 소보로팥소금빵만 매니저가 고쳤으면 명란도 그 수량 (같은 수량)
    const L = (qty: number) => ({ qty, by: "매니저", at: "" });
    const s = makeFinal(board, {}, DEFAULT_LEARNED, "2026-11-06", "2026-11-05", { v: 2, date: mon.date, week: mon.week }, { v: 2, date: mon.date, provisional: { 소보로팥소금빵: L(40) }, final: {} })!;
    expect(qtyOf(s, "명란소금빵")).toBe(qtyOf(s, "소보로팥소금빵"));
    const p = makeFinal(board, {}, DEFAULT_LEARNED, "2026-11-06", "2026-11-05", { v: 2, date: mon.date, week: mon.week }, { v: 2, date: mon.date, provisional: { 명란소금빵: L(40) }, final: {} })!;
    expect(qtyOf(p, "명란소금빵")).toBe(40);
  });

  it("첫 판매(10-24)부터 28일 실적이 쌓이면 다른 빵처럼 판매 추이로", () => {
    expect(newBreadEarly(board, "명란소금빵", "2026-11-19")).toBe(true); // 27일
    expect(newBreadEarly(board, "명란소금빵", "2026-11-20")).toBe(false); // 28일
    const w = makeWeek(board, {}, DEFAULT_LEARNED, "2026-11-26", "2026-11-25");
    for (const x of w) expect(x.week.items.find((i) => i.name === "명란소금빵")).toBeDefined();
  });
});
