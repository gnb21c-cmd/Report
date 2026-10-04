/* ============================================================
   D  — 베이커리 매니저 작업지시 (…/d/, 매니저 폰)
        [주간 잠정] 목요일 15시에 나온 다음 주 월 ~ 일 계획을 요일별로 잠정 확정 (목 18시 마감)
        [최종 확정] 매일 15시에 나온 3일 뒤 최종안을 18시 전에 확정 (금 → 월 … 목 → 일)
        [명령서] 오늘 생산 · 내일 준비 (카톡 보내기) · [결과] 날짜별 생산 · 판매 · 50% · 폐기 · [1~4주] 전망
   D-1 — 현장 태블릿 (…/d1/<열쇠>/, 로그인 없음): 아침 6시부터 오늘 생산 + 내일 준비 두 칸
   매출 금액은 어디에도 보이지 않음 (수량 · 예상 손님 수만). 규칙은 packages/core/src/bakery.ts
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  Board,
  CONFIRM_DEADLINE,
  count,
  dayResult,
  displayDays,
  FINAL_LEAD,
  nowKst,
  orderRows,
  orderText,
  shortLabel,
  snapUnit,
  breadUnit,
  weekday,
  weekDates,
  weekPlanDay,
  WEEKDAY_KO,
  type BreadResult,
  type OrderDoc,
  type OrderRow,
  type PlanDoc,
} from "@report/core";
import { cloudApi, CloudError, demoApi, login, logout, session, tabletKey, tabletUrl, type Api, type Kind } from "./data";
import { finalImage, shareImage, weekImage, type ImgRow } from "./image";

export function App() {
  if (__DEMO__) return <Demo />;
  const key = tabletKey();
  if (key) return <Floor api={cloudApi(key, false)} />;
  return <ManagerGate />;
}

/** 체험판 — 주소 끝 #d1 이면 태블릿 화면 */
function Demo() {
  const api = useMemo(() => demoApi(), []);
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const f = () => setHash(location.hash);
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return (
    <>
      <div className="demo-bar">
        체험판 · 가짜 자료 · <a href="#">D 매니저</a> · <a href="#d1">D-1 현장 태블릿</a>
      </div>
      {hash === "#d1" ? <Floor api={api} /> : <Manager api={api} who="체험 매니저" board="demo" onLogout={() => {}} />}
    </>
  );
}

/* ---------- 로그인 ---------- */
function ManagerGate() {
  const [s, setS] = useState(session());
  if (!s) return <Login onDone={() => setS(session())} />;
  return (
    <Manager
      api={cloudApi(s.board, true)}
      who={s.name}
      board={s.board}
      onLogout={() => {
        logout();
        setS(null);
      }}
    />
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async () => {
    setBusy(true);
    setErr("");
    try {
      await login(email, pw, name);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="login">
      <h1>🥐 베이커리 작업지시</h1>
      <p className="hint">매니저 계정으로 한 번만 로그인하면 이 폰에 남습니다.</p>
      <label>
        이름 (확정한 사람으로 남음)
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 김매니저" />
      </label>
      <label>
        이메일
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      </label>
      <label>
        비밀번호
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" onKeyDown={(e) => e.key === "Enter" && go()} />
      </label>
      {err && <p className="error">{err}</p>}
      <button className="primary big" onClick={go} disabled={busy || !email || !pw}>
        {busy ? "로그인 중…" : "로그인"}
      </button>
    </main>
  );
}

/* ---------- D 매니저 ---------- */
type Tab = "week" | "final" | "order" | "result" | "outlook";
/** 큰 화면 둘 — 다음 주 잠정 확정 · 3일 뒤 최종 확정 */
const TABS: [Tab, string][] = [
  ["week", "다음 주 잠정 확정"],
  ["final", "3일 뒤 최종 확정"],
];
/** 그 밖 (작게) */
const MORE: [Tab, string][] = [
  ["order", "오늘·내일 명령서"],
  ["result", "결과"],
  ["outlook", "1~4주 전망"],
];

function useDay(api: Api, date: string) {
  const [plan, setPlan] = useState<PlanDoc | null>(null);
  const [order, setOrder] = useState<OrderDoc | null>(null);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    setLoaded(false);
    try {
      const [p, o] = await Promise.all([api.plan(date), api.order(date)]);
      setPlan(p);
      setOrder(o);
      setErr("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [api, date]);
  useEffect(() => {
    void load();
  }, [load]);
  return { plan, order, setOrder, err, loaded, reload: load };
}

/** 다가오는 주 — 목요일(15시 뒤)부터는 다음 주, 그 전에는 이번 주 계획이 나와 있는 주 */
function comingMonday(today: string): string {
  const thisMon = addDays(today, -((weekday(today) + 6) % 7));
  return addDays(thisMon, 7);
}

function Manager({ api, who, board, onLogout }: { api: Api; who: string; board: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("final");
  const today = nowKst().date;
  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>🥐 베이커리 작업지시</h1>
          <span className="sub">
            {shortLabel(today)} · {who}
          </span>
        </div>
        {api.kind === "cloud" && (
          <button className="ghost small" onClick={() => confirm("로그아웃할까요?") && onLogout()}>
            로그아웃
          </button>
        )}
      </header>
      <nav className="tabs two">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>
      <nav className="more">
        {MORE.map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>
      {tab === "week" && <WeekView api={api} today={today} who={who} />}
      {tab === "final" && <Confirm api={api} date={addDays(today, FINAL_LEAD)} kind="final" who={who} />}
      {tab === "order" && <OrderView api={api} board={board} />}
      {tab === "result" && <Result api={api} today={today} />}
      {tab === "outlook" && <OutlookView api={api} monday={comingMonday(today)} />}
    </div>
  );
}

const dayChip = (d: string) => `${WEEKDAY_KO[weekday(d)]} ${Number(d.slice(8, 10))}`;

/** 주간 잠정 — 다음 주 월 ~ 일, 요일을 골라 빵마다 잠정 확정 */
function WeekView({ api, today, who }: { api: Api; today: string; who: string }) {
  const [monday, setMonday] = useState(comingMonday(today));
  const dates = weekDates(addDays(monday, -4));
  const [pick, setPick] = useState(dates[0]);
  useEffect(() => setPick(weekDates(addDays(monday, -4))[0]), [monday]);
  const thursday = weekPlanDay(monday);
  const [imgBusy, setImgBusy] = useState(false);
  const [imgMsg, setImgMsg] = useState("");
  // 7일 표 전체를 그림 한 장으로 — 잠정 확정 수량, 안 한 빵은 계획 수량에 • 표시
  const shareWeek = async () => {
    setImgBusy(true);
    setImgMsg("");
    try {
      const docs = await Promise.all(dates.map(async (d) => ({ d, p: await api.plan(d), o: await api.order(d) })));
      if (!docs.some((x) => x.p?.week)) throw new Error("이 주 계획이 아직 없습니다.");
      const tot = new Map<string, number>();
      for (const { p, o } of docs) {
        for (const it of p?.week?.items || []) tot.set(it.name, (tot.get(it.name) || 0) + (o?.provisional[it.name]?.qty ?? it.qty));
        for (const [n, l] of Object.entries(o?.provisional || {})) if (!tot.has(n)) tot.set(n, l.qty);
      }
      const names = [...tot.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko")).map(([n]) => n);
      const get = (d: string, n: string) => {
        const x = docs.find((y) => y.d === d)!;
        const c = x.o?.provisional[n];
        if (c) return { qty: c.qty, pending: false };
        const w = x.p?.week?.items.find((i) => i.name === n);
        return w ? { qty: w.qty, pending: true } : null;
      };
      const b = await weekImage(dates, names, get, who);
      setImgMsg(await shareImage(b, `잠정생산_${dates[0]}.png`, "다음 주 잠정 생산"));
    } catch (e) {
      setImgMsg((e as Error).message);
    } finally {
      setImgBusy(false);
    }
  };
  return (
    <main className="content">
      <div className="week-nav">
        <button className="ghost small" onClick={() => setMonday(addDays(monday, -7))} aria-label="지난주">
          ‹
        </button>
        <b>
          {Number(monday.slice(5, 7))}/{Number(monday.slice(8, 10))} ~ {Number(dates[6].slice(5, 7))}/{Number(dates[6].slice(8, 10))} 주간
        </b>
        <button className="ghost small" onClick={() => setMonday(addDays(monday, 7))} disabled={monday >= comingMonday(today)} aria-label="다음 주">
          ›
        </button>
      </div>
      <p className="muted center">
        {shortLabel(thursday)} 15시 계획 · {CONFIRM_DEADLINE} 전에 잠정 확정 (안 하면 계획 수량 그대로 잠정)
      </p>
      <div className="chips">
        {dates.map((d) => (
          <button key={d} className={d === pick ? "on" : ""} onClick={() => setPick(d)}>
            {dayChip(d)}
          </button>
        ))}
      </div>
      <button className="ghost img-btn" disabled={imgBusy} onClick={shareWeek}>
        {imgBusy ? "그리는 중…" : "📷 잠정 확정 7일 표 이미지로 카톡 보내기"}
      </button>
      {imgMsg && <p className="msg center">{imgMsg}</p>}
      <Confirm key={pick} api={api} date={pick} kind="provisional" who={who} weekDays={dates} />
    </main>
  );
}

/**
 * 확정 표 — 빵마다 [제품명 · 지시 · 수정 칸 · 확정], 맨 위에 붙는 [일괄 확정]
 * kind = provisional(주간 잠정, 목요일) · final(3일 뒤 최종, 매일)
 */
function Confirm({ api, date, kind, who, weekDays }: { api: Api; date: string; kind: Kind; who: string; weekDays?: string[] }) {
  const { plan, order, setOrder, err, loaded } = useDay(api, date);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const now = nowKst();
  const step = kind === "final" ? plan?.final : plan?.week;
  const due = kind === "final" ? addDays(date, -FINAL_LEAD) : plan?.week?.madeOn || weekPlanDay(date);
  const after = (d: string) => now.date > d || (now.date === d && now.time >= CONFIRM_DEADLINE);
  const late = after(due);
  // 최종 마감(3일 전 18시)이 지난 날의 잠정 확정은 효과가 없어 막음
  const locked = kind === "provisional" && after(addDays(date, -FINAL_LEAD));
  const done = order?.[kind] || {};
  const prov = order?.provisional || {};
  const rows = step?.items || [];
  // 고친 수량도 만드는 단위로 (몽블랑 5개)
  const valueOf = (name: string, q: number) => {
    const v = edit[name];
    if (v != null && v !== "") return snapUnit(name, Number(v) || 0);
    return done[name]?.qty ?? q;
  };
  const save = async (lines: Record<string, number>, label: string) => {
    setBusy(label);
    setMsg("");
    try {
      const o = await api.confirm(date, kind, lines, who);
      setOrder(o);
      setEdit((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !(k in lines))));
      setMsg(`${label === "all" ? "일괄" : label} ${kind === "final" ? "최종 확정" : "잠정 확정"} 했습니다.`);
    } catch (e) {
      setMsg((e as CloudError).message);
    } finally {
      setBusy(null);
    }
  };
  // 7일 모두 일괄 잠정 확정 — 고친 칸이 없는 날은 계획 수량 그대로
  const saveWeek = async () => {
    if (!weekDays || !confirm("7일 모두 계획 수량으로 잠정 확정할까요? (이미 잠정 확정한 빵은 그 수량 그대로)")) return;
    setBusy("week");
    setMsg("");
    try {
      let n = 0;
      for (const d of weekDays) {
        if (after(addDays(d, -FINAL_LEAD))) continue;
        const [p, o] = await Promise.all([api.plan(d), api.order(d)]);
        if (!p?.week) continue;
        const have = o?.provisional || {};
        const lines = Object.fromEntries(p.week.items.filter((i) => !have[i.name]).map((i) => [i.name, d === date ? valueOf(i.name, i.qty) : i.qty]));
        if (Object.keys(lines).length) {
          const saved = await api.confirm(d, "provisional", lines, who);
          if (d === date) setOrder(saved);
          n++;
        }
      }
      setMsg(`${n}일 잠정 확정 했습니다.`);
    } catch (e) {
      setMsg((e as CloudError).message);
    } finally {
      setBusy(null);
    }
  };
  // 최종 확정 목록 전체를 그림 한 장으로 (확정 안 한 빵은 최종안 수량에 • 표시)
  const shareFinal = async () => {
    setBusy("img");
    try {
      const list: ImgRow[] = rows.map((r) => ({ name: r.name, qty: done[r.name]?.qty ?? r.qty, pending: !done[r.name] })).filter((r) => r.qty > 0);
      const b = await finalImage(date, list, who);
      setMsg(await shareImage(b, `최종생산_${date}.png`, `${shortLabel(date)} 최종 생산 지시`));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const confirmedN = rows.filter((r) => done[r.name]).length;
  const total = rows.reduce((a, r) => a + valueOf(r.name, r.qty), 0);
  return (
    <section className={kind === "final" ? "content" : ""} style={kind === "final" ? undefined : { display: "grid", gap: 10 }}>
      <section className="sticky">
        <div className="sticky-head">
          <b>
            {shortLabel(date)} {kind === "final" ? "최종 확정" : "잠정 확정"}
          </b>
          <span className={late ? "warn" : "muted"}>
            {locked
              ? "최종 확정 단계로 넘어간 날 — 최종 확정 탭에서"
              : late
                ? kind === "final"
                  ? "마감 지남 — 확정 안 한 빵은 최종안 그대로"
                  : "마감 지남 — 안 한 빵은 계획 수량 그대로 잠정"
                : `${shortLabel(due)} ${CONFIRM_DEADLINE} 전에`}
          </span>
        </div>
        {step && (
          <div className="sticky-sub">
            예상 손님 {count(step.visitors, "명")} · {step.kind} · 날씨 {step.weather} · 합계 <b>{count(total, "개")}</b> · {kind === "final" ? "확정" : "잠정"} {confirmedN}/{rows.length}
          </div>
        )}
        <button className="primary big" disabled={!rows.length || !!busy || locked} onClick={() => save(Object.fromEntries(rows.map((r) => [r.name, valueOf(r.name, r.qty)])), "all")}>
          {busy === "all" ? "확정 중…" : kind === "final" ? "이 날 일괄 최종 확정" : "이 날 일괄 잠정 확정"}
        </button>
        {weekDays && (
          <button className="ghost" disabled={!!busy} onClick={saveWeek}>
            {busy === "week" ? "확정 중…" : "7일 모두 일괄 잠정 확정"}
          </button>
        )}
        {kind === "final" && rows.length > 0 && (
          <button className="ghost" disabled={!!busy} onClick={shareFinal}>
            📷 최종 확정 목록 이미지로 카톡 보내기
          </button>
        )}
        {msg && <p className="msg">{msg}</p>}
      </section>
      {err && <p className="error box">{err}</p>}
      {loaded && !err && !step && (
        <p className="empty box">{kind === "final" ? `${shortLabel(date)} 최종안은 ${shortLabel(addDays(date, -FINAL_LEAD))} 15시에 나옵니다 (주간 계획이 있는 날만).` : `이 주 계획은 ${shortLabel(weekPlanDay(date))} 15시에 나옵니다.`}</p>
      )}
      {rows.length > 0 && (
        <div className="rows">
          <div className={`row head${kind === "final" ? " fin" : ""}`}>
            <span>제품명</span>
            {kind === "final" && <span className="num">잠정</span>}
            <span className="num">{kind === "final" ? "최종안" : "계획"}</span>
            <span className="num">수정</span>
            <span />
          </div>
          {rows.map((r) => {
            const c = done[r.name];
            const v = edit[r.name];
            return (
              <div key={r.name} className={`row${c ? " done" : ""}${kind === "final" ? " fin" : ""}`}>
                <span className="name">
                  {r.name}
                  {breadUnit(r.name) > 1 && <small className="unit"> {breadUnit(r.name)}개 단위</small>}
                  {r.lo != null && (
                    <small className="muted">
                      {" "}
                      {r.lo}~{r.hi}
                    </small>
                  )}
                </span>
                {kind === "final" && <span className="num muted">{prov[r.name]?.qty ?? plan?.week?.items.find((i) => i.name === r.name)?.qty ?? "—"}</span>}
                <span className="num">{r.qty}</span>
                <input
                  className="num"
                  inputMode="numeric"
                  disabled={locked}
                  value={v ?? (c && c.qty !== r.qty ? String(c.qty) : "")}
                  placeholder={String(c?.qty ?? r.qty)}
                  onChange={(e) => setEdit({ ...edit, [r.name]: e.target.value.replace(/[^0-9]/g, "") })}
                  aria-label={`${r.name} 수량 수정`}
                />
                <button className={c && v == null ? "ok" : "primary"} disabled={!!busy || locked} onClick={() => save({ [r.name]: valueOf(r.name, r.qty) }, r.name)}>
                  {busy === r.name ? "…" : c && v == null ? `✓ ${c.qty}` : "확정"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** 1 ~ 4주차 평일 · 휴일 하루 생산 개수 (주간 계획 월요일 문서) */
function OutlookView({ api, monday }: { api: Api; monday: string }) {
  const next = useDay(api, monday);
  const cur = useDay(api, addDays(monday, -7));
  const plan = next.plan?.outlook ? next.plan : cur.plan;
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return (
    <main className="content">
      <section className="card">
        <h2>앞으로 1~4주 하루 생산 개수</h2>
        <p className="muted">평일 · 휴일 하루 평균 (날씨는 모름으로 셈) — 인원 · 재료 계획용 · 목요일 15시에 새로 셈</p>
        {(next.err || cur.err) && <p className="error">{next.err || cur.err}</p>}
        {next.loaded && cur.loaded && !plan?.outlook && <p className="empty">아직 없습니다 — 목요일 15시 주간 계획과 함께 나옵니다.</p>}
        {plan?.outlook && (
          <table>
            <thead>
              <tr>
                <th>주차</th>
                <th>기간</th>
                <th className="num">평일</th>
                <th className="num">휴일</th>
              </tr>
            </thead>
            <tbody>
              {plan.outlook.map((w) => (
                <tr key={w.week}>
                  <td>{w.week}주차</td>
                  <td>
                    {md(w.from)} ~ {md(w.to)}
                  </td>
                  <td className="num">{w.weekday == null ? "—" : count(w.weekday, "개")}</td>
                  <td className="num">{w.holiday == null ? "—" : count(w.holiday, "개")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

async function share(text: string, title: string): Promise<string> {
  try {
    if (navigator.share) {
      await navigator.share({ title, text });
      return "";
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return "";
  }
  try {
    await navigator.clipboard.writeText(text);
    return "복사했습니다 — 카톡 대화창에 붙여 넣어 주세요.";
  } catch {
    return "보내기를 못 했습니다. 글을 길게 눌러 복사해 주세요.";
  }
}

/** 명령서 — 오늘 생산 · 내일 준비 (현장 태블릿과 같은 두 날, 아침 6시 기준) */
function OrderView({ api, board }: { api: Api; board: string }) {
  const [d0, d1] = displayDays(nowKst());
  const a = useDay(api, d0);
  const b = useDay(api, d1);
  const [msg, setMsg] = useState("");
  const now = nowKst();
  const ra = orderRows(a.plan, a.order, now);
  const rb = orderRows(b.plan, b.order, now);
  const text = [orderText(d0, ra, "오늘 생산"), orderText(d1, rb, "내일 준비")].join("\n\n");
  return (
    <main className="content">
      {[
        { d: d0, rows: ra, s: a, label: "오늘 생산" },
        { d: d1, rows: rb, s: b, label: "내일 준비" },
      ].map(({ d, rows, s, label }) => (
        <section key={d} className="card">
          <h2>
            {label} · {shortLabel(d)}
          </h2>
          {s.err && <p className="error">{s.err}</p>}
          {s.loaded && !rows.length && !s.err && <p className="empty">작업지시가 없는 날입니다.</p>}
          <OrderList rows={rows} big={false} />
        </section>
      ))}
      <section className="card">
        <pre className="share-text">{text}</pre>
        <button className="primary big" disabled={!ra.length && !rb.length} onClick={async () => setMsg(await share(text, "생산 명령서"))}>
          카톡으로 보내기
        </button>
        {api.kind === "cloud" && (
          <button className="ghost" onClick={async () => setMsg(await share(`현장 태블릿 생산 명령서 주소 (크롬으로 열고 홈 화면에 추가)\n${tabletUrl(board)}`, "현장 태블릿 주소"))}>
            현장 태블릿 주소 보내기
          </button>
        )}
        {msg && <p className="msg">{msg}</p>}
      </section>
    </main>
  );
}

function OrderList({ rows, big }: { rows: OrderRow[]; big: boolean }) {
  const list = rows.filter((r) => r.state === "확정 전" || (r.qty || 0) > 0);
  if (!list.length) return null;
  const total = list.reduce((a, r) => a + (r.qty || 0), 0);
  return (
    <div className={`order${big ? " big" : ""}`}>
      {list.map((r) => (
        <div key={r.name} className={`order-row s-${r.state === "확정" ? "ok" : r.state === "자동" ? "auto" : "wait"}`}>
          <span className="name">{r.name}</span>
          <span className="qty">{r.qty == null ? "—" : `${r.qty}개`}</span>
          <span className="state">{r.state}</span>
        </div>
      ))}
      <div className="order-row total">
        <span className="name">합계</span>
        <span className="qty">{count(total, "개")}</span>
        <span className="state" />
      </div>
    </div>
  );
}

/* ---------- D-1 현장 태블릿 — 아침 6시부터 오늘 생산 + 내일 준비 ---------- */
function Floor({ api }: { api: Api }) {
  const [tick, setTick] = useState(0);
  // 1분마다 날짜 넘김 확인, 5분마다 자료 새로
  const [now, setNow] = useState(nowKst());
  useEffect(() => {
    const t = setInterval(() => setNow(nowKst()), 60_000);
    const r = setInterval(() => setTick((n) => n + 1), 300_000);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, []);
  const [d0, d1] = displayDays(now);
  return (
    <div className="app floor">
      <header className="top">
        <h1>🥐 생산 명령서</h1>
        <span className="sub">5분마다 새로 고침 · 아침 6시에 날이 바뀜</span>
      </header>
      <main className="floor-grid">
        <FloorDay key={`${d0}-${tick}`} api={api} date={d0} label="오늘 생산" />
        <FloorDay key={`${d1}-${tick}`} api={api} date={d1} label="내일 준비" />
      </main>
    </div>
  );
}
function FloorDay({ api, date, label }: { api: Api; date: string; label: string }) {
  const { plan, order, err, loaded } = useDay(api, date);
  const rows = orderRows(plan, order, nowKst());
  return (
    <section className="floor-day">
      <h2 className="floor-date">
        {label} <span>{shortLabel(date)}</span>
      </h2>
      {err && <p className="error box">{err}</p>}
      {loaded && !rows.length && !err && <p className="empty box">작업지시가 없는 날입니다.</p>}
      <OrderList rows={rows} big />
    </section>
  );
}

/** 지난 날 결과 — 빵별 생산(확정 · 자동) · 판매 · 50% 할인 · 폐기 (매일 밤 22:10 수집 뒤 채워짐, 다음 15시 계획의 보정에 쓰임) */
function Result({ api, today }: { api: Api; today: string }) {
  const [date, setDate] = useState(addDays(today, -1));
  const [rows, setRows] = useState<BreadResult[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    setRows(null);
    setErr("");
    Promise.all([api.plan(date), api.order(date), api.report(date)])
      .then(([p, o, r]) => {
        if (!live) return;
        setRows(r ? dayResult(new Board([r]), date, p, o) : []);
      })
      .catch((e) => live && setErr((e as Error).message));
    return () => {
      live = false;
    };
  }, [api, date]);
  const sum = (k: "made" | "sold" | "half" | "waste") => (rows || []).reduce((a, r) => a + (r[k] || 0), 0);
  const known = (rows || []).some((r) => r.made != null);
  return (
    <main className="content">
      <section className="card">
        <div className="day-nav">
          <button className="ghost small" onClick={() => setDate(addDays(date, -1))} aria-label="전날">
            ‹
          </button>
          <h2>{shortLabel(date)} 결과</h2>
          <button className="ghost small" onClick={() => setDate(addDays(date, 1))} disabled={date >= addDays(today, -1)} aria-label="다음 날">
            ›
          </button>
        </div>
        <p className="muted">폐기 = 생산 − 판매 · 50% 할인 = 저녁 8시 30분 뒤 반값 판매 · 매일 밤 22:10 실적 수집 뒤 채워지고, 다음 15시 계획이 이 차이만큼 빵별 수량을 고칩니다</p>
        {err && <p className="error">{err}</p>}
        {rows && !rows.length && <p className="empty">이날 실적이 아직 없습니다.</p>}
        {rows && rows.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>제품명</th>
                <th className="num">생산</th>
                <th className="num">판매</th>
                <th className="num">50%</th>
                <th className="num">폐기</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td>
                    {r.name}
                    {r.soldOut && <span className="sold-out">다 팔림</span>}
                  </td>
                  <td className="num">{r.made ?? "—"}</td>
                  <td className="num">{r.sold}</td>
                  <td className="num">{r.half || ""}</td>
                  <td className="num">{r.waste == null ? "—" : r.waste || ""}</td>
                </tr>
              ))}
              <tr className="sum">
                <td>합계</td>
                <td className="num">{known ? sum("made") : "—"}</td>
                <td className="num">{sum("sold")}</td>
                <td className="num">{sum("half")}</td>
                <td className="num">{known ? sum("waste") : "—"}</td>
              </tr>
            </tbody>
          </table>
        )}
        {rows && rows.length > 0 && !known && <p className="muted">이날은 작업지시 전이라 생산 · 폐기를 모릅니다.</p>}
      </section>
    </main>
  );
}
