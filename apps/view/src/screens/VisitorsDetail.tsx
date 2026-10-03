/* ============================================================
   카페아스타나 방문인원 — 홈의 방문인원 상자를 누르면
   ① 주 단위 합계 선 (월 ~ 일, 1월 첫 주 ~ 마감일이 든 주) — 작년 같은 주(364일 전) 회색 · 올해 분홍
   ② 달마다 막대 (1 ~ 12월) — 작년 같은 달 회색 · 올해 분홍 (마감일이 든 달은 마감일까지)
   방문인원 = 음료 · 맥주 잔 × 0.96 (rules.ts VISITOR_FACTOR)
   ============================================================ */
import { count, shortLabel, weeklyVisitors, yearMonthly, type Board } from "@report/core";
import { BarChart } from "../charts/BarChart";
import { ChartCard, Legend } from "../charts/common";
import { LineChart } from "../charts/LineChart";
import { DetailHeader, md, Stat, type Nav } from "./parts";

const LY = "var(--ly)";
const PINK = "var(--pink-strong)";
/** 세로 눈금 — 1만 넘으면 '1.5만' */
const n = (v: number) => (v >= 10000 ? `${Math.round(v / 1000) / 10}만` : count(v));
const people = (v: number) => count(v, "명");

export function VisitorsDetail(props: { board: Board } & Nav) {
  const { board, date } = props;
  const y = Number(date.slice(0, 4));
  const day = board.day(date);
  const year = board.range(`${y}-01-01`, date);
  const w = weeklyVisitors(board, date);
  const mo = yearMonthly(board, "visitors", date);
  const months = Array.from({ length: 12 }, (_, i) => `${i + 1}`);
  const weekLabel = (i: number) => md(w.starts[i]);
  const legend = <Legend items={[{ label: `작년 (${y - 1})`, color: LY, key: "rect" }, { label: `올해 (${y})`, color: PINK, key: "rect" }]} />;

  return (
    <>
      <DetailHeader title="카페아스타나 방문인원" {...props} />
      <main className="content">
        <div className="stats">
          <Stat label={`마감일 · ${shortLabel(date)}`} value={people(day.visitors)} note={`음료 · 맥주 ${count(day.cups, "잔")} × 0.96`} />
          <Stat label={`${String(y).slice(2)}년 1월 1일 ~ 마감일`} value={people(year.visitors)} note={`하루 평균 ${people(year.has.cafe ? Math.round(year.visitors / year.has.cafe) : 0)}`} />
        </div>

        <ChartCard
          title="주 단위 방문인원 합계"
          sub="월요일 ~ 일요일 합 · 회색 = 작년 같은 주 (같은 요일) · 분홍 = 올해 (마감일이 든 주는 마감일까지)"
          legend={legend}
          table={<Table head="주 (월요일)" rows={w.starts.map((s, i) => [md(s), w.ly[i], w.cur[i]])} />}
        >
          <LineChart
            xs={w.starts}
            series={[
              { label: `작년 (${y - 1})`, color: LY, values: w.ly, weight: 2 },
              { label: `올해 (${y})`, color: PINK, values: w.cur, weight: 3 },
            ]}
            xTick={(i) => {
              // 그 달 첫 주에만 '○월' (두 달에 한 번)
              const mo = Number(w.starts[i].slice(5, 7));
              const first = i === 0 ? w.starts[i].slice(0, 4) === String(y) : w.starts[i].slice(5, 7) !== w.starts[i - 1].slice(5, 7);
              return first && mo % 2 === 1 ? `${mo}월` : null;
            }}
            tipTitle={(i) => `${weekLabel(i)} 주`}
            fmt={people}
            axisFmt={n}
            label="주 단위 방문인원"
            height={230}
          />
        </ChartCard>

        <ChartCard
          title="달마다 방문인원"
          sub={`1 ~ 12월 · 회색 = 작년 같은 달 · 분홍 = 올해 (${Number(date.slice(5, 7))}월은 ${Number(date.slice(8, 10))}일까지)`}
          legend={legend}
          table={<Table head="월" rows={months.map((m, i) => [`${m}월`, mo.ly[i], mo.cur[i]])} />}
        >
          <BarChart
            xs={months}
            series={[
              { label: `작년 (${y - 1})`, color: LY, values: mo.ly },
              { label: `올해 (${y})`, color: PINK, values: mo.cur },
            ]}
            xTick={(i) => `${i + 1}`}
            tipTitle={(i) => `${i + 1}월`}
            fmt={people}
            axisFmt={n}
            label="달마다 방문인원"
          />
        </ChartCard>
        <p className="note center-note">방문인원 = 그날 음료 · 맥주 잔 수 × 0.96 (영수증 · 상품별 엑셀에서)</p>
      </main>
    </>
  );
}

function Table({ head, rows }: { head: string; rows: [string, number | null, number | null][] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>{head}</th>
          <th className="num">작년</th>
          <th className="num">올해</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, a, b]) => (
          <tr key={k}>
            <td>{k}</td>
            <td className="num">{a == null ? "—" : people(a)}</td>
            <td className="num">{b == null ? "—" : people(b)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
