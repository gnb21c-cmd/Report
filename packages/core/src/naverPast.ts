/* ============================================================
   네이버 지난 자료 — 주 단위 화면을 캡처해 정리한 표 (CSV · 엑셀)
   한 줄 = 하루: [날짜, 10:00, 10:30, … , 19:30] 판매 입장권 수 (빈칸 = 0)
   신규방문자는 지난 자료로는 알 수 없음 (손님 방문 횟수가 계속 쌓임) → noNew 로 표시, B 는 '—'
   + 영수증별 엑셀 여러 개를 한꺼번에 올릴 때 매장 짐작 (guessStore)
   ============================================================ */
import { guessSector, kidsKind } from "./classify";
import { NAVER_SLOTS, type NaverPart } from "./part";
import { cellNum, cellText, normDate, SheetError, type ReceiptLine } from "./receipt";
import { cellDate } from "./daily";
import type { StoreId } from "./types";

export interface NaverPastRow {
  date: string;
  tickets: number[];
}

/** 표 → 날짜별 네이버 판매 입장권. 머리글 줄에 10:00 … 19:30 이 있어야 함 */
export function parseNaverPast(rows: unknown[][]): NaverPastRow[] {
  const norm = (s: string) => {
    const m = s.match(/^(\d{1,2}):(\d{2})/);
    return m ? `${m[1].padStart(2, "0")}:${m[2]}` : s;
  };
  const hdr = rows.findIndex((r) => (r || []).map((c) => norm(cellText(c))).filter((c) => NAVER_SLOTS.includes(c)).length >= 10);
  if (hdr < 0) throw new SheetError("네이버 지난 자료 표가 아닙니다 — 머리글에 10:00 · 10:30 … 19:30 칸이 있어야 합니다.");
  const head = (rows[hdr] || []).map((c) => norm(cellText(c)));
  const col = NAVER_SLOTS.map((s) => head.indexOf(s));
  const out = new Map<string, number[]>();
  for (const r of rows.slice(hdr + 1)) {
    if (!r) continue;
    const date = cellDate(r[0]) || normDate(cellText(r[0]));
    if (!date) continue;
    const t = col.map((c) => (c < 0 ? 0 : Math.max(0, Math.round(cellNum(r[c])))));
    const prev = out.get(date);
    out.set(date, prev ? prev.map((v, i) => v + t[i]) : t);
  }
  if (!out.size) throw new SheetError("날짜가 있는 줄이 없습니다 (첫 칸에 2025-10-01 처럼 날짜).");
  return [...out.entries()].sort().map(([date, tickets]) => ({ date, tickets }));
}

export function naverPastPart(r: NaverPastRow): NaverPart {
  return { v: 1, date: r.date, tickets: r.tickets, newVisitors: NAVER_SLOTS.map(() => 0), noNew: true };
}

/** 영수증 줄을 보고 매장 짐작 — 입장권이 대부분이면 키즈, 음료 · 빵 · 식사면 카페, 둘 다 많으면 [전체] (null) */
export function guessStore(lines: Pick<ReceiptLine, "name" | "gross" | "net" | "refund">[]): StoreId | null {
  const sales = lines.filter((l) => !l.refund);
  if (!sales.length) return null;
  const kids = sales.filter((l) => kidsKind(l) !== "기타").length / sales.length;
  const cafe = sales.filter((l) => kidsKind(l) === "기타" && guessSector(l.name) !== "기타").length / sales.length;
  if (kids > 0.1 && cafe > 0.1) return null;
  return kids > cafe ? "kids" : "cafe";
}
