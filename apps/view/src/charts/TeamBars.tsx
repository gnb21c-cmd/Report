/* 팀별 매출 가로 막대 (한 색) — 값과 비율을 막대 끝에 */
import { won, type Agg, type Team, TEAMS } from "@report/core";

export function TeamBars({ agg }: { agg: Agg }) {
  const rows = TEAMS.map((t) => ({ team: t as Team, net: agg.byTeam[t] })).filter((r) => r.team !== "기타" || r.net !== 0);
  const max = Math.max(1, ...rows.map((r) => r.net));
  return (
    <div className="hbars" role="list">
      {rows.map((r) => (
        <div className="hbar" role="listitem" key={r.team} title={`${r.team} ${won(r.net)}`}>
          <span className="hbar-label">{r.team}</span>
          <span className="hbar-track">
            <span className="hbar-fill" style={{ width: `${Math.max(0, (r.net / max) * 100)}%` }} />
          </span>
          <span className="hbar-value">
            {won(r.net)}
            <small>{agg.net > 0 ? ` ${Math.round((r.net / agg.net) * 100)}%` : ""}</small>
          </span>
        </div>
      ))}
    </div>
  );
}
