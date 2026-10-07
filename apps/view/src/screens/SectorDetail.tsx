/* ============================================================
   섹터 상세 (바리스타 · 베이커리 · 키친 · 키즈입장 · 기타 — 모두 같은 모양, 11-2 ~ 11-4)
   ① 마감일 금액 + 날씨
   ② 마감일 시간대별 매출 (10~22시, 핑크 막대 · 막대 위 추정 인원)
   ③ 지난 4주 같은 요일 평균 (같은 눈금)
   ④ 시간대별 4주 같은 요일 추세 (선 · 시간마다 ▲ ▼)
   ⑤ 분석 (판단 · 달라진 이유 · 흐름 · 운영 관점 해석 · 다음 주 — packages/core/src/insight.ts)
   ⑥ 적게 팔린 상품 5개 (그날 · 이달) — 기타는 뺌 (자판기 · 네컷 · 주차 등 상품이 아님)
   베이커리만: 맨 위 총 생산 · 정가판매 · 할인판매 · 폐기 합계, 맨 아래 빵별 같은 표
     생산 = 그날 D 확정 수량(그날 생산 기록) · 판매 = 다음 날 아침 수집한 영수증 · 폐기 = 생산 − 정가 − 할인
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import {
  count,
  breadTotals,
  dayResult,
  extraTotal,
  hourDay,
  hourLabel,
  kidsPrice,
  HOURS,
  sectorAnalysis,
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
import { useBakeryDoc, type BakeryDoc } from "../data/bakery";
import { useNoCompare } from "../ui/Live";
import { BarChart } from "../charts/BarChart";
import { ChartCard, Legend } from "../charts/common";
import { LineChart, type Line } from "../charts/LineChart";
import { HeroBox } from "../ui/WeatherPanel";
import { BOX_LABEL, Delta } from "./Home";
import { DetailHeader, md, Seg, type Nav } from "./parts";

const xs = HOURS.map(String);
const xTick = (i: number) => (i % 2 === 0 ? hourLabel(HOURS[i]) : null);
const tip = (i: number) => `${HOURS[i]}시 ~ ${HOURS[i] + 1}시`;
const TREND_COLORS = [
  "var(--trend-4)",
  "var(--trend-3)",
  "var(--trend-2)",
  "var(--trend-1)",
  "var(--pink-strong)",
];

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
  const analysis = useMemo(
    () => sectorAnalysis(board, date, box, props.weather),
    [board, date, box, props.weather],
  );
  const yMax = Math.max(0, ...(today?.sales || []), ...avg.sales.map((v) => v || 0));
  const unit = kids ? "장" : "명";
  const bread = useBakeryDoc(board, box === "베이커리" ? date : "");
  // 마감 전(하루가 안 끝난 숫자)이면 4주 추세 · 분석 글은 틀린 판단이 되므로 숨김
  const notClosed = useNoCompare();

  return (
    <>
      <DetailHeader title={name} {...props} />
      <main className="content">
        <HeroBox
          label={`${shortLabel(date)} ${name}`}
          value={won(m.box[box])}
          date={date}
          w={props.weather[date]}
        >
          <Delta
            now={m.box[box]}
            before={pw.has.cafe + pw.has.kids ? pw.box[box] : null}
            label="지난주 같은 요일"
            money={false}
          />
          {m.total > 0 && (
            <span className="note">총 매출의 {((m.box[box] / m.total) * 100).toFixed(1)}%</span>
          )}
          {box === "키즈입장료" && <span className="note">{kidsFormula(m, date)}</span>}
        </HeroBox>

        {box === "베이커리" && <BreadCount board={board} date={date} doc={bread} />}

        <ChartCard
          title="마감일 시간대별 매출"
          sub={
            kids
              ? "10시~22시 · 막대 위 숫자 = 그 시간 입장권 수(장) — 네이버 예약 시간 + 현장 결제"
              : "10시~22시 · 막대 위 숫자 = 그 시간 추정 인원(명) — 음료 잔 × 0.96"
          }
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
          sub={
            avg.dates.length
              ? `${avg.dates.map(md).reverse().join(" · ")} 평균 (${avg.dates.length}일)`
              : "같은 요일 시간대 자료가 아직 없습니다"
          }
          table={
            <HourTable
              sales={avg.dates.length ? avg.sales.map((v) => v || 0) : null}
              people={avg.dates.length ? avg.people.map((v) => v || 0) : null}
              unit={unit}
            />
          }
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

        {notClosed ? (
          <section className="card">
            <h2>추세 · 분석</h2>
            <p className="empty">마감 전 숫자라 4주 추세와 분석은 마감(다음 날) 뒤에 보입니다.</p>
          </section>
        ) : (
          <>
            <TrendCard trend={trend} />

            <section className="card">
              <h2>분석</h2>
              {analysis.map((s) => (
                <div className="analysis-part" key={s.title}>
                  <h3>{s.title}</h3>
                  <ul className="analysis">
                    {s.lines.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          </>
        )}

        {box === "베이커리" && <BreadTable board={board} date={date} doc={bread} />}
      </main>
    </>
  );
}

function addWeek(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

function HourTable({
  sales,
  people,
  unit,
}: {
  sales: number[] | null;
  people: number[] | null;
  unit: string;
}) {
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
  const arrows = trend.dir.map((d) =>
    d === 1
      ? { text: "▲", color: "var(--good)" }
      : d === -1
        ? { text: "▼", color: "var(--bad)" }
        : { text: d === 0 ? "–" : "", color: "var(--muted)" },
  );
  return (
    <ChartCard
      title="시간대별 4주 같은 요일 추세"
      sub="옅은 선 = 4주 전 → 진한 선 = 마감일 · 아래 ▲ 오름 ▼ 내림 (주마다 5% 넘게)"
      legend={
        series.length ? <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} /> : undefined
      }
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
                <td className="num">
                  {trend.rate[i] == null
                    ? arrows[i].text || "—"
                    : `${arrows[i].text} ${trend.rate[i]! > 0 ? "+" : ""}${trend.rate[i]}%/주`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {trend.days.length >= 2 ? (
        <>
          <LineChart
            xs={xs}
            series={series}
            xTick={xTick}
            tipTitle={tip}
            fmt={won}
            axisFmt={wonShort}
            label="시간대별 4주 같은 요일 추세"
            height={220}
          />
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

/** 키즈입장 계산식 한 줄 (그날) */
function kidsFormula(m: Metrics, date: string): string {
  const p = kidsPrice(date);
  return p.charged
    ? `${p.kind} 단가 ${won(p.price)} × 입장권 ${count(m.naver + m.walkIn, "장")}${m.kidsCoupon ? ` − 사은권 ${won(m.kidsCoupon)}` : ""} = 키즈입장 ${won(m.box.키즈입장료)}`
    : `교환권 방식(26년 3월까지) — 네이버 ${count(Math.round(m.fee.naver / 30000), "장")} × 3만원 + 현장 ${won(m.fee.walkIn)} − 카페 교환권 사용 ${won(m.kidsCoupon)} = 키즈입장 ${won(m.box.키즈입장료)}`;
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
        <HeroBox
          label={`${shortLabel(date)} 기타`}
          value={won(m.box.기타)}
          date={date}
          w={props.weather[date]}
        >
          <Delta
            now={m.box.기타}
            before={pw.has.cafe + pw.has.kids ? pw.box.기타 : null}
            label="지난주 같은 요일"
            money={false}
          />
          {m.total > 0 && (
            <span className="note">총 매출의 {((m.box.기타 / m.total) * 100).toFixed(1)}%</span>
          )}
        </HeroBox>
        {/* 한 줄에 하나씩 길게 */}
        <div className="etc-list">
          {rows.map((r) => (
            <EtcStat key={r.label} {...r} per={per} />
          ))}
        </div>
        <p className="note center-note">
          {per} 기타 매출 합계 {won(y.box.기타)} · 자판기 · 네컷사진 · 주차료 = 카드 단말기 승인 내역(나이스 ·
          KIS) · 매장 소액 기타 = POS 기타 상품 (키즈 간식 · 연장 요금 등 포함)
        </p>
      </main>
    </>
  );
}

function EtcStat({ label, day, ytd, per }: { label: string; day: number; ytd: number; per: string }) {
  return (
    <div className="stat etc-row">
      <div className="etc-top">
        <span className="stat-label">{label}</span>
        <span className="stat-value">{won(day)}</span>
      </div>
      <span className="note">
        {per} 누적 {label} 매출 {won(ytd)}
      </span>
    </div>
  );
}

/** 베이커리 맨 위 합계 — 총 생산(그날 D 확정 수량) · 정가판매 · 할인판매(저녁 8시 30분 뒤 50%) · 폐기(= 생산 − 정가 − 할인) */
function BreadCount({ board, date, doc }: { board: Board; date: string; doc: BakeryDoc | null | undefined }) {
  const t = useMemo(() => breadTotals(dayResult(board, date, doc?.plan, doc?.order)), [board, date, doc]);
  const sales = !!board.report(date)?.cafe;
  // 마감 전에는 아직 안 팔린 것이라 '폐기'가 아니라 '남음'
  const open = useNoCompare();
  const cells: [string, number | null][] = [
    ["총 생산", t.made],
    ["정가판매", sales ? t.full : null],
    ["할인판매", sales ? t.half : null],
    [open ? "남음 (마감 전)" : "폐기", sales ? t.waste : null],
  ];
  return (
    <div className="quad" aria-label="베이커리 개수">
      {cells.map(([k, v]) => (
        <div key={k} className="quad-box">
          <div className="quad-label">{k}</div>
          <div className="quad-value">{v == null ? "—" : count(v, "개")}</div>
        </div>
      ))}
    </div>
  );
}

/** 베이커리 맨 아래 — 빵별 생산 · 정가판매 · 50% 할인 · 폐기 (생산은 작업지시, 판매는 그날 영수증) */
function BreadTable({ board, date, doc }: { board: Board; date: string; doc: BakeryDoc | null | undefined }) {
  const rows = useMemo(() => dayResult(board, date, doc?.plan, doc?.order), [board, date, doc]);
  const hasSales = !!board.report(date)?.cafe;
  const open = useNoCompare();
  const n = (v: number | null) => (v == null ? "—" : v.toLocaleString("ko-KR"));
  const sum = (f: (r: (typeof rows)[number]) => number | null) =>
    rows.some((r) => f(r) != null) ? rows.reduce((a, r) => a + (f(r) || 0), 0) : null;
  return (
    <section className="card">
      <h2>
        빵별 생산 · 판매 · 폐기 <small className="muted">개수</small>
      </h2>
      {doc === undefined ? (
        <p className="empty">작업지시 자료를 받는 중입니다…</p>
      ) : !rows.length ? (
        <p className="empty">이날은 베이커리 생산 · 판매 자료가 없습니다.</p>
      ) : (
        <>
          <table className="bread-tbl">
            <thead>
              <tr>
                <th>상품</th>
                <th className="num">생산</th>
                <th className="num">정가판매</th>
                <th className="num">할인판매</th>
                <th className="num">{open ? "남음" : "폐기"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td className="num">{n(r.made)}</td>
                  <td className="num">{hasSales ? n(r.full) : "—"}</td>
                  <td className="num">{hasSales ? n(r.half) : "—"}</td>
                  <td className={`num${r.waste && !open ? " warn" : ""}`}>{hasSales ? n(r.waste) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>합계 {rows.length}종</td>
                <td className="num">{n(sum((r) => r.made))}</td>
                <td className="num">{hasSales ? n(sum((r) => r.full)) : "—"}</td>
                <td className="num">{hasSales ? n(sum((r) => r.half)) : "—"}</td>
                <td className="num">{hasSales ? n(sum((r) => r.waste)) : "—"}</td>
              </tr>
            </tfoot>
          </table>
          <p className="note muted">
            생산 = 그날 베이커리 작업지시(D) 확정 수량 · 정가판매 · 할인판매(저녁 8시 30분 뒤 50%) = 다음 날
            아침 수집한 영수증 · 폐기 = 생산 − 정가판매 − 할인판매
            {open && " · 마감 전이라 '남음' = 생산 − 지금까지 판매 (마감 뒤 폐기로 바뀜)"}
            {!doc && " · 이날은 작업지시 자료가 없어 생산 · 폐기는 비어 있습니다 (작업지시 앱을 쓰기 전)"}
          </p>
        </>
      )}
    </section>
  );
}
