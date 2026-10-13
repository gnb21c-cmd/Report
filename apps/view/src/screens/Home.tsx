/* ============================================================
   대시보드 — 달력에서 고른 마감일의 숫자
   ① 왼쪽 상자: 날씨 네 칸 + 날짜 · 마감일 매출 · 지난주 같은 요일 비교 (→ 하루 상세)
   ② 오른쪽: 바리스타 · 베이커리 · 키친 · 키즈입장 · 기타 — 왼쪽 상자 높이를 다섯으로 나눈 긴 상자, 금액은 원 단위 (→ 섹터 상세)
      위치는 마감 전 · 후 모든 날 같게. 글자는 칸에 맞춰(줄 바꿈 · 잘림 없이) 가능한 크게
   ③ 당월 매출 합계 · 전년 동기간 매출 합계 / OO년 총 매출 합계 (→ 누계 상세, 해는 마감일 따라)
   ④ 키즈 입장 4칸 한 줄 (가운데 정렬): 입장권 판매 총 수량 · 네이버판매 (中 신규 n장) · 현장판매 · 이벤트 무료입장 (→ 각 상세)
   ⑤ 카페 소비 인원 · 1인 평균소비 (소비 인원 → 상세) — 이름은 2026-10-13 사장님 지시 (예전 '카페아스타나 방문인원')
   ⑥ 자금 현황 — 잔액 합계 · 대출 제외 자금 (→ 자금 상세)
   ⑦ OO년 (현금/신용) 정산완료 합계 (1/1~마감일 통장에 들어온 카드 · 네이버페이 · 배달앱 · 현금매출) — 누계 줄 오른쪽 아래
   ============================================================ */
import { useRef } from "react";
import { WeatherPanel } from "../ui/WeatherPanel";
import { LiveWarn, useLive } from "../ui/Live";
import { useFit } from "../ui/fit";
import { addDays, BOXES, changePct, comparable, count, hasData, holidayName, kidsTickets, money, todayKst, pct, SETTLE_LABEL, shortLabel, STORE_LABEL, won, type BoxKey, type CashSummary, type Dashboard, type DayWeather, type Metrics, type SettleKind } from "@report/core";

export type View =
  | { name: "home" }
  | { name: "day" }
  | { name: "sector"; box: BoxKey }
  | { name: "month" }
  | { name: "year" }
  | { name: "naver" }
  | { name: "kids"; key: "walkIn" | "eventFree" }
  | { name: "cash" }
  | { name: "settle" }
  | { name: "visitors" }
  | { name: "settings" };
export type Open = (v: View) => void;

export function Delta({ now, before, label, money = true, missing }: { now: number | null; before: number | null; label: string; money?: boolean; missing?: string }) {
  // 마감 전(하루가 안 끝난 숫자) · 확정 전은 하루 전체와 견주면 틀린 비교 → 숨김
  const live = useLive();
  if (live) return <span className="delta muted">{live.today ? "마감 전 · 비교는 마감 뒤" : "확정 전 · 비교는 확정 뒤"}</span>;
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
export function partial(m: Metrics): string | undefined {
  const n = Math.max(m.has.cafe, m.has.kids);
  return n ? `작년 자료 ${n}일치뿐 · 비교 안 함` : undefined;
}

export const Chevron = () => (
  <svg className="chev" viewBox="0 0 24 24" width="18" height="18" aria-hidden>
    <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const BOX_LABEL: Record<BoxKey, string> = { 바리스타: "바리스타", 베이커리: "베이커리", 키친: "키친", 키즈입장료: "키즈입장", 기타: "기타" };

export type Settle = { total: number; by: Record<SettleKind, number>; days: number };

export function Home({ d, open, weather, cash, cashFrom, settle }: { d: Dashboard; open: Open; weather?: DayWeather; cash?: CashSummary; cashFrom?: string | null; settle?: Settle }) {
  const day = d.day;
  const nothing = day.has.cafe + day.has.kids === 0;
  const hol = holidayName(d.date);
  const live = useLive();

  return (
    <>
      <LiveWarn />
      {live?.today ? null : nothing ? (
        <div className="banner">
          {/* 오늘은 아직 마감 전 — 다음 날 아침 사무실 입력 뒤에 보임 */}
          {d.date === todayKst()
            ? `선택하신 일자는 오늘(마감 전)입니다. ${Number(addDays(d.date, 1).slice(8, 10))}일 10시 후 확인해 주세요.`
            : `${shortLabel(d.date)} 자료가 없습니다 — 휴무이거나 아직 사무실에서 입력 전입니다.`}
        </div>
      ) : (
        (day.has.cafe === 0 || day.has.kids === 0) && (
          <div className="banner" role="alert">
            <span aria-hidden>⚠</span> {day.has.cafe === 0 ? STORE_LABEL.cafe : STORE_LABEL.kids} 엑셀이 아직 입력되지 않았습니다.
          </div>
        )
      )}

      <div className="day-top">
        <DayBox d={d} weather={weather} hol={hol} nothing={nothing} onClick={() => open({ name: "day" })} />
        <SectorBars d={d} open={open} />
      </div>

      {/* 키즈 입장 4칸 한 줄 (섹터 바로 아래) — 이름 · 장수 모두 가운데. 네이버 아래 회색 '(中 신규 41장)', 네 칸 같은 크기 */}
      <div className="stats four">
        <div className="stat">
          <div className="stat-label">
            입장권 판매
            <br />총 수량
          </div>
          <div className="stat-value">{count(kidsTickets(day), "장")}</div>
          <span className="note" />
        </div>
        <button className="stat tap" onClick={() => open({ name: "naver" })} title={day.newKnown ? "" : day.naverInput ? "지난 자료" : day.has.kids ? "입력 전 · POS 추정" : "입력 전"}>
          <div className="stat-label">네이버판매</div>
          <div className="stat-value">{count(day.naver, "장")}</div>
          <span className="note">{live?.provisional.includes("naver") ? "(이용완료 + 입장예정)" : day.newKnown ? `(中 신규 ${count(day.newVisitors, "장")})` : ""}</span>
        </button>
        <button className="stat tap" onClick={() => open({ name: "kids", key: "walkIn" })}>
          <div className="stat-label">현장판매</div>
          <div className="stat-value">{count(day.walkIn, "장")}</div>
          <span className="note" />
        </button>
        <button className="stat tap" onClick={() => open({ name: "kids", key: "eventFree" })}>
          <div className="stat-label">
            이벤트
            <br />
            무료입장
          </div>
          <div className="stat-value">{count(day.eventFree, "장")}</div>
          <span className="note" />
        </button>
      </div>

      {/* 그날 정보 — 카페 소비 인원 · 1인 평균소비 (키즈 입장 4칸 아래, 2026-10-13 사장님 지시로 순서 바꿈) */}
      <div className="stats">
        <button className="stat tap" onClick={() => open({ name: "visitors" })}>
          <div className="stat-label">
            카페 소비 인원 <Chevron />
          </div>
          <div className="stat-value">{count(day.visitors, "명")}</div>
          <span className="note">음료·맥주 {count(day.cups, "잔")} × 0.96</span>
        </button>
        <div className="stat">
          <div className="stat-label">1인 평균소비</div>
          <div className="stat-value">{day.avgSpend == null ? "—" : won(day.avgSpend)}</div>
          <span className="note">총 매출 ÷ 카페 소비 인원</span>
        </div>
      </div>

      {/* 자금 현황 — 그날 정보 아래. 누르면 계좌 · 적요까지 자세히 */}
      <button className="stat tap cash-stat" onClick={() => open({ name: "cash" })} aria-label="자금 현황 자세히">
        <div className="stat-label">
          자금 현황 · 잔액 합계 <small className="muted">증권계좌 별도</small> <Chevron />
        </div>
        {cash ? (
          <>
            <div className="stat-value">{money(cash.total, "KRW", false)}원</div>
            <CashBar inn={cash.krw.in} out={cash.krw.out} />
            {cashFrom && <span className="note">휴일 — 입출금 없음 · {shortLabel(cashFrom)} 잔액 그대로</span>}
            <span className="note">
              대출 제외 자금 <b className={cash.net < 0 ? "minus" : ""}>{cash.net < 0 ? `(${money(-cash.net, "KRW", false)})` : money(cash.net, "KRW", false)}원</b>
            </span>
          </>
        ) : (
          <span className="note">이날 자금 보고 없음 — 눌러서 가까운 날 보기</span>
        )}
      </button>

      {/* 1. 당월 매출 합계 · 2. 전년 동기간 매출 합계 (좌우 비교) / 3. OO년 총 매출 합계 · 4. OO년 (현금/신용) 정산완료 합계 */}
      <div className="stats">
        <button className="stat tap" onClick={() => open({ name: "month" })}>
          <div className="stat-label">
            당월 매출 합계 <Chevron />
          </div>
          <div className="stat-value">{won(d.month.total)}</div>
          {/* 오늘 마감 전이면 누계는 어제까지 (d.cumTo) */}
          <span className="note period">({d.cumTo < d.month.from ? "오늘 마감 전 · 확정분 없음" : span(d.month.from, d.cumTo, true)})</span>
        </button>
        <button className="stat tap" onClick={() => open({ name: "month" })}>
          <div className="stat-label">
            전년 동기간 매출 합계 <Chevron />
          </div>
          <div className="stat-value">{hasData(d.lyMonth) ? won(d.lyMonth.total) : "—"}</div>
          <span className="note period">({span(d.lyMonth.from, d.lyMonth.to, true)})</span>
        </button>
      </div>
      <div className="stats">
        <button className="stat tap" onClick={() => open({ name: "year" })}>
          <div className="stat-label">
            {d.date.slice(2, 4)}년 총 매출 합계 <Chevron />
          </div>
          <div className="stat-value">{won(d.year.total)}</div>
          <span className="note period">({d.cumTo < `${d.date.slice(0, 4)}-01-01` ? "오늘 마감 전 · 확정분 없음" : span(`${d.date.slice(0, 4)}-01-01`, d.cumTo, true)})</span>
        </button>
        <button className="stat tap" onClick={() => open({ name: "settle" })}>
          <div className="stat-label">
            {d.date.slice(2, 4)}년 (현금/신용) 정산완료 합계 <Chevron />
          </div>
          <div className="stat-value">{settle && settle.days > 0 ? won(settle.total) : "—"}</div>
          <span className="note period">({span(`${d.date.slice(0, 4)}-01-01`, d.date, false)})</span>
        </button>
      </div>
    </>
  );
}

/** 그날 원화 입금 · 출금 막대 (긴 쪽을 꽉 차게) */
function CashBar({ inn, out }: { inn: number; out: number }) {
  const max = Math.max(inn, out, 1);
  return (
    <div className="cash-bar" aria-label={`입금 ${money(inn, "KRW", false)}원, 출금 ${money(out, "KRW", false)}원`}>
      <div className="cb-row">
        <span className="cb-label">입금</span>
        <span className="cb-track">
          <span className="cb-fill in" style={{ width: `${(inn / max) * 100}%` }} />
        </span>
        <span className="cb-num in">+{money(inn, "KRW", false)}</span>
      </div>
      <div className="cb-row">
        <span className="cb-label">출금</span>
        <span className="cb-track">
          <span className="cb-fill out" style={{ width: `${(out / max) * 100}%` }} />
        </span>
        <span className="cb-num out">−{money(out, "KRW", false)}</span>
      </div>
    </div>
  );
}

/** 기간 글자 — '26년 10월 1일 ~ 10월 2일' (year=false 면 해 없이) */
export function span(from: string, to: string, year: boolean): string {
  // 날짜 안에서는 줄이 안 바뀌게 (좁은 폰에서는 '~' 앞뒤에서만)
  const nb = "\u00a0";
  const k = (x: string) => `${Number(x.slice(5, 7))}월${nb}${Number(x.slice(8, 10))}일`;
  return `${year ? `${from.slice(2, 4)}년${nb}` : ""}${k(from)} ~ ${from.slice(0, 4) !== to.slice(0, 4) ? `${to.slice(2, 4)}년${nb}` : ""}${k(to)}`;
}

/** 비교 % — 좁은 칸이라 정수(+12%), 1% 안쪽만 소수 한 자리(+0.4%) */
function pctWhole(p: number): string {
  return Math.abs(p) < 1 ? pct(p) : `${p > 0 ? "+" : ""}${Math.round(p)}%`;
}

/** 왼쪽 상자 — 날씨 네 칸 / 날짜 / 마감일 매출 / 금액 / 지난주 같은 요일 / 그 금액 대비 / 오르내린 금액 (%) */
function DayBox({ d, weather, hol, nothing, onClick }: { d: Dashboard; weather?: DayWeather; hol?: string | null; nothing: boolean; onClick: () => void }) {
  const live = useLive();
  const wxRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLSpanElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);
  const cmpRef = useRef<HTMLSpanElement>(null);
  const [, m, dd] = d.date.split("-").map(Number);
  const dateLine = `${m}월 ${dd}일(${d.weekday})${hol ? ` ${hol}` : ""}`;
  const kind = live?.today ? "마감 전 매출" : live ? "확정 전 매출" : "마감일 매출";
  const total = d.day.total;
  const before = d.prevWeek.m.total;
  const p = nothing ? null : changePct(total, before);
  // 비교 세 줄 — 마감 전 · 확정 전은 하루 전체와 견주면 틀린 비교라 숨김
  const cmp: [string, string, JSX.Element | string] = live
    ? [live.today ? "마감 전 정보라" : "확정 전 정보라", "지난주 비교는", live.today ? "마감 뒤에 보입니다" : "확정 뒤에 보입니다"]
    : p == null
      ? [`지난주 ${d.weekday}요일`, "비교 자료 없음", "\u00a0"]
      : [
          `지난주 ${d.weekday}요일`,
          `${won(before)} 대비`,
          <span className={p > 0 ? "up" : p < 0 ? "down" : ""}>
            {won(Math.abs(total - before))} {p > 0 ? "상승" : p < 0 ? "하락" : "변동 없음"} ({pctWhole(p)})
          </span>,
        ];
  const key = `${d.date}|${total}|${before}|${live?.today}|${!!live}|${weather?.label}|${weather?.tempMax}|${weather?.tempMin}`;
  useFit(wxRef, [key]);
  useFit(headRef, [key]);
  useFit(valueRef, [key]);
  useFit(cmpRef, [key]);
  return (
    <button className="card day-box tap" onClick={onClick} aria-label={`${dateLine} ${kind} ${won(total)}`}>
      <WeatherPanel date={d.date} w={weather} innerRef={wxRef} />
      <span className="db-amount">
        <span className="db-head" ref={headRef}>
          <span data-fit className="db-date">
            {dateLine}
          </span>
          <span data-fit className="db-kind">
            {kind}
          </span>
        </span>
        <span className="db-value-wrap" ref={valueRef}>
          <span data-fit className="db-value">
            {won(total)}
          </span>
        </span>
        <span className="db-cmp" ref={cmpRef}>
          {cmp.map((t, i) => (
            <span data-fit key={i} className="db-cmp-line">
              {t}
            </span>
          ))}
        </span>
      </span>
    </button>
  );
}

/** 오른쪽 긴 상자 다섯 — "바리스타 3,345,000원 (41%)" · 다섯 줄 글자 크기 같게 */
function SectorBars({ d, open }: { d: Dashboard; open: Open }) {
  const ref = useRef<HTMLDivElement>(null);
  const day = d.day;
  useFit(ref, [d.date, day.total, ...BOXES.map((b) => day.box[b])]);
  return (
    <div className="bars" role="list" ref={ref}>
      {BOXES.map((b) => (
        <button key={b} data-fit role="listitem" className="bar tap" onClick={() => open({ name: "sector", box: b })} aria-label={`${b} ${won(day.box[b])}`}>
          <span className="bar-label">{BOX_LABEL[b]}</span>
          <span className="bar-amt">
            {won(day.box[b])}
            <span className="bar-pct"> ({day.total > 0 ? Math.round((day.box[b] / day.total) * 100) : 0}%)</span>
          </span>
        </button>
      ))}
    </div>
  );
}
