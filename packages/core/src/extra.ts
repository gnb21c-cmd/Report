import { dayRange } from "./dates";

/* ============================================================
   POS 밖 매출 — 자판기 · 인생네컷 · 주차정산기 (카드 단말기 매출, VAN 사 승인 내역)
   2026-07-01 부터 나이스정보통신 (그 전은 KIS정보통신)
   - 나이스 '통합거래조회' 엑셀: 위에 카드사별 합계, 아래에 건별 내역 (CAT_ID · 구분 · 거래일자 · 금액 …)
   - 구분 '승인' = +, '취소' = −, '승인거절' 은 돈이 안 오감 → 뺌
   - 2026-07-01 하루만 자판기 번호(3974466)가 카페 POS 와 같게 설정됨 → 카페 POS 단말기(HW 'TS-NC…') 결제는 카페 매출에 이미 있으므로 뺌
   매출은 '기타' 상자에 더하고, 정산(카드가맹점 입금)과 함께 지급 수수료 계산에 쓰임
   ============================================================ */

export type ExtraKind = "vending" | "photo" | "parking";
export const EXTRA_KINDS: ExtraKind[] = ["vending", "photo", "parking"];
export const EXTRA_LABEL: Record<ExtraKind, string> = { vending: "자판기", photo: "인생네컷", parking: "주차" };

/** 그날 POS 밖 매출 (원, 카드 승인 − 취소) */
export interface ExtraPart {
  v: 1;
  date: string;
  vending: number;
  photo: number;
  parking: number;
  /** 칸마다 누가 언제 어느 파일로 올렸는지 (A 의 자판기 · 네컷 · 주차 칸) */
  files?: Partial<Record<ExtraKind, { by: string; at: string; file?: string }>>;
}

/** 카드 단말기 번호(CAT_ID) → 매출 종류 */
export const EXTRA_TERMINALS: Record<string, ExtraKind> = {
  "3974466": "vending", // 자판기 (2026-07-01 은 카페 POS 와 같은 번호 — 카페 POS 결제는 뺌)
  "3974965": "parking", // 주차정산기
  "3974963": "photo", // 인생네컷 1
  "3974964": "photo", // 인생네컷 2
};

export const extraTotal = (p?: Pick<ExtraPart, ExtraKind> | null) => (p ? p.vending + p.photo + p.parking : 0);

export interface NiceSheet {
  /** 날짜별 매출 */
  days: Map<string, ExtraPart>;
  /** 건별 합 (승인 − 취소, 카페 POS 결제 포함) */
  sum: number;
  /** 파일 위 '합계' 줄의 매출금액 (없으면 null) */
  summary: number | null;
  /** 카페 POS 결제라 뺀 금액 */
  cafePos: number;
  /** 모르는 단말기 번호 → 금액 (뺌) */
  unknown: Record<string, number>;
  /** 건별 줄 수 */
  lines: number;
  /** 조회 기간 ('거래기간 : 거래일시 - 20260701 … ~ 20260930 …', 없으면 건별 날짜 처음 ~ 끝) */
  from: string;
  to: string;
  /** 이 파일에 든 매출 종류 (단말기별로 받은 파일이면 하나) */
  kinds: ExtraKind[];
  /** 건별 (겹친 파일을 합칠 때 같은 건은 한 번만) */
  items: { key: string; date: string; kind: ExtraKind; amt: number }[];
}

const toNum = (v: unknown) => {
  if (typeof v === "number") return v;
  const n = Number(String(v ?? "").replace(/[,\s원]/g, ""));
  return isFinite(n) ? n : 0;
};
const cell = (v: unknown) => String(v ?? "").trim();

export const emptyExtra = (date: string): ExtraPart => ({ v: 1, date, vending: 0, photo: 0, parking: 0 });

/** 나이스 '통합거래조회' 엑셀 행 → 날짜별 POS 밖 매출 (모양이 다르면 null) */
export function parseNiceSheet(rows: unknown[][]): NiceSheet | null {
  const hi = rows.findIndex((r) => r.some((c) => cell(c) === "CAT_ID") && r.some((c) => cell(c) === "거래일자"));
  if (hi < 0) return null;
  const H = rows[hi].map(cell);
  const col = (name: string) => H.indexOf(name);
  const [cCat, cKind, cDate, cAmt, cHw, cSeq] = [col("CAT_ID"), col("구분"), col("거래일자"), col("금액"), col("HW식별번호"), col("나이스 일련번호")];
  if (cCat < 0 || cKind < 0 || cDate < 0 || cAmt < 0) return null;
  // 위쪽 카드사별 표의 '합계' 줄 — 매출금액 = 다섯째 칸
  let summary: number | null = null;
  for (const r of rows.slice(0, hi)) {
    const i = r.findIndex((c) => cell(c) === "합계");
    if (i >= 0) {
      const head = rows.slice(0, hi).find((x) => x.some((c) => cell(c) === "매출금액"));
      const j = head ? head.findIndex((c) => cell(c) === "매출금액") : i + 3;
      summary = toNum(r[j]);
    }
  }
  const days = new Map<string, ExtraPart>();
  const unknown: Record<string, number> = {};
  let sum = 0;
  let cafePos = 0;
  let lines = 0;
  const items: NiceSheet["items"] = [];
  for (const r of rows.slice(hi + 1)) {
    const cat = cell(r[cCat]);
    const date = cell(r[cDate]);
    if (!cat || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const kind = cell(r[cKind]);
    if (kind !== "승인" && kind !== "취소") continue; // 승인거절 등
    lines++;
    const amt = Math.abs(toNum(r[cAmt])) * (kind === "승인" ? 1 : -1);
    sum += amt;
    if (cHw >= 0 && /^TS-NC/i.test(cell(r[cHw]))) {
      cafePos += amt;
      continue;
    }
    const k = EXTRA_TERMINALS[cat];
    if (!k) {
      unknown[cat] = (unknown[cat] || 0) + amt;
      continue;
    }
    let p = days.get(date);
    if (!p) days.set(date, (p = emptyExtra(date)));
    p[k] += amt;
    items.push({ key: `${cat}|${kind}|${cSeq >= 0 ? cell(r[cSeq]) : r.map(cell).join("|")}`, date, kind: k, amt });
  }
  const ds = [...days.keys()].sort();
  let from = ds[0] || "";
  let to = ds[ds.length - 1] || "";
  for (const r of rows.slice(0, hi)) {
    const m = r.map(cell).join(" ").match(/거래기간[^0-9]*(\d{4})(\d{2})(\d{2})[^~]*~\s*(\d{4})(\d{2})(\d{2})/);
    if (m) {
      from = `${m[1]}-${m[2]}-${m[3]}`;
      to = `${m[4]}-${m[5]}-${m[6]}`;
    }
  }
  const kinds = EXTRA_KINDS.filter((k) => items.some((it) => it.kind === k));
  return { days, sum, summary, cafePos, unknown, lines, from, to, kinds, items };
}

/** 여러 파일(단말기별 · 기간별)의 날짜별 매출 합치기 — 같은 건(일련번호)은 한 번만 */
export function mergeExtra(sheets: NiceSheet[]): Map<string, ExtraPart> {
  const out = new Map<string, ExtraPart>();
  const seen = new Set<string>();
  for (const s of sheets)
    for (const it of s.items) {
      if (seen.has(it.key)) continue;
      seen.add(it.key);
      const o = out.get(it.date) || emptyExtra(it.date);
      o[it.kind] += it.amt;
      out.set(it.date, o);
    }
  return out;
}

/** 올릴 날짜별 값 — 파일 기간 안의 날은 그 파일 종류를 이 값으로 바꿈 (그날 건이 없으면 0). 다른 종류는 그대로 둠 */
export interface ExtraUpdate {
  date: string;
  part: ExtraPart;
  kinds: ExtraKind[];
}

export function extraUpdates(sheets: NiceSheet[]): ExtraUpdate[] {
  const sums = mergeExtra(sheets);
  const cover = new Map<string, Set<ExtraKind>>();
  for (const s of sheets) {
    if (!s.from || !s.to || !s.kinds.length) continue;
    for (const d of dayRange(s.from, s.to)) {
      const c = cover.get(d) || new Set<ExtraKind>();
      s.kinds.forEach((k) => c.add(k));
      cover.set(d, c);
    }
  }
  return [...cover.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, c]) => ({ date, part: sums.get(date) || emptyExtra(date), kinds: EXTRA_KINDS.filter((k) => c.has(k)) }));
}

/** 이미 있는 값에 덮기 — 바꿀 종류만 */
export function applyExtra(old: ExtraPart | undefined | null, u: ExtraUpdate, meta?: { by: string; at: string; file?: string }): ExtraPart {
  const out: ExtraPart = old ? { ...emptyExtra(u.date), ...old, v: 1, date: u.date } : emptyExtra(u.date);
  for (const k of u.kinds) out[k] = u.part[k];
  if (meta) {
    out.files = { ...(out.files || {}) };
    for (const k of u.kinds) out.files[k] = { by: meta.by, at: meta.at, ...(meta.file ? { file: meta.file } : {}) };
  }
  return out;
}
