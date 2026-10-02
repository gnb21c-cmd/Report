/* ============================================================
   상품별 (일자별) 엑셀 읽기 — '지난 자료 한꺼번에 넣기' (작년 비교선을 채우려고)
   머리글 [대분류, 중분류, 소분류, 상품코드, 상품명, 일자, 수량, 총매출액, 총할인액, 실매출액], 위쪽에 '조회일자 : a ~ b'
   기간을 길게 받아도 됨 (날짜 칸이 있음). 시간대 · 팀은 없어서 하루 합계 비교에만 쓰임
   ============================================================ */
import { addDays } from "./dates";
import { cellNum, cellText, normDate, sheetPeriod, SheetError } from "./receipt";
import type { SaleLine } from "./types";

export const DAILY_HEADER = ["대분류", "중분류", "소분류", "상품코드", "상품명", "일자", "수량", "총매출액", "총할인액", "실매출액"];

export interface DailySheet {
  from: string;
  to: string;
  /** 날짜 → 그날 상품 줄 (같은 날·상품명은 합침) */
  days: Map<string, SaleLine[]>;
  /** 상품명 → OK포스 대분류 (분류표 채우기) */
  categories: Map<string, string>;
  /** 조회줄수 제한에 걸려 잘림 */
  truncated: boolean;
  /** 합계 줄과 같음 */
  totalOk: boolean;
}

/** 엑셀 날짜 칸 (글자 · 날짜 숫자) → YYYY-MM-DD */
export function cellDate(v: unknown): string | null {
  if (typeof v === "number" && v > 20000 && v < 80000) return addDays("1899-12-30", Math.floor(v));
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return normDate(cellText(v));
}

export function parseDailySheet(rows: unknown[][]): DailySheet {
  const hdr = rows.findIndex((r) => DAILY_HEADER.every((h, i) => cellText((r || [])[i]) === h));
  if (hdr < 0) {
    const head = rows.slice(0, 10).map((r) => (r || []).map(cellText).join(" ")).join(" ");
    if (/포스번호/.test(head) && /영수증/.test(head)) throw new SheetError("'영수증별 매출 상세현황' 엑셀입니다. 지난 자료 넣기에는 '상품별 (일자별)' 엑셀을 올려 주세요.");
    throw new SheetError(`'상품별 (일자별)' 엑셀이 아닙니다 — 머리글(${DAILY_HEADER.join(", ")})을 찾지 못했습니다.`);
  }
  const { from, to } = sheetPeriod(rows.slice(0, hdr));
  if (!from || !to) throw new SheetError("조회일자를 찾지 못했습니다 — '상품별 (일자별)' 엑셀이 맞는지 확인해 주세요.");
  const info = rows.slice(0, hdr).map((r) => (r || []).map(cellText).join(" ")).join(" ");
  const lim = info.match(/조회\s*줄수\s*:?\s*(\d+)/);
  const days = new Map<string, SaleLine[]>();
  const categories = new Map<string, string>();
  const sums = [0, 0, 0, 0];
  let total: number[] | null = null;
  let count = 0;
  for (const r of rows.slice(hdr + 1)) {
    if (!r) continue;
    if (cellText(r[0]) === "합계") {
      total = [6, 7, 8, 9].map((i) => Math.round(cellNum(r[i])));
      continue;
    }
    const code = cellText(r[3]);
    const name = cellText(r[4]).slice(0, 100);
    const date = cellDate(r[5]);
    if (!code || !name || !date) continue;
    count++;
    const line: SaleLine = {
      code,
      name,
      cat1: cellText(r[0]),
      cat2: cellText(r[1]),
      cat3: cellText(r[2]),
      qty: cellNum(r[6]),
      gross: cellNum(r[7]),
      discount: cellNum(r[8]),
      net: cellNum(r[9]),
    };
    [line.qty, line.gross, line.discount, line.net].forEach((v, i) => (sums[i] += Math.round(v)));
    if (line.cat1) categories.set(name, line.cat1);
    const list = days.get(date) || [];
    const same = list.find((x) => x.name === name && x.cat1 === line.cat1);
    if (same) {
      same.qty += line.qty;
      same.gross += line.gross;
      same.discount += line.discount;
      same.net += line.net;
    } else list.push(line);
    days.set(date, list);
  }
  return {
    from,
    to,
    days,
    categories,
    truncated: !!lim && count >= Number(lim[1]),
    totalOk: !total || total.every((v, i) => v === sums[i]),
  };
}
