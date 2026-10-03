/* ============================================================
   ④ 자금 현황 — 지금 엑셀 '가. 자금요약' 모양 그대로
   - 전일 잔고: 클라우드의 앞 자금 보고 금일 잔고 (맨 처음만 직접 입력)
   - 입금 · 출금: [세부내용 등록] 창(아래에서 올라옴)에 적은 줄의 합 → 금일 잔고 저절로
   - 환율: 보고 시점 USD(1달러) · JPY(100엔) — 직전 보고 대비 변동 표시
   - 대출: 대출 제외 자금 계산용 (앞 보고에서 이어받음)
   입력 칸은 글자로 들고 있다가 올릴 때 숫자로 (빈칸 = 0)
   ============================================================ */
import { Fragment, useEffect, useRef } from "react";
import {
  CASH_ACCOUNTS,
  CASH_GROUP_LABEL,
  cashSummary,
  cleanCashPart,
  currencyOf,
  money,
  shortLabel,
  type CashAccount,
  type CashGroup,
  type CashPart,
  type CashSummary,
  type Currency,
} from "@report/core";

/* ---------- 입력 중인 자금 (글자) ---------- */
export interface RowDraft {
  inWho: string;
  inMemo: string;
  inAmt: string;
  outWho: string;
  outMemo: string;
  outAmt: string;
}
export interface CashDraft {
  date: string;
  usd: string;
  jpy: string;
  open: Record<string, string>;
  rows: Record<string, RowDraft[]>;
  loans: { label: string; amount: string }[];
  notes: Record<string, string>;
}

export const emptyRow = (): RowDraft => ({ inWho: "", inMemo: "", inAmt: "", outWho: "", outMemo: "", outAmt: "" });

/** 금액 칸 글자 → 숫자 (쉼표 · 공백 무시, 빈칸 0) */
export const parseAmt = (s: string) => {
  const v = Number(String(s || "").replace(/[^0-9.-]/g, ""));
  return isFinite(v) ? v : 0;
};
/** 숫자 → 금액 칸 글자 (0 은 '0') */
const showAmt = (v: number, c: Currency) => (c === "KRW" ? Math.round(v).toLocaleString("ko-KR") : v.toLocaleString("en-US", { maximumFractionDigits: 2 }));

/** 쓰는 중인 금액에 쉼표 넣기 (외화는 소수 둘째 자리까지) */
export function typeAmt(raw: string, c: Currency): string {
  let s = raw.replace(/[^0-9.-]/g, "");
  const neg = s.startsWith("-");
  s = s.replace(/-/g, "");
  let [int, dec] = s.split(".");
  int = (int || "").replace(/^0+(?=\d)/, "");
  const body = int ? Number(int).toLocaleString("ko-KR") : dec != null ? "0" : "";
  const tail = c !== "KRW" && dec != null ? "." + dec.slice(0, 2) : "";
  return (neg ? "-" : "") + body + tail;
}

export function draftFromPart(p: CashPart): CashDraft {
  const rows: Record<string, RowDraft[]> = {};
  for (const a of CASH_ACCOUNTS) {
    const c = currencyOf(a.group);
    const list = (p.rows?.[a.id] || []).map((r) => ({
      inWho: r.inWho,
      inMemo: r.inMemo,
      inAmt: r.inAmt ? showAmt(r.inAmt, c) : "",
      outWho: r.outWho,
      outMemo: r.outMemo,
      outAmt: r.outAmt ? showAmt(r.outAmt, c) : "",
    }));
    rows[a.id] = list.length ? list : [emptyRow()];
  }
  return {
    date: p.date,
    usd: p.rates?.usd ? String(p.rates.usd) : "",
    jpy: p.rates?.jpy ? String(p.rates.jpy) : "",
    open: Object.fromEntries(CASH_ACCOUNTS.map((a) => [a.id, p.open?.[a.id] ? showAmt(p.open[a.id], currencyOf(a.group)) : ""])),
    rows,
    loans: (p.loans || []).map((l) => ({ label: l.label, amount: l.amount ? showAmt(l.amount, "KRW") : "" })),
    notes: { ...(p.notes || {}) },
  };
}

export function partFromDraft(d: CashDraft): CashPart {
  return cleanCashPart({
    date: d.date,
    rates: { usd: parseAmt(d.usd), jpy: parseAmt(d.jpy) },
    open: Object.fromEntries(Object.entries(d.open).map(([k, v]) => [k, parseAmt(v)])),
    rows: Object.fromEntries(
      Object.entries(d.rows).map(([k, rs]) => [k, rs.map((r) => ({ inWho: r.inWho, inMemo: r.inMemo, inAmt: parseAmt(r.inAmt), outWho: r.outWho, outMemo: r.outMemo, outAmt: parseAmt(r.outAmt) }))]),
    ),
    loans: d.loans.map((l) => ({ label: l.label, amount: parseAmt(l.amount) })),
    notes: d.notes,
  });
}

/** 올리기 전에 빈칸을 0 으로 채운 모양 (화면에도 0 이 보이게) */
export function fillZeros(d: CashDraft, openEditable: boolean): CashDraft {
  const z = (s: string) => (s.trim() === "" ? "0" : s);
  return {
    ...d,
    usd: z(d.usd),
    jpy: z(d.jpy),
    open: openEditable ? Object.fromEntries(Object.entries(d.open).map(([k, v]) => [k, z(v)])) : d.open,
    rows: Object.fromEntries(Object.entries(d.rows).map(([k, rs]) => [k, rs.map((r) => (r.inWho || r.inMemo || r.outWho || r.outMemo || r.inAmt || r.outAmt ? { ...r, inAmt: z(r.inAmt), outAmt: z(r.outAmt) } : r))])),
    loans: d.loans.map((l) => ({ ...l, amount: z(l.amount) })),
  };
}

/** 지금 입력으로 자금요약 계산 — open: 클라우드에서 이어받은 전일 잔고 (없으면 입력한 값) */
export function draftSummary(d: CashDraft, open: Record<string, number> | null, openFrom: string | null, prevRates: { usd: number; jpy: number } | null): CashSummary {
  const p = partFromDraft(d);
  return cashSummary(p, { open: open || p.open, openFrom, prevRates });
}

/* ---------- 자금요약 표 ---------- */
const GROUP_ROWS: { group: CashGroup; label: string; total?: string }[] = [
  { group: "cash", label: "원화\n(현금)", total: "계정별 합계 ⓐ" },
  { group: "deposit", label: "원화\n(보통예금)", total: "계정별 합계 ⓑ" },
  { group: "securities", label: "법인 증권계좌 ⓒ" },
  { group: "minus", label: "신한 마이너스 통장 ⓓ" },
];

export function CashTable(props: {
  draft: CashDraft;
  sum: CashSummary;
  locked: boolean;
  /** 전일 잔고를 직접 넣는지 (앞 자금 보고가 없을 때만) */
  openEditable: boolean;
  onChange: (d: CashDraft) => void;
  onDetail: (id?: string) => void;
}) {
  const { draft: d, sum, locked } = props;
  const set = (patch: Partial<CashDraft>) => props.onChange({ ...d, ...patch });
  const line = (id: string) => sum.lines.find((l) => l.account.id === id)!;
  const cell = (v: number, c: Currency) => <td className="num">{money(v, c)}</td>;
  const flow = (a: CashAccount, k: "in" | "out") => {
    const l = line(a.id);
    return (
      <td className="num">
        <button className="cell-btn" disabled={locked} onClick={() => props.onDetail(a.id)} title="세부내용 등록에서 고칩니다">
          {money(l[k], l.currency)}
        </button>
      </td>
    );
  };
  const openCell = (a: CashAccount) => {
    const l = line(a.id);
    if (!props.openEditable) return cell(l.open, l.currency);
    return (
      <td className="num">
        <input className="amt" disabled={locked} inputMode="decimal" value={d.open[a.id] || ""} placeholder="0" onChange={(e) => set({ open: { ...d.open, [a.id]: typeAmt(e.target.value, l.currency) } })} />
      </td>
    );
  };
  const accRow = (a: CashAccount, first: boolean, span: number, label: string) => {
    const l = line(a.id);
    return (
      <tr key={a.id} className={l.in || l.out ? "moved" : ""}>
        {first && (
          <th rowSpan={span} className="grp">
            {label}
          </th>
        )}
        <td className="acc">{a.name}</td>
        <td className="accno">{a.no || ""}</td>
        {openCell(a)}
        {flow(a, "in")}
        {flow(a, "out")}
        <td className="num close">{money(l.close, l.currency)}</td>
      </tr>
    );
  };
  const tot = (label: string, g: { open: number; in: number; out: number; close: number }, c: Currency, cls = "tot") => (
    <tr className={cls}>
      <th colSpan={3}>{label}</th>
      <td className="num">{money(g.open, c)}</td>
      <td className="num">{money(g.in, c)}</td>
      <td className="num">{money(g.out, c)}</td>
      <td className="num">{money(g.close, c)}</td>
    </tr>
  );
  const fx = (group: "usd" | "jpy") => {
    const accs = CASH_ACCOUNTS.filter((a) => a.group === group);
    const c: Currency = group === "usd" ? "USD" : "JPY";
    const krw = group === "usd" ? sum.usdKrw : sum.jpyKrw;
    const change = sum.rateChange[group];
    return (
      <>
        {accs.map((a, i) => accRow(a, i === 0, accs.length, CASH_GROUP_LABEL[group].replace(" ", "\n")))}
        {tot("계정별 합계", sum.group[group], c)}
        <tr className="fx">
          <td colSpan={3} className="rate">
            보고시점 {group === "usd" ? "USD 환율 (1달러)" : "JPY 환율 (100엔)"}{" "}
            <input className="amt rate-in" disabled={locked} inputMode="decimal" placeholder="0.00" value={group === "usd" ? d.usd : d.jpy} onChange={(e) => set({ [group]: e.target.value.replace(/[^0-9.]/g, "") } as Partial<CashDraft>)} />
            {change != null && (
              <span className={`chg ${change > 0 ? "up" : change < 0 ? "down" : ""}`}>
                {change > 0 ? "+" : ""}
                {change.toFixed(2)} (직전보고 대비)
              </span>
            )}
          </td>
          <td colSpan={3} className="num krw-label">
            원화 환산 금액
          </td>
          <td className="num krw">{money(krw, "KRW", false)}원</td>
        </tr>
      </>
    );
  };

  return (
    <div className="cash-wrap">
      <table className="cash">
        <colgroup>
          <col className="c-grp" />
          <col className="c-acc" />
          <col className="c-no" />
          <col />
          <col />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th colSpan={2}>금융기관</th>
            <th>계좌</th>
            <th>
              전일 잔고
              <small>{sum.openFrom ? ` (${shortLabel(sum.openFrom)} 마감)` : props.openEditable ? " (처음 · 직접)" : ""}</small>
            </th>
            <th>입금</th>
            <th>출금</th>
            <th>금일 잔고</th>
          </tr>
        </thead>
        <tbody>
          {GROUP_ROWS.map(({ group, label, total }) => {
            const accs = CASH_ACCOUNTS.filter((a) => a.group === group);
            if (!total)
              return (
                <tr key={group} className="tot single">
                  <th colSpan={3}>{label}</th>
                  {openCell(accs[0])}
                  {flow(accs[0], "in")}
                  {flow(accs[0], "out")}
                  <td className="num close">{money(line(accs[0].id).close, "KRW")}</td>
                </tr>
              );
            return (
              <Fragment key={group}>
                {accs.map((a, i) => accRow(a, i === 0, accs.length, label))}
                {tot(total, sum.group[group], "KRW")}
              </Fragment>
            );
          })}
          {tot("원화 합계 (ⓐ+ⓑ+ⓒ+ⓓ)", sum.krw, "KRW", "tot big")}
          <tr className="gap">
            <td colSpan={7} />
          </tr>
          {fx("usd")}
          {fx("jpy")}
          <tr className="grand">
            <th colSpan={6}>잔액 합계 (ⓐ+ⓑ+ⓓ + 외화 보고일 환율 환산 · 증권계좌 제외)</th>
            <td className="num">{money(sum.total, "KRW", false)}원</td>
          </tr>
          <tr className="sec-row">
            <th colSpan={6}>법인 증권계좌 ⓒ (잔액 합계와 별도)</th>
            <td className="num">{money(sum.securities, "KRW", false)}원</td>
          </tr>
          <tr className="net">
            <td colSpan={6} className="loans">
              <div className="loans-in">
              <b>대출 제외 자금</b> <small className="muted">(잔액 합계 + 증권계좌 − 대출)</small>
              {d.loans.map((l, i) => (
                <span key={i} className="loan">
                  <input className="loan-label" disabled={locked} placeholder="대출 이름 (예: 신한 311-…)" value={l.label} onChange={(e) => set({ loans: d.loans.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  <input className="amt" disabled={locked} inputMode="numeric" placeholder="0" value={l.amount} onChange={(e) => set({ loans: d.loans.map((x, j) => (j === i ? { ...x, amount: typeAmt(e.target.value, "KRW") } : x)) })} />
                  {!locked && (
                    <button className="x" onClick={() => set({ loans: d.loans.filter((_, j) => j !== i) })} aria-label="대출 빼기">
                      ×
                    </button>
                  )}
                </span>
              ))}
              {!locked && (
                <button className="link" onClick={() => set({ loans: [...d.loans, { label: "", amount: "" }] })}>
                  + 대출 추가
                </button>
              )}
              </div>
            </td>
            <td className={`num ${sum.net < 0 ? "minus" : ""}`}>{sum.net < 0 ? `(${money(-sum.net, "KRW", false)})` : money(sum.net, "KRW", false)}원</td>
          </tr>
        </tbody>
      </table>
      <p className="cash-foot">원화 기준 · 외화는 보고일 환율로 환산 · 퇴직급여 예치금 제외 · 입금/출금 숫자를 누르면 그 계좌 세부내용으로</p>
    </div>
  );
}

/* ---------- 세부내용 등록 (아래에서 올라오는 창) ---------- */
/** 세부내용 순서: 은행(원화) → 증권 · 마이너스 → 외화 → 현금 (엑셀 나 · 다 · 라 순서) */
const DETAIL_ORDER = [...CASH_ACCOUNTS.filter((a) => a.group !== "cash"), ...CASH_ACCOUNTS.filter((a) => a.group === "cash")];

export function CashSheet(props: { draft: CashDraft; onChange: (d: CashDraft) => void; onClose: () => void; focus?: string }) {
  const { draft: d } = props;
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.focus) return;
    const el = body.current?.querySelector(`[data-acc="${props.focus}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "start" });
    (el?.querySelector("input") as HTMLInputElement | null)?.focus();
  }, [props.focus]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [props]);
  const setRows = (id: string, rows: RowDraft[]) => props.onChange({ ...d, rows: { ...d.rows, [id]: rows } });
  return (
    <div className="sheet-bg" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label="자금 변동 세부내용 등록">
        <header className="sheet-head">
          <h2>자금 변동 세부내용 — {shortLabel(d.date)}</h2>
          <span className="hint">계좌마다 한 줄씩 있습니다. 더 적을 것이 있을 때만 '+ 칸 추가'. 금액 빈칸은 올릴 때 0 으로 들어갑니다.</span>
          <button className="primary" onClick={props.onClose}>
            다 적었음 (닫기)
          </button>
        </header>
        <div className="sheet-body" ref={body}>
          <table className="detail">
            <colgroup>
              <col className="d-acc" />
              <col className="d-who" />
              <col className="d-memo" />
              <col className="d-amt" />
              <col className="d-who" />
              <col className="d-memo" />
              <col className="d-amt" />
              <col className="d-x" />
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2}>거래 은행</th>
                <th colSpan={3} className="in">
                  입금
                </th>
                <th colSpan={3} className="out">
                  출금
                </th>
                <th rowSpan={2} />
              </tr>
              <tr>
                <th>거래처</th>
                <th>적요</th>
                <th>금액</th>
                <th>거래처 / 수령인</th>
                <th>적요</th>
                <th>금액</th>
              </tr>
            </thead>
            {DETAIL_ORDER.map((a) => {
              const c = currencyOf(a.group);
              const rows = d.rows[a.id]?.length ? d.rows[a.id] : [emptyRow()];
              const sumIn = rows.reduce((s, r) => s + parseAmt(r.inAmt), 0);
              const sumOut = rows.reduce((s, r) => s + parseAmt(r.outAmt), 0);
              const put = (i: number, patch: Partial<RowDraft>) => setRows(a.id, rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
              const fxCls = c === "KRW" ? "" : " fx";
              return (
                <tbody key={a.id} data-acc={a.id} className={`acc-block${fxCls}`}>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      {i === 0 && (
                        <th rowSpan={rows.length + 1} className="acc">
                          {a.group === "cash" ? `현금\n${a.name}` : a.name}
                          {c !== "KRW" && <small>{c === "USD" ? "달러" : "엔"}로 적기</small>}
                        </th>
                      )}
                      <td>
                        <input value={r.inWho} onChange={(e) => put(i, { inWho: e.target.value })} aria-label={`${a.name} 입금 거래처`} />
                      </td>
                      <td>
                        <input value={r.inMemo} onChange={(e) => put(i, { inMemo: e.target.value })} aria-label={`${a.name} 입금 적요`} />
                      </td>
                      <td>
                        <input className="amt" inputMode="decimal" value={r.inAmt} onChange={(e) => put(i, { inAmt: typeAmt(e.target.value, c) })} aria-label={`${a.name} 입금 금액`} />
                      </td>
                      <td>
                        <input value={r.outWho} placeholder={a.outWho || ""} onChange={(e) => put(i, { outWho: e.target.value })} aria-label={`${a.name} 출금 ${a.outWho || "거래처"}`} />
                      </td>
                      <td>
                        <input value={r.outMemo} onChange={(e) => put(i, { outMemo: e.target.value })} aria-label={`${a.name} 출금 적요`} />
                      </td>
                      <td>
                        <input className="amt" inputMode="decimal" value={r.outAmt} onChange={(e) => put(i, { outAmt: typeAmt(e.target.value, c) })} aria-label={`${a.name} 출금 금액`} />
                      </td>
                      <td>
                        {rows.length > 1 && (
                          <button className="x" onClick={() => setRows(a.id, rows.filter((_, j) => j !== i))} aria-label="이 줄 빼기">
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="sub">
                    <td colSpan={2}>{a.name} 입금 소계</td>
                    <td className="num">{money(sumIn, c)}</td>
                    <td colSpan={2}>{a.name} 출금 소계</td>
                    <td className="num">{money(sumOut, c)}</td>
                    <td>
                      <button className="add" onClick={() => setRows(a.id, [...rows, emptyRow()])}>
                        + 칸 추가
                      </button>
                    </td>
                  </tr>
                </tbody>
              );
            })}
          </table>
        </div>
      </section>
    </div>
  );
}
