/* 재고(E · E-1 · F) — astana 재고 계산 이식 + 통합 Ver.2.0 규칙 (안전재고 · 발주 필요량 · 실셈 차이) */
import { describe, expect, it } from "vitest";
import {
  countCheck,
  dailyUse,
  orderPlan,
  packLabel,
  pkgSplitText,
  recipeCost,
  recipeUsage,
  safetyStock,
  soldFromLines,
  stockLedger,
  stockReport,
  stockText,
  usePerPack,
  vatAmount,
  type Material,
  type Recipe,
  type StockCount,
  type StockIn,
  type Supplier,
} from "../src";

const suppliers: Supplier[] = [
  { id: "s-milk", name: "우유 거래처", leadDays: 1, minOrderAmount: 50000 },
  { id: "s-flour", name: "제분 거래처", leadDays: 3, orderDays: [1, 4] },
];
const materials: Material[] = [
  { id: "milk", name: "우유", supplierId: "s-milk", packSize: 1, packUnit: "L", pkgQty: 12, pkgPrice: 24000, initialStock: 13, asOf: "2026-09-01" },
  { id: "bean", name: "원두", supplierId: "s-milk", packSize: 1, packUnit: "kg", pkgQty: 1, pkgPrice: 30000, initialStock: 4, asOf: "2026-09-01" },
  { id: "flour", name: "밀가루", supplierId: "s-flour", packSize: 20, packUnit: "kg", pkgQty: 1, pkgPrice: 40000, vatFree: true, initialStock: 2, asOf: "2026-09-01", moqPkgs: 2, tiers: [{ minPkgs: 5, pkgPrice: 36000 }] },
  { id: "egg", name: "계란", supplierId: "s-milk", packSize: 30, packUnit: "개", pkgQty: 1, pkgPrice: 9000, initialStock: 3, asOf: "2026-09-01" },
];
const recipes: Recipe[] = [
  { product: "카페라떼", part: "바리스타", items: [{ materialId: "bean", qty: 20 }, { materialId: "milk", qty: 200 }] },
  { product: "크루아상", part: "베이커리", items: [{ materialId: "flour", qty: 100 }, { materialId: "milk", qty: 50 }] },
  { product: "에그 토스트", part: "키친", items: [{ materialId: "egg", qty: 2 }] },
];

describe("단위 · PKG · 부가세 (astana 와 같음)", () => {
  it("공급단위로 셈 — 우유 1L 13개는 '13개 (1L)'", () => {
    expect(stockText(materials[0], 13)).toBe("13개 (1L)");
    expect(packLabel(materials[2])).toBe("20kg");
    expect(usePerPack(materials[0])).toBe(1000);
    expect(usePerPack(materials[2])).toBe(20000);
  });
  it("PKG 환산 · 부가세 (면세는 0)", () => {
    expect(pkgSplitText(materials[0], 29)).toBe("2PKG + 5개");
    expect(vatAmount(24000)).toBe(2400);
    expect(vatAmount(40000, true)).toBe(0);
  });
  it("레시피 1개 원가 = Σ 양 ÷ 공급단위 × 1개 단가", () => {
    // 라떼: 원두 20g (30,000원/kg) = 600 + 우유 200ml (2,000원/L) = 400
    expect(recipeCost(recipes[0], materials)).toBeCloseTo(1000);
  });
});

describe("B 영수증 줄 → 판매 수량 · 레시피 사용 (베이커리는 D 생산량)", () => {
  const lines = [
    { name: "카페라떼", qty: 10, net: 50000 },
    { name: "카페 라떼", qty: 2, net: 10000 }, // 띄어쓰기 달라도 같은 상품
    { name: "크루아상", qty: 30, net: 120000 },
    { name: "레시피없는메뉴", qty: 5, net: 5000 },
  ];
  const sold = soldFromLines("2026-09-02", lines);
  it("상품명별 수량 합", () => {
    expect(sold.find((s) => s.name === "카페라떼")?.qty).toBe(12);
  });
  const usage = recipeUsage({ recipes, materials, sold, production: [{ date: "2026-09-02", items: [{ product: "크루아상", qty: 40 }] }] });
  const sum = (id: string) => usage.filter((u) => u.materialId === id).reduce((a, u) => a + u.packs, 0);
  it("음료는 판매 × 레시피, 베이커리는 그날 D 생산량(40) × 레시피 — 판매(30)가 아님", () => {
    expect(sum("bean")).toBeCloseTo((20 * 12) / 1000);
    expect(sum("flour")).toBeCloseTo((100 * 40) / 20000);
    expect(sum("milk")).toBeCloseTo((200 * 12 + 50 * 40) / 1000);
  });
});

describe("장부 재고 = 최초 실셈 + 입고 − 레시피 사용 + 실셈 차이", () => {
  const ins: StockIn[] = [{ date: "2026-09-03", materialId: "milk", qty: 12 }];
  const usage = [{ date: "2026-09-02", materialId: "milk", product: "카페라떼", part: "바리스타" as const, packs: 4.4, basis: "판매" as const }];
  it("뜯지 않은 개수 · 나눠 쓰는 중 표시 · 재고자산", () => {
    const r = stockLedger({ materials, ins, usage, upTo: "2026-09-05" }).find((x) => x.material.id === "milk")!;
    expect(r.book).toBeCloseTo(13 + 12 - 4.4);
    expect(r.onHand).toBe(20);
    expect(r.opened).toBe(true);
    expect(r.value).toBe(20 * 2000);
  });
  it("기준일 전 기록은 최초 실셈에 이미 들어 있으므로 뺌", () => {
    const r = stockLedger({ materials, ins: [{ date: "2026-08-30", materialId: "milk", qty: 12 }], upTo: "2026-09-05" }).find((x) => x.material.id === "milk")!;
    expect(r.book).toBe(13);
  });
});

describe("AI 안전재고 — 소비 속도 · 리드타임", () => {
  it("하루 평균 2개 · 흔들림 없음 · 리드타임 3일 → 6개", () => {
    const s = safetyStock(Array(28).fill(2), 3);
    expect(s.mean).toBe(2);
    expect(s.ai).toBe(6);
  });
  it("흔들리면 더 많이 (95% 안전)", () => {
    const s = safetyStock([0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4, 0, 4], 3);
    expect(s.mean).toBe(2);
    expect(s.ai!).toBeGreaterThan(6);
  });
  it("7일 미만 자료면 모름 (관리자 안전재고를 쓰라고)", () => {
    expect(safetyStock([1, 2, 3], 2).ai).toBeNull();
  });
  it("날짜별 사용량 — 쓰지 않은 날은 0", () => {
    const d = dailyUse([{ date: "2026-09-02", materialId: "milk", packs: 3 } as any], "milk", "2026-09-01", "2026-09-03");
    expect(d).toEqual([0, 3, 0]);
  });
});

describe("발주 필요량 — 안전재고 이하일 때 (MOQ · PKG 단위 · 최적 비용)", () => {
  it("우유: 재고 5 ≤ 안전 8 → 목표(안전 + 다음 발주까지 쓸 양)까지 PKG(12개) 단위로 올림", () => {
    const p = orderPlan({ material: materials[0], supplier: suppliers[0], onHand: 5, mean: 2, safety: 8, cycleDays: 7 });
    expect(p).not.toBeNull();
    // 목표 8 + 2 × 7 = 22 → 필요 17 → 2PKG(24개)
    expect(p!.pkgs).toBe(2);
    expect(p!.qty).toBe(24);
    expect(p!.cost).toBe(48000);
  });
  it("안전재고보다 많으면 발주 안 함", () => {
    expect(orderPlan({ material: materials[0], supplier: suppliers[0], onHand: 9, mean: 2, safety: 8, cycleDays: 7 })).toBeNull();
  });
  it("최소 공급(MOQ 2PKG)보다 적게는 안 삼", () => {
    const p = orderPlan({ material: materials[2], supplier: suppliers[1], onHand: 0, mean: 0.1, safety: 1, cycleDays: 3 });
    expect(p!.pkgs).toBe(2);
  });
  it("수량 할인이 있으면 넘치는 양이 14일 쓸 양 안일 때만 더 사서 1개 값이 싼 쪽", () => {
    // 하루 0.3포대: 필요 4포대 → 5포대 할인(36,000)으로 1포대 더 (3.3일치) → 할인 선택
    const p = orderPlan({ material: materials[2], supplier: suppliers[1], onHand: 1, mean: 0.3, safety: 2, cycleDays: 7 });
    expect(p!.pkgs).toBe(5);
    expect(p!.pkgPrice).toBe(36000);
    expect(p!.why).toMatch(/할인/);
    // 하루 0.01포대면 더 산 양이 너무 많아 할인 안 고름
    const q = orderPlan({ material: materials[2], supplier: suppliers[1], onHand: 0, mean: 0.01, safety: 1, cycleDays: 7 });
    expect(q!.pkgs).toBe(2);
  });
});

describe("실셈 차이 — − 면 레시피 재검증 (+ 필요하면 추가 발주), + 면 절약 코드로 자산 다시 올림", () => {
  const count: StockCount = {
    date: "2026-09-10",
    confirmed: true,
    lines: [
      { materialId: "milk", system: 20, counted: 16 },
      { materialId: "bean", system: 3, counted: 4 },
      { materialId: "egg", system: 2, counted: 2 },
    ],
  };
  const c = countCheck(count, materials, { milk: 18 });
  it("부족(−4) → 과사용 · 레시피 재검증 · 안전재고(18) 아래라 추가 발주 필요", () => {
    const m = c.find((x) => x.materialId === "milk")!;
    expect(m.kind).toBe("과사용");
    expect(m.recheckRecipe).toBe(true);
    expect(m.needOrder).toBe(true);
    expect(m.amount).toBe(-8000);
  });
  it("남음(+1) → 절약 코드 · 자산 다시 올림 금액", () => {
    const b = countCheck(count, materials, {}).find((x) => x.materialId === "bean")!;
    expect(b.kind).toBe("절약");
    expect(b.code).toBe("절약");
    expect(b.amount).toBe(30000);
  });
  it("같으면 목록에 없음", () => {
    expect(c.find((x) => x.materialId === "egg")).toBeUndefined();
  });
  it("확정한 실셈 차이는 장부에 들어감 (−4 · +1)", () => {
    const rows = stockLedger({ materials, counts: [count], upTo: "2026-09-10" });
    expect(rows.find((r) => r.material.id === "milk")!.adjust).toBe(-4);
    expect(rows.find((r) => r.material.id === "bean")!.adjust).toBe(1);
  });
});

describe("하루 재고 보고 — 장부 · 안전재고(관리자 값이 이김) · 발주", () => {
  const master = { suppliers, materials: materials.map((m) => (m.id === "egg" ? { ...m, safetyManual: 5 } : m)), recipes };
  const usage = Array.from({ length: 10 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, materialId: "milk", product: "카페라떼", part: "바리스타" as const, packs: 1, basis: "판매" as const }));
  const rep = stockReport({ master, ins: [], counts: [], usage, upTo: "2026-09-10" });
  it("우유: 하루 1개 · 리드타임 1일 → AI 안전재고 1, 재고 3 이면 발주 없음", () => {
    const m = rep.find((r) => r.material.id === "milk")!;
    expect(m.onHand).toBe(3);
    expect(m.ai).toBe(1);
    expect(m.order).toBeNull();
  });
  it("계란: 관리자 안전재고 5 > 재고 3 → 발주", () => {
    const e = rep.find((r) => r.material.id === "egg")!;
    expect(e.safety).toBe(5);
    expect(e.order).not.toBeNull();
  });
  it("장부가 − 이면 표시 (레시피 재검증)", () => {
    const neg = stockReport({ master, ins: [], counts: [], usage: [{ ...usage[0], packs: 20 }], upTo: "2026-09-10" });
    expect(neg.find((r) => r.material.id === "milk")!.negative).toBe(true);
  });
});

describe("레시피에 고를 판매 상품 — B 보고의 상품 줄에서", () => {
  it("이름 하나로 · 많이 팔린 순 · 분류(섹터) 같이", async () => {
    const { productList } = await import("../src");
    const l = productList([
      { products: [["카페라떼", "바리스타", 10, 50000], ["크루아상", "베이커리", 3, 12000]] },
      { products: [["카페 라떼", "바리스타", 5, 25000]] },
    ]);
    expect(l[0]).toEqual({ name: "카페라떼", sector: "바리스타", qty: 15 });
    expect(l[1].sector).toBe("베이커리");
  });
});

describe("E 가 쓰는 재고 장부 문서 · F 알림", () => {
  it("장부 문서: 원재료마다 숫자만 · 발주 줄 · 상품 목록", async () => {
    const { ledgerDoc, stockReport } = await import("../src");
    const rep = stockReport({ master: { suppliers, materials, recipes }, ins: [], counts: [], usage: [], upTo: "2026-09-10" });
    const d = ledgerDoc(rep, [{ name: "카페라떼", sector: "바리스타", qty: 3 }], "2026-09-10", "2026-09-11T01:00:00Z");
    expect(d.rows.find((r) => r.id === "milk")).toMatchObject({ onHand: 13, unit: "1L", safety: 0 });
    expect(d.products[0].name).toBe("카페라떼");
  });
  it("하루 한 번 발주 알림 (같은 날 두 번 만들지 않음) · 장부 − 알림", async () => {
    const { alertsFor } = await import("../src");
    const order = { materialId: "milk", name: "우유", supplierId: "s-milk", need: 17, pkgs: 2, qty: 24, pkgPrice: 24000, cost: 48000, vat: 4800, why: "안전재고" };
    const doc = { v: 1 as const, at: "t", upTo: "2026-09-10", rows: [{ id: "egg", name: "계란", negative: true } as any], orders: [order], products: [] };
    const a = alertsFor(doc, suppliers, []);
    expect(a.map((x) => x.id)).toEqual(["order-2026-09-10", "negative-2026-09-10"]);
    expect(a[0].title).toBe("발주 필요 1건");
    expect(a[0].lines[0]).toMatch(/우유 거래처/);
    expect(a[1].lines[0]).toMatch(/계란/);
    expect(alertsFor(doc, suppliers, ["order-2026-09-10", "negative-2026-09-10"])).toEqual([]);
  });
  it("실셈 알림: 과사용(레시피 재검증 · 추가 발주) · 절약", async () => {
    const { countAlert } = await import("../src");
    const a = countAlert("2026-09-10", [
      { materialId: "milk", name: "우유", diff: -4, amount: -8000, kind: "과사용", recheckRecipe: true, needOrder: true, code: null },
      { materialId: "bean", name: "원두", diff: 1, amount: 30000, kind: "절약", recheckRecipe: false, needOrder: false, code: "절약" },
    ]);
    expect(a.id).toBe("count-2026-09-10");
    expect(a.lines.join("\n")).toMatch(/우유 −4 · 레시피 재검증 · 추가 발주 필요/);
    expect(a.lines.join("\n")).toMatch(/원두 \+1 · 절약 코드로 30,000원 자산 다시 올림/);
  });
});

describe("사용량 쌓아 두기 (E 가 지난 날을 다시 읽지 않게)", () => {
  it("날짜 · 원재료별 합 → 다시 장부 계산에 써도 같은 결과", async () => {
    const { sumUsage, usageFromCache } = await import("../src");
    const rows = recipeUsage({ recipes, materials, sold: [{ date: "2026-09-02", name: "카페라떼", qty: 10 }, { date: "2026-09-03", name: "카페라떼", qty: 5 }] });
    const cache = sumUsage(rows);
    expect(cache["2026-09-02"].milk).toBeCloseTo(2);
    const a = stockLedger({ materials, usage: rows, upTo: "2026-09-05" });
    const b = stockLedger({ materials, usage: usageFromCache(cache), upTo: "2026-09-05" });
    expect(b.map((r) => r.book)).toEqual(a.map((r) => r.book));
  });
});
