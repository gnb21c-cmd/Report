/* ============================================================
   섹터 상세 (바리스타 · 베이커리 · 키친 · 키즈입장 · 기타 — 모두 같은 모양, 11-2 ~ 11-4)
   ① 마감일 금액 + 날씨
   ② 마감일 시간대별 매출 (10~22시, 핑크 막대 · 막대 위 추정 인원)
   ③ 지난 4주 같은 요일 평균 (같은 눈금)
   ④ 시간대별 4주 같은 요일 추세 (선 · 시간마다 ▲ ▼)
   ⑤ 분석 (선호 시간 이동 · 피크 · 비슷한 날씨 · 매출 속도 · 다음 주 예측)
   ⑥ 적게 팔린 상품 5개 (그날 · 이달) — 기타는 뺌 (자판기 · 네컷 · 주차 등 상품이 아님)
   ============================================================ */
import { useMemo, useState } from "react";
import {
  bottomProducts,
  count,
  extraTotal,
  hourDay,
  hourLabel,
  hourlyInsights,
  kidsPrice,
  lowSellers,
  HOURS,
  shortLabel,
  weeksAverage,
  weeksTrend,
  won,
  wonShort,
  type Board,
  type BoxKey,
  type Metrics,
  type WeatherMap,
} from "@report/core";
import { BarChart } from "../charts/BarChart";
import { ChartCard, Legend } from "../charts/common";
import { LineChart, type Line } from "../charts/LineChart";
import { HeroBox } from "../ui/WeatherPanel";
import { BOX_LABEL, Delta } from "./Home";
import { DetailHeader, md, Seg, type Nav } from "./parts";

const xs = HOURS.map(String);
const xTick = (i: number) => (i % 2 === 0 ? hourLabel(HOURS[i]) : null);
const tip = (i: number) => `${HOURS[i]}시 ~ ${HOURS[i] + 1}시`;
const TREND_COLORS = ["var(--trend-4)", "var(--trend-3)", "var(--trend-2)", "var(--trend-1)", "var(--pink-strong)"];

export function SectorDetail(props: { board: Board; box: BoxKey; weather: WeatherMap } & Nav) {
  // 기타는 시간대 · 분석 없이 매출 분류만 (자판기 · 인생네컷 · 주차 · 매장 소액 기타)
  if (props.box === "기타") return <EtcDetail {...props} />;
  return <SalesDetail {...props} />;
}

function SalesDetail(props: { board: Board; box: BoxKey; weather: WeatherMap } & Nav) {
  const { board, box, date } = props;
  const name = box === "키즈입장료" ? "키즈 입장료" : BOX_LABEL[box];
  const kids = box === "키즈입장료";
  const m = board.day(date);
  const pw = board.day(addWeek(date, -1));
  const today = useMemo(() => hourDay(board, date, box), [board, date, box]);
  const avg = useMemo(() => weeksAverage(board, date, box), [board, date, box]);
  const trend = useMemo(() => weeksTrend(board, date, box), [board, date, box]);
  const lines = useMemo(() => hourlyInsights(board, date, box, props.weather), [board, date, box, props.weather]);
  const yMax = Math.max(0, ...(today?.sales || []), ...avg.sales.map((v) => v || 0));
  const unit = kids ? "장" : "명";

  return (
    <>
      <DetailHeader title={name} {...props} />
      <main className="content">
        <HeroBox label={`${shortLabel(date)} ${name}`} value={won(m.box[box])} date={date} w={props.weather[date]}>
          <Delta now={m.box[box]} before={pw.has.cafe + pw.has.kids ? pw.box[box] : null} label="지난주 같은 요일" money={false} />
          {m.total > 0 && <span className="note">총 매출의 {((m.box[box] / m.total) * 100).toFixed(1)}%</span>}
          {box === "키즈입장료" && <span className="note">{kidsFormula(m, date)}</span>}
        </HeroBox>

        <ChartCard
          title="마감일 시간대별 매출"
          sub={kids ? "10시~22시 · 막대 위 숫자 = 그 시간 입장권 수(장) — 네이버 예약 시간 + 현장 결제" : "10시~22시 · 막대 위 숫자 = 그 시간 추정 인원(명) — 음료 잔 × 0.96"}
          table={<HourTable sales={today?.sales || null} people={today?.people || null} unit={unit} />}
        >
          {today ? (
            <BarChart
              xs={xs}
              series={[{ label: shortLabel(date), color: "var(--pink)", values: today.sales }]}
              top={today.people.map((p, i) => (today.sales[i] > 0 && p > 0 ? String(p) : null))}
              xTick={xTick}
              tipTitle={tip}
              fmt={won}
              axisFmt={wonShort}
              yMax={yMax}
              label="마감일 시간대별 매출"
            />
          ) : (
            <p className="empty">이날은 시간대 자료가 없습니다 (영수증별 엑셀로 올린 날만 나옵니다).</p>
          )}
        </ChartCard>

        <ChartCard
          title="지난 4주 같은 요일 평균"
          sub={avg.dates.length ? `${avg.dates.map(md).reverse().join(" · ")} 평균 (${avg.dates.length}일)` : "같은 요일 시간대 자료가 아직 없습니다"}
          table={<HourTable sales={avg.dates.length ? avg.sales.map((v) => v || 0) : null} people={avg.dates.length ? avg.people.map((v) => v || 0) : null} unit={unit} />}
        >
          {avg.dates.length ? (
            <BarChart
              xs={xs}
              series={[{ label: "4주 평균", color: "var(--pink-soft)", values: avg.sales }]}
              top={avg.people.map((p, i) => ((avg.sales[i] || 0) > 0 && (p || 0) > 0 ? String(p) : null))}
              xTick={xTick}
              tipTitle={tip}
              fmt={won}
              axisFmt={wonShort}
              yMax={yMax}
              label="지난 4주 같은 요일 시간대별 평균"
            />
          ) : (
            <p className="empty">영수증별 엑셀이 쌓이면 나옵니다.</p>
          )}
        </ChartCard>

        <TrendCard trend={trend} />

        <section className="card">
          <h2>분석 · 4주 추세</h2>
          <ul className="analysis">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>

        {/* 맨 밑: 바리스타 = 적게 팔린 상품 5개 · 베이커리 = 60일 최저 판매 빵 10종 · 키친 · 키즈 = 없음 */}
        {box === "바리스타" && <BottomCard board={board} box={box} date={date} />}
        {box === "베이커리" && <LowSellersCard board={board} date={date} />}
      </main>
    </>
  );
}

function addWeek(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

function HourTable({ sales, people, unit }: { sales: number[] | null; people: number[] | null; unit: string }) {
  if (!sales) return <p className="empty">자료가 없습니다.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>시간</th>
          <th className="num">매출</th>
          <th className="num">{unit === "장" ? "입장권" : "추정 인원"}</th>
        </tr>
      </thead>
      <tbody>
        {HOURS.map((h, i) => (
          <tr key={h}>
            <td>
              {h}시~{h + 1}시
            </td>
            <td className="num">{won(sales[i])}</td>
            <td className="num">{people ? count(people[i], unit) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TrendCard({ trend }: { trend: ReturnType<typeof weeksTrend> }) {
  const series: Line[] = trend.days.map((d, k) => ({
    label: d.weeksAgo ? `${d.weeksAgo}주 전 (${md(d.date)})` : `마감일 (${md(d.date)})`,
    color: d.weeksAgo ? TREND_COLORS[4 - d.weeksAgo] : TREND_COLORS[4],
    values: d.sales,
    weight: d.weeksAgo ? 1.5 : 3,
    noDot: k !== trend.days.length - 1,
  }));
  const arrows = trend.dir.map((d) => (d === 1 ? { text: "▲", color: "var(--good)" } : d === -1 ? { text: "▼", color: "var(--bad)" } : { text: d === 0 ? "–" : "", color: "var(--muted)" }));
  return (
    <ChartCard
      title="시간대별 4주 같은 요일 추세"
      sub="옅은 선 = 4주 전 → 진한 선 = 마감일 · 아래 ▲ 오름 ▼ 내림 (주마다 5% 넘게)"
      legend={series.length ? <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} /> : undefined}
      table={
        <table>
          <thead>
            <tr>
              <th>시간</th>
              {trend.days.map((d) => (
                <th key={d.date} className="num">
                  {md(d.date)}
                </th>
              ))}
              <th className="num">추세</th>
            </tr>
          </thead>
          <tbody>
            {HOURS.map((h, i) => (
              <tr key={h}>
                <td>{h}시</td>
                {trend.days.map((d) => (
                  <td key={d.date} className="num">
                    {wonShort(d.sales[i])}
                  </td>
                ))}
                <td className="num">{trend.rate[i] == null ? arrows[i].text || "—" : `${arrows[i].text} ${trend.rate[i]! > 0 ? "+" : ""}${trend.rate[i]}%/주`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {trend.days.length >= 2 ? (
        <>
          <LineChart xs={xs} series={series} xTick={xTick} tipTitle={tip} fmt={won} axisFmt={wonShort} label="시간대별 4주 같은 요일 추세" height={220} />
          <div className="arrows" aria-label="시간마다 오름 내림">
            {arrows.map((a, i) => (
              <span key={i} style={{ color: a.color }} title={tip(i)}>
                {a.text}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="empty">같은 요일 시간대 자료가 2번 이상 쌓이면 나옵니다.</p>
      )}
    </ChartCard>
  );
}

function BottomCard({ board, box, date }: { board: Board; box: BoxKey; date: string }) {
  const [span, setSpan] = useState<"day" | "month">("day");
  const rows = useMemo(() => bottomProducts(board, date, box, span, 5), [board, date, box, span]);
  return (
    <section className="card">
      <h2>적게 팔린 상품 5개</h2>
      <p className="sub">{span === "day" ? "마감일에 팔린 상품 중 수량이 적은 순" : "이달(1일~마감일) 수량이 적은 순 · 최근 90일 안에 팔린 적 있는 상품은 0개도"}</p>
      <div className="card-tools top-gap">
        <Seg
          value={span}
          options={[
            ["day", "마감일"],
            ["month", "이달"],
          ]}
          onChange={setSpan}
        />
      </div>
      {rows.length ? (
        <table>
          <thead>
            <tr>
              <th>상품</th>
              <th className="num">수량</th>
              <th className="num">실매출</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.store + p.name}>
                <td>
                  {p.name}
                </td>
                <td className="num">{count(p.qty)}</td>
                <td className="num">{won(p.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty">판매 자료가 없습니다.</p>
      )}
    </section>
  );
}

/** 키즈입장 계산식 한 줄 (그날) */
function kidsFormula(m: Metrics, date: string): string {
  const p = kidsPrice(date);
  return p.charged
    ? `${p.kind} 단가 ${won(p.price)} × 입장권 ${count(m.naver + m.walkIn, "장")}${m.kidsCoupon ? ` − 사은권 ${won(m.kidsCoupon)}` : ""} = 키즈입장 ${won(m.box.키즈입장료)}`
    : `교환권 방식(26년 3월까지) — 네이버 ${count(Math.round(m.fee.naver / 30000), "장")} × 3만원 + 현장 ${won(m.fee.walkIn)} − 카페 교환권 사용 ${won(m.kidsCoupon)} = 키즈입장 ${won(m.box.키즈입장료)}`;
}

/** 베이커리 — 마감일까지 60일 동안 적게 팔린 빵 10종 (매출액 · 60일 이동 합계 대비 비율) */
function LowSellersCard({ board, date }: { board: Board; date: string }) {
  const r = useMemo(() => lowSellers(board, date, "베이커리", 60, 10), [board, date]);
  return (
    <section className="card">
      <div className="low-head">
        <h2>60일 최저 판매 빵 10종</h2>
        <div className="low-total">
          <span className="note">60일 이동 합계</span>
          <b>{won(r.total)}</b>
        </div>
      </div>
      <p className="sub">
        {md(r.from)} ~ {md(date)} (마감일 포함 60일) · 매출액이 적은 순
      </p>
      {r.rows.length ? (
        <table>
          <thead>
            <tr>
              <th>빵</th>
              <th className="num">60일 매출</th>
              <th className="num">비율</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((p) => (
              <tr key={p.name}>
                <td>{p.name}</td>
                <td className="num">{won(p.net)}</td>
                <td className="num">{(p.share * 100).toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty">판매 자료가 없습니다.</p>
      )}
    </section>
  );
}

/** 기타 — 그날 자판기 · 인생네컷 · 주차료 · 매장 소액 기타, 아래 회색 글씨 = 1/1 ~ 마감일 누적 */
function EtcDetail(props: { board: Board; box: BoxKey; weather: WeatherMap } & Nav) {
  const { board, date } = props;
  const m = board.day(date);
  const y = board.range(`${date.slice(0, 4)}-01-01`, date);
  const pw = board.day(addWeek(date, -1));
  const small = (x: Metrics) => x.box.기타 - extraTotal(x.extra);
  const rows: { label: string; day: number; ytd: number }[] = [
    { label: "자판기", day: m.extra.vending, ytd: y.extra.vending },
    { label: "네컷사진", day: m.extra.photo, ytd: y.extra.photo },
    { label: "주차료", day: m.extra.parking, ytd: y.extra.parking },
    { label: "매장 소액 기타", day: small(m), ytd: small(y) },
  ];
  const per = `${date.slice(2, 4)}년 1월 1일 ~ ${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;
  return (
    <>
      <DetailHeader title="기타" {...props} />
      <main className="content">
        <HeroBox label={`${shortLabel(date)} 기타`} value={won(m.box.기타)} date={date} w={props.weather[date]}>
          <Delta now={m.box.기타} before={pw.has.cafe + pw.has.kids ? pw.box.기타 : null} label="지난주 같은 요일" money={false} />
          {m.total > 0 && <span className="note">총 매출의 {((m.box.기타 / m.total) * 100).toFixed(1)}%</span>}
        </HeroBox>
        <div className="stats">
          {rows.slice(0, 2).map((r) => (
            <EtcStat key={r.label} {...r} per={per} />
          ))}
        </div>
        <div className="stats">
          {rows.slice(2).map((r) => (
            <EtcStat key={r.label} {...r} per={per} />
          ))}
        </div>
        <p className="note center-note">
          {per} 기타 매출 합계 {won(y.box.기타)} · 자판기 · 네컷사진 · 주차료 = 카드 단말기 승인 내역(나이스 · KIS) · 매장 소액 기타 = POS 기타 상품 (키즈 간식 · 연장 요금 등 포함)
        </p>
      </main>
    </>
  );
}

function EtcStat({ label, day, ytd, per }: { label: string; day: number; ytd: number; per: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{won(day)}</div>
      <span className="note period">
        {per} 누적 {label} 매출 {won(ytd)}
      </span>
    </div>
  );
}
