/* ============================================================
   누계 상세 (분석 글 없음)
   당월누계 (11-5): 작년 같은 달 같은 기간 누계 · 날마다 쌓은 선 (작년 같은 달 한 달 전체 = 회색, 이번 달 마감일까지 = 빨강)
                   · 방문자 (마감일 · 당월 누적 · 작년 동월 동기간) · 1인 평균 (마감일 · 누적)
   올해누계 (11-6): 작년 같은 기간 누계 · 달마다 쌓은 선 (작년 12달 = 회색, 올해 = 빨강) · 12월에 연말 예상 점
                   · 방문자 (마감월 누적 · 작년 같은 달 · 1/1~마감일 · 작년 1/1~같은 날)
   ‹ › 는 한 달씩 (고른 달 마지막 날까지 — 마감일이 든 달은 마감일). 지난달로 가면 그 달 한 달치가 다 그려짐
   ============================================================ */
import { useState } from "react";
import { comparable, count, lyDay, monthView, won, wonShort, yearView, type Board, type Metrics } from "@report/core";
import { ChartCard, Legend } from "../charts/common";
import { LineChart, type Line } from "../charts/LineChart";
import { Delta, partial } from "./Home";
import { MonthHeader, Stat, type Nav } from "./parts";

const visitors = (m: Metrics) => (m.has.cafe ? count(m.visitors, "명") : "자료 없음");
const money = (m: Metrics) => (m.has.cafe + m.has.kids ? won(m.total) : "자료 없음");
const dot = (d: string) => d.replaceAll("-", ".");

export function MonthDetail(props: { board: Board } & Nav) {
  const { board } = props;
  // 달 단위로 움직임 (홈의 날짜는 그대로)
  const [date, setDate] = useState(props.date);
  const v = monthView(board, date);
  const ly = lyDay(date); // 작년 = 364일 전 (같은 요일)
  const m = Number(date.slice(5, 7));
  // 작년 같은 달 = 이번 달 날짜마다 364일 전 (말일이 다음 달 1일로 넘어가도 이름은 이번 달)
  const lm = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const series: Line[] = [
    { label: `작년 ${lm}월 (${Number(date.slice(0, 4)) - 1})`, color: "var(--ly)", values: v.ly, weight: 2 },
    { label: `올해 ${m}월`, color: "var(--cur)", values: v.cur, weight: 3 },
  ];
  return (
    <>
      <MonthHeader title="당월누계" {...props} date={date} onDate={setDate} />
      <main className="content">
        <section className="card hero">
          <div className="stat-label">
            {m}월 1일 ~ {d}일 누계
          </div>
          <div className="hero-value">{won(v.month.total)}</div>
          <Delta now={v.month.total} before={comparable(v.lyMonth) ? v.lyMonth.total : null} label="작년 같은 달 같은 기간" money={false} missing={partial(v.lyMonth)} />
        </section>
        <div className="stats">
          <Stat label="작년 같은 달 같은 기간 누계" value={money(v.lyMonth)} note={`${dot(v.lyMonth.from)} ~ ${ly.slice(5).replace("-", ".")}`} />
          <Stat label={`작년 ${lm}월 한 달 전체`} value={money(v.lyFull)} note={v.lyFull.total > 0 && comparable(v.lyFull) ? `올해 ${((v.month.total / v.lyFull.total) * 100).toFixed(1)}% 채움` : undefined} />
        </div>

        <ChartCard
          title="누계 흐름"
          sub="날마다 쌓은 매출 · 회색 = 작년 같은 달 전체 · 빨강 = 올해 마감일까지"
          legend={<Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />}
          table={<CumTable xs={v.days.map((x) => `${x}일`)} series={series} sel={d - 1} />}
        >
          <LineChart
            xs={v.days.map(String)}
            series={series}
            xTick={(i) => (i === 0 || (i + 1) % 5 === 0 ? `${i + 1}일` : null)}
            tipTitle={(i) => `${i + 1}일까지 누계`}
            fmt={won}
            axisFmt={wonShort}
            selected={d - 1}
            label="당월 누계 흐름"
            height={220}
          />
        </ChartCard>

        <h3 className="group">방문 · 1인 평균소비</h3>
        <div className="stats">
          <Stat label="마감일 방문자 수" value={visitors(v.day)} />
          <Stat label="당월 누적 방문자 수" value={visitors(v.month)} />
          <Stat label="작년 동월 동기간 누적 방문자 수" value={visitors(v.lyMonth)} note={v.lyMonth.has.cafe ? <Delta now={v.month.visitors} before={comparable(v.lyMonth) ? v.lyMonth.visitors : null} label="올해" money={false} missing="비교 안 함" /> : undefined} />
          <Stat label="마감일 1인 평균 소비금액" value={v.day.avgSpend == null ? "—" : won(v.day.avgSpend)} />
          <Stat label="누적 1인 평균 소비금액" value={v.month.avgSpend == null ? "—" : won(v.month.avgSpend)} note={`${m}/1 ~ ${m}/${d}`} />
        </div>
      </main>
    </>
  );
}

export function YearDetail(props: { board: Board } & Nav) {
  const { board } = props;
  const [date, setDate] = useState(props.date);
  // 숫자는 고른 달 마지막 날까지, 선은 그해 마감일까지 다 (옅은 파란 칸 = 고른 달)
  const v = yearView(board, date);
  const lineDate = date.slice(0, 4) === props.maxDate.slice(0, 4) ? props.maxDate : `${date.slice(0, 4)}-12-31`;
  const vLine = lineDate === date ? v : yearView(board, lineDate);
  const y = date.slice(0, 4);
  const ly = lyDay(date); // 작년 = 364일 전 (같은 요일)
  const m = Number(date.slice(5, 7));
  // 작년 같은 달 = 이번 달 날짜마다 364일 전 (말일이 다음 달 1일로 넘어가도 이름은 이번 달)
  const lm = Number(date.slice(5, 7));
  const series: Line[] = [
    { label: `작년 (${ly.slice(0, 4)})`, color: "var(--ly)", values: vLine.ly, weight: 2 },
    { label: `올해 (${y})`, color: "var(--cur)", values: vLine.cur, weight: 3 },
  ];
  // 마감월 점 → 12월 연말 예상 점을 잇는 점선
  const em = Number(lineDate.slice(5, 7));
  const start = vLine.cur[em - 1];
  if (vLine.estimate && em < 12 && start != null)
    series.push({ label: "연말 예상", color: "var(--cur)", values: vLine.months.map((mo) => (mo < em ? null : start + ((vLine.estimate!.value - start) * (mo - em)) / (12 - em))), weight: 1.5, dash: true, noDot: true });
  const marks = vLine.estimate ? [{ i: 11, v: vLine.estimate.value, color: "var(--cur)", label: `연말 예상 ${wonShort(vLine.estimate.value)}` }] : [];
  return (
    <>
      <MonthHeader title="올해누계" {...props} date={date} onDate={setDate} />
      <main className="content">
        <section className="card hero">
          <div className="stat-label">
            1월 1일 ~ {m}월 {Number(date.slice(8, 10))}일 누계
          </div>
          <div className="hero-value">{won(v.year.total)}</div>
          <Delta now={v.year.total} before={comparable(v.lyYear) ? v.lyYear.total : null} label="작년 같은 기간" money={false} missing={partial(v.lyYear)} />
        </section>
        <div className="stats">
          <Stat label="작년 같은 기간 누계" value={money(v.lyYear)} note={`${dot(v.lyYear.from)} ~ ${ly.slice(5).replace("-", ".")}`} />
          <Stat label="연말 예상 (12월 31일)" value={vLine.estimate ? won(vLine.estimate.value) : "—"} note={vLine.estimate ? vLine.estimate.how : "자료가 쌓이면 나옵니다"} />
        </div>

        <ChartCard
          title="누계 흐름"
          sub="달마다 쌓은 매출 · 회색 = 작년 12달 · 빨강 = 올해 마감일까지 · 12월의 빨간 점 = 연말 예상"
          legend={<Legend items={series.filter((s) => !s.dash).map((s) => ({ label: s.label, color: s.color }))} />}
          table={<CumTable xs={v.months.map((x) => `${x}월`)} series={series.filter((s) => !s.dash)} sel={m - 1} />}
        >
          <LineChart
            xs={v.months.map(String)}
            series={series}
            marks={marks}
            xTick={(i) => ((i % 2 === 0 && i !== 10) || i === 11 ? `${i + 1}월` : null)}
            tipTitle={(i) => `${i + 1}월까지 누계${i === m - 1 ? ` (올해는 ${Number(date.slice(8))}일까지)` : ""}`}
            fmt={won}
            axisFmt={wonShort}
            selected={m - 1}
            label="올해 누계 흐름"
            height={230}
          />
        </ChartCard>

        <h3 className="group">방문</h3>
        <div className="stats">
          <Stat label={`${m}월 누적 방문자 수`} value={visitors(v.month)} note={`${m}/1 ~ 마감일`} />
          <Stat label={`작년 ${lm}월 방문자 수`} value={visitors(v.lyMonthFull)} note={`${Number(date.slice(0, 4)) - 1}년 ${lm}월 한 달`} />
          <Stat label="1월 1일 ~ 마감일 방문자 수" value={visitors(v.year)} />
          <Stat label="작년 1월 1일 ~ 같은 날 방문자 수" value={visitors(v.lyYear)} note={v.lyYear.has.cafe ? <Delta now={v.year.visitors} before={comparable(v.lyYear) ? v.lyYear.visitors : null} label="올해" money={false} missing="비교 안 함" /> : undefined} />
        </div>
      </main>
    </>
  );
}

function CumTable({ xs, series, sel }: { xs: string[]; series: Line[]; sel: number }) {
  return (
    <table>
      <thead>
        <tr>
          <th />
          {series.map((s) => (
            <th key={s.label} className="num">
              {s.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {xs.map((x, i) => (
          <tr key={x} className={i === sel ? "sel" : ""}>
            <td>{x}</td>
            {series.map((s) => (
              <td key={s.label} className="num">
                {s.values[i] == null ? "—" : won(s.values[i]!)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
