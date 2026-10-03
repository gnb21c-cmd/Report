/* 막대 그래프 — 한 묶음(핑크 막대 + 막대 위 숫자) 또는 겹친 비교(뒤 회색 = 작년 · 앞 빨강 = 올해)
   손가락을 대면 그 칸의 값 */
import { useState } from "react";
import { niceTicks, Tooltip, useWidth, type TipRow } from "./common";

export interface Bars {
  label: string;
  color: string;
  values: (number | null)[];
}

export function BarChart(props: {
  xs: string[];
  /** single: 첫 묶음만 · overlay: [뒤(작년), 앞(올해)] */
  series: Bars[];
  /** 막대 위에 적을 글자 (single 일 때) */
  top?: (string | null)[];
  xTick: (i: number) => string | null;
  tipTitle: (i: number) => string;
  fmt: (v: number) => string;
  axisFmt: (v: number) => string;
  /** 세로 눈금 끝 (두 그래프를 같은 눈금으로 볼 때) */
  yMax?: number;
  height?: number;
  label: string;
  /** 칸 아래 한 줄 (예: ▲ ▼) */
  below?: { text: string; color: string }[];
}) {
  const { xs, series } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const h = props.height ?? 210;
  const belowH = props.below ? 20 : 0;
  const pad = { l: 44, r: 8, t: props.top ? 22 : 10, b: 22 + belowH };
  const iw = width - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const ticks = niceTicks(Math.max(1, props.yMax ?? 0, ...all));
  const top = ticks[ticks.length - 1] || 1;
  const n = xs.length;
  const slot = iw / Math.max(1, n);
  const y = (v: number) => pad.t + ih - (Math.max(0, v) / top) * ih;
  const overlay = series.length > 1;
  const idxAt = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * width;
    return Math.max(0, Math.min(n - 1, Math.floor((px - pad.l) / slot)));
  };
  const topSize = slot < 20 ? 9.5 : slot < 26 ? 11 : 13;

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
        {hover != null && <rect x={pad.l + hover * slot} y={pad.t} width={slot} height={ih} className="hover-band" />}
        {series.map((s, si) => {
          const front = overlay && si === series.length - 1;
          const w = overlay ? (front ? slot * 0.46 : slot * 0.78) : slot * 0.68;
          return s.values.map((v, i) =>
            v == null || v <= 0 ? null : (
              <rect key={`${si}-${i}`} x={pad.l + i * slot + (slot - w) / 2} y={y(v)} width={w} height={Math.max(1, pad.t + ih - y(v))} rx={Math.min(3, w / 4)} fill={s.color} />
            ),
          );
        })}
        {props.top &&
          props.top.map((t, i) => {
            const v = series[0].values[i];
            return t && v != null && v > 0 ? (
              <text key={i} x={pad.l + i * slot + slot / 2} y={y(v) - 5} className="bar-top" textAnchor="middle" style={{ fontSize: topSize }}>
                {t}
              </text>
            ) : null;
          })}
        <line x1={pad.l} x2={width - pad.r} y1={pad.t + ih} y2={pad.t + ih} className="baseline" />
        {xs.map((_, i) => {
          const t = props.xTick(i);
          return t ? (
            <text key={i} x={pad.l + i * slot + slot / 2} y={pad.t + ih + 15} className="axis" textAnchor="middle">
              {t}
            </text>
          ) : null;
        })}
        {props.below?.map((b, i) =>
          b.text ? (
            <text key={i} x={pad.l + i * slot + slot / 2} y={h - 4} textAnchor="middle" className="below" style={{ fill: b.color }}>
              {b.text}
            </text>
          ) : null,
        )}
        <rect
          x={0}
          y={0}
          width={width}
          height={h}
          fill="transparent"
          style={{ touchAction: "pan-y" }}
          onPointerMove={(e) => setHover(idxAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hover != null && (
        <Tooltip
          x={pad.l + hover * slot + slot / 2}
          y={4}
          width={width}
          title={props.tipTitle(hover)}
          rows={[...series]
            .reverse()
            .map((s): TipRow => ({ color: s.color, key: "rect", label: s.label, value: s.values[hover] == null ? "자료 없음" : props.fmt(s.values[hover]!) }))
            .concat(props.top && props.top[hover] ? [{ label: "", value: props.top[hover]! }] : [])}
        />
      )}
    </div>
  );
}
