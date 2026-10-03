/* 선 그래프 (여러 선) — 손가락을 대면 그 위치의 모든 선 값, 누르면 그 날짜로 (onPick) */
import { useState } from "react";
import { niceTicks, Tooltip, useWidth } from "./common";

export interface Line {
  label: string;
  color: string;
  values: (number | null)[];
  /** 굵게(주 선) · 가늘게(비교 선) */
  weight?: number;
  /** 점선 (예상) */
  dash?: boolean;
  /** 끝점 동그라미를 그리지 않음 */
  noDot?: boolean;
}

/** 따로 찍는 점 (예: 연말 예상) */
export interface Mark {
  i: number;
  v: number;
  color: string;
  label: string;
}

export function LineChart(props: {
  xs: string[];
  series: Line[];
  xTick: (i: number) => string | null;
  tipTitle: (i: number) => string;
  fmt: (v: number) => string;
  axisFmt: (v: number) => string;
  selected?: number;
  onPick?: (i: number) => void;
  height?: number;
  label: string;
  marks?: Mark[];
}) {
  const { xs, series } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const h = props.height ?? 200;
  const pad = { l: 46, r: 14, t: 10, b: 24 };
  const iw = width - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null)).concat((props.marks || []).map((m) => m.v));
  const lo = Math.min(0, ...all);
  const ticks = niceTicks(Math.max(1, ...all));
  const top = ticks[ticks.length - 1] || 1;
  const n = xs.length;
  const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => pad.t + ih - ((v - lo) / (top - lo || 1)) * ih;
  const path = (vals: (number | null)[]) =>
    vals.map((v, i) => (v == null ? "" : `${i === 0 || vals[i - 1] == null ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join("");
  const lastIdx = (vals: (number | null)[]) => {
    for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) return i;
    return -1;
  };
  const idxAt = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * width;
    return Math.max(0, Math.min(n - 1, Math.round(((px - pad.l) / iw) * (n - 1))));
  };
  const sel = props.selected;

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={h} role="img" aria-label={props.label}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 6} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">
              {props.axisFmt(t)}
            </text>
          </g>
        ))}
        {xs.map((_, i) => {
          const t = props.xTick(i);
          return t ? (
            <text key={i} x={x(i)} y={h - 6} className="axis" textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
              {t}
            </text>
          ) : null;
        })}
        {sel != null && sel >= 0 && sel < n && <line x1={x(sel)} x2={x(sel)} y1={pad.t} y2={pad.t + ih} className="sel-line" />}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="crosshair" />}
        {[...series].reverse().map((s) => (
          <path key={s.label} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.weight ?? 2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dash ? "5 5" : undefined} />
        ))}
        {series.map((s) => {
          if (s.noDot) return null;
          const i = sel != null && s.values[sel] != null ? sel : lastIdx(s.values);
          return i >= 0 ? <circle key={s.label} cx={x(i)} cy={y(s.values[i]!)} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} /> : null;
        })}
        {(props.marks || []).map((m) => (
          <g key={m.label}>
            <circle cx={x(m.i)} cy={y(m.v)} r={6} fill={m.color} stroke="var(--surface-1)" strokeWidth={2} />
            <text x={x(m.i) - 8} y={y(m.v) - 10} className="mark-label" textAnchor="end" style={{ fill: m.color }}>
              {m.label}
            </text>
          </g>
        ))}
        {hover != null &&
          series.map((s) => (s.values[hover] != null ? <circle key={s.label} cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} /> : null))}
        <rect
          x={0}
          y={0}
          width={width}
          height={h}
          fill="transparent"
          style={{ touchAction: "pan-y", cursor: props.onPick ? "pointer" : "default" }}
          onPointerMove={(e) => setHover(idxAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => props.onPick?.(idxAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
        />
      </svg>
      {hover != null && (
        <Tooltip
          x={x(hover)}
          y={4}
          width={width}
          title={props.tipTitle(hover)}
          rows={series
            .filter((s) => !s.noDot || s.values[hover] != null)
            .map((s) => ({ color: s.color, label: s.label, value: s.values[hover] == null ? "자료 없음" : props.fmt(s.values[hover]!) }))
            .concat((props.marks || []).filter((m) => m.i === hover).map((m) => ({ color: m.color, label: m.label, value: props.fmt(m.v) })))}
        />
      )}
    </div>
  );
}

/** 상자 안 작은 추세선 (최근 14일) — 끝점만 강조 */
export function Spark({ values, width = 64, height = 24 }: { values: (number | null)[]; width?: number; height?: number }) {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null);
  if (pts.length < 2) return <svg width={width} height={height} aria-hidden />;
  const max = Math.max(...pts.map((p) => p[1]));
  const min = Math.min(...pts.map((p) => p[1]));
  const x = (i: number) => 2 + (i / (values.length - 1)) * (width - 6);
  const y = (v: number) => height - 3 - ((v - min) / (max - min || 1)) * (height - 6);
  const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const [li, lv] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} aria-hidden className="spark">
      <path d={d} fill="none" stroke="var(--spark)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(li)} cy={y(lv)} r={2.5} fill="var(--series-1)" />
    </svg>
  );
}
