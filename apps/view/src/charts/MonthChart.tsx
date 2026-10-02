/* 월별 매출 막대 — 올해(파랑)와 작년 같은 달(회색) 나란히 */
import { useState } from "react";
import { changePct, pct, won, wonShort, type MonthRow } from "@report/core";
import { ChartCard, Legend, niceTicks, Tooltip, useWidth } from "./common";

const label = (m: string) => `${Number(m.slice(5))}월`;

export function MonthChart({ rows }: { rows: MonthRow[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const h = 220;
  const pad = { l: 44, r: 8, t: 10, b: 26 };
  const iw = width - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const max = Math.max(1, ...rows.flatMap((r) => [r.net, r.lastYear ?? 0]));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const band = iw / rows.length;
  const bw = Math.min(12, Math.max(4, (band - 6) / 2));
  const y = (v: number) => pad.t + ih - (Math.max(0, v) / top) * ih;
  const bar = (cx: number, v: number, fill: string) => {
    const yy = y(v);
    const hh = pad.t + ih - yy;
    if (hh <= 0) return null;
    const r = Math.min(4, hh, bw / 2);
    // 위쪽만 둥글게, 바닥은 반듯하게
    const d = `M${cx},${pad.t + ih}V${yy + r}Q${cx},${yy} ${cx + r},${yy}H${cx + bw - r}Q${cx + bw},${yy} ${cx + bw},${yy + r}V${pad.t + ih}Z`;
    return <path d={d} fill={fill} />;
  };
  const hr = hover != null ? rows[hover] : null;
  const cur = rows[rows.length - 1];

  return (
    <ChartCard
      title="월별 매출"
      sub={`이번 달(${label(cur.month)})은 기준일까지 · 작년은 같은 기간`}
      legend={
        <Legend
          items={[
            { color: "var(--series-1)", label: "올해", key: "rect" },
            { color: "var(--ref)", label: "작년 같은 달", key: "rect" },
          ]}
        />
      }
      table={
        <table>
          <thead>
            <tr>
              <th>달</th>
              <th className="num">실매출</th>
              <th className="num">카페</th>
              <th className="num">키즈</th>
              <th className="num">작년</th>
              <th className="num">증감</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.month}>
                <td>{r.month.replace("-", ".")}</td>
                <td className="num">{won(r.net)}</td>
                <td className="num">{won(r.cafe)}</td>
                <td className="num">{won(r.kids)}</td>
                <td className="num">{r.lastYear == null ? "—" : won(r.lastYear)}</td>
                <td className="num">{pct(r.lastYear == null ? null : changePct(r.net, r.lastYear))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="chart" ref={ref}>
        <svg width={width} height={h} role="img" aria-label="월별 매출 막대 그래프">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className="grid" />
              <text x={pad.l - 6} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">
                {wonShort(t)}
              </text>
            </g>
          ))}
          {rows.map((r, i) => {
            const cx = pad.l + band * i + band / 2;
            return (
              <g key={r.month} opacity={hover == null || hover === i ? 1 : 0.55}>
                {bar(cx - bw - 1, r.net, "var(--series-1)")}
                {r.lastYear != null && bar(cx + 1, r.lastYear, "var(--ref)")}
                {(i % 2 === (rows.length - 1) % 2 || band > 34) && (
                  <text x={cx} y={h - 8} className="axis" textAnchor="middle">
                    {label(r.month)}
                  </text>
                )}
                <rect
                  x={pad.l + band * i}
                  y={pad.t}
                  width={band}
                  height={ih}
                  fill="transparent"
                  onPointerEnter={() => setHover(i)}
                  onPointerDown={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                />
              </g>
            );
          })}
          <line x1={pad.l} x2={width - pad.r} y1={pad.t + ih} y2={pad.t + ih} className="baseline" />
        </svg>
        {hr && (
          <Tooltip
            x={pad.l + band * hover! + band / 2}
            y={8}
            width={width}
            title={`${hr.month.slice(0, 4)}년 ${label(hr.month)}${hover === rows.length - 1 ? " (진행 중)" : ""}`}
            rows={[
              { color: "var(--series-1)", key: "rect", label: "올해", value: won(hr.net) },
              { color: "var(--ref)", key: "rect", label: "작년 같은 달", value: hr.lastYear == null ? "자료 없음" : won(hr.lastYear) },
              { label: "증감", value: pct(hr.lastYear == null ? null : changePct(hr.net, hr.lastYear)) },
            ]}
          />
        )}
      </div>
    </ChartCard>
  );
}
