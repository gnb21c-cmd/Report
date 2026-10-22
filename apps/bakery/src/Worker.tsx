/* ============================================================
   근무자 화면 (…/w/<키 번호>/, 로그인 없음 · 2026-10-22 사장님) — 관리자 보고 앱에서 수량만 발췌
   - 맨 위: 재방문 이벤트 돈까스 예정 — 오늘 아직 안 온 이벤트 대상 예약 · 내일 · 모레 · 글피 (통합데스크 숫자)
   - 바리스타 · 베이커리 · 키친 버튼 → 섹터 화면: 평일 · 휴일 하루 평균 수요량 두 칸 + 상품별 오늘 · 1주 · 월 판매량
   - 키 번호는 현장 태블릿과 같음 (매니저 앱 [태블릿 주소]) · 숫자만 복사해 둔 floor/{키}/work 만 읽음 (매출 금액 · 손님 정보 없음)
   - 1분마다 새로 읽음 · 규칙은 packages/core/src/work.ts
   ============================================================ */
import { checkWorkDoc, checkWorkEvent, count, nowKst, shortLabel, weekday, WEEKDAY_KO, WORK_SECTORS, type WorkDoc, type WorkEventDoc, type WorkSectorKey } from "@report/core";
import { useEffect, useState } from "react";
import type { WorkApi } from "./data";

const ICON: Record<WorkSectorKey, string> = { 바리스타: "☕", 베이커리: "🥐", 키친: "🍳" };
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))} (${WEEKDAY_KO[weekday(d)]})`;
const AHEAD = ["내일", "모레", "글피"];

export function Worker({ api }: { api: WorkApi }) {
  const [doc, setDoc] = useState<WorkDoc | null | undefined>(undefined);
  const [ev, setEv] = useState<WorkEventDoc | null | undefined>(undefined);
  const [err, setErr] = useState("");
  const [sector, setSector] = useState<WorkSectorKey | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => {
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
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [api]);
  const today = nowKst().date;
  return (
    <div className="app worker">
      <header className="top">
        {sector ? (
          <button className="ghost back" onClick={() => setSector(null)} aria-label="뒤로">
            ‹ 뒤로
          </button>
        ) : null}
        <h1>{sector ? `${ICON[sector]} ${sector}` : `오늘 한눈에 · ${shortLabel(today)}`}</h1>
        <span className="sub">{doc ? `${new Date(doc.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" })} 기준 · 1분마다 새로 고침` : "1분마다 새로 고침"}</span>
      </header>
      <main className="content">
        {err && <p className="error box">{err}</p>}
        {sector ? <SectorView doc={doc} sector={sector} /> : <Home doc={doc} ev={ev} today={today} onSector={setSector} />}
      </main>
    </div>
  );
}

function Home({ doc, ev, today, onSector }: { doc: WorkDoc | null | undefined; ev: WorkEventDoc | null | undefined; today: string; onSector: (s: WorkSectorKey) => void }) {
  const e = ev?.event && ev.event.day === today ? ev.event : null;
  return (
    <>
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
            <div className="ev-ahead">
              {[1, 2, 3].map((k, i) => {
                const a = e.ahead[i];
                return (
                  <div key={k} className="ev-day">
                    <span>
                      {AHEAD[i]}
                      {a && <small> {md(a.date)}</small>}
                    </span>
                    <b className="num">{a ? count(a.n, "건") : "—"}</b>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
      <div className="sector-btns">
        {WORK_SECTORS.map((s) => {
          const x = doc?.sectors[s];
          const t = x ? x.items.reduce((a, i) => a + i.today, 0) : null;
          return (
            <button key={s} className="sector-btn" onClick={() => onSector(s)}>
              <span className="ic">{ICON[s]}</span>
              <b>{s}</b>
              <small className="muted">{t == null ? "" : `오늘 ${count(t, x!.unit)}`}</small>
            </button>
          );
        })}
      </div>
      {doc === null && <p className="muted center">숫자가 아직 없어요 — 바리스타 POS 하루 수집이 15분마다 채워요.</p>}
    </>
  );
}

function SectorView({ doc, sector }: { doc: WorkDoc | null | undefined; sector: WorkSectorKey }) {
  if (doc === undefined) return <p className="muted center">불러오는 중…</p>;
  if (!doc) return <p className="muted center">숫자가 아직 없어요 — 바리스타 POS 하루 수집이 15분마다 채워요.</p>;
  const x = doc.sectors[sector];
  const month = `${Number(doc.date.slice(5, 7))}월`;
  return (
    <>
      <div className="avg-boxes">
        <div className="avg-box">
          <span>평일 평균 수요량</span>
          <b className="num">{x.avg.weekday == null ? "—" : count(x.avg.weekday, x.unit)}</b>
          <small className="muted">하루 · 지난 4주</small>
        </div>
        <div className="avg-box hol">
          <span>휴일 평균 수요량</span>
          <b className="num">{x.avg.holiday == null ? "—" : count(x.avg.holiday, x.unit)}</b>
          <small className="muted">하루 · 지난 4주</small>
        </div>
      </div>
      <section className="card list-card">
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
            {x.items.map((i) => (
              <tr key={i.name} className={i.today ? "" : "zero"}>
                <td>{i.name}</td>
                <td className="num">{i.today.toLocaleString("ko-KR")}</td>
                <td className="num">{i.week.toLocaleString("ko-KR")}</td>
                <td className="num">{i.month.toLocaleString("ko-KR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!x.items.length && <p className="empty">이번 달 판매가 아직 없어요.</p>}
        <p className="note">오늘 = 지금까지(마감 전) · 1주 = 오늘 포함 7일 · {month} = 1일 ~ 오늘 · 단위 {x.unit}</p>
      </section>
    </>
  );
}
