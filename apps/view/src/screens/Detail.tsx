/* ============================================================
   상세 화면 — 한 숫자(총 매출 · 팀 · 방문자 · 1인 평균 · 키즈 입장권)의
   ① 그날 값  ② 추세 선 그래프 (14일 · 30일 · 90일 · 12개월)  ③ 분석 설명  ④ 그 숫자의 속 (상품 · 입장권 고치기 등)
   그래프의 점을 누르면 그 날짜로 옮겨 감
   ============================================================ */
import { useMemo, useState } from "react";
import {
  addDays,
  analyze,
  BOXES,
  count,
  dailySeries,
  formatMetric,
  isCup,
  isMoney,
  kidsKind,
  kidsPrice,
  METRIC_LABEL,
  monthlySeries,
  movingAverage,
  shortLabel,
  topProducts,
  valueOf,
  won,
  wonShort,
  type Board,
  type KidsAdjust,
  type MetricKey,
  type ProductRow,
} from "@report/core";
import { ChartCard, Legend } from "../charts/common";
import { LineChart, type Line } from "../charts/LineChart";
import { Delta } from "./Home";

type Range = "14" | "30" | "90" | "12m";
const RANGES: [Range, string][] = [
  ["14", "14일"],
  ["30", "30일"],
  ["90", "90일"],
  ["12m", "12개월"],
];

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map(([v, l]) => (
        <button key={v} role="tab" aria-selected={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function DetailHeader({ title, date, onBack, onDate, minDate, maxDate }: { title: string; date: string; onBack: () => void; onDate: (d: string) => void; minDate: string; maxDate: string }) {
  return (
    <header className="detail-head">
      <button className="icon-btn" onClick={onBack} aria-label="뒤로">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
          <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <h1>{title}</h1>
      <div className="detail-date">
        <button className="icon-btn" disabled={date <= minDate} onClick={() => onDate(addDays(date, -1))} aria-label="전날">
          ‹
        </button>
        <span>{shortLabel(date)}</span>
        <button className="icon-btn" disabled={date >= maxDate} onClick={() => onDate(addDays(date, 1))} aria-label="다음날">
          ›
        </button>
      </div>
    </header>
  );
}

const mdLabel = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

function TrendCard({ board, k, date, onDate }: { board: Board; k: MetricKey; date: string; onDate: (d: string) => void }) {
  const [range, setRange] = useState<Range>("30");
  const money = isMoney(k);
  const fmt = (v: number) => formatMetric(k, v);
  const axisFmt = (v: number) => (money ? wonShort(v) : count(v));

  let xs: string[];
  let series: Line[];
  let selected: number | undefined;
  let xTick: (i: number) => string | null;
  let tipTitle: (i: number) => string;
  if (range === "12m") {
    const { cur, ly } = monthlySeries(board, k, date, 12);
    xs = cur.map((p) => p.x);
    series = [
      { label: "올해", color: "var(--series-1)", values: cur.map((p) => p.v) },
      { label: "작년 같은 달", color: "var(--ref)", values: ly.map((p) => p.v), weight: 1.5 },
    ];
    selected = xs.length - 1;
    xTick = (i) => (i % 2 === (xs.length - 1) % 2 ? `${Number(xs[i].slice(5))}월` : null);
    tipTitle = (i) => `${xs[i].slice(0, 4)}년 ${Number(xs[i].slice(5))}월${i === xs.length - 1 ? ` (${mdLabel(date)}까지)` : ""}`;
  } else {
    const n = Number(range);
    const s = dailySeries(board, k, date, n);
    xs = s.map((p) => p.x);
    series = [{ label: "하루", color: "var(--series-1)", values: s.map((p) => p.v) }];
    if (n >= 30) series.push({ label: "7일 평균", color: "var(--ref)", values: movingAverage(dailySeries(board, k, date, n + 6), 7).slice(6).map((p) => p.v), weight: 1.5 });
    selected = xs.length - 1;
    const step = n <= 14 ? 3 : n <= 30 ? 7 : 21;
    xTick = (i) => ((xs.length - 1 - i) % step === 0 ? mdLabel(xs[i]) : null);
    tipTitle = (i) => shortLabel(xs[i]);
  }

  return (
    <ChartCard
      title="추세"
      sub={range === "12m" ? "달마다 (이번 달은 고른 날까지 · 작년도 같은 기간)" : "하루마다 · 점을 누르면 그 날짜로"}
      legend={series.length > 1 ? <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} /> : undefined}
      head={<Seg value={range} options={RANGES} onChange={setRange} />}
      table={
        <table>
          <thead>
            <tr>
              <th>{range === "12m" ? "달" : "날짜"}</th>
              {series.map((s) => (
                <th key={s.label} className="num">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {xs
              .map((x, i) => (
                <tr key={x} className={i === selected ? "sel" : ""}>
                  <td>{range === "12m" ? x.replace("-", ".") : shortLabel(x)}</td>
                  {series.map((s) => (
                    <td key={s.label} className="num">
                      {s.values[i] == null ? "—" : fmt(s.values[i]!)}
                    </td>
                  ))}
                </tr>
              ))
              .reverse()}
          </tbody>
        </table>
      }
    >
      <LineChart
        xs={xs}
        series={series}
        xTick={xTick}
        tipTitle={tipTitle}
        fmt={fmt}
        axisFmt={axisFmt}
        selected={selected}
        onPick={range === "12m" ? undefined : (i) => onDate(xs[i])}
        label={`${METRIC_LABEL[k]} 추세`}
      />
    </ChartCard>
  );
}

function ProductsCard({ board, k, date }: { board: Board; k: MetricKey; date: string }) {
  const [span, setSpan] = useState<"day" | "month">("day");
  const from = span === "day" ? date : date.slice(0, 8) + "01";
  const rows = useMemo(() => {
    const all = board.sales.products(from, date);
    const pick = (p: ProductRow) => {
      if (k === "기타") return (p.pos === "cafe" && p.team === "기타") || (p.pos === "kids" && ["기타", "추가인원"].includes(kidsKind({ name: p.name, gross: p.net, net: p.net })));
      if (k === "visitors") return isCup(p.pos, { name: p.name, cat1: "" }, p.team);
      return p.pos === "cafe" && p.team === k;
    };
    return topProducts(all.filter(pick), 50);
  }, [board, k, from, date]);
  const sortQty = k === "visitors";
  const list = sortQty ? [...rows].sort((a, b) => b.qty - a.qty) : rows;
  const total = list.reduce((s, p) => s + (sortQty ? p.qty : p.net), 0);
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{k === "visitors" ? "잔으로 센 상품" : "상품별"}</h2>
          <p className="sub">
            {list.length}개 · {sortQty ? count(total, "잔") : won(total)}
          </p>
        </div>
        <Seg
          value={span}
          options={[
            ["day", "그날"],
            ["month", "이달"],
          ]}
          onChange={setSpan}
        />
      </div>
      <div className="table-wrap">
        {list.length ? (
          <table>
            <thead>
              <tr>
                <th>상품</th>
                <th className="num">수량</th>
                <th className="num">실매출</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.pos + p.name}>
                  <td>
                    {p.name}
                    {(k === "기타" || p.codes.length > 1) && (
                      <div className="note">
                        {k === "기타" ? (p.pos === "kids" ? "키즈 POS" : "카페 POS") : ""}
                        {p.codes.length > 1 ? ` 상품코드 ${p.codes.length}개 (VAN 변경 전후)` : ""}
                      </div>
                    )}
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
      </div>
    </section>
  );
}

function TotalCard({ board, date }: { board: Board; date: string }) {
  const m = board.day(date);
  return (
    <section className="card">
      <h2>총 매출 구성</h2>
      <table>
        <tbody>
          {BOXES.map((b) => (
            <tr key={b}>
              <td>{b === "키즈입장료" ? "키즈 입장료" : b}</td>
              <td className="num">{won(m.box[b])}</td>
              <td className="num muted">{m.total > 0 ? `${((m.box[b] / m.total) * 100).toFixed(1)}%` : "—"}</td>
            </tr>
          ))}
          <tr className="sum">
            <td>합계</td>
            <td className="num">{won(m.total)}</td>
            <td />
          </tr>
        </tbody>
      </table>
      <p className="note">참고: POS 실매출 합계 {won(m.posNet)} — 네이버 예약 입장권은 POS 에 0원으로 찍혀서, 입장권 수 × 단가로 계산해 키즈 입장료에 넣습니다.</p>
    </section>
  );
}

function KidsCard({ board, date, onSave, adjust }: { board: Board; date: string; adjust?: KidsAdjust; onSave: (date: string, adj: KidsAdjust | null) => Promise<void> }) {
  const m = board.day(date);
  const { price, kind } = kidsPrice(date);
  const [val, setVal] = useState<string>(String(m.naver));
  const [name, setName] = useState<string>(() => {
    try {
      return localStorage.getItem("report.editor") || "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const n = Math.max(0, Math.round(Number(val) || 0));
  const changed = n !== m.naver;
  const save = async (adj: KidsAdjust | null) => {
    setBusy(true);
    setMsg(null);
    try {
      try {
        localStorage.setItem("report.editor", name);
      } catch {
        /* 없어도 됨 */
      }
      await onSave(date, adj);
      setMsg(adj ? `${count(adj.naver, "장")}으로 고쳤습니다. 모든 폰에 같은 값으로 보입니다.` : "POS 발행 수로 되돌렸습니다.");
      if (!adj) setVal(String(m.naverPos));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card">
      <h2>키즈 입장권 · {shortLabel(date)}</h2>
      <table>
        <tbody>
          <tr>
            <td>
              네이버 예약 입장권
              <div className="note">POS 0원 발행 {count(m.naverPos, "장")}</div>
            </td>
            <td className="num">{count(m.naver, "장")}</td>
            <td className="num">{won(m.fee.naver)}</td>
          </tr>
          <tr>
            <td>
              현장 구매 입장권
              <div className="note">POS 실결제 {won(m.walkInPosNet)}</div>
            </td>
            <td className="num">{count(m.walkIn, "장")}</td>
            <td className="num">{won(m.fee.walkIn)}</td>
          </tr>
          <tr className="sum">
            <td>
              합계 <span className="muted">({kind} {won(price)})</span>
            </td>
            <td className="num">{count(m.naver + m.walkIn, "장")}</td>
            <td className="num">{won(m.box.키즈입장료)}</td>
          </tr>
        </tbody>
      </table>

      <div className="edit">
        <h3>네이버 입장권 수 고치기</h3>
        <p className="note">근무자가 더 출력했거나 시험 출력한 장수가 있으면, 네이버 예약 화면의 실제 수로 고쳐 주세요. 키즈 입장료와 총 매출이 다시 계산됩니다.</p>
        <div className="stepper">
          <button className="ghost" onClick={() => setVal(String(Math.max(0, n - 1)))} aria-label="한 장 빼기">
            −
          </button>
          <input id="naver-count" inputMode="numeric" value={val} onChange={(e) => setVal(e.target.value.replace(/[^0-9]/g, ""))} aria-label="네이버 입장권 수" />
          <button className="ghost" onClick={() => setVal(String(n + 1))} aria-label="한 장 더하기">
            +
          </button>
          <span className="muted">장</span>
        </div>
        <label className="field">
          고치는 사람
          <input id="editor-name" value={name} maxLength={20} placeholder="예: 점장" onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="row">
          <button disabled={busy || !changed} onClick={() => save({ naver: n, by: name.trim() })}>
            {busy ? "저장 중…" : "저장"}
          </button>
          {adjust && (
            <button className="ghost" disabled={busy} onClick={() => save(null)}>
              POS 수({count(m.naverPos, "장")})로 되돌리기
            </button>
          )}
        </div>
        {adjust && (
          <p className="note">
            고친 값 {count(adjust.naver, "장")}
            {adjust.by ? ` · ${adjust.by}` : ""}
            {adjust.at ? ` · ${new Date(adjust.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
          </p>
        )}
        {msg && <p className="note strong">{msg}</p>}
      </div>
    </section>
  );
}

export function Detail(props: {
  board: Board;
  k: MetricKey;
  date: string;
  minDate: string;
  maxDate: string;
  adjust?: KidsAdjust;
  onDate: (d: string) => void;
  onBack: () => void;
  onSaveAdjust: (date: string, adj: KidsAdjust | null) => Promise<void>;
}) {
  const { board, k, date } = props;
  const m = board.day(date);
  const v = m.has.cafe + m.has.kids ? valueOf(m, k) : null;
  const pw = board.day(addDays(date, -7));
  const pwv = pw.has.cafe + pw.has.kids ? valueOf(pw, k) : null;
  const lines = analyze(board, k, date);
  const kids = k === "키즈입장료" || k === "naver" || k === "walkIn" || k === "tickets";
  const team = k === "바리스타" || k === "베이커리" || k === "키친" || k === "기타";

  return (
    <>
      <DetailHeader title={METRIC_LABEL[k]} date={date} onBack={props.onBack} onDate={props.onDate} minDate={props.minDate} maxDate={props.maxDate} />
      <main className="content">
        <section className="card hero">
          <div className="stat-label">
            {shortLabel(date)} {METRIC_LABEL[k]}
          </div>
          <div className="hero-value">{formatMetric(k, v)}</div>
          <Delta now={v} before={pwv} label="지난주 같은 요일" money={false} />
          {pwv != null && <div className="note">지난주 {formatMetric(k, pwv)}</div>}
        </section>
        <TrendCard board={board} k={k} date={date} onDate={props.onDate} />
        <section className="card">
          <h2>분석</h2>
          <ul className="analysis">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
        {k === "total" && <TotalCard board={board} date={date} />}
        {kids && <KidsCard key={date} board={board} date={date} adjust={props.adjust} onSave={props.onSaveAdjust} />}
        {(team || k === "visitors") && <ProductsCard board={board} k={k} date={date} />}
        {k === "avgSpend" && (
          <section className="card">
            <h2>계산</h2>
            <p className="sub">
              총 매출 {won(m.total)} ÷ 추정 방문자 {count(m.visitors, "명")} (음료·맥주 {count(m.cups, "잔")} × 0.96)
            </p>
          </section>
        )}
      </main>
    </>
  );
}
