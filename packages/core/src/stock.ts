/* ============================================================
   재고 (통합 Ver.2.0 — E 재고추적관리 시스템 · E-1 재고 관리 및 설정 · F 발주app)
   계산은 astana packages/domain/src/inventory.ts 를 옮겨 씀 (같은 단위 · PKG · 부가세 · 레시피 이력 · 장부)
   - 공급단위: 창고에서 꺼내 쓰는 가장 작은 단위 (1L 병 · 20kg 포대). 재고는 이 개수로 셈
   - PKG 단위: 공급처에서 살 수 있는 최소 묶음에 든 공급단위 개수 (12EA). PKG 단가 = 그 묶음 공급가(부가세 별도)
   - 레시피는 g · ml · 개로 적고 공급단위로 환산해 뺌 (1L 에 30ml = 0.03개)
       베이커리 = 그날 D 확정 생산량 × 레시피 (생산량이 없는 날은 판매) · 그 밖(바리스타 · 키친 · 기타) = B 영수증 판매 수량 × 레시피
   - 장부 재고 = 최초 실셈 + 입고(창고 입구) − 레시피 사용 + 실셈 차이. 보이는 재고 = 뜯지 않은 개수(정수)
   - AI 안전재고 = 하루 평균 소비 × 리드타임 + 1.65 × 흔들림 × √리드타임 (95%) — 관리자가 적은 안전재고가 있으면 그것
   - 안전재고 이하 → 발주 필요량 = 안전재고 + 다음 발주까지 쓸 양 − 지금 재고 → PKG 단위로 올림, 최소 공급(MOQ) 이상,
     수량 할인은 더 사는 양이 14일 쓸 양 안일 때만 1개 값이 싼 쪽 (최적 비용)
   - 실셈 차이: − 과사용 → 레시피 재검증 (+ 안전재고 아래면 추가 발주) · + 절약 → '절약' 코드로 자산 다시 올림
   ============================================================ */

const toNum = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const num = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString("ko-KR");
const EPS = 1e-9;
const plusDays = (key: string, n: number) => new Date(Date.parse(key + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

/* ---------- 단위 ---------- */
export type UnitFamily = "무게" | "부피" | "개수";
export interface StockUnit {
  unit: string;
  family: UnitFamily;
  /** 레시피에 적는 단위 (kg → g, L → ml) */
  use: string;
  /** 이 단위 1 = factor × use */
  factor: number;
}
const COUNT_UNITS = ["개", "팩", "병", "캔", "봉", "박스", "포대", "통", "판", "롤", "장", "묶음", "단", "망", "세트", "케이스"];
export const STOCK_UNITS: StockUnit[] = [
  { unit: "kg", family: "무게", use: "g", factor: 1000 },
  { unit: "g", family: "무게", use: "g", factor: 1 },
  { unit: "L", family: "부피", use: "ml", factor: 1000 },
  { unit: "ml", family: "부피", use: "ml", factor: 1 },
  ...COUNT_UNITS.map((unit) => ({ unit, family: "개수" as const, use: unit, factor: 1 })),
];
export const unitInfo = (u?: string | null): StockUnit => STOCK_UNITS.find((x) => x.unit === u) || { unit: u || "개", family: "개수", use: u || "개", factor: 1 };

/* ---------- 공급처 · 원재료 ---------- */
export interface Supplier {
  id: string;
  name: string;
  /** 발주 → 입고 일수 */
  leadDays?: number | null;
  /** 발주하는 요일 (0=일 … 6=토). 비우면 아무 날 */
  orderDays?: number[] | null;
  /** 최소 주문금액 (공급가) */
  minOrderAmount?: number | null;
  contact?: string | null;
  memo?: string | null;
}

export interface Material {
  id: string;
  name: string;
  supplierId?: string | null;
  /** 공급단위 수치 · 단위 (1 · L) */
  packSize?: number | null;
  packUnit?: string | null;
  /** PKG 단위 (공급 기준 — 최소 묶음에 든 공급단위 개수) */
  pkgQty?: number | null;
  /** PKG 단가 (공급단가, 부가세 별도) */
  pkgPrice?: number | null;
  vatFree?: boolean | null;
  /** 최소 공급 PKG 수 (MOQ) — 비우면 1 */
  moqPkgs?: number | null;
  /** 수량 할인 — minPkgs PKG 부터 그 PKG 단가 */
  tiers?: { minPkgs: number; pkgPrice: number }[] | null;
  /** 관리자 변경 안전재고 (공급단위 개수) — 비우면 AI 안전재고 */
  safetyManual?: number | null;
  /** 최초 실셈 (공급단위 개수) · 그 날 */
  initialStock: number;
  asOf?: string | null;
  storage?: string | null;
  desc?: string | null;
}

export type Pack = { packSize?: number | null; packUnit?: string | null };
export const packSizeOf = (m: Pack) => (toNum(m?.packSize) > 0 ? toNum(m.packSize) : 1);
export const packUnitOf = (m: Pack) => m?.packUnit || "개";
/** 레시피 단위 (g · ml · 개) */
export const useUnitOf = (m: Pack) => unitInfo(packUnitOf(m)).use;
/** 공급단위 1개에 든 양 (레시피 단위) — 1L = 1000ml */
export const usePerPack = (m: Pack) => packSizeOf(m) * unitInfo(packUnitOf(m)).factor;
/** "1L" · "20kg" · "30개들이" · "포대" */
export function packLabel(m: Pack) {
  const u = unitInfo(packUnitOf(m));
  const size = packSizeOf(m);
  if (u.family !== "개수") return `${num(size)}${u.unit}`;
  return size === 1 ? u.unit : `${num(size)}${u.unit}들이`;
}
export const countWordOf = (m: Pack) => (unitInfo(packUnitOf(m)).family === "개수" && packSizeOf(m) === 1 ? packUnitOf(m) : "개");
/** "13개 (1L)" · "5포대" */
export function stockText(m: Pack, n: number) {
  const word = countWordOf(m);
  const label = packLabel(m);
  return word === label ? `${num(n)}${word}` : `${num(n)}${word} (${label})`;
}

type Pkg = { pkgQty?: number | null; pkgPrice?: number | null };
export const pkgQtyOf = (m?: Pkg | null) => (toNum(m?.pkgQty) >= 1 ? toNum(m!.pkgQty) : 1);
export const pkgPriceOf = (m?: Pkg | null) => toNum(m?.pkgPrice);
/** 1개 단가 = PKG 단가 ÷ PKG 단위 */
export const unitCostOf = (m?: Pkg | null) => pkgPriceOf(m) / pkgQtyOf(m);
/** 29개 (12EA) → "2PKG + 5개" */
export function pkgSplitText(m: Pack & Pkg, n: number): string | null {
  const q = pkgQtyOf(m);
  if (q <= 1 || !Number.isFinite(n)) return null;
  const whole = Math.floor((n + EPS) / q);
  if (!whole) return null;
  const rest = Math.round((n - whole * q) * 1000) / 1000;
  return rest > EPS ? `${whole}PKG + ${num(rest)}${countWordOf(m)}` : `${whole}PKG`;
}

export const VAT_RATE = 0.1;
/** 부가세 = 공급가 × 10% (원 미만 버림), 면세면 0 */
export const vatAmount = (price: unknown, vatFree?: boolean | null) => (vatFree ? 0 : Math.floor(toNum(price) * VAT_RATE));

/* ---------- 레시피 ---------- */
export interface RecipeItem {
  materialId: string;
  /** 상품 1개에 쓰는 양 (g · ml · 개) */
  qty: number;
}
/** 파트 = B 의 섹터 (바리스타 · 베이커리 · 키친 · 기타) — 베이커리는 D 생산량으로 뺌 */
export type StockPart = "바리스타" | "베이커리" | "키친" | "기타";
export interface Recipe {
  /** B 상품명 (띄어쓰기 · 대소문자 무시하고 맞춤) */
  product: string;
  part?: StockPart | null;
  items: RecipeItem[];
  /** 고치기 전 레시피 (until 날까지는 그때 양으로 — 지난 장부가 바뀌지 않게) */
  history?: { until: string; items: RecipeItem[] }[] | null;
}
export const productKey = (s?: string | null) => String(s || "").replace(/\s+/g, "").toLowerCase();
export function recipeItemsOn(r: Recipe, date: string): RecipeItem[] {
  for (const h of r?.history || []) if (h && date <= h.until) return h.items || [];
  return r?.items || [];
}
/** 레시피 1개분 원가 (원) */
export function recipeCost(r: Recipe, materials: Material[]) {
  const byId = new Map(materials.map((m) => [m.id, m]));
  let sum = 0;
  for (const it of r?.items || []) {
    const m = byId.get(it.materialId);
    if (m) sum += (toNum(it.qty) / usePerPack(m)) * unitCostOf(m);
  }
  return sum;
}

/* ---------- 판매 · 생산 → 레시피 사용 ---------- */
export interface SoldLine {
  date: string;
  name: string;
  qty: number;
}
/** B 영수증 줄(lines/{날짜}_{매장}) → 상품명별 판매 수량 (띄어쓰기만 다른 이름은 하나로) */
export function soldFromLines(date: string, lines: { name: string; qty: number }[]): SoldLine[] {
  const m = new Map<string, SoldLine>();
  for (const l of lines || []) {
    const k = productKey(l?.name);
    if (!k) continue;
    const s = m.get(k) || { date, name: l.name, qty: 0 };
    s.qty += toNum(l.qty);
    m.set(k, s);
  }
  return [...m.values()];
}
/** 그날 베이커리 생산 (D 확정 수량) */
export interface Production {
  date: string;
  items: { product: string; qty: number }[];
}
export interface UsageRow {
  date: string;
  materialId: string;
  product: string;
  part: StockPart;
  /** 쓴 양 (공급단위) */
  packs: number;
  basis: "판매" | "생산";
}
export function recipeUsage(opts: { recipes: Recipe[]; materials: Material[]; sold: SoldLine[]; production?: Production[] }): UsageRow[] {
  const mats = new Map(opts.materials.map((m) => [m.id, m]));
  const recipes = new Map(opts.recipes.map((r) => [productKey(r.product), r]));
  const partOf = (r: Recipe): StockPart => r.part || "기타";
  const prodDays = new Map<string, Map<string, number>>();
  for (const p of opts.production || []) {
    const m = prodDays.get(p.date) || new Map<string, number>();
    for (const it of p.items || []) m.set(productKey(it.product), (m.get(productKey(it.product)) || 0) + toNum(it.qty));
    prodDays.set(p.date, m);
  }
  const out: UsageRow[] = [];
  const use = (date: string, r: Recipe, qty: number, basis: UsageRow["basis"]) => {
    if (!(qty > 0)) return;
    for (const it of recipeItemsOn(r, date)) {
      const m = mats.get(it.materialId);
      if (m) out.push({ date, materialId: it.materialId, product: r.product, part: partOf(r), packs: (toNum(it.qty) * qty) / usePerPack(m), basis });
    }
  };
  for (const s of opts.sold || []) {
    const r = recipes.get(productKey(s.name));
    if (!r) continue;
    if (partOf(r) === "베이커리" && prodDays.has(s.date)) continue; // 그날은 D 생산량으로
    use(s.date, r, toNum(s.qty), "판매");
  }
  for (const [date, m] of prodDays)
    for (const [key, qty] of m) {
      const r = recipes.get(key);
      if (r && partOf(r) === "베이커리") use(date, r, qty, "생산");
    }
  return out;
}

/* ---------- 입고 · 실셈 · 장부 ---------- */
/** 창고 입구 입고 한 줄 (공급단위 개수) */
export interface StockIn {
  date: string;
  materialId: string;
  qty: number;
  /** 그때 PKG 단가 (단가 추이) */
  pkgPrice?: number | null;
  by?: string | null;
}
export interface StockCountLine {
  materialId: string;
  /** 실셈 때 장부상 보이는 재고 */
  system: number;
  /** 실셈 수량 (비우면 안 셈) */
  counted: number | null;
}
export interface StockCount {
  date: string;
  lines: StockCountLine[];
  /** 확정해야 장부에 들어감 */
  confirmed?: boolean;
  by?: string | null;
}
export const countDiff = (l: StockCountLine) => (l && l.counted != null && Number.isFinite(Number(l.counted)) ? toNum(l.counted) - toNum(l.system) : 0);

export interface StockRow {
  material: Material;
  initial: number;
  inQty: number;
  used: number;
  adjust: number;
  /** 장부 재고 (소수 · − 가능) */
  book: number;
  /** 보이는 재고 = 뜯지 않은 개수 */
  onHand: number;
  opened: boolean;
  /** 재고자산 = 보이는 재고 × 1개 단가 */
  value: number;
}
/** 원재료별 장부 재고 (upTo 날 끝). 최초 실셈 날(asOf) 전 기록은 빼고 */
export function stockLedger(opts: { materials: Material[]; ins?: StockIn[]; usage?: UsageRow[]; counts?: StockCount[]; upTo?: string }): StockRow[] {
  const upTo = opts.upTo || "9999-12-31";
  const asOf = new Map(opts.materials.map((m) => [m.id, m.asOf || ""]));
  const ok = (id: string, date: string) => asOf.has(id) && date >= (asOf.get(id) || "") && date <= upTo;
  const acc = new Map<string, { in: number; used: number; adj: number }>();
  const box = (id: string) => acc.get(id) || (acc.set(id, { in: 0, used: 0, adj: 0 }), acc.get(id)!);
  for (const i of opts.ins || []) if (ok(i.materialId, i.date)) box(i.materialId).in += toNum(i.qty);
  for (const u of opts.usage || []) if (ok(u.materialId, u.date)) box(u.materialId).used += u.packs;
  for (const c of opts.counts || []) {
    if (!c?.confirmed) continue;
    for (const l of c.lines || []) if (ok(l.materialId, c.date)) box(l.materialId).adj += countDiff(l);
  }
  return opts.materials.map((m) => {
    const a = acc.get(m.id) || { in: 0, used: 0, adj: 0 };
    const initial = m.asOf && m.asOf > plusDays(upTo, 1) ? 0 : toNum(m.initialStock);
    const book = initial + a.in - a.used + a.adj;
    const onHand = Math.max(0, Math.floor(book + EPS));
    return { material: m, initial, inQty: a.in, used: a.used, adjust: a.adj, book, onHand, opened: book > EPS && book - Math.floor(book + EPS) > 1e-6, value: onHand * unitCostOf(m) };
  });
}

/* ---------- AI 안전재고 ---------- */
/** 원재료 하나의 날짜별 사용량 (from ~ to, 쓰지 않은 날 0) */
export function dailyUse(usage: Pick<UsageRow, "date" | "materialId" | "packs">[], materialId: string, from: string, to: string): number[] {
  const by = new Map<string, number>();
  for (const u of usage) if (u.materialId === materialId) by.set(u.date, (by.get(u.date) || 0) + u.packs);
  const out: number[] = [];
  for (let d = from; d <= to; d = plusDays(d, 1)) out.push(by.get(d) || 0);
  return out;
}
/** 안전재고 (공급단위) = 하루 평균 × 리드타임 + z × 흔들림 × √리드타임. 7일 미만 자료면 null */
export function safetyStock(daily: number[], leadDays: number, z = 1.65): { mean: number; sd: number; ai: number | null } {
  const n = daily.length;
  const mean = n ? daily.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n ? Math.sqrt(daily.reduce((a, b) => a + (b - mean) ** 2, 0) / n) : 0;
  if (n < 7) return { mean, sd, ai: null };
  const L = Math.max(1, toNum(leadDays) || 1);
  return { mean, sd, ai: Math.max(0, Math.ceil(mean * L + z * sd * Math.sqrt(L) - EPS)) };
}
/** 다음 발주부터 그다음 발주까지 날 수 (발주 요일이 없으면 7일) */
export function orderCycleDays(s: Supplier | null | undefined, today: string): number {
  const days = (s?.orderDays || []).filter((d) => d >= 0 && d <= 6);
  if (!days.length) return 7;
  const dow = (k: string) => new Date(k + "T00:00:00Z").getUTCDay();
  const next: string[] = [];
  for (let i = 0; i < 15 && next.length < 2; i++) {
    const k = plusDays(today, i);
    if (days.includes(dow(k))) next.push(k);
  }
  return next.length < 2 ? 7 : (Date.parse(next[1]) - Date.parse(next[0])) / 86400000;
}

/* ---------- 발주 필요량 ---------- */
export interface BuyLine {
  materialId: string;
  name: string;
  supplierId: string | null;
  /** 필요한 양 (공급단위) */
  need: number;
  pkgs: number;
  /** 들어올 양 (공급단위) = pkgs × PKG 단위 */
  qty: number;
  pkgPrice: number;
  /** 공급가 합 · 부가세 */
  cost: number;
  vat: number;
  why: string;
}
/** 안전재고 이하이면 발주 한 줄 (아니면 null) */
export function orderPlan(o: { material: Material; supplier?: Supplier | null; onHand: number; mean: number; safety: number; cycleDays: number; maxExtraDays?: number }): BuyLine | null {
  const m = o.material;
  if (o.onHand > o.safety + EPS) return null;
  const q = pkgQtyOf(m);
  const moq = Math.max(1, Math.round(toNum(m.moqPkgs) || 1));
  const target = o.safety + o.mean * o.cycleDays;
  const need = Math.max(0, target - o.onHand);
  let pkgs = Math.max(moq, Math.ceil(need / q - EPS), 1);
  const why = [`안전재고 ${num(o.safety)} 이하 (지금 ${num(o.onHand)})`];
  if (pkgs === moq && moq > 1 && Math.ceil(need / q - EPS) < moq) why.push(`최소 공급 ${moq}PKG`);
  // 수량 할인 — 이미 해당하면 그 값, 조금 더 사서 1개 값이 싸지면 (더 사는 양이 maxExtraDays 일 쓸 양 안일 때만)
  const tiers = (m.tiers || []).filter((t) => t && t.minPkgs > 0 && t.pkgPrice > 0).sort((a, b) => a.minPkgs - b.minPkgs);
  const priceAt = (n: number) => tiers.filter((t) => t.minPkgs <= n).reduce((p, t) => Math.min(p, t.pkgPrice), pkgPriceOf(m) || Infinity);
  let price = priceAt(pkgs);
  const maxExtra = o.maxExtraDays ?? 14;
  for (const t of tiers) {
    if (t.minPkgs <= pkgs) continue;
    const extra = t.minPkgs * q - need;
    const days = o.mean > EPS ? extra / o.mean : Infinity;
    if (days <= maxExtra && priceAt(t.minPkgs) < price) {
      why.push(`수량 할인 ${t.minPkgs}PKG 부터 ${t.pkgPrice.toLocaleString("ko-KR")}원 (더 사는 양 ${Math.round(days * 10) / 10}일치)`);
      pkgs = t.minPkgs;
      price = priceAt(pkgs);
    }
  }
  if (!Number.isFinite(price)) price = 0;
  const cost = pkgs * price;
  return { materialId: m.id, name: m.name, supplierId: m.supplierId || null, need, pkgs, qty: pkgs * q, pkgPrice: price, cost, vat: vatAmount(cost, m.vatFree), why: why.join(" · ") };
}

/** 공급처별로 묶음 — 최소 주문금액이 안 되면 알림 */
export function ordersBySupplier(lines: BuyLine[], suppliers: Supplier[]): { supplier: Supplier | null; lines: BuyLine[]; total: number; short: number }[] {
  const by = new Map<string, BuyLine[]>();
  for (const l of lines) by.set(l.supplierId || "", [...(by.get(l.supplierId || "") || []), l]);
  return [...by].map(([id, ls]) => {
    const supplier = suppliers.find((s) => s.id === id) || null;
    const total = ls.reduce((a, l) => a + l.cost, 0);
    return { supplier, lines: ls, total, short: Math.max(0, toNum(supplier?.minOrderAmount) - total) };
  });
}

/* ---------- 실셈 차이 ---------- */
export interface CountResult {
  materialId: string;
  name: string;
  /** 실셈 − 장부 (공급단위) */
  diff: number;
  /** 차이 금액 (공급가) — − 과사용 / + 절약 */
  amount: number;
  kind: "과사용" | "절약";
  /** 과사용: 레시피 재검증 필요 */
  recheckRecipe: boolean;
  /** 과사용이고 실셈이 안전재고 이하 → 추가 발주 */
  needOrder: boolean;
  /** 절약: 자산을 다시 올리는 코드 */
  code: "절약" | null;
}
/** 실셈 결과 → 과사용(레시피 재검증 · 추가 발주) / 절약(절약 코드로 자산 다시 올림). 같은 줄은 뺌 */
export function countCheck(count: StockCount, materials: Material[], safetyById: Record<string, number>): CountResult[] {
  const byId = new Map(materials.map((m) => [m.id, m]));
  const out: CountResult[] = [];
  for (const l of count.lines || []) {
    const m = byId.get(l.materialId);
    if (!m || l.counted == null) continue;
    const diff = countDiff(l);
    if (Math.abs(diff) < EPS) continue;
    const over = diff < 0;
    const safety = safetyById[l.materialId];
    out.push({
      materialId: m.id,
      name: m.name,
      diff,
      amount: Math.round(diff * unitCostOf(m)),
      kind: over ? "과사용" : "절약",
      recheckRecipe: over,
      needOrder: over && safety != null && toNum(l.counted) <= safety,
      code: over ? null : "절약",
    });
  }
  return out.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

/* ---------- 하루 재고 보고 (E 매일 계산 · E-1 화면 · F 알림이 같이 씀) ---------- */
export interface StockMaster {
  suppliers: Supplier[];
  materials: Material[];
  recipes: Recipe[];
}
export interface StockReportRow extends StockRow {
  mean: number;
  /** AI 안전재고 (자료 부족이면 null) · 관리자 안전재고 · 쓰는 값 */
  ai: number | null;
  manual: number | null;
  safety: number | null;
  order: BuyLine | null;
  /** 장부가 − (레시피보다 더 쓰였거나 입고 누락) */
  negative: boolean;
}
/** upTo 날 끝 기준 재고 · 안전재고 · 발주 필요 (소비 속도는 그 전 days 일) */
export function stockReport(o: { master: StockMaster; ins: StockIn[]; counts: StockCount[]; usage: UsageRow[]; upTo: string; days?: number }): StockReportRow[] {
  const days = o.days || 28;
  const from = plusDays(o.upTo, -(days - 1));
  const rows = stockLedger({ materials: o.master.materials, ins: o.ins, usage: o.usage, counts: o.counts, upTo: o.upTo });
  return rows.map((r) => {
    const m = r.material;
    const sup = o.master.suppliers.find((s) => s.id === m.supplierId) || null;
    const start = m.asOf && m.asOf > from ? m.asOf : from;
    const s = safetyStock(start <= o.upTo ? dailyUse(o.usage, m.id, start, o.upTo) : [], toNum(sup?.leadDays) || 1);
    const manual = m.safetyManual != null && String(m.safetyManual) !== "" ? toNum(m.safetyManual) : null;
    const safety = manual ?? s.ai;
    const order = safety == null ? null : orderPlan({ material: m, supplier: sup, onHand: r.onHand, mean: s.mean, safety, cycleDays: orderCycleDays(sup, plusDays(o.upTo, 1)) });
    return { ...r, mean: s.mean, ai: s.ai, manual, safety, order, negative: r.book < -EPS };
  });
}

/** B 보고의 상품 줄([이름, 분류, 수량, 매출]) → 레시피에 고를 판매 상품 목록 (많이 팔린 순, 띄어쓰기만 다른 이름은 하나로) */
export function productList(parts: { products: [string, string, number, number][] }[]): { name: string; sector: string; qty: number }[] {
  const m = new Map<string, { name: string; sector: string; qty: number }>();
  for (const p of parts)
    for (const [name, sector, qty] of p?.products || []) {
      const k = productKey(name);
      if (!k) continue;
      const x = m.get(k) || { name, sector: String(sector), qty: 0 };
      x.qty += toNum(qty);
      m.set(k, x);
    }
  return [...m.values()].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, "ko"));
}

/* ---------- E 가 쓰는 장부 문서 (inv/ledger) · F 알림 (alerts/{id}) ---------- */
export interface LedgerRow {
  id: string;
  name: string;
  supplierId: string | null;
  /** 공급단위 표시 (1L) · 세는 말 */
  unit: string;
  word: string;
  onHand: number;
  book: number;
  opened: boolean;
  value: number;
  /** 하루 평균 소비 (공급단위) */
  mean: number;
  ai: number | null;
  manual: number | null;
  safety: number | null;
  negative: boolean;
}
export interface LedgerDoc {
  v: 1;
  /** 계산한 시각 · 기준일(그날 끝) */
  at: string;
  upTo: string;
  rows: LedgerRow[];
  orders: BuyLine[];
  /** 레시피에 고를 B 판매 상품 */
  products: { name: string; sector: string; qty: number }[];
}
export function ledgerDoc(rep: StockReportRow[], products: LedgerDoc["products"], upTo: string, at: string): LedgerDoc {
  const r1 = (n: number) => Math.round(n * 1000) / 1000;
  return {
    v: 1,
    at,
    upTo,
    rows: rep.map((r) => ({
      id: r.material.id,
      name: r.material.name,
      supplierId: r.material.supplierId || null,
      unit: packLabel(r.material),
      word: countWordOf(r.material),
      onHand: r.onHand,
      book: r1(r.book),
      opened: r.opened,
      value: Math.round(r.value),
      mean: r1(r.mean),
      ai: r.ai,
      manual: r.manual,
      safety: r.safety,
      negative: r.negative,
    })),
    orders: rep.map((r) => r.order).filter((o): o is BuyLine => !!o),
    products,
  };
}

export interface StockAlert {
  /** order-날짜 · negative-날짜 · count-날짜 (같은 날 두 번 만들지 않음) */
  id: string;
  at: string;
  kind: "order" | "negative" | "count";
  title: string;
  lines: string[];
  orders?: BuyLine[];
  /** F 에서 읽은 시각 (안 읽었으면 null) · 푸시 보낸 시각 */
  readAt?: string | null;
  pushedAt?: string | null;
}
const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
/** 장부 문서 → 새 알림 (이미 있는 id 는 빼고): 발주 필요 · 장부 − (레시피 재검증) */
export function alertsFor(doc: LedgerDoc, suppliers: Supplier[], existing: string[]): StockAlert[] {
  const out: StockAlert[] = [];
  if (doc.orders.length)
    out.push({
      id: `order-${doc.upTo}`,
      at: doc.at,
      kind: "order",
      title: `발주 필요 ${doc.orders.length}건`,
      lines: ordersBySupplier(doc.orders, suppliers).flatMap((g) => [
        `${g.supplier?.name || "공급처 미지정"} — ${won(g.total)}${g.short > 0 ? ` (최소 주문금액까지 ${won(g.short)} 모자람)` : ""}`,
        ...g.lines.map((l) => `· ${l.name} ${l.pkgs}PKG (${num(l.qty)}개) ${won(l.cost)} — ${l.why}`),
      ]),
      orders: doc.orders,
      readAt: null,
    });
  const neg = doc.rows.filter((r) => r.negative);
  if (neg.length)
    out.push({
      id: `negative-${doc.upTo}`,
      at: doc.at,
      kind: "negative",
      title: `장부 재고가 − 인 원재료 ${neg.length}개 — 레시피 재검증`,
      lines: neg.map((r) => `· ${r.name}: 레시피보다 더 쓰였거나 입고 기록이 빠졌을 수 있음 → 레시피 · 입고 확인, 필요하면 실셈`),
      readAt: null,
    });
  return out.filter((a) => !existing.includes(a.id));
}
/** 실셈 확정 → 알림 (과사용: 레시피 재검증 · 추가 발주 / 절약: 절약 코드로 자산 다시 올림) */
export function countAlert(date: string, res: CountResult[], at = new Date().toISOString()): StockAlert {
  const over = res.filter((r) => r.kind === "과사용");
  const saved = res.filter((r) => r.kind === "절약");
  return {
    id: `count-${date}`,
    at,
    kind: "count",
    title: `실셈 ${date} — 과사용 ${over.length} · 절약 ${saved.length}`,
    lines: [
      ...over.map((r) => `${r.name} −${num(-r.diff)} · 레시피 재검증${r.needOrder ? " · 추가 발주 필요" : ""} (${won(-r.amount)})`),
      ...saved.map((r) => `${r.name} +${num(r.diff)} · 절약 코드로 ${won(r.amount)} 자산 다시 올림`),
    ],
    readAt: null,
  };
}

/* ---------- 사용량 쌓아 두기 (invUse/{YYYY-MM} = { 날짜: { 원재료: 공급단위 } }) — E 가 지난 날을 다시 읽지 않게 ---------- */
export type UseCache = Record<string, Record<string, number>>;
/** 레시피 사용 줄 → 날짜 · 원재료별 합 */
export function sumUsage(rows: Pick<UsageRow, "date" | "materialId" | "packs">[]): UseCache {
  const out: UseCache = {};
  for (const r of rows) {
    const d = (out[r.date] ||= {});
    d[r.materialId] = Math.round(((d[r.materialId] || 0) + r.packs) * 1e6) / 1e6;
  }
  return out;
}
/** 쌓아 둔 합 → 장부 계산용 사용 줄 */
export function usageFromCache(cache: UseCache): UsageRow[] {
  const out: UsageRow[] = [];
  for (const [date, m] of Object.entries(cache)) for (const [materialId, packs] of Object.entries(m)) out.push({ date, materialId, product: "", part: "기타", packs, basis: "판매" });
  return out;
}
