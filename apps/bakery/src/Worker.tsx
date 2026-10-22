/* ============================================================
   근무자 화면 (…/w/<키 번호>/, 로그인 없음 · 2026-10-22 사장님) — 매장 한 곳에 붙인 QR 로 근무자만 열어 그때그때 봄 (공유 기능 없음)
   - 첫 화면: 베이커리 · 키친 두 칸
   - 베이커리: 현장 태블릿 생산 명령서 그대로 (예전 …/d1/<키>/ 도 이 화면 베이커리로 열림)
   - 키친: 재방문 이벤트 돈까스 예정(오늘 남은 · 내일 · 2일 뒤 · 3일 뒤) · [이벤트] 돈까스 평일 · 휴일 평균 판매량 · 상품별 오늘 · 1주 · 그 달
     손님이 매시 정각 · 30분에 와서 쓰므로 그 10분 전(20분 · 50분)에는 새 숫자 — 화면은 1분마다 · 다시 켤 때 바로 새로 읽음
     (통합데스크가 1분마다 보내고 매시 20 · 50분에 네이버를 다시 읽음 → 바리스타 POS 하루 수집이 칸을 받는 중에도 1분마다 옮김)
     통합데스크 소식이 10분 넘게 없으면 '늦은 숫자'라고 알림 (키즈 POS 꺼짐 등)
   - 키 번호는 현장 태블릿과 같음 (매니저 앱 [태블릿 주소]) · 숫자만 복사해 둔 floor/{키} 만 읽음 (매출 금액 · 손님 정보 없음)
   - 규칙은 packages/core/src/work.ts
   ============================================================ */
import { checkWorkDoc, checkWorkEvent, count, nowKst, shortLabel, weekday, WEEKDAY_KO, type WorkDoc, type WorkEventDoc } from "@report/core";
import { useEffect, useState, type ReactNode } from "react";
import type { WorkApi } from "./data";

type Page = "home" | "bakery" | "kitchen";
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))} (${WEEKDAY_KO[weekday(d)]})`;
const AHEAD = ["내일", "2일 뒤", "3일 뒤"];
/** 통합데스크 소식이 이보다 오래되면 늦은 숫자라고 알림 (분) */
const EVENT_LATE_MIN = 10;
/** 통합데스크 시각("YYYY-MM-DD HH:MM:SS", 한국) 뒤로 지난 분 */
const minsSince = (at: string) => (Date.now() - Date.parse(`${at.replace(" ", "T")}+09:00`)) / 60e3;

/** bakery = 현장 태블릿 생산 명령서 (뒤로 버튼을 받아 그림) */
export function Worker({ api, bakery, start = "home" }: { api: WorkApi; bakery: (back: () => void) => ReactNode; start?: Page }) {
  const [page, setPage] = useState<Page>(start);
  const home = () => setPage("home");
  if (page === "bakery") return <>{bakery(home)}</>;
  if (page === "kitchen") return <Kitchen api={api} onBack={home} />;
  return (
    <div className="app worker">
      <header className="top">
        <h1>현장 · {shortLabel(nowKst().date)}</h1>
      </header>
      <main className="content">
        <div className="sector-btns two">
          <button className="sector-btn" onClick={() => setPage("bakery")}>
            <span className="ic">🥐</span>
            <b>베이커리</b>
            <small className="muted">생산 명령서</small>
          </button>
          <button className="sector-btn" onClick={() => setPage("kitchen")}>
            <span className="ic">🥩</span>
            <b>키친</b>
            <small className="muted">돈까스 예정 · 판매량</small>
          </button>
        </div>
      </main>
    </div>
  );
}

function Kitchen({ api, onBack }: { api: WorkApi; onBack: () => void }) {
  const [doc, setDoc] = useState<WorkDoc | null | undefined>(undefined);
  const [ev, setEv] = useState<WorkEventDoc | null | undefined>(undefined);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    const load = () =>
      Promise.all([api.now(), api.event()]).then(
        ([d, e]) => {
          if (!live) return;
          setErr("");
          // 검사에 걸린 숫자는 보여 주지 않음
          setDoc(d && !checkWorkDoc(d).length ? d : null);
          setEv(e && !checkWorkEvent(e).length ? e : null);
        },
        (e) => live && setErr((e as Error).message),
      );
    load();
    const t = setInterval(load, 60_000);
    // 폰 화면을 다시 켜거나 앱으로 돌아오면 바로 새로 (꺼져 있던 동안은 타이머가 멈춰 있을 수 있음)
    const seen = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", seen);
    return () => {
      live = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", seen);
    };
  }, [api]);
  const today = nowKst().date;
  const e = ev?.event && ev.event.day === today ? ev.event : null;
  const late = e ? Math.floor(minsSince(e.at)) : 0;
  const month = `${Number(today.slice(5, 7))}월`;
  const dk = doc?.kitchen.donkatsu;
  return (
    <div className="app worker">
      <header className="top">
        <button className="ghost back" onClick={onBack} aria-label="뒤로">
          ‹ 뒤로
        </button>
        <h1>🥩 키친</h1>
        <span className="sub">1분마다 새로 고침</span>
      </header>
      <main className="content">
        {err && <p className="error box">{err}</p>}
        <section className="card event-card" aria-label="재방문 이벤트 돈까스 예정">
          <h2>재방문 이벤트 · 돈까스 예정</h2>
          {ev === undefined ? (
            <p className="muted">불러오는 중…</p>
          ) : !e ? (
            <p className="muted">통합데스크 숫자를 기다리는 중이에요 (키즈 POS 통합데스크가 보내면 바로 보여요)</p>
          ) : (
            <>
              <div className="ev-today">
                <span>오늘 남은 예약</span>
                <b className="num">{e.today == null ? "—" : count(e.today, "건")}</b>
                <small className="muted">아직 안 온 손님 · 통합데스크 {e.at.slice(11, 16)} 기준</small>
              </div>
              {late > EVENT_LATE_MIN && <p className="warn">통합데스크 소식이 {late}분째 없어요 — 숫자가 늦을 수 있어요 (키즈 POS 통합데스크가 켜져 있는지 봐 주세요)</p>}
              <div className="ev-ahead">
                {AHEAD.map((label, i) => {
                  const a = e.ahead[i];
                  return (
                    <div key={label} className="ev-day">
                      <span>{label}</span>
                      {a && <small>{md(a.date)}</small>}
                      <b className="num">{a ? count(a.n, "건") : "—"}</b>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
        <div className="avg-boxes">
          <div className="avg-box">
            <span>평일 평균 판매량</span>
            <b className="num">{dk?.weekday == null ? "—" : count(dk.weekday, "개")}</b>
            <small className="muted">[이벤트] 돈까스 · 하루</small>
          </div>
          <div className="avg-box hol">
            <span>휴일 평균 판매량</span>
            <b className="num">{dk?.holiday == null ? "—" : count(dk.holiday, "개")}</b>
            <small className="muted">[이벤트] 돈까스 · 하루</small>
          </div>
        </div>
        {doc && dk?.weekday == null && dk?.holiday == null && <p className="muted center small">[이벤트] 돈까스가 아직 안 팔렸어요 (처음 팔린 날부터 지난 4주 평균)</p>}
        <section className="card list-card">
          {doc === undefined ? (
            <p className="muted">불러오는 중…</p>
          ) : !doc ? (
            <p className="muted">숫자가 아직 없어요 — 바리스타 POS 하루 수집이 15분마다 채워요.</p>
          ) : (
            <>
              <table className="work-table">
                <thead>
                  <tr>
                    <th>상품명</th>
                    <th>오늘</th>
                    <th>1주</th>
                    <th>{month}</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.kitchen.items.map((i) => (
                    <tr key={i.name} className={i.today ? "" : "zero"}>
                      <td>{i.name}</td>
                      <td className="num">{i.today.toLocaleString("ko-KR")}</td>
                      <td className="num">{i.week.toLocaleString("ko-KR")}</td>
                      <td className="num">{i.month.toLocaleString("ko-KR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!doc.kitchen.items.length && <p className="empty">이번 달 판매가 아직 없어요.</p>}
              <p className="note">
                {new Date(doc.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" })} 기준 · 오늘 = 지금까지(마감 전) · 1주 = 오늘 포함 7일 · {month} = 1일 ~ 오늘
              </p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
