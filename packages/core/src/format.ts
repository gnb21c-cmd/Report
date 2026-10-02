/* 금액·숫자 보여 주기 */

/** 1,234,000원 */
export function won(n: number): string {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

/** 큰 금액 줄여서: 123만 · 1.2억 (그래프 눈금·칸용) */
export function wonShort(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e8) return `${sign}${trim(a / 1e8)}억`;
  if (a >= 1e7 && a % 1e7 === 0) return `${sign}${a / 1e7}천만`;
  if (a >= 1e4) return `${sign}${Math.round(a / 1e4).toLocaleString("ko-KR")}만`;
  return `${sign}${Math.round(a).toLocaleString("ko-KR")}`;
}

function trim(v: number): string {
  return v >= 10 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "");
}

/** +3.2% · -1.0% · — */
export function pct(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function count(n: number, unit = ""): string {
  return `${Math.round(n).toLocaleString("ko-KR")}${unit}`;
}
