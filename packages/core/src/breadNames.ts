/* ============================================================
   빵 이름 바꿈 (2026-10-25 사장님) — POS 이름이 바뀌어도 같은 빵으로 판매 기록 · 계획 · 결과 · 같은 요일 칸을 이어서 셈
   - 인절미팥빵 → 저당팥빵 (POS 10-24 부터) · 고소한옛날맘모스(맘모스) → 팥앙금샌드 (POS 10-28 수요일부터)
   - from = 새 이름으로 계획하는 첫 날: 10-29(목)에 발표하는 11-02 ~ 08 주간안부터 새 이름
     그 전 날짜 계획(이미 발표한 것)은 옛 이름 그대로 — 화면에는 "인절미팥빵 (변경명칭:저당팥빵)"
   - 그 전 날짜와 견줄 때(결과 · 매진)는 새 이름으로 팔린 것도 옛 이름으로 셈, 그날부터는 옛 이름으로 팔린 것도 새 이름으로
   ============================================================ */
import type { Board } from "./metrics";

export interface BreadRename {
  old: string;
  to: string;
  /** 새 이름으로 계획하는 첫 날 */
  from: string;
  /** POS 에 찍힐 수 있는 다른 이름 */
  also?: readonly string[];
}
export const BREAD_RENAME: readonly BreadRename[] = [
  { old: "인절미팥빵", to: "저당팥빵", from: "2026-11-02" },
  { old: "고소한옛날맘모스", to: "팥앙금샌드", from: "2026-11-02", also: ["맘모스", "팥앙금빵"] },
];

/** 이름 견줄 때 — 띄어쓰기는 상관없음 */
export const breadKey = (n: string) => n.replace(/\s+/g, "");
const RENAME_OF = new Map<string, BreadRename>();
for (const r of BREAD_RENAME) for (const n of [r.old, r.to, ...(r.also || [])]) RENAME_OF.set(breadKey(n), r);

/** 그날 계획에서 쓰는 이름 — 바꾸기 전 날짜는 옛 이름, 그날부터 새 이름 (옛 · 새 · 다른 이름 모두) */
export function breadNameOn(name: string, date: string): string {
  const r = RENAME_OF.get(breadKey(name));
  return r ? (date >= r.from ? r.to : r.old) : name;
}

/** 새 이름 (날짜와 상관없이 — 순서 · 올림 단위 · 같은 요일 칸을 찾을 때) */
export const breadNewName = (name: string): string => RENAME_OF.get(breadKey(name))?.to ?? name;

/** 화면 표기 — 바꾸기 전 날짜의 옛 이름에 "(변경명칭:새 이름)" */
export function breadLabel(name: string, date: string): string {
  const r = RENAME_OF.get(breadKey(name));
  return r && date < r.from && breadKey(name) !== breadKey(r.to) ? `${r.old} (변경명칭:${r.to})` : name;
}

/** 그날(d) 베이커리 판매 개수 — 계획 날(date) 기준 이름으로 묶음 (생산품이 아닌 잼 등은 Board 가 이미 뺌) */
export function breadSold(board: Board, d: string, date: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of board.products(d, d, "베이커리")) {
    const n = breadNameOn(p.name, date);
    m.set(n, (m.get(n) || 0) + p.qty);
  }
  return m;
}

/** 이름 → 개수 묶음을 그날 기준 이름으로 (더함 — 50% 할인 개수) */
export function renameSum(x: Record<string, number>, date: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [n, v] of Object.entries(x)) {
    const k = breadNameOn(n, date);
    out[k] = (out[k] || 0) + v;
  }
  return out;
}

/** 이름 → 시각 묶음을 그날 기준 이름으로 (늦은 시각 — 마지막 판매) */
export function renameLast(x: Record<string, string>, date: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [n, v] of Object.entries(x)) {
    const k = breadNameOn(n, date);
    if (!out[k] || v > out[k]) out[k] = v;
  }
  return out;
}
