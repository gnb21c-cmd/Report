/* 최근 일매출 선 그래프 (카페 · 키즈) — 손가락을 대면 그날 값 */
import { useState } from "react";
import { shortLabel, won, wonShort, type TrendPoint } from "@report/core";
import { ChartCard, Legend, niceTicks, Tooltip, useWidth } from "./common";

const SERIES = [
  { key: "cafe" as const, label: "카페", color: "var(--series-1)" },
  { key: "kids" as const, label: "키즈", color: "var(--series-2)" },
];

export function TrendChart({ points, selected }: { points: TrendPoint[]; selected: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const h = 200;
  const pad = { l: 44, r: 30, t: 10, b: 26 };
  const iw = width - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const max = Math.max(1, ...points.flatMap((p) => [p.cafe, p.kids]));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const x = (i: number) => pad.l + (points.length <= 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - (Math.max(0, v) / top) * ih;
  const path = (k: "cafe" | "kids") =>
    points
      .map((p, i) => (p.has ? `${i === 0 || !points[i - 1].has ? "M" : "L"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}` : ""))
      .join("");

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    const i = Math.round(((px - pad.l) / iw) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };
  const last = points.length - 1;
  const hp = hover != null ? points[hover] : null;

  return (
    <ChartCard
      title={`최근 ${points.length}일 매출`}
      sub="실매출 · 하루 단위"
      legend={<Legend items={SERIES.map((s) => ({ label: s.label, color: s.color }))} />}
      table={
        <table>
          <thead>
            <tr>
              <th>날짜</th>
              <th className="num">카페</th>
              <th className="num">키즈</th>
              <th className="num">합계</th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.date} className={p.date === selected ? "sel" : ""}>
                <td>{shortLabel(p.date)}</td>
                <td className="num">{p.has ? won(p.cafe) : "—"}</td>
                <td className="num">{p.has ? won(p.kids) : "—"}</td>
                <td className="num">{p.has ? won(p.cafe + p.kids) : "자료 없음"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="chart" ref={ref}>
        <svg width={width} height={h} role="img" aria-label="최근 일매출 선 그래프">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className="grid" />
              <text x={pad.l - 6} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">
                {wonShort(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) =>
            i % 7 === last % 7 ? (
              <text key={p.date} x={x(i)} y={h - 8} className="axis" textAnchor="middle">
                {Number(p.date.slice(5, 7))}/{Number(p.date.slice(8))}
              </text>
            ) : null,
          )}
          {hp && <line x1={x(hover!)} x2={x(hover!)} y1={pad.t} y2={pad.t + ih} className="crosshair" />}
          {SERIES.map((s) => (
            <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {SERIES.map((s) =>
            points[last]?.has ? <circle key={s.key} cx={x(last)} cy={y(points[last][s.key])} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} /> : null,
          )}
          {hp &&
            hp.has &&
            SERIES.map((s) => <circle key={s.key} cx={x(hover!)} cy={y(hp[s.key])} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />)}
          <rect
            x={0}
            y={0}
            width={width}
            height={h}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
            style={{ touchAction: "pan-y" }}
          />
        </svg>
        {hp && (
          <Tooltip
            x={x(hover!)}
            y={8}
            width={width}
            title={shortLabel(hp.date)}
            rows={
              hp.has
                ? [
                    { color: "var(--series-1)", label: "카페", value: won(hp.cafe) },
                    { color: "var(--series-2)", label: "키즈", value: won(hp.kids) },
                    { label: "합계", value: won(hp.cafe + hp.kids) },
                  ]
                : [{ label: "", value: "자료 없음 (휴무 또는 미송부)" }]
            }
          />
        )}
      </div>
    </ChartCard>
  );
}
