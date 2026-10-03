/* ============================================================
   A — 사무실 입력 화면 (직원 PC 바탕화면 아이콘 → 인터넷 주소 …/a/ 를 전체 화면으로)
   맨 위 안내: "yy년 mm월 dd일 기준 -1일 전의 일자 (영업마감 현재) 기준 영업 데이터를 입력하세요"
   ① 네이버 예약 시간대 표 (10:00 ~ 19:30, 판매입장권 수 · 신규방문자 수)
   ② 영수증별 매출 상세현황 엑셀 두 개 (카페아스타나 · 아스타나키즈 따로)
   ③ 새 상품 분류 확인 (처음 보는 카페 상품만)  ④ 보고 미리보기
   [임시저장] 계산 없이 이 PC 에만 보관   [입력완료 · 보고자료 업로드] A 에서 계산 → 클라우드(Firebase)로 바로 → 폰(B)이 받음
   각자 맡은 칸만 넣고 보내도 됨 — 날짜별 문서에서 보낸 칸만 바뀌어 합쳐짐
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  Board,
  buildNaverPart,
  count,
  NAVER_SLOTS,
  SECTORS,
  shortLabel,
  STORE_LABEL,
  temp,
  todayKst,
  won,
  type NaverPart,
  type StoreId,
  type StorePart,
} from "@report/core";
import { api, ApiError, loadMe, mergeReport, saveMe, type DayInfo, type Info, type Me, type SubmitBody, type SubmitResult } from "./api";
import { deleteDraft, draftDates, loadDraft, saveDraft } from "./draft";
import { compute, loadFile, newProducts, type Loaded } from "./load";
import { NaverGrid } from "./NaverGrid";
import { FileBox } from "./FileBox";
import { ImportPast } from "./ImportPast";

const empty = () => NAVER_SLOTS.map(() => "");
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const longDate = (d: string) => `${d.slice(0, 4)}년 ${shortLabel(d)}`;
/** 확인 창 — 체험판(Artifact 화면)은 confirm 창이 안 떠서 그대로 진행 */
const sure = (msg: string) => (__DEMO__ ? true : window.confirm(msg));

type Msg = { kind: "ok" | "bad" | "info"; text: string } | null;

export function App() {
  const today = todayKst();
  const [date, setDate] = useState(addDays(today, -1));
  const [me, setMe] = useState<Me>(loadMe);
  const [askMe, setAskMe] = useState(!loadMe().name);
  const [info, setInfo] = useState<Info | null>(null);
  const [conn, setConn] = useState<string | null>(null);
  const [day, setDay] = useState<DayInfo | null>(null);
  const [table, setTable] = useState<Record<string, string>>({});
  const [tickets, setTickets] = useState<string[]>(empty);
  const [newVisitors, setNewVisitors] = useState<string[]>(empty);
  const [naverEdited, setNaverEdited] = useState(false);
  const [files, setFiles] = useState<Partial<Record<StoreId, Loaded>>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [draftAt, setDraftAt] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<string[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<SubmitBody | null>(null);
  const [done, setDone] = useState<SubmitResult | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showHow, setShowHow] = useState(false);

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
    void draftDates().then(setDrafts);
  }, [refreshInfo, refreshTable]);

  /* ---------- 날짜를 고르면: 클라우드에 올라간 것 + 이 PC 의 임시저장 ---------- */
  const loadDate = useCallback(async (d: string) => {
    setMsg(null);
    setDone(null);
    setFiles({});
    setOverrides({});
    setNaverEdited(false);
    setDirty(false);
    setDraftAt(null);
    let info: DayInfo | null = null;
    try {
      info = await api.day(d);
      setConn(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAskMe(true);
      else setConn((e as Error).message);
    }
    setDay(info);
    const n = info?.report?.naver;
    // 클라우드에 올라간 값을 보여 줌 (0 은 빈칸으로)
    setTickets(n ? n.tickets.map((v) => (v ? String(v) : "")) : empty());
    setNewVisitors(n ? n.newVisitors.map((v) => (v ? String(v) : "")) : empty());
    const draft = await loadDraft(d);
    if (draft) {
      setTickets(draft.tickets);
      setNewVisitors(draft.newVisitors);
      setNaverEdited(draft.tickets.some((x) => x !== "") || draft.newVisitors.some((x) => x !== ""));
      setOverrides(draft.overrides || {});
      const f: Partial<Record<StoreId, Loaded>> = {};
      for (const s of ["cafe", "kids"] as StoreId[]) {
        const x = draft.files[s];
        if (x) f[s] = loadFile(s, x.name, x.buf, d);
      }
      setFiles(f);
      setDraftAt(draft.savedAt);
      setMsg({ kind: "info", text: `이 PC 에 임시저장해 둔 입력(${when(draft.savedAt)})을 불러왔습니다.` });
    }
  }, []);
  useEffect(() => {
    void loadDate(date);
  }, [date, loadDate]);

  // 저장하지 않은 입력이 있으면 닫을 때 물어봄
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const changeDate = (d: string) => {
    if (d === date) return;
    if (dirty && !sure("임시저장하지 않은 입력이 있습니다. 날짜를 바꾸면 지금 입력한 것은 사라집니다. 바꿀까요?")) return;
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
  const naverPart: NaverPart | undefined = naverEdited ? buildNaverPart(date, tickets, newVisitors) : undefined;
  const parts: SubmitBody["parts"] = {
    ...(results.cafe ? { cafe: results.cafe.part } : {}),
    ...(results.kids ? { kids: results.kids.part } : {}),
    ...(naverPart ? { naver: naverPart } : {}),
  };
  const preview = useMemo(() => {
    const merged = mergeReport(day?.report || null, date, me.name, parts);
    return new Board([merged]).day(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, date, me.name, results, naverPart && JSON.stringify(naverPart)]);

  /* ---------- 입력 바꾸기 ---------- */
  const onGrid = (row: "tickets" | "newVisitors", v: string[]) => {
    (row === "tickets" ? setTickets : setNewVisitors)(v);
    setNaverEdited(true);
    setDirty(true);
  };
  const onFile = async (store: StoreId, f: File) => {
    if (!/\.xlsx?$/i.test(f.name)) {
      setMsg({ kind: "bad", text: `${f.name} 은(는) 엑셀 파일이 아닙니다. .xls 파일을 올려 주세요.` });
      return;
    }
    const l = loadFile(store, f.name, await f.arrayBuffer(), date);
    const other = files[store === "cafe" ? "kids" : "cafe"];
    if (other && other.print === l.print) l.error = "왼쪽·오른쪽에 같은 파일을 올렸습니다. 매장마다 따로 받은 파일을 올려 주세요.";
    setFiles((p) => ({ ...p, [store]: l }));
    setDirty(true);
    setMsg(null);
  };
  const clearFile = (store: StoreId) => {
    setFiles((p) => {
      const n = { ...p };
      delete n[store];
      return n;
    });
    setDirty(true);
  };

  /* ---------- 임시저장 (계산 없이 이 PC 에만) ---------- */
  const doDraft = async () => {
    try {
      const at = new Date().toISOString();
      await saveDraft({
        date,
        tickets,
        newVisitors: newVisitors,
        files: Object.fromEntries(Object.entries(files).map(([k, l]) => [k, { name: l!.name, buf: l!.buf }])),
        overrides,
        savedAt: at,
      });
      setDraftAt(at);
      setDirty(false);
      setDrafts(await draftDates());
      setMsg({ kind: "ok", text: `이 PC 에 임시저장했습니다 (${when(at)}). 계산·보내기는 하지 않았습니다 — 다음에 이 날짜를 열면 이어서 할 수 있습니다.` });
    } catch {
      setMsg({ kind: "bad", text: "임시저장하지 못했습니다 (브라우저 저장 공간). 입력완료로 바로 보내 주세요." });
    }
  };

  /* ---------- 입력완료 · 보고자료 업로드 ---------- */
  const ask = () => {
    setMsg(null);
    if (!me.name) return setAskMe(true);
    const bad = Object.values(files).find((l) => l?.error);
    if (bad) return setMsg({ kind: "bad", text: `${STORE_LABEL[bad.store]} 엑셀 문제를 먼저 해결해 주세요: ${bad.error}` });
    if (!parts.cafe && !parts.kids && !parts.naver) return setMsg({ kind: "bad", text: "보낼 것이 없습니다. 네이버 표에 숫자를 넣거나 엑셀을 올려 주세요." });
    const products: Record<string, string> = {};
    for (const p of fresh) products[p.name] = overrides[p.name] || p.guess;
    setConfirm({
      date,
      by: me.name,
      parts,
      lines: { ...(results.cafe ? { cafe: results.cafe.lines } : {}), ...(results.kids ? { kids: results.kids.lines } : {}) },
      products: Object.keys(products).length ? products : undefined,
    });
  };
  const send = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const r = await api.submit(confirm);
      await deleteDraft(date);
      setDrafts(await draftDates());
      setConfirm(null);
      setDirty(false);
      setDone(r);
      void refreshTable();
      void refreshInfo();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAskMe(true);
      setMsg({ kind: "bad", text: `보내지 못했습니다: ${(e as Error).message} — 입력은 그대로 있습니다. 임시저장해 두고 다시 해 보세요.` });
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  const [y, m, d] = today.split("-");
  const server = day?.report;
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
              if (dirty && !sure("임시저장하지 않은 입력이 있습니다. 그래도 끝낼까요?")) return;
              setDirty(false);
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
            <button className="ghost big" onClick={() => changeDate(addDays(date, -1))} aria-label="전날">
              ◀
            </button>
            <span className="date-big">{longDate(date)}</span>
            <button className="ghost big" onClick={() => changeDate(addDays(date, 1))} disabled={date >= today} aria-label="다음날">
              ▶
            </button>
            <input type="date" value={date} max={today} onChange={(e) => e.target.value && changeDate(e.target.value)} aria-label="날짜 고르기" />
            {date !== addDays(today, -1) && (
              <button className="ghost" onClick={() => changeDate(addDays(today, -1))}>
                어제로
              </button>
            )}
          </div>
          <div className="date-info">
            <span>
              🌤 기상청:{" "}
              {wx ? (
                <b>
                  {wx.icon} {wx.label} · 최고 {temp(wx.tempMax)} · 최저 {temp(wx.tempMin)}
                  {wx.rainMm ? ` · 강수 ${wx.rainMm}mm` : ""} <small>({wx.source === "observed" ? "관측" : "예보"})</small>
                </b>
              ) : (
                <span className="muted">아직 없음 (GitHub 가 1시간마다 기상청에서 받아 넣음)</span>
              )}
            </span>
            <span>
              📥 클라우드에 올라간 것:{" "}
              {(["naver", "cafe", "kids"] as const).map((k) => {
                const mm = server?.meta?.[k];
                const has = !!server?.[k];
                return (
                  <span key={k} className={`have ${has ? "yes" : "no"}`}>
                    {k === "naver" ? "네이버" : k === "cafe" ? "카페" : "키즈"} {has ? `✓ ${mm?.by || ""} ${when(mm?.at)}` : "—"}
                  </span>
                );
              })}
            </span>
            {drafts.filter((x) => x !== date).length > 0 && (
              <span>
                💾 임시저장 있는 날:{" "}
                {drafts
                  .filter((x) => x !== date)
                  .slice(0, 5)
                  .map((x) => (
                    <button key={x} className="link" onClick={() => changeDate(x)}>
                      {shortLabel(x)}
                    </button>
                  ))}
              </span>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>① 네이버 예약 — 시간대별 판매입장권 수 · 신규방문자 수</h2>
            <span className="hint">
              네이버 예약 관리 화면을 보고 30분마다 넣어 주세요. 신규방문자 = 마감 현재 방문 완료 횟수가 1인 손님. 빈칸은 0. 엑셀에서 복사해 붙여넣어도 됩니다.
              {server?.naver && !naverEdited ? ` (클라우드에 올라간 값을 보여 주는 중 — 고치면 새로 보냄)` : ""}
            </span>
          </div>
          <NaverGrid tickets={tickets} newVisitors={newVisitors} onChange={onGrid} />
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>② 영수증별 매출 상세현황 엑셀 — 매장마다 따로 2개</h2>
            <button className="link" onClick={() => setShowHow((v) => !v)}>
              {showHow ? "받는 방법 닫기" : "엑셀 받는 방법 보기"}
            </button>
          </div>
          {showHow && (
            <ol className="steps">
              <li>
                백오피스 <b>nice.okpos.co.kr</b> 에 총괄 아이디로 들어감 → <b>영수증별 매출 상세현황</b> 화면
              </li>
              <li>
                매장을 <b>[카페아스타나]</b> 하나만 고르고 조회일자를 <b>{longDate(date)}</b> 하루로 → 조회 → 엑셀 받기 → 아래 왼쪽 칸에 올림
              </li>
              <li>
                매장을 <b>[아스타나키즈]</b> 로 바꿔 같은 날짜로 한 번 더 받음 → 오른쪽 칸에 올림
              </li>
              <li>
                매장 <b>[전체]</b> 로 받으면 두 매장이 섞여서 안 됩니다. 파일 이름 뒤 (27) 같은 번호는 상관없습니다.
              </li>
            </ol>
          )}
          <div className="files">
            {(["cafe", "kids"] as StoreId[]).map((s) => (
              <FileBox key={s} store={s} date={date} loaded={files[s]} result={results[s]} onFile={(f) => onFile(s, f)} onClear={() => clearFile(s)} onUseDate={changeDate} onServer={server?.[s] ? server.meta?.[s] : undefined} />
            ))}
          </div>
        </section>

        <div className="two">
          <section className="panel">
            <div className="panel-head">
              <h2>③ 새 상품 분류 확인</h2>
              <span className="hint">처음 보는 카페아스타나 상품만 — 맞게 골라 주면 다음부터는 묻지 않습니다</span>
            </div>
            {fresh.length > 20 && (
              <p className="warn">처음에는 많습니다. 아래 '지난 자료 한꺼번에 넣기'로 상품별(일자별) 엑셀을 한 번 넣으면 OK포스 대분류로 분류표가 채워져 다음부터는 거의 묻지 않습니다. 짐작한 분류가 맞으면 그대로 보내도 됩니다.</p>
            )}
            {fresh.length ? (
              <div className="table-scroll">
                <table className="list">
                  <thead>
                    <tr>
                      <th>상품명</th>
                      <th className="num">수량</th>
                      <th className="num">실매출</th>
                      <th>분류</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fresh.map((p) => (
                      <tr key={p.name}>
                        <td>{p.name}</td>
                        <td className="num">{count(p.qty)}</td>
                        <td className="num">{won(p.net)}</td>
                        <td>
                          <select
                            value={overrides[p.name] || p.guess}
                            onChange={(e) => {
                              setOverrides((o) => ({ ...o, [p.name]: e.target.value }));
                              setDirty(true);
                            }}
                          >
                            {SECTORS.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">{files.cafe ? "모두 분류표에 있는 상품입니다 ✓" : "카페아스타나 엑셀을 올리면 여기서 확인합니다."}</p>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>④ 보고 미리보기 — {shortLabel(date)}</h2>
              <span className="hint">지금 입력 + 클라우드에 이미 올라간 것을 합친 숫자 (폰에 이렇게 보입니다)</span>
            </div>
            <table className="list preview">
              <tbody>
                <tr className="sum">
                  <td>마감일 총 매출</td>
                  <td className="num">{won(preview.total)}</td>
                </tr>
                {(["바리스타", "베이커리", "키친", "키즈입장료", "기타"] as const).map((b) => (
                  <tr key={b}>
                    <td>{b === "키즈입장료" ? "키즈입장" : b}</td>
                    <td className="num">{won(preview.box[b])}</td>
                  </tr>
                ))}
                <tr>
                  <td>카페아스타나 방문인원 · 1인 평균소비</td>
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
                참고: 키즈 POS 입장 발행으로 계산한 네이버는 {count(preview.naverPos, "장")}, 입력한 값은 {count(preview.naver, "장")} — 숫자를 한 번 더 확인해 주세요.
              </p>
            )}
          </section>
        </div>

        <p className="muted small center">
          작년 비교선을 채우려면{" "}
          <button className="link" onClick={() => setShowImport(true)}>
            지난 자료 한꺼번에 넣기 (상품별 · 영수증별 여러 파일 · 네이버)
          </button>
          {info ? ` · 입력 화면 ${info.version}` : ""}
        </p>
      </main>

      <footer className="foot">
        <div className={`foot-msg ${msg?.kind || ""}`}>{msg ? msg.text : draftAt ? `임시저장 ${when(draftAt)}` : dirty ? "저장하지 않은 입력이 있습니다." : "각자 맡은 칸만 넣고 보내도 됩니다 — 날짜별로 합쳐집니다."}</div>
        <button className="ghost huge" onClick={doDraft} disabled={busy}>
          💾 임시저장
        </button>
        <button className="huge primary" onClick={ask} disabled={busy}>
          ✅ 입력완료 · 보고자료 업로드
        </button>
      </footer>

      {confirm && <ConfirmBox body={confirm} server={server || null} busy={busy} onCancel={() => setConfirm(null)} onSend={send} />}
      {done && <DoneBox r={done} onClose={() => (setDone(null), void loadDate(date))} />}
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

function partLine(k: "cafe" | "kids", p: StorePart): string {
  if (k === "cafe") return `실매출 ${won(p.posNet)} · ${count(p.teams, "팀")} · 음료 ${count(p.cups, "잔")} · 반품 ${count(p.refunds.receipts, "장")} 지움`;
  return `실매출 ${won(p.posNet)} · 입장 발행 ${count(p.kids?.issued || 0, "장")} · 현장 ${count(p.kids?.walkIn || 0, "장")} · 이벤트 무료 ${count(p.kids?.eventFree || 0, "팀")}`;
}

function ConfirmBox({ body, server, busy, onCancel, onSend }: { body: SubmitBody; server: DayInfo["report"]; busy: boolean; onCancel: () => void; onSend: () => void }) {
  const p = body.parts;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const replace = (k: "cafe" | "kids" | "naver") => (server?.[k] ? ` — 클라우드에 있던 것(${server.meta?.[k]?.by || ""} ${when(server.meta?.[k]?.at)})을 바꿈` : "");
  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-label="보내기 확인">
      <div className="modal">
        <h2>{longDate(body.date)} 보고자료를 클라우드로 보낼까요?</h2>
        <ul className="send-list">
          {p.naver && (
            <li>
              <b>네이버</b> 판매입장권 {count(sum(p.naver.tickets), "장")} · 신규방문자 {count(sum(p.naver.newVisitors), "명")}
              {replace("naver")}
            </li>
          )}
          {p.cafe && (
            <li>
              <b>카페아스타나</b> {p.cafe.file} — {partLine("cafe", p.cafe)}
              {replace("cafe")}
            </li>
          )}
          {p.kids && (
            <li>
              <b>아스타나키즈</b> {p.kids.file} — {partLine("kids", p.kids)}
              {replace("kids")}
            </li>
          )}
          {body.products && <li>새 상품 {count(Object.keys(body.products).length, "개")}의 분류를 분류표에 저장</li>}
        </ul>
        {!p.naver && <p className="muted">네이버 표는 손대지 않아 보내지 않습니다 (다른 분이 넣거나 클라우드에 있는 값 그대로).</p>}
        {(!p.cafe || !p.kids) && <p className="muted">올리지 않은 매장 엑셀은 클라우드에 있는 것 그대로 둡니다.</p>}
        <div className="row end">
          <button className="ghost huge" onClick={onCancel} disabled={busy}>
            취소
          </button>
          <button className="huge primary" onClick={onSend} disabled={busy}>
            {busy ? "보내는 중…" : "보내기"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DoneBox({ r, onClose }: { r: SubmitResult; onClose: () => void }) {
  const m = new Board([r.report]).day(r.report.date);
  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-label="보내기 완료">
      <div className="modal">
        <h2>✅ {longDate(r.report.date)} 보고자료를 올렸습니다</h2>
        <p className={r.publish.ok ? "okmsg" : "warn"}>{r.publish.ok ? "폰(B)에도 올렸습니다. 폰에서 앱을 다시 열면 보입니다." : r.publish.message}</p>
        <table className="list">
          <tbody>
            <tr className="sum">
              <td>총 매출</td>
              <td className="num">{won(m.total)}</td>
            </tr>
            <tr>
              <td>들어간 자료</td>
              <td className="num">
                {[r.report.naver && "네이버", r.report.cafe && "카페", r.report.kids && "키즈"].filter(Boolean).join(" · ") || "—"}
                {(!r.report.naver || !r.report.cafe || !r.report.kids) && <span className="muted"> (빠진 것은 다른 분이 넣으면 합쳐짐)</span>}
              </td>
            </tr>
          </tbody>
        </table>
        <div className="row end">
          <button className="huge primary" onClick={onClose}>
            확인
          </button>
        </div>
      </div>
    </div>
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
