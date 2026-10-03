/* ============================================================
   대시보드 — 달력에서 고른 마감일의 숫자
   ① 마감일 총 매출 + 날씨 (상세 없음)
   ② 바리스타 · 베이커리 · 키친 · 키즈입장 · 기타 (한 줄 상자 다섯 개 → 섹터 상세)
   ③ 당월 매출 합계 · 전년도 같은 기간 매출 합계 / OO년 총 매출 합계 (→ 누계 상세, 해는 마감일 따라)
   ④ 카페아스타나 방문인원 · 1인 평균소비 (상세 없음)
   ⑤ 네이버 입장권 판매수 · 현장 입장권 판매수 · 이벤트 무료입장팀 수 (→ 각 상세)
   ⑥ 자금 현황 — 잔액 합계 · 대출 제외 자금 (→ 자금 상세)
   ⑦ OO년 (현금/신용) 정산완료 합계 (1/1~마감일 통장에 들어온 카드 · 네이버페이 · 배달앱 · 현금매출) — 누계 줄 오른쪽 아래
   ============================================================ */
import { HeroBox } from "../ui/WeatherPanel";
import { addDays, BOXES, changePct, comparable, count, holidayName, money, todayKst, pct, SETTLE_LABEL, shortLabel, STORE_LABEL, won, wonMan, type BoxKey, type CashSummary, type Dashboard, type DayWeather, type Metrics, type SettleKind } from "@report/core";

export type View =
  | { name: "home" }
  | { name: "day" }
  | { name: "sector"; box: BoxKey }
  | { name: "month" }
  | { name: "year" }
  | { name: "naver" }
  | { name: "kids"; key: "walkIn" | "eventFree" }
  | { name: "cash" }
  | { name: "settings" };
export type Open = (v: View) => void;

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

  return (
    <>
      {nothing ? (
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

      <HeroBox
        label={
          <>
            마감일 총 매출 · {shortLabel(d.date)}
            {hol ? ` ${hol}` : ""}
          </>
        }
        value={won(day.total)}
        date={d.date}
        w={weather}
        onClick={() => open({ name: "day" })}
      >
        <Delta now={day.total} before={d.prevWeek.m.total} label={`지난주 ${d.weekday}요일`} />
      </HeroBox>

      {/* 섹터 상자 — 다섯 개가 한 화면 폭에 (금액은 만 단위, 정확한 금액은 눌러서 상세에서) */}
      <div className="sectors" role="list">
        {BOXES.map((b) => (
          <button key={b} role="listitem" className="sector tap" onClick={() => open({ name: "sector", box: b })} aria-label={`${b} ${won(day.box[b])}`}>
            <span className="sec-label">{BOX_LABEL[b]}</span>
            <span className="sec-line">
              <span className="sec-value">{wonMan(day.box[b])}</span>
              <span className="sec-pct">{day.total > 0 ? `${Math.round((day.box[b] / day.total) * 100)}%` : ""}</span>
            </span>
          </button>
        ))}
      </div>


      {/* 자금 현황 — 섹터 상자 바로 아래. 누르면 계좌 · 적요까지 자세히 */}
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

      {/* 1. 당월 매출 합계 · 2. 전년도 같은 기간 매출 합계 / 3. OO년 총 매출 합계 · 4. OO년 (현금/신용) 정산완료 합계 */}
      <div className="stats">
        <button className="stat tap" onClick={() => open({ name: "month" })}>
          <div className="stat-label">
            당월 매출 합계 <Chevron />
          </div>
          <div className="stat-value">{won(d.month.total)}</div>
          <Delta now={d.month.total} before={comparable(d.lyMonth) ? d.lyMonth.total : null} label="작년 같은 기간" money={false} missing={partial(d.lyMonth)} />
        </button>
        <button className="stat tap" onClick={() => open({ name: "year" })}>
          <div className="stat-label">
            전년도 같은 기간 매출 합계 <Chevron />
          </div>
          <div className="stat-value">{comparable(d.lyYear) ? won(d.lyYear.total) : "—"}</div>
          <span className="note">
            {d.lyYear.from.slice(2).replace(/-/g, ".")} ~ {d.lyDate.slice(5).replace("-", ".")}
          </span>
        </button>
      </div>
      <div className="stats">
        <button className="stat tap" onClick={() => open({ name: "year" })}>
          <div className="stat-label">
            {d.date.slice(2, 4)}년 총 매출 합계 <Chevron />
          </div>
          <div className="stat-value">{won(d.year.total)}</div>
          <Delta now={d.year.total} before={comparable(d.lyYear) ? d.lyYear.total : null} label="작년 같은 기간" money={false} missing={partial(d.lyYear)} />
        </button>
        {settle && settle.days > 0 ? (
          <SettleBox d={d} s={settle} />
        ) : (
          <div className="stat">
            <div className="stat-label">{d.date.slice(2, 4)}년 (현금/신용) 정산완료 합계</div>
            <div className="stat-value">—</div>
            <span className="note">자금 보고가 아직 없습니다</span>
          </div>
        )}
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">카페아스타나 방문인원</div>
          <div className="stat-value">{count(day.visitors, "명")}</div>
          <span className="note">음료·맥주 {count(day.cups, "잔")} × 0.96</span>
        </div>
        <div className="stat">
          <div className="stat-label">1인 평균소비</div>
          <div className="stat-value">{day.avgSpend == null ? "—" : won(day.avgSpend)}</div>
          <span className="note">총 매출 ÷ 방문인원</span>
        </div>
      </div>

      <div className="stats three">
        <button className="stat tap" onClick={() => open({ name: "naver" })}>
          <div className="stat-label">네이버 입장권 판매수</div>
          <div className="stat-value">{count(day.naver, "장")}</div>
          <span className="note">{day.newKnown ? `신규 ${count(day.newVisitors, "명")}` : day.naverInput ? "지난 자료" : day.has.kids ? "입력 전 · POS 추정" : "입력 전"}</span>
        </button>
        <button className="stat tap" onClick={() => open({ name: "kids", key: "walkIn" })}>
          <div className="stat-label">현장 입장권 판매수</div>
          <div className="stat-value">{count(day.walkIn, "장")}</div>
          <span className="note">입장료 결제</span>
        </button>
        <button className="stat tap" onClick={() => open({ name: "kids", key: "eventFree" })}>
          <div className="stat-label">이벤트 무료입장팀 수</div>
          <div className="stat-value">{count(day.eventFree, "팀")}</div>
          <span className="note">쿠폰 입장</span>
        </button>
      </div>
      <p className="note center-note">
        {d.price.charged
          ? `${d.price.kind} 단가 ${won(d.price.price)} × 입장권 ${count(day.naver + day.walkIn, "장")}${day.kidsCoupon ? ` − 사은권 ${won(day.kidsCoupon)}` : ""} = 키즈입장 ${won(day.box.키즈입장료)}`
          : `교환권 방식(26년 3월까지) — 네이버 ${count(day.fee.naver / 30000, "장")} × 3만원 + 현장 ${won(day.fee.walkIn)} − 카페 교환권 사용 ${won(day.kidsCoupon)} = 키즈입장 ${won(day.box.키즈입장료)}`}
      </p>

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

/** 26년 (현금/신용) 정산완료 합계 — 1/1 ~ 마감일 통장에 들어온 매출 정산 (카드 · 네이버페이 · 배달앱 · 현금매출) */
function SettleBox({ d, s }: { d: Dashboard; s: Settle }) {
  const parts = (Object.keys(SETTLE_LABEL) as SettleKind[]).filter((k) => s.by[k]).map((k) => `${SETTLE_LABEL[k]} ${wonMan(s.by[k])}`);
  return (
    <div className="stat">
      <div className="stat-label">{d.date.slice(2, 4)}년 (현금/신용) 정산완료 합계</div>
      <div className="stat-value">{won(s.total)}</div>
      <span className="note settle-note">{parts.join(" · ") || "정산 입금 없음"}</span>
    </div>
  );
}
