/* 매출 보고 앱 (B) — 설치한 폰 누구나 봄 (로그인 없음)
   첫 화면: 달력 띠 + 대시보드 → 상자를 누르면 상세(추세 · 분석) → 뒤로(폰의 뒤로 버튼도 됨) */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, Board, dashboard, latestBatches, reportDate, salesOf, SalesIndex, todayKst, type MetricKey } from "@report/core";
import { useData } from "./data/useData";
import { CalendarStrip } from "./ui/CalendarStrip";
import { Home } from "./screens/Home";
import { Detail } from "./screens/Detail";
import { CumDetail } from "./screens/CumDetail";
import { Settings } from "./screens/Settings";

type View = { name: "home" } | { name: "metric"; key: MetricKey } | { name: "cum"; kind: "month" | "year" } | { name: "settings" };

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <main className="center">
      <div className="card notice">
        <h1>{title}</h1>
        <p className="sub">{text}</p>
      </div>
    </main>
  );
}

export function App() {
  const d = useData();
  const idx = useMemo(() => new SalesIndex(salesOf(d.batches), latestBatches(d.batches).map((b) => ({ pos: b.pos, date: b.date }))), [d.batches]);
  const board = useMemo(() => new Board(idx, d.adjusts), [idx, d.adjusts]);
  const latest = useMemo(() => reportDate(d.batches), [d.batches]);
  const today = todayKst();
  const [date, setDate] = useState<string>(latest || addDays(today, -1));
  const [view, setView] = useState<View>({ name: "home" });
  const homeScroll = useRef(0);

  // 새 마감 자료가 오면 기준일을 그날로
  useEffect(() => {
    if (latest) setDate(latest);
  }, [latest]);

  // 폰의 뒤로 버튼 = 앱 안에서 뒤로
  useEffect(() => {
    const onPop = (e: PopStateEvent) => setView((e.state && e.state.view) || { name: "home" });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (view.name === "home") requestAnimationFrame(() => window.scrollTo(0, homeScroll.current));
    else window.scrollTo(0, 0);
  }, [view]);

  const open = useCallback((v: View) => {
    homeScroll.current = window.scrollY;
    history.pushState({ view: v }, "");
    setView(v);
  }, []);
  const back = useCallback(() => {
    if (history.state && history.state.view) history.back();
    else setView({ name: "home" });
  }, []);

  if (d.phase === "setup") return <Notice title="설정이 필요합니다" text="클라우드 보관함 주소(VITE_FIREBASE_API_KEY · VITE_FIREBASE_PROJECT_ID)를 넣고 다시 만들어 주세요. docs/SETUP.md 참고." />;
  if (d.phase === "nokey") return <Notice title="설치 주소로 열어 주세요" text="받으신 설치 주소(…/b/열쇠/)로 열어야 매장 자료가 보입니다. 주소를 다시 확인해 주세요." />;

  const to = latest && latest > today ? latest : today;
  const from = idx.first && idx.first < addDays(to, -60) ? idx.first : addDays(to, -60);
  const nav = { date, minDate: from, maxDate: to, onDate: setDate, onBack: back };

  if (view.name === "metric")
    return (
      <div className="app">
        <Detail board={board} k={view.key} adjust={d.adjusts[date]} onSaveAdjust={d.setAdjust} weather={d.weather} {...nav} />
      </div>
    );
  if (view.name === "cum")
    return (
      <div className="app">
        <CumDetail board={board} kind={view.kind} {...nav} />
      </div>
    );
  if (view.name === "settings")
    return (
      <div className="app">
        <Settings batches={d.batches} devices={d.devices} demo={d.demo} syncedAt={d.syncedAt} syncing={d.syncing} onSync={d.sync} onReload={d.reload} onBack={back} />
      </div>
    );

  return (
    <div className="app">
      <header className="top">
        <CalendarStrip from={from} to={to} selected={date} present={idx.present} latest={latest} onSelect={setDate} onSettings={() => open({ name: "settings" })} />
        {d.demo && <div className="demo-tag">체험판 · 가짜 자료</div>}
        {d.error && <div className="banner">{d.error}</div>}
      </header>
      <main className={`content${d.syncing ? " busy" : ""}`}>
        {d.phase === "loading" && !d.batches.length ? <p className="empty">자료를 받는 중입니다…</p> : <Home board={board} d={dashboard(board, date)} open={open} weather={d.weather[date]} />}
      </main>
    </div>
  );
}
