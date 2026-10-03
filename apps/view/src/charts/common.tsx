/* 그래프 공통 — 폭 재기 · 눈금 · 말풍선 */
import { useEffect, useRef, useState, type ReactNode } from "react";

/** 담는 상자의 폭 (화면을 돌리거나 크기가 바뀌면 다시) */
export function useWidth<T extends HTMLElement>(initial = 340) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(240, Math.floor(el.clientWidth))));
    ro.observe(el);
    setW(Math.max(240, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** 0 부터 max 까지 보기 좋은 눈금 (1·2·5 단위) */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) out.push(Math.round(v));
  return out;
}

export interface TipRow {
  color?: string;
  /** 선(line) · 막대(rect) 표시 */
  key?: "line" | "rect";
  label: string;
  value: string;
}

/** 말풍선 — 값이 앞, 이름이 뒤 */
export function Tooltip({ x, y, title, rows, width }: { x: number; y: number; title: string; rows: TipRow[]; width: number }) {
  const left = Math.min(Math.max(8, x + 12), width - 180);
  return (
    <div className="tip" style={{ left, top: Math.max(0, y) }} role="status">
      <div className="tip-title">{title}</div>
      {rows.map((r) => (
        <div className="tip-row" key={r.label}>
          {r.color && <span className={r.key === "rect" ? "key-rect" : "key-line"} style={{ background: r.color }} />}
          <b>{r.value}</b>
          <span className="muted">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { color: string; label: string; key?: "line" | "rect" }[] }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.label}>
          <span className={it.key === "rect" ? "key-rect" : "key-line"} style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** 그래프 ↔ 표 바꾸기 (값을 말풍선 없이도 볼 수 있게) */
export function ChartCard({ title, sub, legend, head, table, children }: { title: string; sub?: string; legend?: ReactNode; head?: ReactNode; table: ReactNode; children: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {sub && <p className="sub">{sub}</p>}
        </div>
        <button className="ghost small" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? "그래프" : "표로 보기"}
        </button>
      </div>
      {head && <div className="card-tools">{head}</div>}
      {!asTable && legend}
      {asTable ? <div className="table-wrap tall">{table}</div> : children}
    </section>
  );
}
