/* 매출 보고 앱 (B) — 설치한 폰 누구나 봄 (로그인 없음)
   첫 화면: 달력 띠 + 대시보드 → 상자를 누르면 상세 → 뒤로(폰의 뒤로 버튼도 됨) */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, applySettings, Board, cashBook, cashOnDay, closedDay, dashboard, dayStage, liveReport, liveStale, mergeLive, settlements, todayKst, type CashPart, type DayReport, type LiveKind } from "@report/core";
import { LiveCtx, type LiveState } from "./ui/Live";
import { useData } from "./data/useData";
import { CalendarStrip } from "./ui/CalendarStrip";
import { Home, type View } from "./screens/Home";
import { SectorDetail } from "./screens/SectorDetail";
import { MonthDetail, YearDetail } from "./screens/CumDetail";
import { KidsBarsDetail, NaverDetail } from "./screens/KidsDetail";
import { LogScreen } from "./screens/LogScreen";
import { InstallBanner } from "./ui/InstallBanner";
import { CashDetail } from "./screens/CashDetail";
import { SettleDetail } from "./screens/SettleDetail";
import { VisitorsDetail } from "./screens/VisitorsDetail";
import { DayDetail } from "./screens/DayDetail";

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
  // 오늘 마감 전 영업정보 — 오늘 · 어제 live 문서를 검사해 통과한 칸만, 확정 칸이 없는 자리에 (폰 저장소에는 쌓지 않음)
  const lives = useMemo(() => {
    const m = new Map<string, ReturnType<typeof liveReport> & { provisional: LiveKind[]; merged: DayReport }>();
    const confirmed = new Map(d.reports.map((r) => [r.date, r]));
    for (const [date, doc] of Object.entries(d.live)) {
      if (!doc) continue;
      const lr = liveReport(doc, date);
      const merged = mergeLive(confirmed.get(date), lr.report);
      m.set(date, { ...lr, provisional: merged.provisional || [], merged });
    }
    return m;
  }, [d.live, d.reports]);
  const reports = useMemo(() => {
    if (!lives.size) return d.reports;
    const m = new Map(d.reports.map((r) => [r.date, r]));
    for (const [date, l] of lives) if (l.provisional.length) m.set(date, l.merged);
    return [...m.values()];
  }, [d.reports, lives]);
  // 설정(기간 스티커 · 휴일)을 넣은 뒤 계산 — 설정이 바뀌면 다시
  const board = useMemo(() => {
    applySettings(d.settings);
    return new Board(reports);
  }, [reports, d.settings]);
  const present = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const [date, r] of board.byDate) m.set(date, new Set([r.cafe && "cafe", r.kids && "kids", r.naver && "naver"].filter(Boolean) as string[]));
    return m;
  }, [board]);
  // 볼 수 있는 마지막 날 — 확정은 전날 자료가 다음 날 오전 10시부터 (5분마다 다시 봄). 마감 전 영업정보가 있으면 오늘(아침 10시 전에는 어제)까지
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5 * 60_000);
    return () => clearInterval(t);
  }, []);
  const closed = closedDay(new Date(now));
  const boardLatest = useMemo(() => board.latest(), [board]);
  const latest = boardLatest && boardLatest > closed ? closed : boardLatest;
  // 자금: 앞 보고의 금일 잔고를 이어서 계산
  const cashParts = useMemo(() => d.reports.map((r) => r.cash).filter((c): c is CashPart => !!c), [d.reports]);
  const book = useMemo(() => cashBook(cashParts), [cashParts]);
  const today = todayKst(new Date(now));
  const liveTop = [today, addDays(today, -1)].find((k) => k > closed && (lives.get(k)?.report || (k < today && board.report(k))));
  const top = liveTop || latest;
  const [date, setDate] = useState<string>(top || closed);
  const [view, setView] = useState<View>({ name: "home" });
  const homeScroll = useRef(0);

  // 새 마감 자료 · 오늘 마감 전 영업정보가 오면 기준일을 그날로
  useEffect(() => {
    if (top) setDate(top);
  }, [top]);

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

  const to = liveTop || closed;
  const lv = lives.get(date);
  const stage = dayStage(date, today);
  // 오늘은 마감 전 · 어제가 아직 확정 전(아침 10시 전)이면 '확정 전' — 둘 다 비교(▲▼)를 숨김
  const liveState: LiveState | null =
    stage === "live" || date > closed
      ? {
          today: stage === "live",
          provisional: lv?.provisional || [],
          at: lv?.at || null,
          stale: stage === "live" && liveStale(lv?.at, new Date(now)),
          problems: lv?.problems || [],
          // 오늘 숫자를 받았는데 네이버만 없음(네이버 로그인 풀림 등) → 키즈 입장료가 모자라다고 알림
          naverMissing: stage === "live" && !!lv?.report && !board.report(date)?.naver,
        }
      : null;
  const from = board.first && board.first < addDays(to, -60) ? board.first : addDays(to, -60);
  const nav = { date, minDate: from, maxDate: to, onDate: setDate, onBack: back };
  // 휴일(보고 없음)은 가장 최근 잔액 그대로 · 입출금 0
  const cashDay = cashOnDay(book, cashParts, date);

  let body: JSX.Element | null = null;
  if (view.name === "day") body = <DayDetail board={board} weather={d.weather} {...nav} />;
  else if (view.name === "sector") body = <SectorDetail board={board} box={view.box} weather={d.weather} {...nav} />;
  // 누계 상세는 마감 전인 오늘을 빼고 어제까지 확정분으로
  else if (view.name === "month") body = <MonthDetail board={board} {...nav} date={liveState?.today ? addDays(date, -1) : date} />;
  else if (view.name === "year") body = <YearDetail board={board} {...nav} date={liveState?.today ? addDays(date, -1) : date} />;
  else if (view.name === "naver") body = <NaverDetail board={board} {...nav} />;
  else if (view.name === "kids") body = <KidsBarsDetail board={board} k={view.key} {...nav} />;
  else if (view.name === "visitors") body = <VisitorsDetail board={board} {...nav} />;
  else if (view.name === "settle") body = <SettleDetail cashParts={cashParts} {...nav} />;
  else if (view.name === "cash") {
    const earlier = [...book.keys()].filter((k) => k <= date).sort().pop() || null;
    body = <CashDetail sum={cashDay?.sum} part={cashDay?.part} carriedFrom={cashDay?.carriedFrom || null} meta={cashDay?.carriedFrom ? undefined : board.report(date)?.meta?.cash} earlier={earlier !== date ? earlier : null} {...nav} />;
  } else if (view.name === "settings")
    body = <LogScreen board={board} latest={latest} onBack={back} />;
  if (body)
    return (
      <LiveCtx.Provider value={liveState}>
        <div className="app">{body}</div>
      </LiveCtx.Provider>
    );

  return (
    <LiveCtx.Provider value={liveState}>
      <div className="app">
        <InstallBanner />
        <header className="top">
          <CalendarStrip from={from} to={to} selected={date} present={present} latest={latest} onSelect={setDate} onSettings={() => open({ name: "settings" })} />
          {d.source === "demo" && <div className="demo-tag">체험판 · 가짜 자료</div>}
          {d.error && <div className="banner">{d.error}</div>}
        </header>
        <main className={`content${d.syncing ? " busy" : ""}`}>
          {d.phase === "loading" && !d.reports.length ? <p className="empty">자료를 받는 중입니다…</p> : <Home d={dashboard(board, date, liveState?.today ? { cumTo: addDays(date, -1) } : {})} open={open} weather={d.weather[date]} cash={cashDay?.sum} cashFrom={cashDay?.carriedFrom} settle={settlements(cashParts, `${date.slice(0, 4)}-01-01`, date)} />}
        </main>
      </div>
    </LiveCtx.Provider>
  );
}
