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
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  count,
  bakeryProducts,
  breadLabel,
  breadTotals,
  dayResult,
  producedOf,
  RECENT_DAYS,
  type BakeryProduct,
  type BreadResult,
  etcDetail,
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
  type EtcDetail as EtcLists,
  type ExtraKind,
  type Metrics,
  type WeatherMap,
} from "@report/core";
import { useBakeryDoc, type BakeryDoc } from "../data/bakery";
import { BarChart } from "../charts/BarChart";
import { ChartCard, Legend } from "../charts/common";
import { LineChart, type Line } from "../charts/LineChart";
import { HeroBox } from "../ui/WeatherPanel";
import { useLive } from "../ui/Live";
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
  const analysis = useMemo(() => sectorAnalysis(board, date, box, props.weather), [board, date, box, props.weather]);
  const yMax = Math.max(0, ...(today?.sales || []), ...avg.sales.map((v) => v || 0));
  const unit = kids ? "장" : "명";
  const bread = useBakeryDoc(board, box === "베이커리" ? date : "");
  // 마감 전 · 확정 전 숫자면 4주 추세 · 분석 글은 틀린 판단이 되므로 숨김
  const notClosed = !!useLive();

  return (
    <>
      <DetailHeader title={name} {...props} />
      <main className="content">
        <HeroBox label={`${shortLabel(date)} ${name}`} value={won(m.box[box])} date={date} w={props.weather[date]}>
          <Delta now={m.box[box]} before={pw.has.cafe + pw.has.kids ? pw.box[box] : null} label="지난주 같은 요일" money={false} />
          {m.total > 0 && <span className="note">총 매출의 {((m.box[box] / m.total) * 100).toFixed(1)}%</span>}
          {box === "키즈입장료" && <span className="note">{kidsFormula(m, date)}</span>}
        </HeroBox>

        {box === "베이커리" && <BreadCount board={board} date={date} doc={bread} />}

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

        {notClosed ? (
          <section className="card">
            <h2>추세 · 분석</h2>
            <p className="empty">마감 전(확정 전) 숫자라 4주 추세와 분석은 확정(다음 날 아침 10시) 뒤에 보입니다.</p>
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
        {box === "베이커리" && <BakeryList board={board} date={date} doc={bread} />}
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

/** 키즈입장 계산식 한 줄 (그날) */
function kidsFormula(m: Metrics, date: string): string {
  const p = kidsPrice(date);
  return p.charged
    ? `${p.kind} 단가 ${won(p.price)} × 입장권 ${count(m.naver + m.walkIn, "장")}${m.kidsCoupon ? ` − 사은권 ${won(m.kidsCoupon)}` : ""} = 키즈입장 ${won(m.box.키즈입장료)}`
    : `교환권 방식(26년 3월까지) — 네이버 ${count(Math.round(m.fee.naver / 30000), "장")} × 3만원 + 현장 ${won(m.fee.walkIn)} − 카페 교환권 사용 ${won(m.kidsCoupon)} = 키즈입장 ${won(m.box.키즈입장료)}`;
}

/** 기타 — 그날 자판기 · 인생네컷 · 주차료 · 매장 소액 기타, 아래 회색 글씨 = 1/1 ~ 마감일 누적
    박스를 누르면 아래에서 올라오는 목록: 자판기 · 네컷사진 · 주차료 = 몇 시에 얼마(최근 것이 맨 위), 매장 소액 기타 = 상품별 개수 · 금액 */
type EtcKey = ExtraKind | "small";
function EtcDetail(props: { board: Board; box: BoxKey; weather: WeatherMap } & Nav) {
  const { board, date } = props;
  const m = board.day(date);
  const y = board.range(`${date.slice(0, 4)}-01-01`, date);
  const pw = board.day(addWeek(date, -1));
  const lists = useMemo(() => etcDetail(board, date), [board, date]);
  const [sheet, setSheet] = useState<EtcKey | null>(null);
  const small = (x: Metrics) => x.box.기타 - extraTotal(x.extra);
  const rows: { id: EtcKey; label: string; day: number; ytd: number }[] = [
    { id: "vending", label: "자판기", day: m.extra.vending, ytd: y.extra.vending },
    { id: "photo", label: "네컷사진", day: m.extra.photo, ytd: y.extra.photo },
    { id: "parking", label: "주차료", day: m.extra.parking, ytd: y.extra.parking },
    { id: "small", label: "매장 소액 기타", day: small(m), ytd: small(y) },
  ];
  const per = `${date.slice(2, 4)}년 1월 1일 ~ ${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;
  const open = rows.find((r) => r.id === sheet);
  return (
    <>
      <DetailHeader title="기타" {...props} />
      <main className="content">
        <HeroBox label={`${shortLabel(date)} 기타`} value={won(m.box.기타)} date={date} w={props.weather[date]}>
          <Delta now={m.box.기타} before={pw.has.cafe + pw.has.kids ? pw.box.기타 : null} label="지난주 같은 요일" money={false} />
          {m.total > 0 && <span className="note">총 매출의 {((m.box.기타 / m.total) * 100).toFixed(1)}%</span>}
        </HeroBox>
        {/* 한 줄에 하나씩 길게 — 누르면 목록 */}
        <div className="etc-list">
          {rows.map((r) => (
            <EtcStat key={r.id} label={r.label} day={r.day} ytd={r.ytd} per={per} onOpen={() => setSheet(r.id)} />
          ))}
        </div>
        <p className="note center-note">
          {per} 기타 매출 합계 {won(y.box.기타)} · 자판기 = 카드 단말기 승인(나이스 · KIS) + 키즈 POS 음료 · 자판기 상품 · 네컷사진 · 주차료 = 카드 단말기 승인 · 매장 소액 기타 = 카페 POS 기타 상품 · 박스를 누르면 목록
        </p>
      </main>
      {sheet && open && <EtcSheet k={sheet} label={open.label} total={open.day} date={date} lists={lists} onClose={() => setSheet(null)} />}
    </>
  );
}

function EtcStat({ label, day, ytd, per, onOpen }: { label: string; day: number; ytd: number; per: string; onOpen: () => void }) {
  return (
    <button className="stat etc-row tap" onClick={onOpen} aria-haspopup="dialog" aria-label={`${label} ${won(day)} — 목록`}>
      <div className="etc-top">
        <span className="stat-label">
          {label} <span className="quad-more" aria-hidden>›</span>
        </span>
        <span className="stat-value">{won(day)}</span>
      </div>
      <span className="note">
        {per} 누적 {label} 매출 {won(ytd)}
      </span>
    </button>
  );
}

/** 'HH:MM:SS' → 'HH:MM' */
const hm = (t: string) => t.slice(0, 5);

/** 아래에서 올라오는 목록 — 카드 단말기 칸은 몇 시에 얼마 (최근 것이 맨 위), 매장 소액 기타는 상품별 */
function EtcSheet({ k, label, total, date, lists, onClose }: { k: EtcKey; label: string; total: number; date: string; lists: EtcLists; onClose: () => void }) {
  const today = !!useLive()?.today;
  const products = (xs: EtcLists["small"], storeTag: boolean) => (
    <table className="bread-tbl etc-tbl">
      <thead>
        <tr>
          <th>상품</th>
          <th className="num">개수</th>
          <th className="num">금액</th>
        </tr>
      </thead>
      <tbody>
        {xs.map((x) => (
          <tr key={`${x.store}|${x.name}`} className={x.net === 0 ? "zero" : undefined}>
            <td>
              {x.name}
              {storeTag && x.store === "kids" && <span className="muted"> · 키즈</span>}
            </td>
            <td className="num">{count(x.qty, "개")}</td>
            <td className="num">{won(x.net)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td>합계 {xs.length}종</td>
          <td className="num">{count(xs.reduce((a, x) => a + x.qty, 0), "개")}</td>
          <td className="num">{won(xs.reduce((a, x) => a + x.net, 0))}</td>
        </tr>
      </tfoot>
    </table>
  );
  let body: ReactNode;
  if (k === "small") {
    const xs = lists.small;
    body = xs.length ? (
      <>
        {products(xs, true)}
        <p className="note muted">카페 POS 에서 '기타'로 분류된 상품 (키즈 표시는 키즈 POS) · 0원 상품은 개수만 세는 표시 (테이크아웃 · 캐리어 등)</p>
      </>
    ) : (
      <p className="empty">이날은 매장 소액 기타 상품이 없습니다.</p>
    );
  } else {
    const list = lists.card[k];
    const cardSum = list ? list.reduce((a, x) => a + x[1], 0) : 0;
    const card =
      today && !list?.length ? (
        <p className="empty">자판기 · 네컷 · 주차 카드 결제는 다음(근무일) 날 받습니다.</p>
      ) : list === null ? (
        <p className="empty">이날은 건별 시각 없이 하루 합계만 있습니다 (2026년 6월까지 KIS 자료 · 엑셀을 못 받은 날).</p>
      ) : !list.length ? (
        <p className="empty">이날은 카드 결제가 없습니다.</p>
      ) : (
        <table className="bread-tbl etc-tbl">
          <thead>
            <tr>
              <th>시각</th>
              <th className="num">금액</th>
            </tr>
          </thead>
          <tbody>
            {list.map(([t, amt], i) => (
              <tr key={`${t}|${i}`} className={amt < 0 ? "neg" : undefined}>
                <td>{hm(t)}</td>
                <td className="num">{amt < 0 ? `취소 ${won(amt)}` : won(amt)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>합계 {count(list.length, "건")}</td>
              <td className="num">{won(cardSum)}</td>
            </tr>
          </tfoot>
        </table>
      );
    body = (
      <>
        {k === "vending" && <h3 className="etc-sub">카드 단말기 (자판기 기계)</h3>}
        {card}
        {k === "vending" && lists.kidsVend.length > 0 && (
          <>
            <h3 className="etc-sub">키즈 POS 음료 · 자판기 상품</h3>
            {products(lists.kidsVend, false)}
          </>
        )}
        {list && list.length > 0 && <p className="note muted">최근 결제가 맨 위 · 취소는 − 로 빼서 합계</p>}
      </>
    );
  }
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet list-sheet" role="dialog" aria-label={`${label} 목록`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head etc-head">
          <b>
            {label} {won(total)}
          </b>
          <span className="muted">{shortLabel(date)}</span>
        </div>
        <div className="sheet-scroll">{body}</div>
        <button className="ghost wide" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}

/** 베이커리 맨 위 합계 — 총 생산(= 정가 + 할인 + 폐기, 현장에서 그날 수량이 바뀔 수 있어 지시 수량 대신) · 정가판매 · 할인판매(저녁 8시 30분 뒤 50%) · 폐기(= 지시(확정 · 자동) − 판매)
    총 생산을 누르면 상품별 생산 · 정가 · 할인 · 폐기 전체, 폐기를 누르면 폐기된 빵만 (아래에서 올라오는 창) */
function BreadCount({ board, date, doc }: { board: Board; date: string; doc: BakeryDoc | null | undefined }) {
  const rows = useMemo(() => dayResult(board, date, doc?.plan, doc?.order), [board, date, doc]);
  const t = useMemo(() => breadTotals(rows), [rows]);
  const sales = !!board.report(date)?.cafe;
  // 오늘 마감 전에는 아직 안 팔린 것이라 '폐기'가 아니라 '남음'
  const open = !!useLive()?.today;
  const [sheet, setSheet] = useState<"all" | "waste" | null>(null);
  const wasteLabel = open ? "남음 (마감 전)" : "폐기";
  const cells: [string, number | null, "all" | "waste" | null][] = [
    ["총 생산", sales ? t.made : null, "all"],
    ["정가판매", sales ? t.full : null, null],
    ["할인판매", sales ? t.half : null, null],
    [wasteLabel, sales ? t.waste : null, "waste"],
  ];
  return (
    <>
      <div className="quad" aria-label="베이커리 개수">
        {cells.map(([k, v, list]) =>
          list && v != null ? (
            <button key={k} className="quad-box tap" onClick={() => setSheet(list)} aria-haspopup="dialog" aria-label={`${k} ${count(v, "개")} — 상품별 목록`}>
              <div className="quad-label">
                {k} <span className="quad-more" aria-hidden>›</span>
              </div>
              <div className="quad-value">{count(v, "개")}</div>
            </button>
          ) : (
            <div key={k} className="quad-box">
              <div className="quad-label">{k}</div>
              <div className="quad-value">{v == null ? "—" : count(v, "개")}</div>
            </div>
          ),
        )}
      </div>
      {sheet && <BreadSheet date={date} rows={rows} kind={sheet} wasteLabel={wasteLabel} onClose={() => setSheet(null)} />}
    </>
  );
}

/** 아래에서 올라오는 상품별 목록 — all: 생산 · 정가 · 할인 · 폐기 전체 (생산 많은 순) / waste: 폐기된 빵만 (폐기 많은 순) */
function BreadSheet({ date, rows, kind, wasteLabel, onClose }: { date: string; rows: BreadResult[]; kind: "all" | "waste"; wasteLabel: string; onClose: () => void }) {
  const list = kind === "all" ? [...rows].sort((a, b) => producedOf(b) - producedOf(a) || a.name.localeCompare(b.name, "ko")) : rows.filter((r) => (r.waste || 0) > 0).sort((a, b) => b.waste! - a.waste! || a.name.localeCompare(b.name, "ko"));
  const n = (v: number | null) => (v == null ? "—" : v.toLocaleString("ko-KR"));
  const total = (f: (r: BreadResult) => number | null) => list.reduce((a, r) => a + (f(r) || 0), 0);
  const title = kind === "all" ? "상품별 생산 · 판매 · 폐기" : wasteLabel === "폐기" ? "폐기된 빵" : "남은 빵 (마감 전)";
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet list-sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <b>{title}</b>
          <span className="muted">{shortLabel(date)}</span>
        </div>
        {!list.length ? (
          <p className="empty">{kind === "waste" ? `${wasteLabel === "폐기" ? "폐기된" : "남은"} 빵이 없습니다.` : "이날은 베이커리 생산 · 판매 자료가 없습니다."}</p>
        ) : (
          <div className="sheet-scroll">
            <table className="bread-tbl">
              <thead>
                <tr>
                  <th>상품</th>
                  <th className="num">생산</th>
                  <th className="num">정가판매</th>
                  <th className="num">할인판매</th>
                  <th className="num">{wasteLabel === "폐기" ? "폐기" : "남음"}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.name}>
                    <td>{breadLabel(r.name, date)}</td>
                    <td className="num">{n(producedOf(r))}</td>
                    <td className="num">{n(r.full)}</td>
                    <td className="num">{n(r.half)}</td>
                    <td className={`num${kind === "waste" ? " strong" : ""}`}>{n(r.waste)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>합계 {list.length}종</td>
                  <td className="num">{n(total(producedOf))}</td>
                  <td className="num">{n(total((r) => r.full))}</td>
                  <td className="num">{n(total((r) => r.half))}</td>
                  <td className="num">{n(total((r) => r.waste))}</td>
                </tr>
              </tfoot>
            </table>
            <p className="note muted">생산 = 정가판매 + 할인판매 + {wasteLabel === "폐기" ? "폐기" : "남음"} · {wasteLabel === "폐기" ? "폐기" : "남음"} = 작업지시(확정, 없으면 자동) 수량 − 판매 · 작업지시에 없는 상품은 —</p>
          </div>
        )}
        <button className="ghost wide" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}

/** 베이커리 맨 아래 — 빵별 생산(= 판매 + 폐기) · 정가판매 · 50% 할인 · 폐기(= 지시 − 판매), 판매는 그날 영수증 */
function BreadTable({ board, date, doc }: { board: Board; date: string; doc: BakeryDoc | null | undefined }) {
  const rows = useMemo(() => dayResult(board, date, doc?.plan, doc?.order), [board, date, doc]);
  const hasSales = !!board.report(date)?.cafe;
  const open = !!useLive()?.today;
  const n = (v: number | null) => (v == null ? "—" : v.toLocaleString("ko-KR"));
  const sum = (f: (r: (typeof rows)[number]) => number | null) => (rows.some((r) => f(r) != null) ? rows.reduce((a, r) => a + (f(r) || 0), 0) : null);
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
                  <td>{breadLabel(r.name, date)}</td>
                  <td className="num">{hasSales ? n(producedOf(r)) : "—"}</td>
                  <td className="num">{hasSales ? n(r.full) : "—"}</td>
                  <td className="num">{hasSales ? n(r.half) : "—"}</td>
                  <td className={`num${r.waste && !open ? " warn" : ""}`}>{hasSales ? n(r.waste) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>합계 {rows.length}종</td>
                <td className="num">{hasSales ? n(sum((r) => producedOf(r))) : "—"}</td>
                <td className="num">{hasSales ? n(sum((r) => r.full)) : "—"}</td>
                <td className="num">{hasSales ? n(sum((r) => r.half)) : "—"}</td>
                <td className="num">{hasSales ? n(sum((r) => r.waste)) : "—"}</td>
              </tr>
            </tfoot>
          </table>
          <p className="note muted">
            생산 = 정가판매 + 할인판매 + 폐기 (현장에서 그날 수량이 바뀔 수 있어 지시 수량 대신) · 정가판매 · 할인판매(저녁 8시 30분 뒤 50%) = 영수증 · 폐기 = 작업지시(확정, 없으면 자동) 수량 − 판매 (일과 중 바뀐 양은 모름, 작업지시에 없는 상품은 —)
            {open && " · 오늘은 마감 전이라 남음 = 작업지시 수량 − 지금까지 판매 (마감 뒤 폐기로 바뀜)"}
            {!doc && " · 이날은 작업지시 자료가 없어 생산 · 폐기는 비어 있습니다 (작업지시 앱을 쓰기 전)"}
          </p>
        </>
      )}
    </section>
  );
}

/** 베이커리 맨 아래 — 베이커리로 셈하는 상품 전체 (그날 보고에 저장된 분류 = 베이커리 매출 · 판매 개수에 들어간 상품)
    작업지시에 있는 빵 / 작업지시에 없는데 팔린 상품(판매에는 들어가고 생산 · 남음에서는 빠짐) / 4주 넘게 안 팔린 상품(접힘). 금액 없이 개수만 */
function BakeryList({ board, date, doc }: { board: Board; date: string; doc: BakeryDoc | null | undefined }) {
  const list = useMemo(() => bakeryProducts(board, date, doc?.plan, doc?.order), [board, date, doc]);
  const n = (v: number | null) => (v == null ? "—" : v.toLocaleString("ko-KR"));
  const hasOrder = list.some((r) => r.order != null);
  const ordered = list.filter((r) => r.order != null);
  const others = list.filter((r) => r.order == null && (r.day > 0 || r.recent > 0));
  const old = list.filter((r) => r.order == null && !(r.day > 0 || r.recent > 0));
  const othersDay = others.reduce((a, r) => a + r.day, 0);
  const table = (rows: BakeryProduct[], showOrder: boolean) => (
    <table className="bread-tbl">
      <thead>
        <tr>
          <th>상품</th>
          {showOrder && <th className="num">작업지시</th>}
          <th className="num">그날 판매</th>
          <th className="num">4주 판매</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <td>{breadLabel(r.name, date)}</td>
            {showOrder && <td className="num">{n(r.order)}</td>}
            <td className={`num${showOrder && r.order != null && r.day > r.order ? " warn" : ""}`}>{n(r.day)}</td>
            <td className="num">{n(r.recent)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <section className="card bakery-list">
      <h2>
        베이커리로 셈하는 상품 전체 <small className="muted">{list.length}종 · 개수</small>
      </h2>
      <p className="note muted">POS 영수증에서 베이커리로 분류되어 베이커리 매출 · 판매 개수에 들어가는 상품입니다 ({shortLabel(date)}까지 받은 보고 기준 · 4주 = 그날 포함 {RECENT_DAYS}일)</p>
      {doc === undefined ? (
        <p className="empty">작업지시 자료를 받는 중입니다…</p>
      ) : !list.length ? (
        <p className="empty">베이커리로 셈한 상품이 없습니다.</p>
      ) : (
        <>
          {hasOrder && (
            <>
              <h3 className="bl-head">
                작업지시에 있는 빵 <small className="muted">{ordered.length}종</small>
              </h3>
              {table(ordered, true)}
              {ordered.some((r) => r.day > (r.order ?? 0)) && <p className="note bl-warn">빨간 숫자 = 작업지시보다 더 팔림 (더 만들었거나 전날 남은 빵 · 실제 생산은 시스템이 모름)</p>}
            </>
          )}
          <h3 className="bl-head">
            {hasOrder ? "작업지시에 없는 상품" : "최근 4주 팔린 상품"} <small className="muted">{others.length}종</small>
          </h3>
          {hasOrder && others.length > 0 && (
            <p className="note bl-warn">
              그날 {othersDay.toLocaleString("ko-KR")}개 — 베이커리 판매 개수에는 들어가지만 작업지시가 없어 생산 · 남음(폐기) 계산에서는 빠집니다
            </p>
          )}
          {others.length ? table(others, false) : <p className="empty">없습니다.</p>}
          {old.length > 0 && (
            <details className="bl-old">
              <summary>
                최근 4주 안 팔린 상품 {old.length}종 <small className="muted">(눌러서 보기)</small>
              </summary>
              <table className="bread-tbl">
                <thead>
                  <tr>
                    <th>상품</th>
                    <th className="num">마지막 판매</th>
                  </tr>
                </thead>
                <tbody>
                  {old.map((r) => (
                    <tr key={r.name}>
                      <td>{breadLabel(r.name, date)}</td>
                      <td className="num">{r.last ? r.last.replaceAll("-", ".") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          <p className="note muted">딸기잼 · 블루베리잼은 베이커리 매대에서 팔아도 생산품이 아니라 기타로 셉니다 (이 목록 · 작업지시에서 빠짐)</p>
          {!hasOrder && <p className="note muted">이날은 작업지시 자료가 없어 작업지시 칸이 없습니다.</p>}
        </>
      )}
    </section>
  );
}
