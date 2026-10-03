/* ============================================================
   자금 현황 (현금흐름) — 지금 엑셀 '가. 자금요약' · '나. 자금 변동 내역 상세' · '다/라. 현금' 그대로
   - 계좌마다: 전일 잔고 + 입금 − 출금 = 금일 잔고
   - 입금 · 출금 = 세부내용(거래처 · 적요 · 금액) 줄의 합 (계좌마다 한 줄, 더 쓸 때만 칸 추가)
   - 전일 잔고 = 그 전에 올라간 자금 보고의 금일 잔고 (빠진 날이 있으면 그 앞의 가장 늦은 날)
     자금 보고가 하나도 없을 때(맨 처음)만 A 에서 직접 넣은 값을 씀
   - 외화는 그 나라 돈으로 적고, 보고일 환율로 원화 환산 (엔화는 100엔당 환율)
   - 잔액 합계 = 현금ⓐ + 보통예금ⓑ + 마이너스 통장ⓓ + 외화 환산 — 법인 증권계좌ⓒ(2억)는 빼고 따로 보여 줌
   - 대출 제외 자금 = 잔액 합계 + 증권계좌 − 대출 (엑셀과 같음)
   클라우드: reports/{날짜} 의 칸 cash (A 가 올림, B 가 읽음)
   ============================================================ */

export type CashGroup = "cash" | "deposit" | "securities" | "minus" | "usd" | "jpy";
export type Currency = "KRW" | "USD" | "JPY";

export interface CashAccount {
  id: string;
  group: CashGroup;
  /** 금융기관 · 이름 (자금요약 줄) */
  name: string;
  /** 계좌번호 칸 */
  no?: string;
  /** 세부내용에서 출금 쪽 첫 칸 이름 (현금은 수령인) */
  outWho?: string;
}

/** 자금요약 줄 순서 그대로 */
export const CASH_ACCOUNTS: CashAccount[] = [
  { id: "cashAlpha", group: "cash", name: "알파비젼㈜", no: "금고시재", outWho: "수령인" },
  { id: "cashCafe", group: "cash", name: "카페 아스타나", no: "금고시재", outWho: "수령인" },
  { id: "nh", group: "deposit", name: "농협은행" },
  { id: "shinhan", group: "deposit", name: "신한은행" },
  { id: "woori", group: "deposit", name: "우리은행" },
  { id: "citi", group: "deposit", name: "씨티은행" },
  { id: "ibk", group: "deposit", name: "기업은행" },
  { id: "keb", group: "deposit", name: "KEB은행" },
  { id: "hana", group: "deposit", name: "하나은행" },
  { id: "securities", group: "securities", name: "법인 증권계좌" },
  { id: "minus", group: "minus", name: "신한 마이너스 통장" },
  { id: "shinhanUsd1", group: "usd", name: "신한은행(USD) 1" },
  { id: "shinhanUsd2", group: "usd", name: "신한은행(USD) 2" },
  { id: "citiUsd", group: "usd", name: "씨티은행(USD)" },
  { id: "kebUsd", group: "usd", name: "KEB은행(USD)" },
  { id: "shinhanJpy", group: "jpy", name: "신한은행(JPY)" },
  { id: "kebJpy", group: "jpy", name: "KEB은행(JPY)" },
];

export const CASH_GROUP_LABEL: Record<CashGroup, string> = {
  cash: "원화 (현금)",
  deposit: "원화 (보통예금)",
  securities: "법인 증권계좌",
  minus: "신한 마이너스 통장",
  usd: "외화 (USD)",
  jpy: "외화 (JPY)",
};

export const currencyOf = (g: CashGroup): Currency => (g === "usd" ? "USD" : g === "jpy" ? "JPY" : "KRW");

/** 세부내용 한 줄 — 왼쪽 입금 · 오른쪽 출금 (엑셀처럼 한 줄에 둘 다) */
export interface CashRow {
  inWho: string;
  inMemo: string;
  inAmt: number;
  outWho: string;
  outMemo: string;
  outAmt: number;
}

export interface CashLoan {
  /** 예: 신한(311-…) */
  label: string;
  amount: number;
}

/** 하루 자금 보고 (A 가 올리는 조각) */
export interface CashPart {
  date: string;
  /** 보고 시점 환율 — USD 1달러당 · JPY 100엔당 (원) */
  rates: { usd: number; jpy: number };
  /** 올릴 때 본 전일 잔고 (맨 처음 자금 보고면 직접 넣은 값 — 다음부터는 앞날 금일 잔고로 다시 계산) */
  open: Record<string, number>;
  /** 계좌별 세부내용 */
  rows: Record<string, CashRow[]>;
  /** 대출 (대출 제외 자금 계산용) */
  loans: CashLoan[];
  /** 비고 (계좌별) */
  notes?: Record<string, string>;
}

export interface CashLineResult {
  account: CashAccount;
  currency: Currency;
  open: number;
  in: number;
  out: number;
  close: number;
}

export interface CashSummary {
  date: string;
  lines: CashLineResult[];
  /** 묶음별 합계 (그 나라 돈) */
  group: Record<CashGroup, { open: number; in: number; out: number; close: number }>;
  /** 원화 합계 ⓐ+ⓑ+ⓒ+ⓓ */
  krw: { open: number; in: number; out: number; close: number };
  usdKrw: number;
  jpyKrw: number;
  /** 법인 증권계좌 금일 잔고 (잔액 합계와 따로) */
  securities: number;
  /** 잔액 합계 (원화 + 외화 환산, 증권계좌 뺌) */
  total: number;
  loans: number;
  /** 대출 제외 자금 */
  net: number;
  rates: { usd: number; jpy: number };
  /** 직전 자금 보고 대비 환율 변동 (없으면 null) */
  rateChange: { usd: number | null; jpy: number | null };
  /** 전일 잔고를 가져온 날 (null = 직접 넣은 값) */
  openFrom: string | null;
}

/** 금액 맞추기 — 원화는 원 단위, 외화는 센트(0.01) 단위 */
export const roundMoney = (v: number, c: Currency) => (c === "KRW" ? Math.round(v) : Math.round(v * 100) / 100);
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);

export const emptyCashRow = (): CashRow => ({ inWho: "", inMemo: "", inAmt: 0, outWho: "", outMemo: "", outAmt: 0 });
export const isBlankRow = (r: CashRow) => !r.inWho.trim() && !r.inMemo.trim() && !num(r.inAmt) && !r.outWho.trim() && !r.outMemo.trim() && !num(r.outAmt);

/** 올리기 전에 정리 — 빈 줄은 빼고, 빈 금액은 0, 금액은 원/센트로 맞춤. 모든 계좌 칸을 0 으로라도 채움 */
export function cleanCashPart(p: CashPart): CashPart {
  const open: Record<string, number> = {};
  const rows: Record<string, CashRow[]> = {};
  for (const a of CASH_ACCOUNTS) {
    const c = currencyOf(a.group);
    open[a.id] = roundMoney(num(p.open?.[a.id]), c);
    rows[a.id] = (p.rows?.[a.id] || [])
      .map((r) => ({
        inWho: String(r.inWho || "").trim(),
        inMemo: String(r.inMemo || "").trim(),
        inAmt: roundMoney(num(r.inAmt), c),
        outWho: String(r.outWho || "").trim(),
        outMemo: String(r.outMemo || "").trim(),
        outAmt: roundMoney(num(r.outAmt), c),
      }))
      .filter((r) => !isBlankRow(r));
  }
  const notes = Object.fromEntries(Object.entries(p.notes || {}).map(([k, v]) => [k, String(v || "").trim()]).filter(([, v]) => v));
  return {
    date: p.date,
    rates: { usd: Math.round(num(p.rates?.usd) * 100) / 100, jpy: Math.round(num(p.rates?.jpy) * 100) / 100 },
    open,
    rows,
    loans: (p.loans || []).map((l) => ({ label: String(l.label || "").trim(), amount: Math.round(num(l.amount)) })).filter((l) => l.label || l.amount),
    ...(Object.keys(notes).length ? { notes } : {}),
  };
}

/** 계좌 하나의 입금 · 출금 합 */
export function cashFlow(p: CashPart, id: string): { in: number; out: number } {
  const a = CASH_ACCOUNTS.find((x) => x.id === id);
  const c = a ? currencyOf(a.group) : "KRW";
  let i = 0;
  let o = 0;
  for (const r of p.rows?.[id] || []) {
    i += num(r.inAmt);
    o += num(r.outAmt);
  }
  return { in: roundMoney(i, c), out: roundMoney(o, c) };
}

/** 계좌별 금일 잔고 (전일 잔고 open 기준) */
export function cashClose(p: CashPart, open: Record<string, number> = p.open): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of CASH_ACCOUNTS) {
    const f = cashFlow(p, a.id);
    out[a.id] = roundMoney(num(open?.[a.id]) + f.in - f.out, currencyOf(a.group));
  }
  return out;
}

/** 하루 자금요약 — open: 전일 잔고 (모르면 p.open), prev: 직전 자금 보고 (환율 변동용) */
export function cashSummary(p: CashPart, opts: { open?: Record<string, number>; openFrom?: string | null; prevRates?: { usd: number; jpy: number } | null } = {}): CashSummary {
  const open = opts.open || p.open || {};
  const zero = () => ({ open: 0, in: 0, out: 0, close: 0 });
  const group = Object.fromEntries((Object.keys(CASH_GROUP_LABEL) as CashGroup[]).map((g) => [g, zero()])) as CashSummary["group"];
  const lines: CashLineResult[] = [];
  for (const a of CASH_ACCOUNTS) {
    const c = currencyOf(a.group);
    const f = cashFlow(p, a.id);
    const o = roundMoney(num(open[a.id]), c);
    const line = { account: a, currency: c, open: o, in: f.in, out: f.out, close: roundMoney(o + f.in - f.out, c) };
    lines.push(line);
    const g = group[a.group];
    g.open = roundMoney(g.open + line.open, c);
    g.in = roundMoney(g.in + line.in, c);
    g.out = roundMoney(g.out + line.out, c);
    g.close = roundMoney(g.close + line.close, c);
  }
  const krw = zero();
  for (const g of ["cash", "deposit", "securities", "minus"] as CashGroup[]) for (const k of ["open", "in", "out", "close"] as const) krw[k] += group[g][k];
  const rates = { usd: num(p.rates?.usd), jpy: num(p.rates?.jpy) };
  const usdKrw = Math.round(group.usd.close * rates.usd);
  const jpyKrw = Math.round((group.jpy.close * rates.jpy) / 100);
  const securities = group.securities.close;
  const total = krw.close - securities + usdKrw + jpyKrw;
  const loans = (p.loans || []).reduce((s, l) => s + num(l.amount), 0);
  const pr = opts.prevRates;
  const diff = (now: number, before?: number) => (before && now ? Math.round((now - before) * 100) / 100 : null);
  return {
    date: p.date,
    lines,
    group,
    krw,
    usdKrw,
    jpyKrw,
    securities,
    total,
    loans,
    net: total + securities - loans,
    rates,
    rateChange: { usd: diff(rates.usd, pr?.usd), jpy: diff(rates.jpy, pr?.jpy) },
    openFrom: opts.openFrom === undefined ? null : opts.openFrom,
  };
}

/** 자금 보고들을 날짜 순서로 이어 계산 — 전일 잔고 = 앞 자금 보고의 금일 잔고 (맨 앞만 그 보고에 적힌 전일 잔고)
    앞날을 나중에 고쳐 올려도 뒷날 전일 잔고가 저절로 맞춰짐 */
export function cashBook(parts: CashPart[]): Map<string, CashSummary> {
  const sorted = [...parts].filter((p) => p && /^\d{4}-\d{2}-\d{2}$/.test(p.date)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out = new Map<string, CashSummary>();
  let prev: CashPart | null = null;
  let prevClose: Record<string, number> | null = null;
  for (const p of sorted) {
    const s = cashSummary(p, { open: prevClose || p.open, openFrom: prev ? prev.date : null, prevRates: prev?.rates || null });
    out.set(p.date, s);
    prevClose = Object.fromEntries(s.lines.map((l) => [l.account.id, l.close]));
    prev = p;
  }
  return out;
}

/** 새 날짜 자금 보고의 시작 모양 — 앞 자금 보고가 있으면 그 금일 잔고 · 환율 · 대출을 이어받음 */
export function startCashPart(date: string, before: CashPart[]): { part: CashPart; openFrom: string | null; prevRates: { usd: number; jpy: number } | null } {
  const earlier = before.filter((p) => p.date < date);
  const book = cashBook(earlier);
  const last = earlier.sort((a, b) => (a.date < b.date ? -1 : 1)).pop() || null;
  const rows = Object.fromEntries(CASH_ACCOUNTS.map((a) => [a.id, [emptyCashRow()]]));
  if (!last) return { part: { date, rates: { usd: 0, jpy: 0 }, open: {}, rows, loans: [] }, openFrom: null, prevRates: null };
  const s = book.get(last.date)!;
  return {
    part: { date, rates: { ...last.rates }, open: Object.fromEntries(s.lines.map((l) => [l.account.id, l.close])), rows, loans: last.loans.map((l) => ({ ...l })) },
    openFrom: last.date,
    prevRates: last.rates,
  };
}

/** 외화 · 원화 금액 보여 주기 (0 은 '-') */
export function money(v: number, c: Currency, dash = true): string {
  if (dash && !v) return "-";
  const neg = v < 0;
  const a = Math.abs(v);
  const s = c === "KRW" ? Math.round(a).toLocaleString("ko-KR") : a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sym = c === "USD" ? "$" : c === "JPY" ? "¥" : "";
  return `${neg ? "-" : ""}${sym}${s}`;
}
