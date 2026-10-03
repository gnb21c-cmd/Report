/* 엑셀 파일(.xls · .xlsx) → 행 × 칸 값 (첫 시트). 계산은 @report/core 가 함 */
import * as XLSX from "xlsx";

export function readRows(buf: ArrayBuffer): unknown[][] {
  const book = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: false, cellNF: false, cellText: false });
  const ws = book.Sheets[book.SheetNames[0]];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "", blankrows: false });
}

/** 같은 파일을 두 칸에 올렸는지 알아보려는 간단한 지문 (보안용 아님) */
export function fingerprint(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let h = 2166136261;
  for (let i = 0; i < b.length; i += Math.max(1, Math.floor(b.length / 65536))) {
    h ^= b[i];
    h = Math.imul(h, 16777619);
  }
  return `${b.length}-${(h >>> 0).toString(16)}`;
}
