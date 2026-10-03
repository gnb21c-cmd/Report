/* 매출 보고 앱 (B) — 설치한 폰 누구나 봄 (로그인 없음)
   첫 화면: 달력 띠 + 대시보드 → 상자를 누르면 상세 → 뒤로(폰의 뒤로 버튼도 됨) */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, Board, dashboard, todayKst } from "@report/core";
import { useData } from "./data/useData";
import { CalendarStrip } from "./ui/CalendarStrip";
import { Home, type View } from "./screens/Home";
import { SectorDetail } from "./screens/SectorDetail";
import { MonthDetail, YearDetail } from "./screens/CumDetail";
import { KidsBarsDetail, NaverDetail } from "./screens/KidsDetail";
import { Settings } from "./screens/Settings";

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
  const board = useMemo(() => new Board(d.reports), [d.reports]);
  const present = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const [date, r] of board.byDate) m.set(date, new Set([r.cafe && "cafe", r.kids && "kids", r.naver && "naver"].filter(Boolean) as string[]));
    return m;
  }, [board]);
  const latest = useMemo(() => board.latest(), [board]);
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
  const from = board.first && board.first < addDays(to, -60) ? board.first : addDays(to, -60);
  const nav = { date, minDate: from, maxDate: to, onDate: setDate, onBack: back };

  let body: JSX.Element | null = null;
  if (view.name === "sector") body = <SectorDetail board={board} box={view.box} weather={d.weather} {...nav} />;
  else if (view.name === "month") body = <MonthDetail board={board} {...nav} />;
  else if (view.name === "year") body = <YearDetail board={board} {...nav} />;
  else if (view.name === "naver") body = <NaverDetail board={board} {...nav} />;
  else if (view.name === "kids") body = <KidsBarsDetail board={board} k={view.key} {...nav} />;
  else if (view.name === "settings")
    body = <Settings board={board} status={d.status} source={d.source} latest={latest} syncedAt={d.syncedAt} syncing={d.syncing} onSync={d.sync} onReload={d.reload} onBack={back} />;
  if (body) return <div className="app">{body}</div>;

  return (
    <div className="app">
      <header className="top">
        <CalendarStrip from={from} to={to} selected={date} present={present} latest={latest} onSelect={setDate} onSettings={() => open({ name: "settings" })} />
        {d.source === "demo" && <div className="demo-tag">체험판 · 가짜 자료</div>}
        {d.error && <div className="banner">{d.error}</div>}
      </header>
      <main className={`content${d.syncing ? " busy" : ""}`}>
        {d.phase === "loading" && !d.reports.length ? <p className="empty">자료를 받는 중입니다…</p> : <Home d={dashboard(board, date)} open={open} weather={d.weather[date]} />}
      </main>
    </div>
  );
}
