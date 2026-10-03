/* ============================================================
   키즈 입장권 상세
   네이버 입장권 판매수 (11-8): 마감일 총판매수량 · 신규방문자 수 · 신규 비율
     시간대별 판매 막대 (마감일 · 이달 누계) — 작년 같은 날/같은 기간 = 회색, 올해 = 빨강
     날마다(이달) · 달마다(올해) · 올해 쌓은 판매수 선 — 작년 전체 = 회색, 올해 마감일까지 = 빨강
     작년 같은 기간 대비 증감 수 · 증감률 (분석 글 · 고치기 칸 없음 — 네이버는 A 에서 넣음)
   현장 입장권 판매수 · 이벤트 무료입장팀 수: 1일 ~ 말일 막대 (작년 = 회색, 올해 = 빨강)
   ============================================================ */
import {
  changePct,
  count,
  monthDaily,
  monthStart,
  NAVER_SLOTS,
  naverSlots,
  pct,
  lyCalendar,
  lyDay as lyOf,
  shortLabel,
  sum,
  yearMonthly,
  type Board,
  type Metrics,
} from "@report/core";
import { BarChart } from "../charts/BarChart";
import { ChartCard, Legend } from "../charts/common";
import { LineChart, type Line } from "../charts/LineChart";
import { DetailHeader, md, Stat, type Nav } from "./parts";

const LY = "var(--ly)";
const CUR = "var(--cur)";
const n = (v: number) => count(v);

/** 올해 · 작년 · 증감 · 증감률 한 줄 */
function CompareRow({ label, now, before, unit, ok }: { label: string; now: number; before: number; unit: string; ok: boolean }) {
  const p = ok ? changePct(now, before) : null;
  const d = now - before;
  return (
    <tr>
      <td>{label}</td>
      <td className="num">{count(now, unit)}</td>
      <td className="num">{ok ? count(before, unit) : "자료 없음"}</td>
      <td className={`num ${ok && d > 0 ? "up-text" : ok && d < 0 ? "down-text" : ""}`}>{ok ? `${d > 0 ? "+" : ""}${count(d, unit)}` : "—"}</td>
      <td className={`num ${p != null && p > 0 ? "up-text" : p != null && p < 0 ? "down-text" : ""}`}>{p == null ? "—" : pct(p)}</td>
    </tr>
  );
}

function CompareCard({ rows, unit, title = "작년 같은 기간과 비교" }: { rows: { label: string; now: Metrics; before: Metrics; pick: (m: Metrics) => number; has: (m: Metrics) => boolean }[]; unit: string; title?: string }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <table>
        <thead>
          <tr>
            <th />
            <th className="num">올해</th>
            <th className="num">작년</th>
            <th className="num">증감</th>
            <th className="num">증감률</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <CompareRow key={r.label} label={r.label} now={r.pick(r.now)} before={r.pick(r.before)} unit={unit} ok={r.has(r.before)} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

const slotTick = (i: number) => (i % 4 === 0 ? `${10 + i / 2}시` : null);
const slotTip = (i: number) => `${NAVER_SLOTS[i]} ~ ${NAVER_SLOTS[i + 1] || "20:00"}`;

export function NaverDetail(props: { board: Board } & Nav) {
  const { board, date } = props;
  // 작년 = 364일 전 (같은 주 · 같은 요일)
  const ly = lyOf(date);
  const day = board.day(date);
  const lyDay = board.day(ly);
  const daySlots = naverSlots(board, date, date);
  const lyDaySlots = naverSlots(board, ly, ly);
  const monSlots = naverSlots(board, monthStart(date), date);
  // 이달 누계는 달력 날짜 (작년 같은 달 1일 ~ 같은 날짜) · 하루는 364일 전
  const lyMonSlots = naverSlots(board, lyCalendar(monthStart(date)), lyCalendar(date));
  const month = board.range(monthStart(date), date);
  const lyMonth = board.range(lyCalendar(monthStart(date)), lyCalendar(date));
  const year = board.range(`${date.slice(0, 4)}-01-01`, date);
  const lyYear = board.range(lyOf(`${date.slice(0, 4)}-01-01`), ly);
  const daily = monthDaily(board, "naver", date);
  const monthly = yearMonthly(board, "naver", date);
  const yearly = yearMonthly(board, "naver", date, true);
  const ratio = day.naver > 0 && day.newKnown ? Math.round((day.newVisitors / day.naver) * 1000) / 10 : null;
  const has = (m: Metrics) => m.has.naver + m.has.kids > 0;
  const lyY = ly.slice(0, 4);
  const lines = (cur: (number | null)[], last: (number | null)[]): Line[] => [
    { label: `작년 (${lyY})`, color: LY, values: last, weight: 2 },
    { label: "올해", color: CUR, values: cur, weight: 3 },
  ];
  const months = Array.from({ length: 12 }, (_, i) => `${i + 1}`);

  return (
    <>
      <DetailHeader title="네이버 입장권 판매수" {...props} />
      <main className="content">
        {!day.naverInput && (
          <div className="banner">{day.has.kids ? `${shortLabel(date)} 네이버 표가 아직 입력되지 않아 키즈 POS(입장 발행 − 현장)로 추정한 값입니다.` : `${shortLabel(date)} 네이버 표가 아직 입력되지 않았습니다.`}</div>
        )}
        <div className="stats three">
          <Stat label="마감일 총판매수량" value={count(day.naver, "장")} note={has(lyDay) ? `작년 같은 날 ${count(lyDay.naver, "장")}` : undefined} />
          <Stat label="신규방문자 수" value={day.newKnown ? count(day.newVisitors, "명") : "—"} note={day.naverInput && !day.newKnown ? "지난 자료라 알 수 없음" : "방문 완료 1회째"} />
          <Stat label="총인원 대비 신규 비율" value={ratio == null ? "—" : `${ratio}%`} note="신규 ÷ 판매수량" />
        </div>

        <ChartCard
          title={`시간대별 판매 · ${shortLabel(date)}`}
          sub={`30분 칸 · 회색 = 작년 같은 날 (${md(ly)}) · 빨강 = 마감일`}
          legend={<Legend items={[{ label: `작년 ${md(ly)}`, color: LY, key: "rect" }, { label: `마감일 ${md(date)}`, color: CUR, key: "rect" }]} />}
          table={<SlotTable a={lyDaySlots.days ? lyDaySlots.tickets : null} b={daySlots.days ? daySlots.tickets : null} />}
        >
          <BarChart
            xs={NAVER_SLOTS}
            series={[
              { label: `작년 ${md(ly)}`, color: LY, values: lyDaySlots.days ? lyDaySlots.tickets : NAVER_SLOTS.map(() => null) },
              { label: `마감일 ${md(date)}`, color: CUR, values: daySlots.days ? daySlots.tickets : NAVER_SLOTS.map(() => null) },
            ]}
            xTick={slotTick}
            tipTitle={slotTip}
            fmt={(v) => count(v, "장")}
            axisFmt={n}
            label="시간대별 네이버 판매 (마감일)"
          />
        </ChartCard>

        <ChartCard
          title={`시간대별 판매 · 이달 누계 (${Number(date.slice(5, 7))}/1~${md(date)})`}
          sub={`회색 = 작년 같은 기간 (입력 ${lyMonSlots.days}일) · 빨강 = 올해 (입력 ${monSlots.days}일)`}
          legend={<Legend items={[{ label: "작년 같은 기간", color: LY, key: "rect" }, { label: "올해", color: CUR, key: "rect" }]} />}
          table={<SlotTable a={lyMonSlots.days ? lyMonSlots.tickets : null} b={monSlots.days ? monSlots.tickets : null} />}
        >
          <BarChart
            xs={NAVER_SLOTS}
            series={[
              { label: "작년 같은 기간", color: LY, values: lyMonSlots.days ? lyMonSlots.tickets : NAVER_SLOTS.map(() => null) },
              { label: "올해", color: CUR, values: monSlots.days ? monSlots.tickets : NAVER_SLOTS.map(() => null) },
            ]}
            xTick={slotTick}
            tipTitle={slotTip}
            fmt={(v) => count(v, "장")}
            axisFmt={n}
            label="시간대별 네이버 판매 (이달 누계)"
          />
        </ChartCard>

        <ChartCard title={`날마다 판매수 · ${Number(date.slice(5, 7))}월`} sub="회색 = 작년 같은 달 전체 · 빨강 = 올해 마감일까지" legend={<Legend items={lines(daily.cur, daily.ly).map((s) => ({ label: s.label, color: s.color }))} />} table={<ValTable xs={daily.days.map((d) => `${d}일`)} series={lines(daily.cur, daily.ly)} unit="장" />}>
          <LineChart xs={daily.days.map(String)} series={lines(daily.cur, daily.ly)} xTick={(i) => (i === 0 || (i + 1) % 5 === 0 ? `${i + 1}일` : null)} tipTitle={(i) => `${i + 1}일`} fmt={(v) => count(v, "장")} axisFmt={n} selected={Number(date.slice(8)) - 1} label="날마다 네이버 판매수" />
        </ChartCard>

        <ChartCard title="달마다 판매수" sub="회색 = 작년 12달 · 빨강 = 올해 (이번 달은 마감일까지)" legend={<Legend items={lines(monthly.cur, monthly.ly).map((s) => ({ label: s.label, color: s.color }))} />} table={<ValTable xs={months.map((m) => `${m}월`)} series={lines(monthly.cur, monthly.ly)} unit="장" />}>
          <LineChart xs={months} series={lines(monthly.cur, monthly.ly)} xTick={(i) => ((i % 2 === 0 && i !== 10) || i === 11 ? `${i + 1}월` : null)} tipTitle={(i) => `${i + 1}월`} fmt={(v) => count(v, "장")} axisFmt={n} selected={Number(date.slice(5, 7)) - 1} label="달마다 네이버 판매수" />
        </ChartCard>

        <ChartCard title="한 해 쌓은 판매수" sub="1월부터 달마다 쌓은 값 · 회색 = 작년 한 해 · 빨강 = 올해 마감일까지" legend={<Legend items={lines(yearly.cur, yearly.ly).map((s) => ({ label: s.label, color: s.color }))} />} table={<ValTable xs={months.map((m) => `${m}월`)} series={lines(yearly.cur, yearly.ly)} unit="장" />}>
          <LineChart xs={months} series={lines(yearly.cur, yearly.ly)} xTick={(i) => ((i % 2 === 0 && i !== 10) || i === 11 ? `${i + 1}월` : null)} tipTitle={(i) => `${i + 1}월까지`} fmt={(v) => count(v, "장")} axisFmt={n} selected={Number(date.slice(5, 7)) - 1} label="한 해 쌓은 네이버 판매수" />
        </ChartCard>

        <CompareCard
          unit="장"
          title="작년 같은 기간과 비교 (이용자 수)"
          rows={[
            { label: `마감일 (${md(date)})`, now: day, before: lyDay, pick: (m) => m.naver, has },
            { label: "이달 누계", now: month, before: lyMonth, pick: (m) => m.naver, has },
            { label: "올해 누계", now: year, before: lyYear, pick: (m) => m.naver, has },
          ]}
        />
        {month.newKnown > 0 && <p className="note center-note">이달 신규방문자 {count(month.newVisitors, "명")} (입력 화면에 넣은 {count(month.newKnown, "일")})</p>}
      </main>
    </>
  );
}

export function KidsBarsDetail(props: { board: Board; k: "walkIn" | "eventFree" } & Nav) {
  const { board, date, k } = props;
  const unit = k === "walkIn" ? "장" : "팀";
  const title = k === "walkIn" ? "현장 입장권 판매수" : "이벤트 무료입장팀 수";
  const ly = lyOf(date);
  const d = monthDaily(board, k, date);
  const day = board.day(date);
  const pick = (m: Metrics) => m[k];
  const has = (m: Metrics) => m.has.kids > 0;
  const month = board.range(monthStart(date), date);
  const lyMonth = board.range(lyCalendar(monthStart(date)), lyCalendar(date));
  const lyFull = sum(d.ly.map((v) => v || 0));
  const m = Number(date.slice(5, 7));
  return (
    <>
      <DetailHeader title={title} {...props} />
      <main className="content">
        <div className="stats three">
          <Stat label="마감일" value={day.has.kids ? count(pick(day), unit) : "—"} note={shortLabel(date)} />
          <Stat label="이달 누계" value={count(pick(month), unit)} note={`${m}/1 ~ ${md(date)}`} />
          <Stat label={`작년 ${Number(ly.slice(5, 7))}월 전체`} value={d.ly.some((v) => v != null) ? count(lyFull, unit) : "자료 없음"} />
        </div>
        <ChartCard
          title={`날마다 · ${m}월 1일 ~ 말일`}
          sub="회색 = 작년 같은 달 · 빨강 = 올해 (마감일까지)"
          legend={<Legend items={[{ label: `작년 ${ly.slice(0, 4)}`, color: LY, key: "rect" }, { label: "올해", color: CUR, key: "rect" }]} />}
          table={<ValTable xs={d.days.map((x) => `${x}일`)} series={[{ label: "작년", color: LY, values: d.ly }, { label: "올해", color: CUR, values: d.cur }]} unit={unit} />}
        >
          <BarChart
            xs={d.days.map(String)}
            series={[
              { label: `작년 ${ly.slice(0, 4)}`, color: LY, values: d.ly },
              { label: "올해", color: CUR, values: d.cur },
            ]}
            xTick={(i) => (i === 0 || (i + 1) % 5 === 0 ? `${i + 1}` : null)}
            tipTitle={(i) => `${m}월 ${i + 1}일`}
            fmt={(v) => count(v, unit)}
            axisFmt={n}
            label={`${title} 날마다`}
          />
        </ChartCard>
        <CompareCard
          unit={unit}
          rows={[
            { label: `마감일 (${md(date)})`, now: day, before: board.day(ly), pick, has },
            { label: "이달 누계", now: month, before: lyMonth, pick, has },
          ]}
        />
      </main>
    </>
  );
}

function SlotTable({ a, b }: { a: number[] | null; b: number[] | null }) {
  return (
    <table>
      <thead>
        <tr>
          <th>시간</th>
          <th className="num">작년</th>
          <th className="num">올해</th>
        </tr>
      </thead>
      <tbody>
        {NAVER_SLOTS.map((s, i) => (
          <tr key={s}>
            <td>{s}</td>
            <td className="num">{a ? count(a[i], "장") : "—"}</td>
            <td className="num">{b ? count(b[i], "장") : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ValTable({ xs, series, unit }: { xs: string[]; series: Line[] | { label: string; values: (number | null)[] }[]; unit: string }) {
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
          <tr key={x}>
            <td>{x}</td>
            {series.map((s) => (
              <td key={s.label} className="num">
                {s.values[i] == null ? "—" : count(s.values[i]!, unit)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
