/* 누계 상세 — 당월 누계(날마다 쌓은 선: 이번 달 · 지난달 · 작년 같은 달) / 올해 누계(달마다 쌓은 선: 올해 · 작년) */
import { addMonths, comparable, cumulative, monthCumulative, monthOf, sameDayYearsAgo, won, wonShort, yearCumulative, type Board } from "@report/core";
import { ChartCard, Legend } from "../charts/common";
import { LineChart, type Line } from "../charts/LineChart";
import { DetailHeader } from "./Detail";
import { Delta } from "./Home";

export function CumDetail(props: { board: Board; kind: "month" | "year"; date: string; minDate: string; maxDate: string; onDate: (d: string) => void; onBack: () => void }) {
  const { board, kind, date } = props;
  const v = cumulative(board, kind, date);
  const ly = sameDayYearsAgo(date);
  const m = Number(date.slice(5, 7));
  const lyHas = comparable(v.ly);
  const lyDays = Math.max(v.ly.has.cafe, v.ly.has.kids);

  let xs: string[];
  let series: Line[];
  let xTick: (i: number) => string | null;
  let tipTitle: (i: number) => string;
  let selected: number;
  if (kind === "month") {
    const c = monthCumulative(board, date);
    const pm = addMonths(monthOf(date), -1);
    xs = c.days.map(String);
    series = [
      { label: `이번 달 (${m}월)`, color: "var(--series-1)", values: c.cur },
      { label: `지난달 (${Number(pm.slice(5))}월)`, color: "var(--series-2)", values: c.prev, weight: 1.5 },
      { label: `작년 ${Number(ly.slice(5, 7))}월`, color: "var(--ref)", values: c.ly, weight: 1.5 },
    ];
    xTick = (i) => (i === 0 || (i + 1) % 5 === 0 ? `${i + 1}일` : null);
    tipTitle = (i) => `${i + 1}일까지 누계`;
    selected = Number(date.slice(8)) - 1;
  } else {
    const c = yearCumulative(board, date);
    xs = c.months.map(String);
    series = [
      { label: `올해 (${date.slice(0, 4)})`, color: "var(--series-1)", values: c.cur },
      { label: `작년 (${ly.slice(0, 4)})`, color: "var(--ref)", values: c.ly, weight: 1.5 },
    ];
    xTick = (i) => (i % 2 === 0 || i === 11 ? `${i + 1}월` : null);
    tipTitle = (i) => `${i + 1}월까지 누계${i === m - 1 ? ` (올해는 ${Number(date.slice(8))}일까지)` : ""}`;
    selected = m - 1;
  }

  return (
    <>
      <DetailHeader title={kind === "month" ? "당월 누계" : "올해 누계"} date={date} onBack={props.onBack} onDate={props.onDate} minDate={props.minDate} maxDate={props.maxDate} />
      <main className="content">
        <section className="card hero">
          <div className="stat-label">{kind === "month" ? `${m}월 1일 ~ ${Number(date.slice(8))}일` : `1월 1일 ~ ${m}월 ${Number(date.slice(8))}일`} 누계</div>
          <div className="hero-value">{won(v.cur.total)}</div>
          <Delta now={v.cur.total} before={lyHas ? v.ly.total : null} label="작년 같은 기간" money={false} missing={lyDays ? `작년 자료 ${lyDays}일치뿐 · 비교 안 함` : undefined} />
        </section>

        <div className="stats">
          <div className="stat">
            <div className="stat-label">작년 같은 기간</div>
            <div className="stat-value">{lyDays ? won(v.ly.total) : "자료 없음"}</div>
            {lyDays > 0 && !lyHas && <span className="note">{lyDays}일치만 있음</span>}
          </div>
          <div className="stat">
            <div className="stat-label">{kind === "month" ? `작년 ${Number(ly.slice(5, 7))}월 전체` : `작년 한 해 전체`}</div>
            <div className="stat-value">{comparable(v.lyFull) ? won(v.lyFull.total) : "자료 부족"}</div>
          </div>
          {v.prev && (
            <div className="stat">
              <div className="stat-label">지난달 같은 기간</div>
              <div className="stat-value">{comparable(v.prev) ? won(v.prev.total) : "자료 부족"}</div>
              <Delta now={v.cur.total} before={comparable(v.prev) ? v.prev.total : null} label="이달" money={false} />
            </div>
          )}
          <div className="stat">
            <div className="stat-label">추정 방문자 · 1인 평균</div>
            <div className="stat-value">{v.cur.visitors.toLocaleString("ko-KR")}명</div>
            <span className="note">1인 {v.cur.avgSpend == null ? "—" : won(v.cur.avgSpend)}</span>
          </div>
        </div>

        <ChartCard
          title="누계 흐름"
          sub={kind === "month" ? "날마다 쌓은 매출" : "달마다 쌓은 매출"}
          legend={<Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />}
          table={
            <table>
              <thead>
                <tr>
                  <th>{kind === "month" ? "일" : "월"}</th>
                  {series.map((s) => (
                    <th key={s.label} className="num">
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {xs.map((x, i) => (
                  <tr key={x} className={i === selected ? "sel" : ""}>
                    <td>
                      {x}
                      {kind === "month" ? "일" : "월"}
                    </td>
                    {series.map((s) => (
                      <td key={s.label} className="num">
                        {s.values[i] == null ? "—" : won(s.values[i]!)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          <LineChart xs={xs} series={series} xTick={xTick} tipTitle={tipTitle} fmt={won} axisFmt={wonShort} selected={selected} label="누계 흐름" />
        </ChartCard>

        <section className="card">
          <h2>분석</h2>
          <ul className="analysis">
            {v.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
