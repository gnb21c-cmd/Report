/* ============================================================
   A — 사무실 입력 화면 (직원 PC 바탕화면 아이콘 → 인터넷 주소 …/a/ 를 전체 화면으로)
   맨 위 안내: "yy년 mm월 dd일 기준 -1일 전의 일자 (영업마감 현재) 기준 영업 데이터를 입력하세요"
   영역마다 맡은 사람이 따로, 아무 때나 (아침 일찍 · 전날 저녁):
     ① 네이버 예약 시간대 표   ② 카페아스타나 엑셀 (+ 새 상품 분류)   ③ 아스타나키즈 엑셀   ④ 자금 현황
   영역마다 [업로드] → 그 영역만 클라우드(Firebase)로 → 회색 빗금 '업로드 완료'
            [수정]   → 빗금이 풀리고 클라우드에 올라간 내용 그대로 고침 → 다시 [업로드] 하면 그날 그 영역만 바뀜
   이 PC 에는 아무것도 저장하지 않음 (어느 PC 에서 열어도 클라우드에서 불러옴). 빈칸은 올릴 때 0
   ============================================================ */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  addDays,
  Board,
  buildNaverPart,
  count,
  money,
  NAVER_SLOTS,
  SECTORS,
  shortLabel,
  startCashPart,
  STORE_LABEL,
  temp,
  todayKst,
  won,
  type CashPart,
  type DayReport,
  type PartMeta,
  type StoreId,
} from "@report/core";
import { api, ApiError, loadMe, mergeReport, saveMe, type DayInfo, type Info, type Me, type SubmitBody } from "./api";
import { compute, loadFile, newProducts, type Loaded } from "./load";
import { NaverGrid } from "./NaverGrid";
import { FileBox } from "./FileBox";
import { ImportPast } from "./ImportPast";
import { CashSheet, CashTable, draftFromPart, draftSummary, fillZeros, partFromDraft, type CashDraft } from "./CashBox";

type Kind = "naver" | "cafe" | "kids" | "cash";
const KINDS: Kind[] = ["naver", "cafe", "kids", "cash"];
const KIND_LABEL: Record<Kind, string> = { naver: "네이버 예약", cafe: "카페아스타나 엑셀", kids: "아스타나키즈 엑셀", cash: "자금 현황" };
const flags = (v: boolean): Record<Kind, boolean> => ({ naver: v, cafe: v, kids: v, cash: v });

const empty = () => NAVER_SLOTS.map(() => "");
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const longDate = (d: string) => `${d.slice(0, 4)}년 ${shortLabel(d)}`;
/** 확인 창 — 체험판(Artifact 화면)은 confirm 창이 안 떠서 그대로 진행 */
const sure = (msg: string) => (__DEMO__ ? true : window.confirm(msg));

type Msg = { kind: "ok" | "bad" | "info"; text: string } | null;
/** 자금 전일 잔고를 어디서 가져왔는지 */
interface CashCtx {
  open: Record<string, number> | null;
  openFrom: string | null;
  prevRates: { usd: number; jpy: number } | null;
}
/** 업로드 확인 창 */
interface Ask {
  kind: Kind;
  body: SubmitBody;
  lines: string[];
}

export function App() {
  const today = todayKst();
  const [date, setDate] = useState(addDays(today, -1));
  const [me, setMe] = useState<Me>(loadMe);
  const [askMe, setAskMe] = useState(!loadMe().name);
  const [info, setInfo] = useState<Info | null>(null);
  const [conn, setConn] = useState<string | null>(null);
  const [day, setDay] = useState<DayInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [table, setTable] = useState<Record<string, string>>({});
  const [tickets, setTickets] = useState<string[]>(empty);
  const [newVisitors, setNewVisitors] = useState<string[]>(empty);
  const [files, setFiles] = useState<Partial<Record<StoreId, Loaded>>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [cash, setCash] = useState<CashDraft>(() => draftFromPart(startCashPart(addDays(today, -1), []).part));
  const [cashCtx, setCashCtx] = useState<CashCtx>({ open: null, openFrom: null, prevRates: null });
  const [sheet, setSheet] = useState<{ focus?: string } | null>(null);
  /** 영역마다: 고치는 중(빗금 없음)인지 · 바뀐 것이 있는지 */
  const [editing, setEditing] = useState<Record<Kind, boolean>>(flags(true));
  const [dirty, setDirty] = useState<Record<Kind, boolean>>(flags(false));
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const anyDirty = KINDS.some((k) => dirty[k]);
  const touch = (k: Kind) => setDirty((p) => (p[k] ? p : { ...p, [k]: true }));

  /* ---------- 클라우드 연결 (로그인) ---------- */
  const refreshInfo = useCallback(async () => {
    try {
      const i = await api.info();
      setInfo(i);
      setConn(null);
      if (!i.email) setAskMe(true);
    } catch (e) {
      setConn((e as Error).message);
    }
  }, []);
  const refreshTable = useCallback(async () => {
    try {
      setTable(await api.products());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAskMe(true);
    }
  }, []);
  useEffect(() => {
    void refreshInfo();
    void refreshTable();
  }, [refreshInfo, refreshTable]);

  /* ---------- 영역 하나를 클라우드에 있는 모양으로 ---------- */
  const fromServer = useCallback((k: Kind, report: DayReport | null | undefined, ctx?: { before: CashPart[]; d: string }) => {
    if (k === "naver") {
      const n = report?.naver;
      setTickets(n ? n.tickets.map(String) : empty());
      setNewVisitors(n ? n.newVisitors.map(String) : empty());
    } else if (k === "cafe" || k === "kids") {
      setFiles((p) => {
        const n = { ...p };
        delete n[k];
        return n;
      });
      if (k === "cafe") setOverrides({});
    } else if (ctx) {
      const start = startCashPart(ctx.d, ctx.before);
      setCashCtx({ open: start.openFrom ? start.part.open : null, openFrom: start.openFrom, prevRates: start.prevRates });
      setCash(draftFromPart(report?.cash || start.part));
    }
  }, []);

  /* ---------- 날짜를 고르면: 클라우드에 올라간 것을 불러옴 (이 PC 에는 저장 안 함) ---------- */
  const [before, setBefore] = useState<CashPart[]>([]);
  const loadDate = useCallback(
    async (d: string) => {
      setLoading(true);
      setMsg(null);
      let got: DayInfo | null = null;
      let prev: CashPart[] = [];
      try {
        [got, prev] = await Promise.all([api.day(d), api.cashBefore(d)]);
        setConn(null);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) setAskMe(true);
        else setConn((e as Error).message);
      }
      setDay(got);
      setBefore(prev);
      const r = got?.report;
      for (const k of KINDS) fromServer(k, r, { before: prev, d });
      // 클라우드에 올라간 영역은 빗금 (고치려면 [수정])
      setEditing({ naver: !r?.naver, cafe: !r?.cafe, kids: !r?.kids, cash: !r?.cash });
      setDirty(flags(false));
      setLoading(false);
    },
    [fromServer],
  );
  useEffect(() => {
    void loadDate(date);
  }, [date, loadDate]);

  // 올리지 않은 입력이 있으면 닫을 때 물어봄
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (anyDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [anyDirty]);

  const changeDate = (d: string) => {
    if (d === date) return;
    if (anyDirty && !sure(`업로드하지 않은 입력이 있습니다 (${KINDS.filter((k) => dirty[k]).map((k) => KIND_LABEL[k]).join(", ")}). 날짜를 바꾸면 사라집니다. 바꿀까요?`)) return;
    setDate(d);
  };

  /* ---------- 계산 (A 에서) ---------- */
  const results = useMemo(
    () => ({
      cafe: files.cafe ? compute(files.cafe, date, table, overrides) : null,
      kids: files.kids ? compute(files.kids, date, table, overrides) : null,
    }),
    [files, date, table, overrides],
  );
  const fresh = useMemo(() => newProducts(files.cafe, table), [files.cafe, table]);
  const server = day?.report || null;
  const openEditable = !cashCtx.openFrom;
  const cashSum = useMemo(() => draftSummary(cash, cashCtx.open, cashCtx.openFrom, cashCtx.prevRates), [cash, cashCtx]);
  /** 미리보기: 클라우드에 있는 것 + 지금 고치는 영역 */
  const preview = useMemo(() => {
    const parts: SubmitBody["parts"] = {};
    if (editing.naver && dirty.naver) parts.naver = buildNaverPart(date, tickets, newVisitors);
    if (editing.cafe && results.cafe) parts.cafe = results.cafe.part;
    if (editing.kids && results.kids) parts.kids = results.kids.part;
    return new Board([mergeReport(server, date, me.name, parts)]).day(date);
  }, [server, date, me.name, editing, dirty, tickets, newVisitors, results]);

  /* ---------- 입력 바꾸기 ---------- */
  const onGrid = (row: "tickets" | "newVisitors", v: string[]) => {
    (row === "tickets" ? setTickets : setNewVisitors)(v);
    touch("naver");
  };
  const onFile = async (store: StoreId, f: File) => {
    if (!/\.xlsx?$/i.test(f.name)) {
      setMsg({ kind: "bad", text: `${f.name} 은(는) 엑셀 파일이 아닙니다. .xls 파일을 올려 주세요.` });
      return;
    }
    const l = loadFile(store, f.name, await f.arrayBuffer(), date);
    const other = files[store === "cafe" ? "kids" : "cafe"];
    if (other && other.print === l.print) l.error = "카페 · 키즈 칸에 같은 파일을 올렸습니다. 매장마다 따로 받은 파일을 올려 주세요.";
    setFiles((p) => ({ ...p, [store]: l }));
    touch(store);
    setMsg(null);
  };
  const clearFile = (store: StoreId) => {
    setFiles((p) => {
      const n = { ...p };
      delete n[store];
      return n;
    });
  };
  const onCash = (d: CashDraft) => {
    setCash(d);
    touch("cash");
  };

  /* ---------- [수정] · [취소] ---------- */
  const edit = (k: Kind) => {
    setEditing((p) => ({ ...p, [k]: true }));
    setMsg({ kind: "info", text: `${KIND_LABEL[k]}: 클라우드에 올라간 내용을 불러왔습니다. 고친 뒤 [업로드] 를 누르면 ${shortLabel(date)} ${KIND_LABEL[k]}만 바뀝니다.` });
  };
  const cancel = (k: Kind) => {
    if (dirty[k] && !sure(`${KIND_LABEL[k]}에서 고친 것을 버리고 클라우드에 있는 그대로 둘까요?`)) return;
    fromServer(k, server, { before, d: date });
    setEditing((p) => ({ ...p, [k]: false }));
    setDirty((p) => ({ ...p, [k]: false }));
    setMsg(null);
  };

  /* ---------- [업로드] — 그 영역만 ---------- */
  const replaced = (k: Kind) => (server?.[k] ? `클라우드에 있던 것(${server.meta?.[k]?.by || ""} ${when(server.meta?.[k]?.at)})을 이것으로 바꿉니다.` : "");
  const upload = (k: Kind) => {
    setMsg(null);
    if (!me.name) return setAskMe(true);
    const base = { date, by: me.name };
    if (k === "naver") {
      // 빈칸은 0 으로 (화면에도)
      const t = tickets.map((x) => (x === "" ? "0" : x));
      const n = newVisitors.map((x) => (x === "" ? "0" : x));
      setTickets(t);
      setNewVisitors(n);
      const p = buildNaverPart(date, t, n);
      const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
      return setAsk({ kind: k, body: { ...base, parts: { naver: p } }, lines: [`판매입장권 ${count(sum(p.tickets), "장")} · 신규방문자 ${count(sum(p.newVisitors), "명")}`, replaced(k)] });
    }
    if (k === "cafe" || k === "kids") {
      const l = files[k];
      const r = results[k];
      if (!l) return setMsg({ kind: "bad", text: `${STORE_LABEL[k]} 엑셀을 먼저 올려 주세요.` });
      if (l.error || !r) return setMsg({ kind: "bad", text: `${STORE_LABEL[k]} 엑셀 문제를 먼저 해결해 주세요: ${l.error || "계산하지 못했습니다"}` });
      const products: Record<string, string> = {};
      if (k === "cafe") for (const p of fresh) products[p.name] = overrides[p.name] || p.guess;
      const p = r.part;
      return setAsk({
        kind: k,
        body: { ...base, parts: { [k]: p }, lines: { [k]: r.lines }, products: Object.keys(products).length ? products : undefined },
        lines: [
          `${l.name}`,
          k === "cafe"
            ? `실매출 ${won(p.posNet)} · ${count(p.teams, "팀")} · 음료 ${count(p.cups, "잔")} · 반품 ${count(p.refunds.receipts, "장")} 지움`
            : `실매출 ${won(p.posNet)} · 입장 발행 ${count(p.kids?.issued || 0, "장")} · 현장 ${count(p.kids?.walkIn || 0, "장")} · 이벤트 무료 ${count(p.kids?.eventFree || 0, "팀")}`,
          Object.keys(products).length ? `새 상품 ${count(Object.keys(products).length, "개")}의 분류를 분류표에 저장` : "",
          replaced(k),
        ],
      });
    }
    // 자금
    const filled = fillZeros(cash, openEditable);
    setCash(filled);
    const p = partFromDraft(filled);
    if (cashCtx.open) p.open = { ...p.open, ...cashCtx.open };
    const s = draftSummary(filled, cashCtx.open, cashCtx.openFrom, cashCtx.prevRates);
    if (s.group.usd.close && !p.rates.usd) return setMsg({ kind: "bad", text: "외화(USD) 잔고가 있는데 USD 환율이 비어 있습니다. 보고시점 환율을 넣어 주세요." });
    if (s.group.jpy.close && !p.rates.jpy) return setMsg({ kind: "bad", text: "외화(JPY) 잔고가 있는데 JPY 환율이 비어 있습니다. 보고시점 환율을 넣어 주세요." });
    setAsk({
      kind: k,
      body: { ...base, parts: { cash: p } },
      lines: [
        `잔액 합계 ${money(s.total, "KRW", false)}원 (증권계좌 ${money(s.securities, "KRW", false)}원 별도)`,
        `입금 ${money(s.krw.in, "KRW", false)}원 · 출금 ${money(s.krw.out, "KRW", false)}원 (원화)`,
        cashCtx.openFrom ? `전일 잔고는 ${shortLabel(cashCtx.openFrom)} 마감 잔고에서 이어받음` : "전일 잔고는 직접 넣은 값 (처음)",
        replaced(k),
      ],
    });
  };
  const send = async () => {
    if (!ask) return;
    const k = ask.kind;
    setBusy(true);
    try {
      await api.submit(ask.body);
      const got = await api.day(date).catch(() => null);
      if (got) setDay(got);
      setEditing((p) => ({ ...p, [k]: false }));
      setDirty((p) => ({ ...p, [k]: false }));
      setMsg({ kind: "ok", text: `✓ ${shortLabel(date)} ${KIND_LABEL[k]} 업로드 완료${__DEMO__ ? " (체험판 — 이 브라우저에만)" : " — 폰(B)에서 앱을 다시 열면 보입니다."}` });
      if (ask.body.products) void refreshTable();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAskMe(true);
      setMsg({ kind: "bad", text: `업로드하지 못했습니다: ${(e as Error).message} — 입력은 그대로 있습니다. 다시 눌러 주세요.` });
    } finally {
      setAsk(null);
      setBusy(false);
    }
  };

  /** 영역 머리의 단추들 */
  const buttons = (k: Kind, extra?: ReactNode) => {
    const locked = !editing[k];
    const canUp = k === "cafe" || k === "kids" ? !!files[k] && !files[k]!.error : true;
    return (
      <div className="actions">
        {extra}
        {locked ? (
          <button className="ghost" onClick={() => edit(k)} disabled={loading}>
            ✎ 수정
          </button>
        ) : (
          server?.[k] && (
            <button className="ghost" onClick={() => cancel(k)} disabled={busy}>
              취소
            </button>
          )
        )}
        <button className="primary" onClick={() => upload(k)} disabled={locked || busy || loading || !canUp}>
          ⬆ 업로드
        </button>
      </div>
    );
  };

  const [y, m, d] = today.split("-");
  const wx = day?.weather;

  return (
    <div className="page">
      <header className="bar">
        <div className="title">
          <span className="logo">📊</span> 아스타나 매출 보고 입력 <small>(A)</small>
          {__DEMO__ && <span className="demo">체험판 — 이 브라우저에만 저장</span>}
        </div>
        <div className="bar-right">
          <span className={`conn ${conn ? "bad" : info?.email ? "ok" : ""}`} title={conn || ""}>
            ● {conn ? "연결 안 됨" : info?.email ? `클라우드 연결됨 · ${info.email}` : "로그인 필요"}
          </span>
          <button className="ghost" onClick={() => setAskMe(true)} title="입력자 · 계정">
            👤 {me.name || "입력자?"}
          </button>
          {!__DEMO__ && (
            <button
              className="ghost"
              onClick={() => {
                if (anyDirty && !sure("업로드하지 않은 입력이 있습니다. 그래도 끝낼까요?")) return;
                setDirty(flags(false));
                window.close();
                setTimeout(() => setMsg({ kind: "info", text: "창이 닫히지 않으면 키보드 Alt + F4 를 눌러 주세요." }), 300);
              }}
            >
              끝내기
            </button>
          )}
        </div>
      </header>

      <main className="main">
        {conn && <div className="alert bad">⚠ {conn}</div>}

        <section className="panel head-panel">
          <p className="guide">
            {y.slice(2)}년 {m}월 {d}일 기준 -1일 전의 일자 (영업마감 현재) 기준 영업 데이터를 입력하세요
          </p>
          <div className="date-row">
            <span className="date-label">입력할 영업일</span>
            <button className="ghost" onClick={() => changeDate(addDays(date, -1))} aria-label="전날">
              ◀
            </button>
            <span className="date-big">{longDate(date)}</span>
            <button className="ghost" onClick={() => changeDate(addDays(date, 1))} disabled={date >= today} aria-label="다음날">
              ▶
            </button>
            <input type="date" value={date} max={today} onChange={(e) => e.target.value && changeDate(e.target.value)} aria-label="날짜 고르기" />
            {date !== addDays(today, -1) && (
              <button className="ghost" onClick={() => changeDate(addDays(today, -1))}>
                어제로
              </button>
            )}
            <span className="date-info">
              🌤{" "}
              {wx ? (
                <b>
                  {wx.icon} {wx.label} · 최고 {temp(wx.tempMax)} · 최저 {temp(wx.tempMin)}
                  {wx.rainMm ? ` · 강수 ${wx.rainMm}mm` : ""} <small>({wx.source === "observed" ? "관측" : "예보"})</small>
                </b>
              ) : (
                <span className="muted">기상청 날씨 아직 없음</span>
              )}
            </span>
            <span className="date-info">
              📥{" "}
              {KINDS.map((k) => (
                <span key={k} className={`have ${server?.[k] ? "yes" : "no"}`}>
                  {k === "naver" ? "네이버" : k === "cafe" ? "카페" : k === "kids" ? "키즈" : "자금"} {server?.[k] ? "✓" : "—"}
                </span>
              ))}
            </span>
          </div>
          {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
        </section>

        <Sector n="①" title="네이버 예약 — 시간대별 판매입장권 수 · 신규방문자 수" hint="30분마다 · 빈칸은 올릴 때 0 · 엑셀에서 복사해 붙여넣어도 됨" locked={!editing.naver} meta={server?.meta?.naver} actions={buttons("naver")}>
          <NaverGrid tickets={tickets} newVisitors={newVisitors} onChange={onGrid} disabled={!editing.naver} />
        </Sector>

        <div className="lower">
          <div className="col">
            <div className="files">
              {(["cafe", "kids"] as StoreId[]).map((s) => (
                <Sector
                  key={s}
                  n={s === "cafe" ? "②" : "③"}
                  title={`${STORE_LABEL[s]} 영수증별 매출`}
                  locked={!editing[s]}
                  meta={server?.meta?.[s]}
                  actions={buttons(s)}
                  className="file-sector"
                >
                  <FileBox
                    store={s}
                    date={date}
                    loaded={files[s]}
                    result={results[s]}
                    onFile={(f) => onFile(s, f)}
                    onClear={() => clearFile(s)}
                    onUseDate={changeDate}
                    onServer={server?.[s] ? server.meta?.[s] : undefined}
                    serverPart={server?.[s]}
                    locked={!editing[s]}
                  />
                  {s === "cafe" && editing.cafe && fresh.length > 0 && (
                    <div className="fresh">
                      <b>새 상품 분류 확인</b> <span className="hint">처음 보는 상품 {fresh.length}개 — 맞게 고르면 다음부터 묻지 않음</span>
                      <div className="table-scroll">
                        <table className="list">
                          <tbody>
                            {fresh.map((p) => (
                              <tr key={p.name}>
                                <td>{p.name}</td>
                                <td className="num">{count(p.qty)}</td>
                                <td className="num">{won(p.net)}</td>
                                <td>
                                  <select value={overrides[p.name] || p.guess} onChange={(e) => setOverrides((o) => ({ ...o, [p.name]: e.target.value }))}>
                                    {SECTORS.map((x) => (
                                      <option key={x} value={x}>
                                        {x}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </Sector>
              ))}
            </div>
            <button className="link how" onClick={() => setShowHow((v) => !v)}>
              {showHow ? "엑셀 받는 방법 닫기" : "영수증별 엑셀 받는 방법"}
            </button>
            {showHow && (
              <ol className="steps">
                <li>
                  백오피스 <b>nice.okpos.co.kr</b> → <b>영수증별 매출 상세현황</b>
                </li>
                <li>
                  매장 <b>[카페아스타나]</b> 하나만, 조회일자 <b>{longDate(date)}</b> 하루 → 조회 → 엑셀 받기 → ② 칸에
                </li>
                <li>
                  매장 <b>[아스타나키즈]</b> 로 바꿔 한 번 더 → ③ 칸에 (매장 [전체] 로 받으면 섞여서 안 됨)
                </li>
              </ol>
            )}

            <section className="panel preview-panel">
              <div className="panel-head">
                <h2>보고 미리보기 — {shortLabel(date)}</h2>
                <span className="hint">클라우드 + 지금 고치는 것 (폰에 이렇게)</span>
              </div>
              <table className="list preview">
                <tbody>
                  <tr className="sum">
                    <td>마감일 총 매출</td>
                    <td className="num">{won(preview.total)}</td>
                  </tr>
                  <tr>
                    <td>바리스타 · 베이커리 · 키친</td>
                    <td className="num">
                      {won(preview.box.바리스타)} · {won(preview.box.베이커리)} · {won(preview.box.키친)}
                    </td>
                  </tr>
                  <tr>
                    <td>키즈입장 · 기타</td>
                    <td className="num">
                      {won(preview.box.키즈입장료)} · {won(preview.box.기타)}
                    </td>
                  </tr>
                  <tr>
                    <td>방문인원 · 1인 평균소비</td>
                    <td className="num">
                      {count(preview.visitors, "명")} · {preview.avgSpend == null ? "—" : won(preview.avgSpend)}
                    </td>
                  </tr>
                  <tr>
                    <td>네이버 · 현장 · 이벤트 무료</td>
                    <td className="num">
                      {count(preview.naver, "장")}
                      {!preview.naverInput && preview.has.kids ? " (POS 추정)" : ""} · {count(preview.walkIn, "장")} · {count(preview.eventFree, "팀")}
                    </td>
                  </tr>
                </tbody>
              </table>
              {preview.naverInput > 0 && preview.has.kids > 0 && preview.naverPos !== preview.naver && (
                <p className="warn">
                  참고: 키즈 POS 입장 발행으로 계산한 네이버는 {count(preview.naverPos, "장")}, 입력한 값은 {count(preview.naver, "장")} — 한 번 더 확인해 주세요.
                </p>
              )}
            </section>
            <p className="muted small">
              작년 비교선을 채우려면{" "}
              <button className="link" onClick={() => setShowImport(true)}>
                지난 자료 한꺼번에 넣기
              </button>
              {info ? ` · 입력 화면 ${info.version}` : ""}
            </p>
          </div>

          <Sector
            n="④"
            title="자금 현황 — 자금요약"
            hint={!editing.cash ? undefined : cashCtx.openFrom ? (cashCtx.openFrom !== addDays(date, -1) ? `⚠ ${shortLabel(addDays(date, -1))} 자금 보고가 없어 ${shortLabel(cashCtx.openFrom)} 마감 잔고를 전일 잔고로` : `전일 잔고 = ${shortLabel(cashCtx.openFrom)} 마감 (클라우드)`) : "처음 자금 보고 — 전일 잔고를 직접 넣어 주세요"}
            locked={!editing.cash}
            meta={server?.meta?.cash}
            className="cash-sector"
            actions={buttons(
              "cash",
              <button onClick={() => setSheet({})} disabled={!editing.cash || loading}>
                📝 세부내용 등록
              </button>,
            )}
          >
            <CashTable draft={cash} sum={cashSum} locked={!editing.cash} openEditable={openEditable} onChange={onCash} onDetail={(id) => setSheet({ focus: id })} />
          </Sector>
        </div>
      </main>

      {sheet && <CashSheet draft={cash} focus={sheet.focus} onChange={onCash} onClose={() => setSheet(null)} />}
      {ask && (
        <div className="modal-bg" role="dialog" aria-modal="true" aria-label="업로드 확인">
          <div className="modal">
            <h2>
              {longDate(date)} {KIND_LABEL[ask.kind]}을(를) 클라우드에 올릴까요?
            </h2>
            <ul className="send-list">
              {ask.lines.filter(Boolean).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="muted">다른 영역은 손대지 않습니다 (각자 올린 것 그대로).</p>
            <div className="row end">
              <button className="ghost huge" onClick={() => setAsk(null)} disabled={busy}>
                취소
              </button>
              <button className="huge primary" onClick={send} disabled={busy}>
                {busy ? "올리는 중…" : "업로드"}
              </button>
            </div>
          </div>
        </div>
      )}
      {askMe && (
        <MeBox
          me={me}
          email={info?.email || null}
          onSave={(x) => {
            saveMe(x);
            setMe(x);
            setAskMe(false);
            void refreshInfo();
            void refreshTable();
            void loadDate(date);
          }}
          onCancel={me.name && info?.email ? () => setAskMe(false) : undefined}
        />
      )}
      {showImport && <ImportPast me={me.name} table={table} onClose={() => setShowImport(false)} onDone={() => (void refreshTable(), void loadDate(date))} />}
    </div>
  );
}

/** 입력 영역 하나 — 업로드가 끝나면 회색 빗금으로 덮고 '업로드 완료' */
function Sector(props: { n: string; title: string; hint?: string; locked: boolean; meta?: PartMeta; actions: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`panel sector ${props.locked ? "locked" : ""} ${props.className || ""}`}>
      <div className="panel-head">
        <h2>
          <span className="n">{props.n}</span> {props.title}
        </h2>
        {props.hint && <span className="hint">{props.hint}</span>}
        {props.actions}
      </div>
      <div className="sector-body">
        {props.children}
        {props.locked && (
          <div className="cover" aria-label="업로드 완료">
            <span className="cover-tag">
              ✓ 업로드 완료
              {props.meta && (
                <small>
                  {props.meta.by} · {when(props.meta.at)}
                </small>
              )}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function MeBox({ me, email, onSave, onCancel }: { me: Me; email: string | null; onSave: (m: Me) => void; onCancel?: () => void }) {
  const [name, setName] = useState(me.name);
  const [em, setEm] = useState(email || "");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [logged, setLogged] = useState(email);
  const submit = async () => {
    setErr(null);
    if (!name.trim()) return setErr("이름을 적어 주세요.");
    if (!logged) {
      setBusy(true);
      try {
        setLogged(await api.login(em, pw));
      } catch (e) {
        setBusy(false);
        return setErr((e as Error).message);
      }
      setBusy(false);
    }
    onSave({ name: name.trim().slice(0, 20) });
  };
  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-label="입력자 · 로그인">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2>누가 입력하나요?</h2>
        <p className="muted">이 PC 에서 처음 한 번만 합니다. 보낸 자료에 이름이 함께 남습니다 (폰 설정 화면의 '최근 입력 현황').</p>
        <label className="field">
          이름
          <input autoFocus value={name} maxLength={20} placeholder="예: 김영희" onChange={(e) => setName(e.target.value)} />
        </label>
        {logged ? (
          <p className="muted">
            로그인됨: <b>{logged}</b>{" "}
            {!__DEMO__ && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  api.logout();
                  setLogged(null);
                }}
              >
                다른 계정으로
              </button>
            )}
          </p>
        ) : (
          <>
            <label className="field">
              계정 이메일 (관리자에게 받은 것)
              <input value={em} autoComplete="username" onChange={(e) => setEm(e.target.value)} placeholder="예: kim@astana.report" />
            </label>
            <label className="field">
              비밀번호
              <input type="password" value={pw} autoComplete="current-password" onChange={(e) => setPw(e.target.value)} />
            </label>
          </>
        )}
        {err && <p className="error">⚠ {err}</p>}
        <div className="row end">
          {onCancel && (
            <button type="button" className="ghost huge" onClick={onCancel}>
              취소
            </button>
          )}
          <button className="huge primary" disabled={busy || !name.trim() || (!logged && (!em.trim() || !pw))}>
            {busy ? "확인 중…" : logged ? "저장" : "로그인"}
          </button>
        </div>
      </form>
    </div>
  );
}
