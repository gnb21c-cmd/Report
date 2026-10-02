/* 오늘 보고 — 기준일(어제 마감) 한 화면 */
import { useState } from "react";
import { changePct, count, pct, POS_LABEL, shortLabel, won, type DailyReport, type KidsAgg, type ProductRow } from "@report/core";
import { TeamBars } from "../charts/TeamBars";

function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  const p = changePct(now, before);
  if (p == null) return <span className="delta muted">{label} 비교 자료 없음</span>;
  const cls = p > 0 ? "up" : p < 0 ? "down" : "";
  return (
    <span className={`delta ${cls}`}>
      <span aria-hidden>{p > 0 ? "▲" : p < 0 ? "▼" : "–"}</span> {pct(p)} <span className="muted">{label}</span>
    </span>
  );
}

function Stat({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {children}
    </div>
  );
}

function Toggle<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
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

function KidsTable({ day, month }: { day: KidsAgg; month: KidsAgg }) {
  const rows: [string, (k: KidsAgg) => string, string?][] = [
    ["현장 결제 입장권", (k) => count(k.walkIn, "장")],
    ["네이버 예약 입장권", (k) => count(k.naver, "장"), "POS 0원 발행 수"],
    ["입장권 합계", (k) => count(k.tickets, "장")],
    ["추가 인원", (k) => count(k.extra, "명")],
    ["입장 매출", (k) => won(k.admissionNet), "현장 입장권 + 추가 인원"],
    ["그 밖 매출", (k) => won(k.otherNet), "간식·음료 등"],
  ];
  return (
    <table>
      <thead>
        <tr>
          <th></th>
          <th className="num">어제</th>
          <th className="num">이달 누계</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, f, note]) => (
          <tr key={label}>
            <td>
              {label}
              {note && <div className="note">{note}</div>}
            </td>
            <td className="num">{f(day)}</td>
            <td className="num">{f(month)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProductTable({ rows }: { rows: ProductRow[] }) {
  if (!rows.length) return <p className="empty">판매 자료가 없습니다.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>상품</th>
          <th className="num">수량</th>
          <th className="num">실매출</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p, i) => (
          <tr key={p.pos + p.name}>
            <td className="muted">{i + 1}</td>
            <td>
              {p.name}
              <div className="note">
                {POS_LABEL[p.pos]} · {p.team}
              </div>
            </td>
            <td className="num">{count(p.qty)}</td>
            <td className="num">{won(p.net)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Today({ r }: { r: DailyReport }) {
  const [teamRange, setTeamRange] = useState<"day" | "month">("day");
  const [topRange, setTopRange] = useState<"day" | "month">("day");
  const m = r.month;
  return (
    <>
      {r.missing.length > 0 && (
        <div className="banner warn" role="alert">
          <span aria-hidden>⚠</span> {r.missing.map((p) => POS_LABEL[p]).join(" · ")} POS 자료가 {shortLabel(r.date)}에 없습니다 — 마감 송부를 안 했거나 휴무일 수 있습니다.
        </div>
      )}

      <section className="card hero">
        <div className="stat-label">{shortLabel(r.date)} 실매출</div>
        <div className="hero-value">{won(r.day.net)}</div>
        <Delta now={r.day.net} before={r.prevWeek.agg.net} label={`지난주 ${r.weekday}요일 대비`} />
        <div className="split">
          <span>
            <span className="key-rect" style={{ background: "var(--series-1)" }} /> 카페 <b>{won(r.day.byPos.cafe)}</b>
          </span>
          <span>
            <span className="key-rect" style={{ background: "var(--series-2)" }} /> 키즈 <b>{won(r.day.byPos.kids)}</b>
          </span>
        </div>
        {r.day.discount !== 0 && <div className="note">총매출 {won(r.day.gross)} · 할인 {won(r.day.discount)}</div>}
      </section>

      <div className="stats">
        <Stat label={`당월 누계 (${m.daysElapsed}일)`} value={won(m.agg.net)}>
          <Delta now={m.agg.net} before={r.prevMonth.net} label="지난달 같은 기간" />
        </Stat>
        <Stat label="예상 월매출" value={won(r.forecast.net)}>
          <span className="note">{r.forecast.basis}</span>
        </Stat>
        <Stat label="작년 같은 기간" value={r.lastYear.has ? won(r.lastYear.monthNet) : "자료 없음"}>
          {r.lastYear.has ? <Delta now={m.agg.net} before={r.lastYear.monthNet} label="올해" /> : <span className="note">작년 엑셀을 넣으면 보입니다</span>}
        </Stat>
        <Stat label="작년 같은 달 전체" value={r.lastYear.has ? won(r.lastYear.monthFullNet) : "자료 없음"}>
          {r.lastYear.has && <Delta now={r.forecast.net} before={r.lastYear.monthFullNet} label="예상 월매출" />}
        </Stat>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>팀별 매출</h2>
          <Toggle value={teamRange} options={[["day", "어제"], ["month", "이달"]]} onChange={setTeamRange} />
        </div>
        <TeamBars agg={teamRange === "day" ? r.day : m.agg} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>키즈 입장</h2>
        </div>
        <div className="table-wrap">
          <KidsTable day={r.kids.day} month={r.kids.month} />
        </div>
        <p className="note">네이버 입장권은 키즈 POS 의 0원 발행 수입니다. 근무자가 더 출력한 장수가 섞일 수 있어 네이버 판매 수와 조금 다를 수 있습니다 (매출에는 영향 없음).</p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>많이 팔린 상품</h2>
          <Toggle value={topRange} options={[["day", "어제"], ["month", "이달"]]} onChange={setTopRange} />
        </div>
        <div className="table-wrap">
          <ProductTable rows={topRange === "day" ? r.top.day : r.top.month} />
        </div>
      </section>
    </>
  );
}
