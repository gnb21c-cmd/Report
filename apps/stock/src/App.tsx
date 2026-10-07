/* ============================================================
   E-1 재고 관리 및 설정 (…/e1/) · 창고 입구 입고 (…/e1/#in) · F 발주app (…/f/)
   - 재고 현황: E 가 매일 아침 계산한 장부(어제 끝) — 재고 · 하루 소비 · AI 안전재고 · 관리자 안전재고 · 발주 필요
   - 원재료: 공급처 · 원재료명 · 공급단위(공급기준) · PKG 단위 · PKG 단가(공급단가) · 면세 · 최소 공급(MOQ) · 수량 할인 · 관리자 안전재고 · 최초 실셈
   - 레시피: B 가 보여 주는 판매 상품을 골라 원재료 양(g · ml · 개) — 베이커리는 D 생산량, 그 밖은 판매 수량만큼 E 가 뺌
   - 입고: 창고 입구에서 들어온 것만 (PKG 수 + 낱개)
   - 실셈: 센 수량을 넣고 확정 → 과사용(레시피 재검증 · 추가 발주) / 절약(절약 코드로 자산 다시 올림) 알림이 F 로
   - F: 알림 목록 · 안 읽은 수(앱 아이콘 숫자) · 누르면 읽음
   계산은 packages/core/src/stock.ts 한 곳 (E 매일 계산과 같은 함수)
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  countAlert,
  countCheck,
  countWordOf,
  ordersBySupplier,
  packLabel,
  pkgQtyOf,
  pkgSplitText,
  recipeCost,
  STOCK_UNITS,
  stockText,
  unitCostOf,
  useUnitOf,
  vatAmount,
  type LedgerDoc,
  type Material,
  type Recipe,
  type StockAlert,
  type StockCount,
  type StockIn,
  type StockMaster,
  type StockPart,
  type Supplier,
} from "@report/core";
import { api, login, logout, session } from "./data";
import { enablePush, pushOn, pushReady } from "./push";

const todayKst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const n3 = (n: number) => (Math.round(n * 100) / 100).toLocaleString("ko-KR");
const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const PARTS: StockPart[] = ["바리스타", "베이커리", "키친", "기타"];

const isF = () => /\/f(\/|$)/.test(location.pathname) || location.hash === "#f";

export function App() {
  const [logged, setLogged] = useState(() => __DEMO__ || !!session());
  if (!logged) return <Login onDone={() => setLogged(true)} title={isF() ? "발주app" : "재고 관리 및 설정"} />;
  return isF() ? <OrderApp /> : <StockApp onLogout={() => (logout(), setLogged(false))} />;
}

function Login({ onDone, title }: { onDone: () => void; title: string }) {
  const [em, setEm] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <h1>{title}</h1>
      <p className="muted">A · D 와 같은 직원 계정으로 로그인합니다.</p>
      <label>
        이름 <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 김영희" />
      </label>
      <label>
        이메일 <input value={em} onChange={(e) => setEm(e.target.value)} inputMode="email" autoComplete="username" />
      </label>
      <label>
        비밀번호 <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
      </label>
      {err && <p className="bad">{err}</p>}
      <button
        className="primary"
        disabled={busy || !em || !pw}
        onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            await login(em, pw, name);
            onDone();
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        로그인
      </button>
    </main>
  );
}

/* ================= E-1 ================= */
type Tab = "status" | "materials" | "suppliers" | "recipes" | "in" | "count";
const TABS: [Tab, string][] = [
  ["status", "재고 현황"],
  ["materials", "원재료"],
  ["suppliers", "공급처"],
  ["recipes", "레시피"],
  ["in", "입고"],
  ["count", "실셈"],
];

function StockApp({ onLogout }: { onLogout: () => void }) {
  const warehouse = location.hash === "#in";
  const [tab, setTab] = useState<Tab>(warehouse ? "in" : "status");
  const [master, setMaster] = useState<StockMaster | null>(null);
  const [ledger, setLedger] = useState<LedgerDoc | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    try {
      const [m, l] = await Promise.all([api.master(), api.ledger()]);
      setMaster(m);
      setLedger(l);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async (m: StockMaster) => {
    try {
      await api.saveMaster(m);
      setMaster(m);
      setMsg({ ok: true, text: "저장했습니다. 재고 계산(E)은 다음 날 아침에 새로 합니다." });
      if (api.kind === "demo") setLedger(await api.ledger());
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  return (
    <div className="app">
      <header className="bar">
        <b>{warehouse ? "창고 입구 · 입고 등록" : "재고 관리 및 설정 (E-1)"}</b>
        {__DEMO__ && <span className="tag">체험판 · 가짜 자료</span>}
        <span className="grow" />
        {!__DEMO__ && (
          <button className="ghost" onClick={onLogout}>
            로그아웃
          </button>
        )}
      </header>
      {!warehouse && (
        <nav className="tabs">
          {TABS.map(([k, label]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </nav>
      )}
      {msg && (
        <div className={`msg ${msg.ok ? "ok" : "bad"}`} onClick={() => setMsg(null)}>
          {msg.text}
        </div>
      )}
      <main className="content">
        {!master ? (
          <p className="muted">불러오는 중…</p>
        ) : tab === "status" ? (
          <StatusTab master={master} ledger={ledger} />
        ) : tab === "materials" ? (
          <MaterialsTab master={master} ledger={ledger} onSave={save} />
        ) : tab === "suppliers" ? (
          <SuppliersTab master={master} onSave={save} />
        ) : tab === "recipes" ? (
          <RecipesTab master={master} ledger={ledger} onSave={save} />
        ) : tab === "in" ? (
          <InTab master={master} big={warehouse} />
        ) : (
          <CountTab master={master} ledger={ledger} onDone={(t) => setMsg({ ok: true, text: t })} />
        )}
      </main>
    </div>
  );
}

const supName = (m: StockMaster, id?: string | null) => m.suppliers.find((s) => s.id === id)?.name || "공급처 미지정";

/* ---------- 재고 현황 ---------- */
function StatusTab({ master, ledger }: { master: StockMaster; ledger: LedgerDoc | null }) {
  if (!ledger) return <p className="muted">아직 재고 계산(E)이 돌지 않았습니다. 원재료 · 레시피 · 최초 실셈을 넣으면 다음 날 아침부터 계산합니다.</p>;
  const groups = ordersBySupplier(ledger.orders, master.suppliers);
  const value = ledger.rows.reduce((a, r) => a + r.value, 0);
  return (
    <>
      <section className="card">
        <h2>
          {ledger.upTo} 끝 기준 <small className="muted">재고자산 {won(value)} · 원재료 {ledger.rows.length}개</small>
        </h2>
        <table className="tbl">
          <thead>
            <tr>
              <th>원재료</th>
              <th>공급처</th>
              <th className="num">재고</th>
              <th className="num">하루 소비</th>
              <th className="num">AI 안전재고</th>
              <th className="num">관리자</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {ledger.rows.map((r) => {
              const order = ledger.orders.find((o) => o.materialId === r.id);
              return (
                <tr key={r.id} className={r.negative ? "neg" : order ? "low" : ""}>
                  <td>
                    {r.name} <small className="muted">{r.unit}</small>
                  </td>
                  <td className="muted">{supName(master, r.supplierId)}</td>
                  <td className="num">
                    {r.onHand}
                    {r.word}
                    {r.opened && <small className="muted"> +쓰는 중</small>}
                  </td>
                  <td className="num">{n3(r.mean)}</td>
                  <td className="num">{r.ai == null ? <small className="muted">자료 부족</small> : r.ai}</td>
                  <td className="num">{r.manual ?? "—"}</td>
                  <td>{r.negative ? "장부 − · 레시피 재검증" : order ? `발주 ${order.pkgs}PKG` : "정상"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="note muted">재고 = 뜯지 않은 공급단위 개수 · AI 안전재고 = 하루 평균 소비 × 리드타임 + 흔들림 여유(95%) · 관리자 값이 있으면 그것을 씀</p>
      </section>
      <section className="card">
        <h2>발주 필요 {ledger.orders.length}건</h2>
        {!groups.length && <p className="muted">안전재고 아래로 내려간 원재료가 없습니다.</p>}
        {groups.map((g) => (
          <div key={g.supplier?.id || "none"} className="group">
            <h3>
              {g.supplier?.name || "공급처 미지정"} — {won(g.total)} <small className="muted">+ 부가세 {won(g.lines.reduce((a, l) => a + l.vat, 0))}</small>
            </h3>
            {g.short > 0 && <p className="bad">최소 주문금액까지 {won(g.short)} 모자람 — 다른 품목과 같이 주문</p>}
            <ul>
              {g.lines.map((l) => (
                <li key={l.materialId}>
                  <b>{l.name}</b> {l.pkgs}PKG ({n3(l.qty)}개) {won(l.cost)} <small className="muted">— {l.why}</small>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </>
  );
}

/* ---------- 원재료 ---------- */
const blankMaterial = (supplierId: string | null): Material => ({ id: newId("m"), name: "", supplierId, packSize: 1, packUnit: "개", pkgQty: 1, pkgPrice: 0, initialStock: 0, asOf: todayKst() });

function MaterialsTab({ master, ledger, onSave }: { master: StockMaster; ledger: LedgerDoc | null; onSave: (m: StockMaster) => void }) {
  const [rows, setRows] = useState<Material[]>(master.materials);
  const dirty = JSON.stringify(rows) !== JSON.stringify(master.materials);
  const set = (i: number, p: Partial<Material>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const numIn = (v: string) => (v === "" ? null : Number(v));
  return (
    <section className="card">
      <h2>원재료 (기초정보)</h2>
      <div className="scroll">
        <table className="tbl edit">
          <thead>
            <tr>
              <th>공급처</th>
              <th>원재료명</th>
              <th>보관장소</th>
              <th>공급단위 (공급기준)</th>
              <th>PKG 단위</th>
              <th>PKG 단가 (공급가)</th>
              <th>면세</th>
              <th>최소 공급 PKG</th>
              <th>수량 할인 (PKG:단가)</th>
              <th>AI 안전재고</th>
              <th>관리자 안전재고</th>
              <th>최초 실셈</th>
              <th>실셈 날</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((m, i) => {
              const l = ledger?.rows.find((r) => r.id === m.id);
              return (
                <tr key={m.id}>
                  <td>
                    <select value={m.supplierId || ""} onChange={(e) => set(i, { supplierId: e.target.value || null })}>
                      <option value="">미지정</option>
                      {master.suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input value={m.name} onChange={(e) => set(i, { name: e.target.value })} />
                  </td>
                  <td>
                    <input value={m.storage || ""} onChange={(e) => set(i, { storage: e.target.value })} size={8} />
                  </td>
                  <td className="nowrap">
                    <input type="number" value={m.packSize ?? 1} onChange={(e) => set(i, { packSize: Number(e.target.value) || 1 })} className="n" />
                    <select value={m.packUnit || "개"} onChange={(e) => set(i, { packUnit: e.target.value })}>
                      {STOCK_UNITS.map((u) => (
                        <option key={u.unit}>{u.unit}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input type="number" value={m.pkgQty ?? 1} onChange={(e) => set(i, { pkgQty: Number(e.target.value) || 1 })} className="n" />
                    EA
                  </td>
                  <td>
                    <input type="number" value={m.pkgPrice ?? 0} onChange={(e) => set(i, { pkgPrice: Number(e.target.value) || 0 })} className="w" />
                    <small className="muted">
                      1개 {won(unitCostOf(m))} · VAT {won(vatAmount(m.pkgPrice, m.vatFree))}
                    </small>
                  </td>
                  <td>
                    <input type="checkbox" checked={!!m.vatFree} onChange={(e) => set(i, { vatFree: e.target.checked })} />
                  </td>
                  <td>
                    <input type="number" value={m.moqPkgs ?? ""} placeholder="1" onChange={(e) => set(i, { moqPkgs: numIn(e.target.value) })} className="n" />
                  </td>
                  <td>
                    <input
                      defaultValue={(m.tiers || []).map((t) => `${t.minPkgs}:${t.pkgPrice}`).join(", ")}
                      placeholder="예: 5:29000"
                      onBlur={(e) =>
                        set(i, {
                          tiers: e.target.value
                            .split(",")
                            .map((x) => x.split(":").map((y) => Number(y.trim())))
                            .filter(([a, b]) => a > 0 && b > 0)
                            .map(([minPkgs, pkgPrice]) => ({ minPkgs, pkgPrice })),
                        })
                      }
                      size={10}
                    />
                  </td>
                  <td className="num">{l?.ai == null ? <small className="muted">자료 부족</small> : `${l.ai}${countWordOf(m)}`}</td>
                  <td>
                    <input type="number" value={m.safetyManual ?? ""} placeholder="AI" onChange={(e) => set(i, { safetyManual: numIn(e.target.value) })} className="n" />
                  </td>
                  <td>
                    <input type="number" value={m.initialStock} onChange={(e) => set(i, { initialStock: Number(e.target.value) || 0 })} className="n" />
                  </td>
                  <td>
                    <input type="date" value={m.asOf || ""} onChange={(e) => set(i, { asOf: e.target.value })} />
                  </td>
                  <td>
                    <button className="ghost" onClick={() => confirm(`${m.name || "이 줄"} 을(를) 지울까요?`) && setRows((rs) => rs.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button onClick={() => setRows((rs) => [...rs, blankMaterial(master.suppliers[0]?.id || null)])}>＋ 원재료</button>
        <span className="grow" />
        <button className="primary" disabled={!dirty || rows.some((r) => !r.name.trim())} onClick={() => onSave({ ...master, materials: rows })}>
          변경 모두 저장
        </button>
      </div>
      <p className="note muted">
        공급단위 = 창고에서 꺼내 쓰는 가장 작은 단위(1L 병) · PKG 단위 = 공급처에서 사는 최소 묶음에 든 개수(12EA) · PKG 단가 = 그 묶음 공급가(부가세 별도) · 최초 실셈 = 처음 센 개수, 그 날부터 레시피만큼 줄여 감
      </p>
    </section>
  );
}

/* ---------- 공급처 ---------- */
function SuppliersTab({ master, onSave }: { master: StockMaster; onSave: (m: StockMaster) => void }) {
  const [rows, setRows] = useState<Supplier[]>(master.suppliers);
  const dirty = JSON.stringify(rows) !== JSON.stringify(master.suppliers);
  const set = (i: number, p: Partial<Supplier>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <section className="card">
      <h2>공급처</h2>
      <table className="tbl edit">
        <thead>
          <tr>
            <th>이름</th>
            <th>리드타임 (발주→입고 일)</th>
            <th>발주 요일 (비우면 아무 날)</th>
            <th>최소 주문금액</th>
            <th>연락처</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => (
            <tr key={s.id}>
              <td>
                <input value={s.name} onChange={(e) => set(i, { name: e.target.value })} />
              </td>
              <td>
                <input type="number" value={s.leadDays ?? ""} onChange={(e) => set(i, { leadDays: e.target.value === "" ? null : Number(e.target.value) })} className="n" />
              </td>
              <td className="nowrap">
                {WEEK.map((w, d) => (
                  <label key={d} className="day">
                    <input
                      type="checkbox"
                      checked={(s.orderDays || []).includes(d)}
                      onChange={(e) => set(i, { orderDays: e.target.checked ? [...(s.orderDays || []), d].sort() : (s.orderDays || []).filter((x) => x !== d) })}
                    />
                    {w}
                  </label>
                ))}
              </td>
              <td>
                <input type="number" value={s.minOrderAmount ?? ""} onChange={(e) => set(i, { minOrderAmount: e.target.value === "" ? null : Number(e.target.value) })} className="w" />
              </td>
              <td>
                <input value={s.contact || ""} onChange={(e) => set(i, { contact: e.target.value })} />
              </td>
              <td>
                <button
                  className="ghost"
                  disabled={master.materials.some((m) => m.supplierId === s.id)}
                  title="원재료가 있는 공급처는 지울 수 없음"
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <button onClick={() => setRows((rs) => [...rs, { id: newId("s"), name: "", leadDays: 2 }])}>＋ 공급처</button>
        <span className="grow" />
        <button className="primary" disabled={!dirty || rows.some((r) => !r.name.trim())} onClick={() => onSave({ ...master, suppliers: rows })}>
          변경 모두 저장
        </button>
      </div>
    </section>
  );
}

/* ---------- 레시피 ---------- */
function RecipesTab({ master, ledger, onSave }: { master: StockMaster; ledger: LedgerDoc | null; onSave: (m: StockMaster) => void }) {
  const products = ledger?.products || [];
  const [pick, setPick] = useState<string>("");
  const cur = master.recipes.find((r) => r.product === pick) || null;
  const [draft, setDraft] = useState<Recipe | null>(null);
  useEffect(() => {
    const sector = products.find((p) => p.name === pick)?.sector;
    setDraft(cur ? { ...cur, items: cur.items.map((i) => ({ ...i })) } : pick ? { product: pick, part: (PARTS.includes(sector as StockPart) ? sector : "기타") as StockPart, items: [] } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick, master]);
  const has = new Set(master.recipes.map((r) => r.product));
  const byId = new Map(master.materials.map((m) => [m.id, m]));
  const saveRecipe = () => {
    if (!draft) return;
    const items = draft.items.filter((i) => i.materialId && i.qty > 0);
    // 이미 판매 · 생산에 쓰인 레시피를 바꾸면 오늘 전 날은 예전 양으로 (지난 장부가 바뀌지 않게)
    const history = cur && JSON.stringify(cur.items) !== JSON.stringify(items) ? [...(cur.history || []), { until: new Date(Date.parse(todayKst() + "T00:00:00Z") - 86400e3).toISOString().slice(0, 10), items: cur.items }] : cur?.history || null;
    onSave({ ...master, recipes: [...master.recipes.filter((r) => r.product !== draft.product), { ...draft, items, history }] });
  };
  return (
    <section className="card">
      <h2>판매 상품 레시피</h2>
      <div className="row">
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">— B 판매 상품 고르기 —</option>
          {products.map((p) => (
            <option key={p.name} value={p.name}>
              {has.has(p.name) ? "✓ " : ""}
              {p.name} ({p.sector} · {p.qty.toLocaleString("ko-KR")}개)
            </option>
          ))}
          {master.recipes
            .filter((r) => !products.some((p) => p.name === r.product))
            .map((r) => (
              <option key={r.product} value={r.product}>
                ✓ {r.product}
              </option>
            ))}
        </select>
        <small className="muted">레시피 있음 {master.recipes.length} / 판매 상품 {products.length}</small>
      </div>
      {!products.length && <p className="muted">판매 상품 목록은 재고 계산(E)이 B 보고에서 가져옵니다 (최근 판매 순).</p>}
      {draft && (
        <>
          <div className="row">
            <b>{draft.product}</b>
            <select value={draft.part || "기타"} onChange={(e) => setDraft({ ...draft, part: e.target.value as StockPart })}>
              {PARTS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <small className="muted">{draft.part === "베이커리" ? "D 확정 생산량만큼 뺌" : "판매 수량만큼 뺌"}</small>
          </div>
          <table className="tbl edit">
            <thead>
              <tr>
                <th>원재료</th>
                <th>1개에 쓰는 양</th>
                <th className="num">원가</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {draft.items.map((it, i) => {
                const m = byId.get(it.materialId);
                return (
                  <tr key={i}>
                    <td>
                      <select value={it.materialId} onChange={(e) => setDraft({ ...draft, items: draft.items.map((x, j) => (j === i ? { ...x, materialId: e.target.value } : x)) })}>
                        <option value="">— 고르기 —</option>
                        {master.materials.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({packLabel(m)})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input type="number" value={it.qty} onChange={(e) => setDraft({ ...draft, items: draft.items.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) || 0 } : x)) })} className="n" /> {m ? useUnitOf(m) : ""}
                    </td>
                    <td className="num">{m ? won(recipeCost({ product: "", items: [it] }, master.materials)) : ""}</td>
                    <td>
                      <button className="ghost" onClick={() => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="row">
            <button onClick={() => setDraft({ ...draft, items: [...draft.items, { materialId: "", qty: 0 }] })}>＋ 원재료</button>
            <span className="grow" />
            <b>1개 원가 {won(recipeCost(draft, master.materials))}</b>
            <button className="primary" onClick={saveRecipe}>
              레시피 저장
            </button>
          </div>
          {cur?.history?.length ? <p className="note muted">고친 기록 {cur.history.length}번 — 고치기 전 날의 판매 · 생산은 예전 양으로 계산</p> : null}
        </>
      )}
    </section>
  );
}

/* ---------- 입고 (창고 입구) ---------- */
function InTab({ master, big }: { master: StockMaster; big: boolean }) {
  const [date, setDate] = useState(todayKst());
  const [list, setList] = useState<StockIn[]>([]);
  const [mid, setMid] = useState("");
  const [pkgs, setPkgs] = useState("");
  const [loose, setLoose] = useState("");
  const [msg, setMsg] = useState("");
  const m = master.materials.find((x) => x.id === mid);
  const qty = m ? (Number(pkgs) || 0) * pkgQtyOf(m) + (Number(loose) || 0) : 0;
  const reload = useCallback(async () => setList(await api.ins(date)), [date]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const add = async () => {
    if (!m || !(qty > 0)) return;
    try {
      await api.addIns(date, [{ date, materialId: m.id, qty, pkgPrice: m.pkgPrice ?? null, by: session()?.name || "체험판" }]);
      setMsg(`${m.name} ${stockText(m, qty)} 입고 등록`);
      setPkgs("");
      setLoose("");
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <section className={`card${big ? " big" : ""}`}>
      <h2>입고 등록</h2>
      <p className="muted">창고 입구에서는 들어온 것만 적습니다. 쓴 양은 레시피로 저절로 빠집니다.</p>
      <div className="form">
        <label>
          날짜 <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          원재료
          <select value={mid} onChange={(e) => setMid(e.target.value)}>
            <option value="">— 고르기 —</option>
            {master.suppliers.map((s) => (
              <optgroup key={s.id} label={s.name}>
                {master.materials
                  .filter((x) => x.supplierId === s.id)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ({packLabel(x)} · {pkgQtyOf(x)}EA)
                    </option>
                  ))}
              </optgroup>
            ))}
            {master.materials.some((x) => !x.supplierId) && (
              <optgroup label="공급처 미지정">
                {master.materials
                  .filter((x) => !x.supplierId)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </optgroup>
            )}
          </select>
        </label>
        <label>
          PKG 수 <input type="number" inputMode="numeric" value={pkgs} onChange={(e) => setPkgs(e.target.value)} />
        </label>
        <label>
          낱개 <input type="number" inputMode="numeric" value={loose} onChange={(e) => setLoose(e.target.value)} />
        </label>
        <button className="primary" disabled={!m || !(qty > 0)} onClick={add}>
          {m && qty > 0 ? `${stockText(m, qty)} 입고` : "입고"}
        </button>
      </div>
      {msg && <p className="ok">{msg}</p>}
      <h3>{date} 입고</h3>
      <ul>
        {list.map((r, i) => {
          const x = master.materials.find((y) => y.id === r.materialId);
          return (
            <li key={i}>
              {x?.name || r.materialId} {x ? stockText(x, r.qty) : r.qty}
              {x && pkgSplitText(x, r.qty) ? ` (${pkgSplitText(x, r.qty)})` : ""} <small className="muted">{r.by}</small>
            </li>
          );
        })}
        {!list.length && <li className="muted">아직 없음</li>}
      </ul>
    </section>
  );
}

/* ---------- 실셈 ---------- */
function CountTab({ master, ledger, onDone }: { master: StockMaster; ledger: LedgerDoc | null; onDone: (t: string) => void }) {
  const [date, setDate] = useState(todayKst());
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [past, setPast] = useState<StockCount[]>([]);
  useEffect(() => {
    void api.counts().then(setPast);
  }, []);
  const system = (id: string) => ledger?.rows.find((r) => r.id === id)?.onHand ?? 0;
  const safety = useMemo(() => Object.fromEntries((ledger?.rows || []).filter((r) => r.safety != null).map((r) => [r.id, r.safety as number])), [ledger]);
  const count: StockCount = {
    date,
    confirmed: true,
    by: session()?.name || "체험판",
    lines: master.materials.filter((m) => counted[m.id] != null && counted[m.id] !== "").map((m) => ({ materialId: m.id, system: system(m.id), counted: Number(counted[m.id]) })),
  };
  const res = countCheck(count, master.materials, safety);
  const done = past.find((c) => c.date === date);
  return (
    <section className="card">
      <h2>실셈 (센 수량)</h2>
      <div className="row">
        <label>
          센 날 <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <small className="muted">장부 = {ledger ? `${ledger.upTo} 끝` : "아직 계산 전"} · 뜯지 않은 개수를 셉니다</small>
      </div>
      {done && <p className="bad">이 날 실셈은 이미 확정했습니다 — 다시 확정하면 바꿔 씁니다.</p>}
      <table className="tbl edit">
        <thead>
          <tr>
            <th>보관장소</th>
            <th>원재료</th>
            <th className="num">장부</th>
            <th>센 수량</th>
            <th className="num">차이</th>
          </tr>
        </thead>
        <tbody>
          {[...master.materials]
            .sort((a, b) => (a.storage || "").localeCompare(b.storage || "", "ko"))
            .map((m) => {
              const c = counted[m.id];
              const d = c == null || c === "" ? null : Number(c) - system(m.id);
              return (
                <tr key={m.id}>
                  <td className="muted">{m.storage}</td>
                  <td>
                    {m.name} <small className="muted">{packLabel(m)}</small>
                  </td>
                  <td className="num">{system(m.id)}</td>
                  <td>
                    <input type="number" inputMode="numeric" value={c ?? ""} onChange={(e) => setCounted({ ...counted, [m.id]: e.target.value })} className="n" />
                  </td>
                  <td className={`num ${d == null ? "" : d < 0 ? "bad" : d > 0 ? "ok" : ""}`}>{d == null ? "" : d > 0 ? `+${d}` : d}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
      {res.length > 0 && (
        <ul className="result">
          {res.map((r) => (
            <li key={r.materialId} className={r.kind === "과사용" ? "bad" : "ok"}>
              {r.kind === "과사용"
                ? `${r.name} ${r.diff} — 과사용 ${won(-r.amount)} · 레시피 재검증${r.needOrder ? " · 추가 발주 필요" : ""}`
                : `${r.name} +${r.diff} — 절약 코드로 ${won(r.amount)} 자산 다시 올림`}
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <span className="grow" />
        <button
          className="primary"
          disabled={!count.lines.length}
          onClick={async () => {
            if (!confirm(`${date} 실셈 ${count.lines.length}개를 확정할까요? 장부에 차이가 들어가고 발주app 에 알림이 갑니다.`)) return;
            await api.saveCount(count);
            if (res.length) await api.saveAlert(countAlert(date, res));
            setPast(await api.counts());
            onDone(`${date} 실셈 확정 — 과사용 ${res.filter((r) => r.kind === "과사용").length} · 절약 ${res.filter((r) => r.kind === "절약").length}. 발주app 에 알림.`);
          }}
        >
          실셈 확정
        </button>
      </div>
    </section>
  );
}

/* ================= F 발주app ================= */
function OrderApp() {
  const [alerts, setAlerts] = useState<StockAlert[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    try {
      setAlerts(await api.alerts());
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const onVis = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);
  const unread = (alerts || []).filter((a) => !a.readAt).length;
  const [push, setPush] = useState(pushOn());
  const [pushMsg, setPushMsg] = useState("");
  // 앱 아이콘 숫자 = 안 읽은 알림 수 (설치한 웹앱 · 지원하는 폰)
  useEffect(() => {
    const n = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (unread) void n.setAppBadge?.(unread).catch(() => {});
    else void n.clearAppBadge?.().catch(() => {});
    document.title = unread ? `(${unread}) 발주app` : "발주app";
  }, [unread]);
  const read = async (a: StockAlert) => {
    setOpen(open === a.id ? null : a.id);
    if (a.readAt) return;
    const b = { ...a, readAt: new Date().toISOString() };
    setAlerts((xs) => (xs || []).map((x) => (x.id === a.id ? b : x)));
    await api.saveAlert(b).catch(() => {});
  };
  return (
    <div className="app f">
      <header className="bar">
        <b>발주app</b>
        {unread > 0 && <span className="badge">{unread}</span>}
        {__DEMO__ && <span className="tag">체험판</span>}
        <span className="grow" />
        <button className="ghost" onClick={() => void load()}>
          새로고침
        </button>
      </header>
      {err && <div className="msg bad">{err}</div>}
      <main className="content">
        {!push && (
          <div className="card push">
            <b>🔔 발주 알림을 폰으로 받기</b>
            <p className="muted">안전재고 아래로 내려가거나 실셈에서 과사용이 나오면 폰 위쪽에 알림이 뜨고, 확인할 때까지 남습니다. 앱 아이콘에는 안 읽은 수가 보입니다.</p>
            {pushReady() ? (
              <p className="muted">{pushReady()}</p>
            ) : (
              <button
                className="primary"
                onClick={async () => {
                  setPushMsg("");
                  try {
                    await enablePush();
                    setPush(true);
                  } catch (e) {
                    setPushMsg((e as Error).message);
                  }
                }}
              >
                알림 켜기
              </button>
            )}
            {pushMsg && <p className="bad">{pushMsg}</p>}
          </div>
        )}
        {!alerts ? (
          <p className="muted">불러오는 중…</p>
        ) : !alerts.length ? (
          <p className="muted">알림이 없습니다.</p>
        ) : (
          alerts.map((a) => (
            <article key={a.id} className={`alert ${a.readAt ? "read" : "unread"} ${a.kind}${a.kind === "count" && /과사용 [1-9]/.test(a.title) ? " over" : ""}`} onClick={() => void read(a)}>
              <div className="alert-head">
                {!a.readAt && <span className="dot" aria-label="안 읽음" />}
                <b>{a.title}</b>
                <span className="grow" />
                <small className="muted">{new Date(a.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" })}</small>
              </div>
              {open === a.id && (
                <ul>
                  {a.lines.map((l, i) => (
                    <li key={i} className={l.startsWith("· ") ? "sub" : "head"}>
                      {l.replace(/^· /, "")}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))
        )}
      </main>
    </div>
  );
}
