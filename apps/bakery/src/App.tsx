/* ============================================================
   D  — 베이커리 매니저 작업지시 (…/d/, 매니저 폰): 내일 확정 · 모레/글피 잠정 · 1~4주 전망 · 오늘 생산 명령서(카톡 보내기)
   D-1 — 현장 태블릿 생산 명령서 (…/d1/<열쇠>/, 로그인 없음): 매니저가 확정한 수량만 크게
   매출 금액은 어디에도 보이지 않음 (수량 · 예상 손님 수만)
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, Board, CONFIRM_DEADLINE, count, dayResult, nowKst, orderRows, orderText, shortLabel, STAGE_LABEL, type BreadResult, type OrderDoc, type OrderRow, type PlanDoc } from "@report/core";
import { cloudApi, CloudError, demoApi, login, logout, session, tabletKey, tabletUrl, type Api } from "./data";

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
        체험판 · 가짜 자료 ·{" "}
        <a href="#">D 매니저</a> · <a href="#d1">D-1 현장 태블릿</a>
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
type Tab = "tomorrow" | "ahead" | "outlook" | "today" | "result";
const TABS: [Tab, string][] = [
  ["tomorrow", "내일 확정"],
  ["ahead", "모레·글피"],
  ["outlook", "1~4주"],
  ["today", "명령서"],
  ["result", "결과"],
];

function useDay(api: Api, date: string) {
  const [plan, setPlan] = useState<PlanDoc | null>(null);
  const [order, setOrder] = useState<OrderDoc | null>(null);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
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

function Manager({ api, who, board, onLogout }: { api: Api; who: string; board: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("tomorrow");
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
      <nav className="tabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>
      {tab === "tomorrow" && <Tomorrow api={api} date={addDays(today, 1)} who={who} />}
      {tab === "ahead" && <Ahead api={api} today={today} />}
      {tab === "outlook" && <OutlookView api={api} date={addDays(today, 1)} />}
      {tab === "today" && <TodayOrder api={api} date={today} board={board} />}
      {tab === "result" && <Result api={api} today={today} />}
    </div>
  );
}

function Notice({ err, plan, loaded }: { err: string; plan: PlanDoc | null; loaded: boolean }) {
  if (err) return <p className="error box">{err}</p>;
  if (loaded && !plan) return <p className="empty box">아직 계획이 없습니다 — 매일 14시에 새로 셉니다.</p>;
  return null;
}

/** 내일 확정 — 빵마다 [제품명 · 지시 수량 · 수정 칸 · 확정], 맨 위 [일괄 확정] */
function Tomorrow({ api, date, who }: { api: Api; date: string; who: string }) {
  const { plan, order, setOrder, err, loaded } = useDay(api, date);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const now = nowKst();
  const late = now.date > addDays(date, -1) || now.time >= CONFIRM_DEADLINE;
  const rows = plan?.items || [];
  const valueOf = (name: string, planQty: number) => {
    const v = edit[name];
    if (v != null && v !== "") return Math.max(0, Math.round(Number(v) || 0));
    return order?.items[name]?.qty ?? planQty;
  };
  const save = async (lines: Record<string, number>, label: string) => {
    setBusy(label);
    setMsg("");
    try {
      const o = await api.confirm(date, lines, who);
      setOrder(o);
      setEdit((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !(k in lines))));
      setMsg(`${label === "all" ? "일괄 확정" : `${label} 확정`} 했습니다.`);
    } catch (e) {
      setMsg((e as CloudError).message);
    } finally {
      setBusy(null);
    }
  };
  const confirmedN = rows.filter((r) => order?.items[r.name]).length;
  const total = rows.reduce((a, r) => a + valueOf(r.name, r.qty), 0);
  return (
    <main className="content">
      <section className="sticky">
        <div className="sticky-head">
          <b>{shortLabel(date)} 생산</b>
          <span className={late ? "warn" : "muted"}>{late ? "마감 지남 — 확정 안 한 빵은 지시 수량 그대로 나감" : `${CONFIRM_DEADLINE} 전에 확정`}</span>
        </div>
        {plan && (
          <div className="sticky-sub">
            예상 손님 {count(plan.visitors, "명")} · {plan.kind} · 날씨 {plan.weather} · 합계 <b>{count(total, "개")}</b> · 확정 {confirmedN}/{rows.length}
          </div>
        )}
        <button className="primary big" disabled={!rows.length || !!busy} onClick={() => save(Object.fromEntries(rows.map((r) => [r.name, valueOf(r.name, r.qty)])), "all")}>
          {busy === "all" ? "확정 중…" : "일괄 확정"}
        </button>
        {msg && <p className="msg">{msg}</p>}
      </section>
      <Notice err={err} plan={plan} loaded={loaded} />
      {rows.length > 0 && (
        <div className="rows">
          <div className="row head">
            <span>제품명</span>
            <span className="num">지시</span>
            <span className="num">수정</span>
            <span />
          </div>
          {rows.map((r) => {
            const c = order?.items[r.name];
            const v = edit[r.name];
            return (
              <div key={r.name} className={`row${c ? " done" : ""}`}>
                <span className="name">{r.name}</span>
                <span className="num">{r.qty}</span>
                <input
                  className="num"
                  inputMode="numeric"
                  value={v ?? (c && c.qty !== r.qty ? String(c.qty) : "")}
                  placeholder={String(c?.qty ?? r.qty)}
                  onChange={(e) => setEdit({ ...edit, [r.name]: e.target.value.replace(/[^0-9]/g, "") })}
                  aria-label={`${r.name} 수량 수정`}
                />
                <button className={c && v == null ? "ok" : "primary"} disabled={!!busy} onClick={() => save({ [r.name]: valueOf(r.name, r.qty) }, r.name)}>
                  {busy === r.name ? "…" : c && v == null ? `✓ ${c.qty}` : "확정"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

/** 모레 · 글피 잠정 */
function Ahead({ api, today }: { api: Api; today: string }) {
  return (
    <main className="content">
      {[2, 3].map((k) => (
        <AheadDay key={k} api={api} date={addDays(today, k)} />
      ))}
    </main>
  );
}
function AheadDay({ api, date }: { api: Api; date: string }) {
  const { plan, err, loaded } = useDay(api, date);
  return (
    <section className="card">
      <h2>
        {shortLabel(date)} <span className="tag">{plan ? STAGE_LABEL[plan.stage] : ""}</span>
      </h2>
      <Notice err={err} plan={plan} loaded={loaded} />
      {plan && (
        <>
          <p className="muted">
            예상 손님 {count(plan.visitors, "명")} · {plan.kind} · 합계 {count(plan.total, "개")} (범위 {count(plan.items.reduce((a, i) => a + (i.lo ?? i.qty), 0))} ~ {count(plan.items.reduce((a, i) => a + (i.hi ?? i.qty), 0), "개")})
          </p>
          <table>
            <thead>
              <tr>
                <th>제품명</th>
                <th className="num">잠정</th>
                <th className="num">범위</th>
              </tr>
            </thead>
            <tbody>
              {plan.items.map((i) => (
                <tr key={i.name}>
                  <td>{i.name}</td>
                  <td className="num">{i.qty}</td>
                  <td className="num muted">
                    {i.lo ?? i.qty} ~ {i.hi ?? i.qty}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

/** 1 ~ 4주차 평일 · 휴일 하루 생산 개수 */
function OutlookView({ api, date }: { api: Api; date: string }) {
  const { plan, err, loaded } = useDay(api, date);
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return (
    <main className="content">
      <section className="card">
        <h2>앞으로 1~4주 하루 생산 개수</h2>
        <p className="muted">평일 · 휴일 하루 평균 (날씨는 모름으로 셈) — 인원 · 재료 계획용</p>
        <Notice err={err} plan={plan} loaded={loaded} />
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

/** 오늘 생산 명령서 — 카톡으로 보내기 · 현장 태블릿 주소 보내기 */
function TodayOrder({ api, date, board }: { api: Api; date: string; board: string }) {
  const { plan, order, err, loaded } = useDay(api, date);
  const [msg, setMsg] = useState("");
  const rows = orderRows(plan, order, nowKst());
  const text = orderText(date, rows);
  return (
    <main className="content">
      <section className="card">
        <h2>{shortLabel(date)} 생산 명령서</h2>
        {err ? <p className="error box">{err}</p> : loaded && !plan && !order ? <p className="empty box">아직 계획이 없습니다 — 매일 14시에 새로 셉니다.</p> : null}
        <OrderList rows={rows} big={false} />
        <pre className="share-text">{text}</pre>
        <button className="primary big" disabled={!rows.length} onClick={async () => setMsg(await share(text, "생산 명령서"))}>
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

/* ---------- D-1 현장 태블릿 ---------- */
function Floor({ api }: { api: Api }) {
  const [which, setWhich] = useState<0 | 1>(0);
  const [tick, setTick] = useState(0);
  const today = nowKst().date;
  const date = addDays(today, which);
  // 5분마다 새로 (매니저가 확정을 바꾸면 반영)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 300_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="app floor">
      <header className="top">
        <h1>🥐 생산 명령서</h1>
        <nav className="tabs">
          <button className={which === 0 ? "on" : ""} onClick={() => setWhich(0)}>
            오늘
          </button>
          <button className={which === 1 ? "on" : ""} onClick={() => setWhich(1)}>
            내일
          </button>
        </nav>
      </header>
      <FloorDay key={`${date}-${tick}`} api={api} date={date} />
    </div>
  );
}
function FloorDay({ api, date }: { api: Api; date: string }) {
  const { plan, order, err, loaded } = useDay(api, date);
  const rows = orderRows(plan, order, nowKst());
  const waiting = rows.length > 0 && rows.every((r) => r.state === "확정 전");
  return (
    <main className="content">
      <h2 className="floor-date">{shortLabel(date)}</h2>
      {err && <p className="error box">{err}</p>}
      {loaded && !rows.length && !err && <p className="empty box">아직 생산 지시가 없습니다.</p>}
      {waiting ? <p className="empty box">매니저 확정 전입니다 ({CONFIRM_DEADLINE} 마감).</p> : <OrderList rows={rows} big />}
      <p className="muted center">5분마다 새로 고침 · 확정 = 매니저가 정한 수량 · 자동 = 마감까지 확정이 없어 계획 수량 그대로</p>
    </main>
  );
}

/** 지난 날 결과 — 빵별 생산(확정 · 자동) · 판매 · 50% 할인 · 폐기 (매일 밤 22:10 수집 뒤 채워짐, 다음 14시 계획의 보정에 쓰임) */
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
        <p className="muted">폐기 = 생산 − 판매 · 50% 할인 = 저녁 8시 30분 뒤 반값 판매 · 매일 밤 22:10 실적 수집 뒤 채워지고, 다음 14시 계획이 이 차이만큼 빵별 수량을 고칩니다</p>
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
