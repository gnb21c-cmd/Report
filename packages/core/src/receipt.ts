/* ============================================================
   영수증별 매출 상세현황 엑셀 읽기 — OK포스 백오피스(nice.okpos.co.kr)에서 매장별로 받은 하루치
   - 쓰는 칸: 포스번호 · 영수증번호 · 구분(매출/반품) · 최초주문 · 상품명 · 수량 · 총매출액 · 할인액 · 실매출액
     안 쓰는 칸: 테이블명 · 결제시각 · 상품코드 · 바코드 · ERP 매핑코드 · 비고 (할인구분 · 가액 · 부가세도)
   - 같은 포스번호 + 같은 영수증번호 = 한 팀 (포스 01 = 메인, 02 = 서브)
   - 반품은 새 영수증번호로 찍힘 → 앞서 판 영수증에서 같은 상품을 찾아 지움 (removeRefunds)
   엑셀 파일 자체는 A 화면이 칸 값 목록(행 × 칸)으로 바꿔서 넘김 (apps/entry)
   ============================================================ */

export interface ReceiptLine {
  /** 포스번호 '01' · '02' */
  pos: string;
  /** 영수증번호 '0001' */
  receipt: string;
  /** 구분 = 반품 */
  refund: boolean;
  /** 최초주문 시각 'HH:MM:SS' (없으면 '') */
  time: string;
  name: string;
  qty: number;
  gross: number;
  discount: number;
  net: number;
}

export interface ReceiptSheet {
  /** 조회일자 (하루치면 from = to) */
  from: string | null;
  to: string | null;
  lines: ReceiptLine[];
  /** 엑셀 합계 줄 (검산용) */
  sheetNet: number | null;
  sheetQty: number | null;
}

export class SheetError extends Error {}

/** 칸 값 → 글자 */
export function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : v.toISOString();
  return String(v).replace(/\s+/g, " ").trim();
}

/** 칸 값 → 숫자 (1,234 · '1234.0' · 빈칸 = 0) */
export function cellNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = cellText(v).replace(/,/g, "");
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** 시각 칸 → 'HH:MM:SS' (엑셀 시간 숫자 0.42 · Date · '10:02' 모두) */
export function cellTime(v: unknown): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (typeof v === "number" && v >= 0 && v < 1) {
    const s = Math.round(v * 86400);
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  }
  if (v instanceof Date && !isNaN(v.getTime())) return `${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  const m = cellText(v).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return m ? `${pad(Number(m[1]))}:${m[2]}:${m[3] || "00"}` : "";
}

/** '2026-10-02' · '2026.10.02' · '20261002' → '2026-10-02' */
export function normDate(s: string): string | null {
  const m = s.match(/(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 엑셀 위쪽의 '조회일자 : 2026-10-02' 또는 '2026-10-01 ~ 2026-10-02' */
export function sheetPeriod(rows: unknown[][]): { from: string | null; to: string | null } {
  for (const row of rows.slice(0, 8)) {
    const text = (row || []).map(cellText).join(" ");
    const m = text.match(/조회\s*일자\s*:?\s*([0-9]{4}[-./]?[0-9]{1,2}[-./]?[0-9]{1,2})(?:\s*~\s*([0-9]{4}[-./]?[0-9]{1,2}[-./]?[0-9]{1,2}))?/);
    if (m) {
      const from = normDate(m[1]);
      return { from, to: m[2] ? normDate(m[2]) : from };
    }
  }
  return { from: null, to: null };
}

const COLS: Record<string, string[]> = {
  pos: ["포스번호", "포스"],
  receipt: ["영수증번호", "영수번호"],
  kind: ["구분"],
  time: ["최초주문", "주문시각", "주문시간"],
  paid: ["결제시각"],
  name: ["상품명"],
  qty: ["수량"],
  gross: ["총매출액", "총매출"],
  discount: ["할인액", "총할인액"],
  net: ["실매출액", "실매출"],
};

/** 행 × 칸 → 영수증 줄. 영수증별 매출 상세현황이 아니면 SheetError (사람이 읽을 안내) */
export function parseReceiptSheet(rows: unknown[][]): ReceiptSheet {
  const hdr = rows.findIndex((r) => {
    const t = (r || []).map(cellText);
    return t.includes("포스번호") && t.includes("상품명");
  });
  if (hdr < 0) {
    const head = rows.slice(0, 10).map((r) => (r || []).map(cellText).join(" ")).join(" ");
    if (/대분류/.test(head) && /일자/.test(head)) throw new SheetError("'상품별 (일자별)' 엑셀입니다. 여기에는 '영수증별 매출 상세현황' 엑셀을 올려 주세요. (지난 자료는 아래 '지난 자료 한꺼번에 넣기')");
    throw new SheetError("'영수증별 매출 상세현황' 엑셀이 아닙니다 — 포스번호 · 영수증번호 · 상품명 칸을 찾지 못했습니다.");
  }
  const head = (rows[hdr] || []).map(cellText);
  const col: Record<string, number> = {};
  for (const [k, names] of Object.entries(COLS)) col[k] = head.findIndex((h) => names.includes(h));
  const missing = ["pos", "receipt", "kind", "name", "qty", "net"].filter((k) => col[k] < 0).map((k) => COLS[k][0]);
  if (missing.length) throw new SheetError(`'영수증별 매출 상세현황' 엑셀에 ${missing.join(" · ")} 칸이 없습니다.`);
  const at = (r: unknown[], k: string) => (col[k] >= 0 ? r[col[k]] : "");

  const { from, to } = sheetPeriod(rows.slice(0, hdr));
  const lines: ReceiptLine[] = [];
  let sheetNet: number | null = null;
  let sheetQty: number | null = null;
  for (const r of rows.slice(hdr + 1)) {
    if (!r) continue;
    const pos = cellText(at(r, "pos"));
    if (pos === "합계" || cellText(r[0]) === "합계") {
      sheetNet = cellNum(at(r, "net"));
      sheetQty = cellNum(at(r, "qty"));
      continue;
    }
    const name = cellText(at(r, "name")).slice(0, 100);
    if (!pos || !name) continue;
    const qty = cellNum(at(r, "qty"));
    const kind = cellText(at(r, "kind"));
    const net = cellNum(at(r, "net"));
    const gross = col.gross >= 0 ? cellNum(at(r, "gross")) : net;
    lines.push({
      pos,
      receipt: cellText(at(r, "receipt")),
      refund: kind === "반품" || (kind !== "매출" && qty < 0),
      time: cellTime(at(r, "time")) || cellTime(at(r, "paid")),
      name,
      qty,
      gross,
      discount: col.discount >= 0 ? cellNum(at(r, "discount")) : gross - net,
      net,
    });
  }
  return { from, to, lines, sheetNet, sheetQty };
}

/* ---------- 반품 지우기 ---------- */

export interface RefundMatch {
  /** 반품 영수증 */
  pos: string;
  receipt: string;
  time: string;
  /** 지운 매출 영수증 (상품마다 찾았으면 null) */
  from: { pos: string; receipt: string } | null;
  lines: number;
  /** 반품 실매출 (양수) */
  amount: number;
  /** 영수증 통째 · 상품마다 · 못 찾음 */
  how: "영수증" | "상품" | "못찾음";
}

export interface RefundResult {
  /** 반품을 지운 뒤 남은 줄 (짝을 못 찾은 반품은 음수 줄로 남김 → 엑셀 합계와 맞음) */
  lines: ReceiptLine[];
  matches: RefundMatch[];
  /** 짝을 못 찾은 반품 줄 */
  unmatched: ReceiptLine[];
}

interface Entry {
  line: ReceiptLine;
  qty: number;
  gross: number;
  discount: number;
  net: number;
  /** 아직 손대지 않은 줄 */
  whole: boolean;
}

const keyOf = (l: { pos: string; receipt: string }) => `${l.pos}|${l.receipt}`;
/** 반품 줄 r 이 매출 줄 e 를 통째로 되돌리는지 (부호만 반대) */
const exact = (e: Entry, r: ReceiptLine) => e.whole && e.line.name === r.name && e.qty === -r.qty && e.gross === -r.gross && e.net === -r.net;

/**
 * 반품을 매출에서 찾아 지움
 * 1) 반품 영수증의 상품이 모두 들어 있는 앞선 매출 영수증 (같은 포스 먼저, 가장 가까운 시각) → 그 줄들을 지움
 *    (2026-10-02 카페: 반품 6장 모두 이렇게 짝이 맞음 — 예: 01-0200 반품 = 01-0195 비프스테이크·리조또·아메리카노 2)
 * 2) 그런 영수증이 없으면 상품마다: 같은 상품의 앞선 매출 줄 (같은 수량·금액 먼저) 에서 빼기 (일부 반품도)
 * 3) 그래도 없으면 음수 줄로 남기고 알려 줌 (다른 날 판 것을 반품한 경우 등)
 */
export function removeRefunds(all: ReceiptLine[]): RefundResult {
  const entries: Entry[] = [];
  const receipts = new Map<string, Entry[]>();
  const groups = new Map<string, ReceiptLine[]>();
  for (const l of all) {
    if (l.refund) {
      const g = groups.get(keyOf(l));
      if (g) g.push(l);
      else groups.set(keyOf(l), [l]);
      continue;
    }
    const e: Entry = { line: l, qty: l.qty, gross: l.gross, discount: l.discount, net: l.net, whole: true };
    entries.push(e);
    const list = receipts.get(keyOf(l));
    if (list) list.push(e);
    else receipts.set(keyOf(l), [e]);
  }
  const timeOf = (list: { time: string }[]) => list.reduce((t, x) => (x.time && (!t || x.time < t) ? x.time : t), "");
  const recList = [...receipts.values()].map((list) => ({ pos: list[0].line.pos, receipt: list[0].line.receipt, time: timeOf(list.map((e) => e.line)), list }));
  const ordered = [...groups.values()].sort((a, b) => timeOf(a).localeCompare(timeOf(b)));

  const matches: RefundMatch[] = [];
  const unmatched: ReceiptLine[] = [];
  const drop = (e: Entry) => {
    e.qty = e.gross = e.discount = e.net = 0;
    e.whole = false;
  };

  for (const g of ordered) {
    const t = timeOf(g);
    const { pos, receipt } = g[0];
    const amount = -g.reduce((s, r) => s + r.net, 0);
    // 1) 영수증 통째
    const cands = recList
      .filter((r) => !t || !r.time || r.time <= t)
      .sort((a, b) => Number(b.pos === pos) - Number(a.pos === pos) || b.time.localeCompare(a.time));
    let done = false;
    for (const rec of cands) {
      const used = new Set<Entry>();
      const pick: Entry[] = [];
      for (const r of g) {
        const e = rec.list.find((x) => !used.has(x) && exact(x, r));
        if (!e) break;
        used.add(e);
        pick.push(e);
      }
      if (pick.length === g.length) {
        pick.forEach(drop);
        matches.push({ pos, receipt, time: t, from: { pos: rec.pos, receipt: rec.receipt }, lines: g.length, amount, how: "영수증" });
        done = true;
        break;
      }
    }
    if (done) continue;
    // 2) 상품마다
    let found = 0;
    for (const r of g) {
      const same = entries.filter((e) => e.qty > 0 && e.line.name === r.name);
      const before = same.filter((e) => !t || !e.line.time || e.line.time <= t);
      const rank = (list: Entry[]) => [...list].sort((a, b) => Number(b.line.pos === r.pos) - Number(a.line.pos === r.pos) || b.line.time.localeCompare(a.line.time));
      const e =
        rank(before.filter((x) => exact(x, r)))[0] ||
        rank(before.filter((x) => x.qty >= -r.qty))[0] ||
        rank(same.filter((x) => exact(x, r)))[0] ||
        rank(same.filter((x) => x.qty >= -r.qty))[0];
      if (!e) {
        unmatched.push(r);
        continue;
      }
      found++;
      e.qty += r.qty;
      e.gross += r.gross;
      e.discount += r.discount;
      e.net += r.net;
      e.whole = false;
      if (e.qty <= 0) drop(e);
    }
    matches.push({ pos, receipt, time: t, from: null, lines: g.length, amount, how: found === g.length ? "상품" : "못찾음" });
  }

  const lines: ReceiptLine[] = [];
  for (const e of entries) {
    if (e.qty === 0 && e.net === 0 && e.gross === 0 && !e.whole) continue;
    lines.push(e.whole ? e.line : { ...e.line, qty: e.qty, gross: e.gross, discount: e.discount, net: e.net });
  }
  lines.push(...unmatched);
  return { lines, matches, unmatched };
}
