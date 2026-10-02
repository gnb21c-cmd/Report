/* ============================================================
   대시보드 — 달력에서 고른 날의 숫자
   ① 총 매출 + 지난주 같은 요일 대비 (상자 하나)
   ② 바리스타 · 베이커리 · 키친 · 키즈 입장료 · 기타 (한 줄씩 각각 상자)
   ③ 당월 누계 · 올해 누계 / 작년 같은 달 누계 · 작년 같은 기간 누계
   ④ 추정 방문자 · 1인 평균 소비
   ⑤ 키즈 입장권: 네이버(고칠 수 있음) · 현장
   상자를 누르면 그 숫자의 추세 그래프 · 분석 설명 화면으로
   ============================================================ */
import { BOXES, changePct, comparable, count, holidayName, pct, POS_LABEL, shortLabel, won, type Board, type Dashboard, type MetricKey, type Metrics } from "@report/core";

export type Open = (v: { name: "metric"; key: MetricKey } | { name: "cum"; kind: "month" | "year" }) => void;

export function Delta({ now, before, label, money = true, missing }: { now: number | null; before: number | null; label: string; money?: boolean; missing?: string }) {
  const p = changePct(now, before);
  if (p == null) return <span className="delta muted">{missing || `${label} 비교 자료 없음`}</span>;
  const cls = p > 0 ? "up" : p < 0 ? "down" : "";
  return (
    <span className={`delta ${cls}`}>
      <span aria-hidden>{p > 0 ? "▲" : p < 0 ? "▼" : "–"}</span> {pct(p)}
      <span className="muted">
        {" "}
        {label}
        {money && before != null ? ` ${won(before)}` : ""}
      </span>
    </span>
  );
}

/** 작년 자료가 일부만 있을 때 안내 */
function partial(m: Metrics): string | undefined {
  const n = Math.max(m.has.cafe, m.has.kids);
  return n ? `작년 자료 ${n}일치뿐 · 비교 안 함` : undefined;
}

const Chevron = () => (
  <svg className="chev" viewBox="0 0 24 24" width="18" height="18" aria-hidden>
    <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function Home({ board, d, open }: { board: Board; d: Dashboard; open: Open }) {
  const day = d.day;
  const nothing = day.has.cafe + day.has.kids === 0;
  const hol = holidayName(d.date);

  return (
    <>
      {nothing ? (
        <div className="banner">{shortLabel(d.date)} 자료가 없습니다 — 휴무이거나 아직 마감 송부 전입니다.</div>
      ) : (
        (day.has.cafe === 0 || day.has.kids === 0) && (
          <div className="banner" role="alert">
            <span aria-hidden>⚠</span> {day.has.cafe === 0 ? POS_LABEL.cafe : POS_LABEL.kids} POS 자료가 아직 없습니다 (마감 송부 전이거나 휴무).
          </div>
        )
      )}

      <button className="card hero tap" onClick={() => open({ name: "metric", key: "total" })}>
        <div className="hero-top">
          <span className="stat-label">
            {shortLabel(d.date)}
            {hol ? ` · ${hol}` : ""} 총 매출
          </span>
          <Chevron />
        </div>
        <div className="hero-value">{won(day.total)}</div>
        <Delta now={day.total} before={d.prevWeek.m.total} label={`지난주 ${d.weekday}요일`} />
      </button>

      {/* 팀별 섹터 버튼 — 한 줄, 넘치면 옆으로 밀어서 */}
      <div className="sectors" role="list">
        {BOXES.map((b) => (
          <button key={b} role="listitem" className="sector tap" onClick={() => open({ name: "metric", key: b })}>
            <span className="sec-top">
              <span className="sec-label">{b === "키즈입장료" ? "키즈입장료" : b}</span>
              <span className="sec-pct">{day.total > 0 ? `${Math.round((day.box[b] / day.total) * 100)}%` : ""}</span>
              <Chevron />
            </span>
            <span className="sec-value">{won(day.box[b])}</span>
          </button>
        ))}
      </div>

      <div className="stats">
        <button className="stat tap" onClick={() => open({ name: "cum", kind: "month" })}>
          <div className="stat-label">당월 누계 ({d.month.from.slice(5).replace("-", "/")}~)</div>
          <div className="stat-value">{won(d.month.total)}</div>
          <Delta now={d.month.total} before={comparable(d.lyMonth) ? d.lyMonth.total : null} label="작년 같은 달" money={false} missing={partial(d.lyMonth)} />
        </button>
        <button className="stat tap" onClick={() => open({ name: "cum", kind: "year" })}>
          <div className="stat-label">올해 누계 (1/1~)</div>
          <div className="stat-value">{won(d.year.total)}</div>
          <Delta now={d.year.total} before={comparable(d.lyYear) ? d.lyYear.total : null} label="작년 같은 기간" money={false} missing={partial(d.lyYear)} />
        </button>
        <button className="stat tap" onClick={() => open({ name: "cum", kind: "month" })}>
          <div className="stat-label">작년 같은 달 누계</div>
          <div className="stat-value">{d.lyMonth.has.cafe + d.lyMonth.has.kids ? won(d.lyMonth.total) : "자료 없음"}</div>
          <span className="note">
            {d.lyMonth.from.replaceAll("-", ".")} ~ {d.lyDate.slice(5).replace("-", ".")}
          </span>
        </button>
        <button className="stat tap" onClick={() => open({ name: "cum", kind: "year" })}>
          <div className="stat-label">작년 같은 기간 누계</div>
          <div className="stat-value">{d.lyYear.has.cafe + d.lyYear.has.kids ? won(d.lyYear.total) : "자료 없음"}</div>
          <span className="note">
            {d.lyYear.from.replaceAll("-", ".")} ~ {d.lyDate.slice(5).replace("-", ".")}
          </span>
        </button>
      </div>

      <h3 className="group">방문 · 소비 (추정)</h3>
      <div className="stats">
        <button className="stat tap" onClick={() => open({ name: "metric", key: "visitors" })}>
          <div className="stat-label">추정 방문자</div>
          <div className="stat-value">{count(day.visitors, "명")}</div>
          <span className="note">음료·맥주 {count(day.cups, "잔")} × 0.96</span>
        </button>
        <button className="stat tap" onClick={() => open({ name: "metric", key: "avgSpend" })}>
          <div className="stat-label">1인 평균 소비</div>
          <div className="stat-value">{day.avgSpend == null ? "—" : won(day.avgSpend)}</div>
          <span className="note">총 매출 ÷ 추정 방문자</span>
        </button>
      </div>

      <h3 className="group">키즈 입장권</h3>
      <div className="stats">
        <button className="stat tap" onClick={() => open({ name: "metric", key: "naver" })}>
          <div className="stat-label">
            네이버 예약 {day.naverAdjusted ? <span className="tag">수정됨</span> : <span className="tag ghost">✎ 고치기</span>}
          </div>
          <div className="stat-value">{count(day.naver, "장")}</div>
          <span className="note">{day.naverAdjusted ? `POS 발행 ${count(day.naverPos, "장")}` : "POS 0원 발행 수"}</span>
        </button>
        <button className="stat tap" onClick={() => open({ name: "metric", key: "walkIn" })}>
          <div className="stat-label">현장 구매</div>
          <div className="stat-value">{count(day.walkIn, "장")}</div>
          <span className="note">키즈 POS 입장료 결제</span>
        </button>
      </div>
      <p className="note center-note">
        {d.price.kind} 단가 {won(d.price.price)} × 입장권 {count(day.naver + day.walkIn, "장")} = 키즈 입장료 {won(day.box.키즈입장료)}
      </p>
    </>
  );
}
