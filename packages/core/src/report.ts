/* ============================================================
   받은 자료를 날짜별로 묶어 둔 색인 — 대시보드 계산(metrics.ts)과 상품 표가 씀
   ============================================================ */
import { dayRange } from "./dates";
import { teamOf, type Team } from "./classify";
import type { PosId, Sale } from "./types";

export interface ProductRow {
  name: string;
  team: Team;
  pos: PosId;
  qty: number;
  net: number;
  /** 쓰인 상품코드 (VAN 변경 전후로 다를 수 있음) */
  codes: string[];
  firstDate: string;
  lastDate: string;
}

export class SalesIndex {
  readonly byDate = new Map<string, Sale[]>();
  /** 날짜 → 자료가 온 POS */
  readonly present = new Map<string, Set<PosId>>();
  readonly first: string | null;
  readonly last: string | null;

  constructor(sales: Sale[], presentDays: { pos: PosId; date: string }[] = []) {
    for (const s of sales) {
      let list = this.byDate.get(s.date);
      if (!list) this.byDate.set(s.date, (list = []));
      list.push(s);
      this.mark(s.date, s.pos);
    }
    // 묶음은 왔지만 판매가 0줄인 날(휴무 등)도 '받음'으로
    for (const p of presentDays) this.mark(p.date, p.pos);
    const keys = [...this.present.keys()].sort();
    this.first = keys[0] ?? null;
    this.last = keys[keys.length - 1] ?? null;
  }

  private mark(date: string, pos: PosId) {
    let set = this.present.get(date);
    if (!set) this.present.set(date, (set = new Set()));
    set.add(pos);
  }

  day(date: string): Sale[] {
    return this.byDate.get(date) || [];
  }

  /** 상품별 합계 (상품명 기준 — 코드가 달라도 이름이 같으면 같은 상품) */
  products(from: string, to: string): ProductRow[] {
    const map = new Map<string, ProductRow & { codeSet: Set<string> }>();
    if (from > to) return [];
    for (const d of dayRange(from, to))
      for (const s of this.day(d)) {
        const key = `${s.pos}|${s.name}`;
        let r = map.get(key);
        if (!r) map.set(key, (r = { name: s.name, team: teamOf(s.pos, s), pos: s.pos, qty: 0, net: 0, codes: [], codeSet: new Set(), firstDate: d, lastDate: d }));
        r.qty += s.qty;
        r.net += s.net;
        if (s.code) r.codeSet.add(s.code);
        r.lastDate = d;
      }
    return [...map.values()].map(({ codeSet, ...r }) => ({ ...r, codes: [...codeSet].sort() }));
  }
}

/** 많이 팔린 순 (실매출, 같으면 수량) */
export function topProducts(rows: ProductRow[], n: number): ProductRow[] {
  return [...rows].sort((a, b) => b.net - a.net || b.qty - a.qty).slice(0, n);
}
