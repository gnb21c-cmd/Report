/* 매출 보고 앱 (B) — 관리자 폰에서 어제 마감 기준 보고를 봄 */
import { useEffect, useMemo, useState } from "react";
import { addDays, dailyReport, latestBatches, monthlyRows, reportDate, salesOf, SalesIndex, shortLabel } from "@report/core";
import { useData } from "./data/useData";
import { Today } from "./screens/Today";
import { Products } from "./screens/Products";
import { Status } from "./screens/Status";
import { TrendChart } from "./charts/TrendChart";
import { MonthChart } from "./charts/MonthChart";

type Tab = "today" | "trend" | "products" | "status";
const TABS: [Tab, string, string][] = [
  ["today", "보고", "M4 13h4v7H4zM10 8h4v12h-4zM16 4h4v16h-4z"],
  ["trend", "추이", "M3 17l5-6 4 4 8-9"],
  ["products", "상품", "M4 6h16M4 12h16M4 18h10"],
  ["status", "설정", "M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 000 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"],
];

function Login({ onSubmit, error, busy }: { onSubmit: (e: string, p: string) => void; error: string | null; busy: boolean }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  return (
    <main className="center">
      <form
        className="card login"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(email, pw);
        }}
      >
        <h1>매출 보고</h1>
        <p className="sub">대표이사 · 관리자 전용</p>
        <label>
          이메일
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          비밀번호
          <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        </label>
        {error && <p className="bad">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "확인 중…" : "로그인"}
        </button>
      </form>
    </main>
  );
}

export function App() {
  const d = useData();
  const [tab, setTab] = useState<Tab>("today");
  const idx = useMemo(() => new SalesIndex(salesOf(d.batches), latestBatches(d.batches).map((b) => ({ pos: b.pos, date: b.date }))), [d.batches]);
  const latest = useMemo(() => reportDate(d.batches), [d.batches]);
  const [date, setDate] = useState<string | null>(latest);
  // 새 마감 자료가 오면 기준일을 그날로
  useEffect(() => setDate(latest), [latest]);

  if (d.phase === "setup")
    return (
      <main className="center">
        <div className="card login">
          <h1>설정이 필요합니다</h1>
          <p className="sub">클라우드 보관함 주소(VITE_FIREBASE_API_KEY · VITE_FIREBASE_PROJECT_ID)를 넣고 다시 만들어 주세요. docs/SETUP.md 참고.</p>
        </div>
      </main>
    );
  if (d.phase === "login") return <Login onSubmit={d.signIn} error={d.error} busy={d.syncing} />;

  const r = date ? dailyReport(idx, date) : null;
  const months = date ? monthlyRows(idx, date, 13) : [];
  const canPrev = !!date && !!idx.first && date > idx.first;
  const canNext = !!date && !!latest && date < latest;

  return (
    <div className="app">
      <header className="top">
        <div className="top-row">
          <h1>
            매출 보고{d.demo && <span className="badge">체험판</span>}
          </h1>
          {!d.demo && (
            <button className="ghost small" onClick={d.sync} disabled={d.syncing} aria-label="새 자료 확인">
              {d.syncing ? "확인 중…" : "↻"}
            </button>
          )}
        </div>
        {date && (
          <div className="datebar">
            <button className="ghost" disabled={!canPrev} onClick={() => setDate(addDays(date, -1))} aria-label="전날">
              ‹
            </button>
            <div>
              <b>{shortLabel(date)}</b> 마감 기준
              {date !== latest && (
                <button className="link" onClick={() => setDate(latest)}>
                  최근으로
                </button>
              )}
            </div>
            <button className="ghost" disabled={!canNext} onClick={() => setDate(addDays(date, 1))} aria-label="다음날">
              ›
            </button>
          </div>
        )}
        {d.error && <div className="banner">{d.error}</div>}
      </header>

      <main className={`content${d.syncing ? " busy" : ""}`}>
        {!r ? (
          tab === "status" ? null : (
            <section className="card">
              <h2>아직 받은 자료가 없습니다</h2>
              <p className="sub">POS 에서 마감 자료를 보내면 여기에 보고가 나옵니다.</p>
            </section>
          )
        ) : tab === "today" ? (
          <Today r={r} />
        ) : tab === "trend" ? (
          <>
            <TrendChart points={r.trend} selected={r.date} />
            <MonthChart rows={months} />
          </>
        ) : tab === "products" ? (
          <Products idx={idx} date={r.date} />
        ) : null}
        {tab === "status" && (
          <Status batches={d.batches} devices={d.devices} email={d.email} demo={d.demo} syncedAt={d.syncedAt} onSync={d.sync} onReload={d.reload} onSignOut={d.signOut} />
        )}
      </main>

      <nav className="tabs">
        {TABS.map(([t, label, icon]) => (
          <button key={t} className={tab === t ? "on" : ""} aria-current={tab === t} onClick={() => setTab(t)}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
              <path d={icon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
