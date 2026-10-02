/* 네이버 예약 시간대 표 — 열: 10:00 ~ 19:30 (30분), 줄: 판매입장권 수 · 신규방문자 수
   엑셀처럼: 화살표 · Enter · Tab 으로 칸 이동, 엑셀에서 복사한 칸을 붙여넣기 */
import { useRef } from "react";
import { NAVER_SLOTS } from "@report/core";

const ROWS = [
  { key: "tickets", label: "판매입장권 수", unit: "장" },
  { key: "newVisitors", label: "신규방문자 수", unit: "명" },
] as const;

export function NaverGrid(props: { tickets: string[]; newVisitors: string[]; onChange: (row: "tickets" | "newVisitors", values: string[]) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[][]>([[], []]);
  const vals = { tickets: props.tickets, newVisitors: props.newVisitors };
  const total = (xs: string[]) => xs.reduce((s, x) => s + (Number(x) || 0), 0);
  const focus = (r: number, c: number) => {
    const el = refs.current[Math.max(0, Math.min(1, r))]?.[Math.max(0, Math.min(NAVER_SLOTS.length - 1, c))];
    el?.focus();
    el?.select();
  };
  const set = (r: number, c: number, v: string) => {
    const key = ROWS[r].key;
    const next = [...vals[key]];
    next[c] = v.replace(/[^0-9]/g, "").slice(0, 4);
    props.onChange(key, next);
  };
  const onKey = (r: number, c: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowRight" && (e.currentTarget.selectionStart === e.currentTarget.value.length || e.currentTarget.selectionEnd === e.currentTarget.value.length)) (e.preventDefault(), focus(r, c + 1));
    else if (e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0) (e.preventDefault(), focus(r, c - 1));
    else if (e.key === "ArrowDown") (e.preventDefault(), focus(r + 1, c));
    else if (e.key === "ArrowUp") (e.preventDefault(), focus(r - 1, c));
    else if (e.key === "Enter") (e.preventDefault(), c === NAVER_SLOTS.length - 1 ? focus(r + 1, 0) : focus(r, c + 1));
  };
  // 엑셀에서 여러 칸 복사 → 붙여넣기 (탭 = 옆 칸, 줄바꿈 = 아래 줄)
  const onPaste = (r: number, c: number) => (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, "").split("\n").filter((l, i, a) => l !== "" || i < a.length - 1);
    const next = { tickets: [...vals.tickets], newVisitors: [...vals.newVisitors] };
    lines.forEach((line, i) => {
      const row = r + i;
      if (row > 1) return;
      line.split("\t").forEach((cell, j) => {
        const col = c + j;
        if (col < NAVER_SLOTS.length) next[ROWS[row].key][col] = cell.replace(/[^0-9]/g, "").slice(0, 4);
      });
    });
    props.onChange("tickets", next.tickets);
    props.onChange("newVisitors", next.newVisitors);
  };

  return (
    <div className="grid-wrap">
      <table className="naver-grid">
        <thead>
          <tr>
            <th className="row-head">구분</th>
            {NAVER_SLOTS.map((s) => (
              <th key={s} className={s.endsWith(":00") ? "hour" : ""}>
                {s}
              </th>
            ))}
            <th className="sum">합계</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row, r) => (
            <tr key={row.key}>
              <th className="row-head">{row.label}</th>
              {NAVER_SLOTS.map((s, c) => (
                <td key={s}>
                  <input
                    ref={(el) => (refs.current[r][c] = el)}
                    inputMode="numeric"
                    aria-label={`${s} ${row.label}`}
                    value={vals[row.key][c] || ""}
                    disabled={props.disabled}
                    onChange={(e) => set(r, c, e.target.value)}
                    onKeyDown={onKey(r, c)}
                    onPaste={onPaste(r, c)}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </td>
              ))}
              <td className="sum">
                {total(vals[row.key]).toLocaleString("ko-KR")}
                {row.unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
