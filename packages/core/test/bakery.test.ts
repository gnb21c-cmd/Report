import { describe, expect, it } from "vitest";
import {
  addDays,
  asOrder,
  asPlan,
  Board,
  corrections,
  dayKind,
  dayRange,
  dayResult,
  DEFAULT_LEARNED,
  displayDays,
  finalDay,
  floorCopy,
  validFloorKey,
  HOURS,
  madeTotal,
  makeFinal,
  makeWeek,
  snapUnit,
  nowKst,
  orderRows,
  orderText,
  weekDates,
  weekPlanDay,
  weekPlanOpen,
  estimateDay,
  isEstimated,
  visiblePlan,
  WEEK_PLAN_TIME,
  CONFIRM_DEADLINE,
  type BreadResult,
  type DayReport,
  type OrderDoc,
  type PlanDoc,
  type StorePart,
} from "../src";

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
    return day(d, cups, [["소금빵", Math.round(cups * 0.3)], ["크루아상", Math.round(cups * 0.1)], ["딸기잼", 3], ["블루베리잼", 2]]);
  });
const board = new Board([...make("2025-08-01", "2025-12-31", () => 1), ...make("2026-08-01", "2026-10-07", () => 1)]);
const L = (qty: number, at = "") => ({ qty, by: "매니저", at });
const T = (date: string, time: string) => ({ date, time });

describe("날짜 — 목요일 주간 · 3일 전 최종 · 아침 6시", () => {
  it("목요일(10-08)에 다음 주 월(10-12) ~ 일(10-18)", () => {
    expect(weekDates("2026-10-08")).toEqual(dayRange("2026-10-12", "2026-10-18"));
  });
  it("그 주의 주간 계획 날 = 앞 목요일", () => {
    for (const d of dayRange("2026-10-12", "2026-10-18")) expect(weekPlanDay(d)).toBe("2026-10-08");
    expect(weekPlanDay("2026-10-19")).toBe("2026-10-15");
  });
  it("최종 확정 날 — 금 → 월, 토 → 화, …, 목 → 일", () => {
    expect(finalDay("2026-10-12")).toBe("2026-10-09"); // 월 ← 금
    expect(finalDay("2026-10-13")).toBe("2026-10-10"); // 화 ← 토
    expect(finalDay("2026-10-18")).toBe("2026-10-15"); // 일 ← 목
  });
  it("현장 태블릿 — 6시 전에는 아직 어제와 오늘, 6시부터 오늘과 내일", () => {
    expect(displayDays(T("2026-10-18", "05:59"))).toEqual(["2026-10-17", "2026-10-18"]);
    expect(displayDays(T("2026-10-18", "06:00"))).toEqual(["2026-10-18", "2026-10-19"]);
  });
});

describe("주간 잠정안은 목요일 아침 6시에 열림 (나머지 시각은 그대로)", () => {
  const plan: PlanDoc = { v: 2, date: "2026-10-19", week: { madeOn: "2026-10-15", asOf: "2026-10-13", kind: "평일", visitors: 0, weather: "", total: 0, items: [] } };
  it("6시", () => expect(WEEK_PLAN_TIME).toBe("06:00"));
  it("목요일 새벽에 미리 계산해 둬도 6시 전에는 안 보이고, 6시부터 보임", () => {
    expect(weekPlanOpen(plan, T("2026-10-15", "05:10"))).toBe(false);
    expect(weekPlanOpen(plan, T("2026-10-15", "06:00"))).toBe(true);
    expect(weekPlanOpen(plan, T("2026-10-16", "01:00"))).toBe(true);
  });
  it("계획이 없으면 안 보임", () => {
    expect(weekPlanOpen({ v: 2, date: "2026-10-19" }, T("2026-10-15", "07:00"))).toBe(false);
  });
  it("매니저 앱은 6시 전에 주간안 · 전망을 못 봄 — 6시부터 그대로 (숫자는 바꾸지 않음)", () => {
    const withOutlook: PlanDoc = { ...plan, outlook: [{ week: 1, from: "2026-10-19", to: "2026-10-25", weekday: 100, holiday: 150 }] };
    const early = visiblePlan(withOutlook, T("2026-10-15", "05:59"))!;
    expect(early.week).toBeUndefined();
    expect(early.outlook).toBeUndefined();
    expect(early.date).toBe("2026-10-19");
    expect(visiblePlan(withOutlook, T("2026-10-15", "06:00"))).toBe(withOutlook);
    expect(visiblePlan(null, T("2026-10-15", "05:00"))).toBeNull();
  });
  it("최종안은 시각과 관계없이 그대로 (최종안이 있는 날의 주간안은 이미 지난 목요일 것)", () => {
    const fin: PlanDoc = { ...plan, date: "2026-10-12", week: { ...plan.week!, madeOn: "2026-10-08" }, final: { ...plan.week!, madeOn: "2026-10-09" } };
    expect(visiblePlan(fin, T("2026-10-09", "05:00"))).toBe(fin);
  });
  it("잠정 확정 마감은 그대로 목요일 18시 · 최종은 그대로 3일 전", () => {
    expect(CONFIRM_DEADLINE).toBe("18:00");
    expect(finalDay("2026-10-19")).toBe("2026-10-16");
  });
});

describe("목요일 아침 6시 주간안 — 수요일 실적은 아직 없어 지난주 · 지지난주 수요일로 채움", () => {
  // 화요일(10-13)까지 실적. 수요일 10-07 · 09-30 · 09-23 은 서로 다르게
  const wed = (d: string, cups: number, bread: [string, number][]) => day(d, cups, bread);
  const base = make("2026-08-01", "2026-10-13", () => 1).filter((r) => !["2026-10-07", "2026-09-30", "2026-09-23"].includes(r.date));
  const b = new Board([...base, wed("2026-10-07", 120, [["소금빵", 40]]), wed("2026-09-30", 80, [["소금빵", 20], ["크루아상", 6]]), wed("2026-09-23", 60, [["소금빵", 10]])]);
  it("지난주(10-07) · 지지난주(09-30) 수요일의 평균 — 손님(잔 수) · 빵별 개수", () => {
    const e = estimateDay(b, "2026-10-14")!;
    expect(e.date).toBe("2026-10-14");
    expect(e.cafe!.cups).toBe(100);
    const q = Object.fromEntries(e.cafe!.products.map((p) => [p[0], p[2]]));
    expect(q).toEqual({ 소금빵: 30, 크루아상: 3 });
    expect(isEstimated(e)).toBe(true);
    // 50% 할인 · 폐기 결과는 없음 (실제로 판 날이 아니라 보정 계산에 쓰지 않음)
    expect(e.cafe!.bakeryHalfBy).toBeUndefined();
  });
  it("자료가 없는 수요일(쉰 날)은 건너뛰고 그 전 수요일", () => {
    const b2 = new Board([...base, wed("2026-09-30", 80, [["소금빵", 20], ["크루아상", 6]]), wed("2026-09-23", 60, [["소금빵", 10]])]);
    const e = estimateDay(b2, "2026-10-14")!;
    expect(e.cafe!.cups).toBe(70);
    expect(Object.fromEntries(e.cafe!.products.map((p) => [p[0], p[2]]))).toEqual({ 소금빵: 15, 크루아상: 3 });
  });
  it("지난 8주 안에 같은 요일 자료가 없으면 채우지 않음", () => {
    expect(estimateDay(new Board(make("2026-07-01", "2026-08-15", () => 1)), "2026-10-14")).toBeNull();
  });
  it("실제 자료는 추정이 아님", () => {
    expect(isEstimated(b.report("2026-10-07"))).toBe(false);
  });
});

describe("주간 잠정안 (목 아침)", () => {
  const week = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-08", "2026-10-07");
  it("7일 · 월요일 문서에만 1~4주 전망 · 딸기잼 · 블루베리잼은 빠짐", () => {
    expect(week.map((w) => w.date)).toEqual(dayRange("2026-10-12", "2026-10-18"));
    expect(week[0].outlook).toHaveLength(4);
    expect(week[1].outlook).toBeUndefined();
    for (const w of week) {
      expect(w.week.madeOn).toBe("2026-10-08");
      expect(w.week.items.some((i) => i.name === "딸기잼")).toBe(false);
      expect(w.week.items.some((i) => i.name === "블루베리잼")).toBe(false);
      const s = w.week.items.find((i) => i.name === "소금빵")!;
      expect(s.base).toBe(s.qty);
    }
  });
  it("보정 배수를 곱하고 보정 전 수량(base)을 남김", () => {
    const fixed = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-08", "2026-10-07", { 소금빵: 0.8 });
    const a = week[0].week.items.find((i) => i.name === "소금빵")!;
    const b = fixed[0].week.items.find((i) => i.name === "소금빵")!;
    expect(b.qty).toBe(Math.round(a.qty * 0.8));
    expect(b.base).toBe(a.qty);
    expect(b.adj).toBe(0.8);
  });
});

describe("최종안 (3일 전 15시)", () => {
  const [mon] = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-08", "2026-10-07");
  const plan: PlanDoc = { v: 2, date: mon.date, week: mon.week };

  it("주간 잠정안이 없거나 다른 날이면 세지 않음", () => {
    expect(makeFinal(board, {}, DEFAULT_LEARNED, "2026-10-09", "2026-10-08", null, null)).toBeNull();
    expect(makeFinal(board, {}, DEFAULT_LEARNED, "2026-10-10", "2026-10-09", plan, null)).toBeNull(); // 10-13 이 아님
  });
  it("금(10-09) → 월(10-12) · 잠정 확정 수량 ±10% 안으로 묶음", () => {
    const order: OrderDoc = { v: 2, date: mon.date, provisional: { 소금빵: L(50) }, final: {} };
    const f = makeFinal(board, {}, DEFAULT_LEARNED, "2026-10-09", "2026-10-08", plan, order, { 소금빵: 3 })!;
    const s = f.items.find((i) => i.name === "소금빵")!;
    expect(s.qty).toBe(55); // 크게 늘어도 잠정 50 의 +10%
    expect([s.lo, s.hi]).toEqual([45, 55]);
    const low = makeFinal(board, {}, DEFAULT_LEARNED, "2026-10-09", "2026-10-08", plan, order, { 소금빵: 0.1 })!;
    expect(low.items.find((i) => i.name === "소금빵")!.qty).toBe(45); // 크게 줄어도 −10%
    // 잠정 확정이 없는 빵은 주간 수량이 기준
    const c = f.items.find((i) => i.name === "크루아상")!;
    const cw = mon.week.items.find((i) => i.name === "크루아상")!.qty;
    expect(c.qty).toBeGreaterThanOrEqual(Math.floor(cw * 0.9));
    expect(c.qty).toBeLessThanOrEqual(Math.ceil(cw * 1.1));
    expect(f.madeOn).toBe("2026-10-09");
  });
});

describe("빵별 상태 — 한 주기 따라가기 (월 10-12)", () => {
  const [mon] = makeWeek(board, {}, DEFAULT_LEARNED, "2026-10-08", "2026-10-07");
  const weekQty = (n: string) => mon.week.items.find((i) => i.name === n)!.qty;
  const plan: PlanDoc = { v: 2, date: mon.date, week: mon.week };

  it("목 17시 — 잠정 확정 전이면 '확정 전'", () => {
    const rows = orderRows(plan, null, T("2026-10-08", "17:00"));
    expect(rows.every((r) => r.state === "확정 전" && r.qty == null)).toBe(true);
  });
  it("목 18시 지나면 잠정 확정 안 한 빵은 주간 수량 그대로 '잠정'", () => {
    const order: OrderDoc = { v: 2, date: mon.date, provisional: { 소금빵: L(70) }, final: {} };
    const rows = orderRows(plan, order, T("2026-10-08", "18:00"));
    expect(rows.find((r) => r.name === "소금빵")).toMatchObject({ qty: 70, state: "잠정", provisional: 70 });
    expect(rows.find((r) => r.name === "크루아상")).toMatchObject({ qty: weekQty("크루아상"), state: "잠정" });
  });
  it("금 18시 지나면 최종 확정 안 한 빵은 최종안 그대로 '자동', 확정한 빵은 '확정'", () => {
    const fin = { ...mon.week, madeOn: "2026-10-09", items: [{ name: "소금빵", qty: 72 }, { name: "크루아상", qty: 25 }] };
    const order: OrderDoc = { v: 2, date: mon.date, provisional: { 소금빵: L(70) }, final: { 크루아상: L(24) } };
    const before = orderRows({ ...plan, final: fin }, order, T("2026-10-09", "17:59"));
    expect(before.find((r) => r.name === "소금빵")).toMatchObject({ state: "잠정", qty: 70, suggested: 72 });
    const after = orderRows({ ...plan, final: fin }, order, T("2026-10-09", "18:00"));
    expect(after.find((r) => r.name === "소금빵")).toMatchObject({ state: "자동", qty: 72 });
    expect(after.find((r) => r.name === "크루아상")).toMatchObject({ state: "확정", qty: 24 });
    expect(madeTotal(after)).toBe(96);
    expect(madeTotal(before)).toBeNull(); // 최종 전에는 생산을 모름
    expect(orderText(mon.date, after)).toBe("[10월 12일 생산 명령서] 총 96개\n· 소금빵 72개 (자동)\n· 크루아상 24개");
  });
  it("클라우드에서 읽을 때부터 블루베리잼 · 딸기잼을 뺌 — 매니저 확정 화면 목록 · 합계 · 7일 일괄 확정 · 이미지가 모두 계획을 이렇게 읽음", () => {
    const raw = { ...plan, week: { ...mon.week, items: [...mon.week.items, { name: "블루베리잼", qty: 1 }], total: mon.week.total + 1 }, final: { ...mon.week, items: [{ name: "소금빵", qty: 60 }, { name: "딸기잼", qty: 2 }], total: 62 } };
    const p = asPlan(JSON.parse(JSON.stringify(raw)))!;
    expect(p.week!.items.some((i) => i.name === "블루베리잼")).toBe(false);
    expect(p.week!.total).toBe(mon.week.total);
    expect(p.final!.items.map((i) => i.name)).toEqual(["소금빵"]);
    expect(p.final!.total).toBe(60);
    const o = asOrder({ v: 2, date: mon.date, provisional: { 블루베리잼: L(1), 소금빵: L(70) }, final: { 딸기잼: L(2) } })!;
    expect(Object.keys(o.provisional)).toEqual(["소금빵"]);
    expect(Object.keys(o.final)).toEqual([]);
  });
  it("이미 만들어진 계획에 블루베리잼 · 딸기잼이 있어도 생산 목록 · 합계에서 빠짐 (잠정 확정해 둔 것도)", () => {
    const old: PlanDoc = { ...plan, week: { ...mon.week, items: [...mon.week.items, { name: "블루베리잼", qty: 1 }, { name: "딸기잼", qty: 2 }] } };
    const order: OrderDoc = { v: 2, date: mon.date, provisional: { 블루베리잼: L(1) }, final: {} };
    const rows = orderRows(old, order, T("2026-10-08", "15:19"));
    expect(rows.some((r) => r.name === "블루베리잼" || r.name === "딸기잼")).toBe(false);
    expect(rows.length).toBe(mon.week.items.length);
  });
  it("최종안 계산이 빠진 날 — 마감 뒤에는 잠정(없으면 주간) 수량으로 '자동'", () => {
    const order: OrderDoc = { v: 2, date: mon.date, provisional: { 소금빵: L(70) }, final: {} };
    const rows = orderRows(plan, order, T("2026-10-10", "09:00"));
    expect(rows.find((r) => r.name === "소금빵")).toMatchObject({ state: "자동", qty: 70 });
    expect(rows.find((r) => r.name === "크루아상")).toMatchObject({ state: "자동", qty: weekQty("크루아상") });
  });
  it("계획 · 확정이 없으면 빈 목록 · 예전 모양(v1) 문서는 버림", () => {
    expect(orderRows(null, null, T("2026-10-08", "10:00"))).toEqual([]);
    expect(asPlan({ v: 1, date: "2026-10-05", items: [] })).toBeNull();
    expect(asOrder({ v: 1, date: "2026-10-05", items: {} })).toBeNull();
    expect(asOrder({ v: 2, date: "2026-10-05" })).toEqual({ v: 2, date: "2026-10-05", provisional: {}, final: {} });
  });
  it("한국 시간", () => {
    expect(nowKst(new Date("2026-10-04T09:30:00Z"))).toEqual({ date: "2026-10-04", time: "18:30" });
  });
});

describe("결과 · 오차 → 다음 예측", () => {
  // 10-12: 소금빵 최종 60개(보정 전 60) 만들어 50개 팔림(그중 8개 50% 할인) · 크루아상 20개 만들어 다 팔림 · 딸기잼은 빠짐
  const r = day("2026-10-12", 100, [["소금빵", 50], ["크루아상", 20], ["딸기잼", 4], ["블루베리잼", 3]]);
  r.cafe!.bakeryHalfBy = { 소금빵: 8 };
  const b = new Board([r]);
  const step = { madeOn: "2026-10-09", asOf: "2026-10-08", kind: "평일" as const, visitors: 100, weather: "모름", total: 80 };
  const plan: PlanDoc = { v: 2, date: "2026-10-12", final: { ...step, items: [{ name: "소금빵", qty: 60, base: 60 }, { name: "크루아상", qty: 20, base: 20 }] } };
  const rows = dayResult(b, "2026-10-12", plan, null);

  it("생산(최종 자동) · 판매 · 50% 할인 · 폐기 = 생산 − 판매", () => {
    expect(rows.find((x) => x.name === "소금빵")).toMatchObject({ made: 60, sold: 50, half: 8, full: 42, waste: 10, soldOut: false });
    expect(rows.find((x) => x.name === "크루아상")).toMatchObject({ made: 20, sold: 20, waste: 0, soldOut: true });
    expect(rows.some((x) => x.name === "딸기잼")).toBe(false);
    expect(rows.some((x) => x.name === "블루베리잼")).toBe(false);
  });
  it("많이 만들면 줄이고, 다 팔리면 조금 올림 (하루뿐이라 1 쪽으로 당김)", () => {
    const c = corrections([{ date: "2026-10-12", rows }], "2026-10-12");
    expect(c["소금빵"]).toBeLessThan(1);
    expect(c["소금빵"]).toBeGreaterThan(42 / 60);
    expect(c["크루아상"]).toBeGreaterThan(1);
  });
  it("보정이 쌓이지 않음 — 보정 전 예측과 견줌", () => {
    const x: BreadResult = { name: "소금빵", made: 45, base: 60, sold: 45, half: 0, full: 45, waste: 0, soldOut: true };
    const c = corrections([1, 2, 3, 4, 5, 6].map((k) => ({ date: addDays("2026-10-12", -k), rows: [x] })), "2026-10-12");
    expect(c["소금빵"]).toBeCloseTo(Math.exp((6 / 8) * Math.log(0.75 * 1.1)), 2);
  });
});

describe("생산 단위 — 몽블랑은 5개 단위", () => {
  it("가까운 5의 배수, 0 보다 많으면 적어도 5개", () => {
    expect(snapUnit("몽블랑", 37)).toBe(35);
    expect(snapUnit("몽블랑", 38)).toBe(40);
    expect(snapUnit("몽블랑", 2)).toBe(5);
    expect(snapUnit("몽블랑", 0)).toBe(0);
    expect(snapUnit("소금빵", 37)).toBe(37);
  });
  it("범위가 있으면 범위 안의 5의 배수 (없으면 가장 가까운 배수)", () => {
    expect(snapUnit("몽블랑", 38, 36, 44)).toBe(40);
    expect(snapUnit("몽블랑", 36, 36, 44)).toBe(40); // 35 는 범위 밖
    expect(snapUnit("몽블랑", 41, 41, 44)).toBe(40); // 범위 안 배수가 없으면 가까운 쪽
  });
  it("주간 · 최종안에 적용", () => {
    const b = new Board([...make("2025-08-01", "2025-12-31", () => 1), ...make("2026-08-01", "2026-10-07", () => 1)].map((r) => ({ ...r, cafe: { ...r.cafe!, products: [...r.cafe!.products, ["몽블랑", "베이커리", 23, 0] as any] } })));
    const [mon] = makeWeek(b, {}, DEFAULT_LEARNED, "2026-10-08", "2026-10-07");
    expect(mon.week.items.find((i) => i.name === "몽블랑")!.qty % 5).toBe(0);
    const f = makeFinal(b, {}, DEFAULT_LEARNED, "2026-10-09", "2026-10-08", { v: 2, date: mon.date, week: mon.week }, null, { 몽블랑: 1.07 })!;
    expect(f.items.find((i) => i.name === "몽블랑")!.qty % 5).toBe(0);
  });
});

describe("현장 태블릿 복사본 — 수량 · 상태만", () => {
  it("예상 손님 · 날씨 · 보정 값은 빼고, 태블릿에서 같은 목록이 나옴", () => {
    const step = { madeOn: "2026-10-08", asOf: "2026-10-07", kind: "평일" as const, visitors: 321, weather: "쾌적", total: 50, items: [{ name: "소금빵", qty: 50, base: 47, adj: 1.06 }] };
    const plan: PlanDoc = { v: 2, date: "2026-10-12", week: step, final: { ...step, madeOn: "2026-10-09", items: [{ name: "소금빵", qty: 52, base: 49, lo: 45, hi: 55 }] }, outlook: [] };
    const order: OrderDoc = { v: 2, date: "2026-10-12", provisional: { 소금빵: L(50) }, final: {} };
    const f = floorCopy(plan, order);
    expect(JSON.stringify(f)).not.toMatch(/321|쾌적|base|adj|outlook|매니저/);
    const now = T("2026-10-12", "07:00");
    expect(orderRows(f.plan, f.order, now)).toEqual(orderRows(plan, order, now));
  });
});

describe("태블릿 키 번호", () => {
  it("숫자 4 ~ 12자리만", () => {
    expect(validFloorKey("910278")).toBe(true);
    expect(validFloorKey("0123")).toBe(true);
    expect(validFloorKey("123")).toBe(false);
    expect(validFloorKey("1234567890123")).toBe(false);
    expect(validFloorKey("91a278")).toBe(false);
    expect(validFloorKey(" 910278")).toBe(false);
  });
});

describe("베이커리 결과 보고 (B 베이커리 상세) · 생산일 잠금", async () => {
  const { breadTotals, productionStarted } = await import("../src");
  it("합계: 총 생산 · 정가판매 · 할인판매 · 폐기(= 생산 − 정가 − 할인), 작업지시 없는 빵은 생산 · 폐기를 모름", () => {
    const t = breadTotals([
      { name: "소금빵", made: 50, base: null, sold: 48, half: 6, full: 42, waste: 2, soldOut: false },
      { name: "몽블랑", made: 20, base: null, sold: 20, half: 0, full: 20, waste: 0, soldOut: true },
      { name: "딸기빵", made: null, base: null, sold: 3, half: 0, full: 3, waste: null, soldOut: false },
    ]);
    expect(t).toEqual({ made: 70, full: 65, half: 6, waste: 2 });
    expect(breadTotals([{ name: "x", made: null, base: null, sold: 3, half: 1, full: 2, waste: null, soldOut: false }])).toEqual({ made: null, full: 2, half: 1, waste: null });
  });
  it("그날 아침 6시(현장 시작)부터는 그날 최종 수량을 못 바꿈 — 현장에 지시한 수량이 그날 생산 기록", () => {
    expect(productionStarted("2026-10-08", { date: "2026-10-08", time: "05:59" })).toBe(false);
    expect(productionStarted("2026-10-08", { date: "2026-10-08", time: "06:00" })).toBe(true);
    expect(productionStarted("2026-10-08", { date: "2026-10-09", time: "01:00" })).toBe(true);
    expect(productionStarted("2026-10-08", { date: "2026-10-07", time: "23:00" })).toBe(false);
  });
});
