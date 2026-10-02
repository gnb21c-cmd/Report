/* ============================================================
   받은 묶음 정리 — 같은 POS·날짜는 늦게 보낸 것 하나만 (하루치를 통째로 바꿈 → 두 번 더해지지 않음)
   ============================================================ */
import { POS_IDS, type DayBatch, type PosId, type Sale } from "./types";

const keyOf = (b: Pick<DayBatch, "pos" | "date">) => `${b.pos}_${b.date}`;

/** 같은 POS·날짜는 sentAt 이 늦은 묶음만 남김 */
export function latestBatches(batches: DayBatch[]): DayBatch[] {
  const map = new Map<string, DayBatch>();
  for (const b of batches) {
    if (!b || !POS_IDS.includes(b.pos) || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) continue;
    const cur = map.get(keyOf(b));
    if (!cur || String(b.sentAt) >= String(cur.sentAt)) map.set(keyOf(b), b);
  }
  return [...map.values()].sort((a, b) => (a.date === b.date ? a.pos.localeCompare(b.pos) : a.date.localeCompare(b.date)));
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 묶음 → 한 줄씩 (상품명 공백 정리 — VAN 변경 전후를 이름으로 이어 봄) */
export function salesOf(batches: DayBatch[]): Sale[] {
  const out: Sale[] = [];
  for (const b of latestBatches(batches))
    for (const r of b.rows || []) {
      const name = String(r?.name ?? "").replace(/\s+/g, " ").trim();
      if (!name) continue;
      out.push({
        pos: b.pos,
        date: b.date,
        code: String(r.code ?? ""),
        name,
        cat1: String(r.cat1 ?? ""),
        cat2: String(r.cat2 ?? ""),
        cat3: String(r.cat3 ?? ""),
        qty: num(r.qty),
        gross: num(r.gross),
        discount: num(r.discount),
        net: num(r.net),
      });
    }
  return out;
}

export interface PosStatus {
  pos: PosId;
  /** 받은 마지막 날짜 */
  lastDate: string | null;
  /** 그 묶음을 보낸 시각 */
  lastSentAt: string | null;
  /** 받은 날 수 */
  days: number;
}

export function posStatus(batches: DayBatch[]): PosStatus[] {
  const latest = latestBatches(batches);
  return POS_IDS.map((pos) => {
    const mine = latest.filter((b) => b.pos === pos);
    const last = mine[mine.length - 1];
    return { pos, lastDate: last?.date ?? null, lastSentAt: last?.sentAt ?? null, days: mine.length };
  });
}

/** 보고 기준일 = 받은 자료 중 가장 늦은 날 (마감해 보낸 날). 자료가 없으면 null */
export function reportDate(batches: DayBatch[]): string | null {
  let max: string | null = null;
  for (const b of batches) if (b && (!max || b.date > max)) max = b.date;
  return max;
}
