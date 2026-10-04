/* ============================================================
   작업지시 자료 — 클라우드(Firebase) 의 plans/{날짜} (16시 계획) · orders/{날짜} (매니저 확정)
   - D(매니저): 이메일 · 비밀번호 로그인 → senders 명단의 매장 열쇠로 읽고 씀
   - D-1(현장 태블릿): 주소 /d1/<열쇠>/ 의 열쇠로 읽기만 (로그인 없음)
   - 체험판: 가짜 실적으로 계획을 바로 세고, 확정은 이 브라우저에만 저장
   ============================================================ */
import { addDays, asOrder, asPlan, Board, DEFAULT_LEARNED, emptyOrder, floorCopy, FINAL_LEAD, makeFinal, makeWeek, nowKst, sampleUntilYesterday, weekday, WEEK_PLAN_WEEKDAY, type DayReport, type OrderDoc, type OrderLine, type PlanDoc } from "@report/core";

export type Kind = "provisional" | "final";

export interface Api {
  kind: "cloud" | "demo";
  plan(date: string): Promise<PlanDoc | null>;
  order(date: string): Promise<OrderDoc | null>;
  /** 현장 태블릿 열쇠 (매니저만 — 없으면 처음 한 번 만듦) */
  floorKey?(): Promise<string>;
  /** 그날 카페 실적 (빵 판매 · 50% 할인) — 매출 금액은 화면에 쓰지 않음 */
  report(date: string): Promise<DayReport | null>;
  /** 빵 몇 개를 잠정(provisional) 또는 최종(final) 확정 — 있던 확정에 더해 씀 */
  confirm(date: string, kind: Kind, lines: Record<string, number>, by: string): Promise<OrderDoc>;
}

const env = { apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined, projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined };
const docs = () => `https://firestore.googleapis.com/v1/projects/${env.projectId}/databases/(default)/documents`;

export class CloudError extends Error {
  constructor(
    msg: string,
    readonly status = 0,
  ) {
    super(msg);
  }
}

async function http(url: string, init: RequestInit = {}): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new CloudError("인터넷에 연결하지 못했습니다. 연결을 확인하고 다시 해 주세요.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = String(body?.error?.message || res.status);
    if (/INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND/.test(raw)) throw new CloudError("이메일이나 비밀번호가 맞지 않습니다.", 401);
    if (/TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_NOT_FOUND|USER_DISABLED/.test(raw) || res.status === 401) throw new CloudError("다시 로그인해 주세요.", 401);
    if (res.status === 403) throw new CloudError("이 계정으로는 확정할 수 없습니다 — Firebase senders 명단을 확인해 주세요.", 403);
    if (res.status === 404) throw new CloudError("없음", 404);
    throw new CloudError(`클라우드 오류 (${raw.slice(0, 100)})`, res.status);
  }
  return body;
}

/* ---------- 매니저 로그인 (입력 화면 A 와 같은 방식) ---------- */
const SESSION = "bakery.session";
interface Session {
  email: string;
  name: string;
  refresh: string;
  board: string;
}
let token: { id: string; until: number } | null = null;

export function session(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION) || "null");
  } catch {
    return null;
  }
}
function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION, JSON.stringify(s));
    else localStorage.removeItem(SESSION);
  } catch {
    /* 이번만 */
  }
}

export async function login(email: string, password: string, name: string): Promise<void> {
  const r = await http(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim(), password, returnSecureToken: true }),
  });
  token = { id: r.idToken, until: Date.now() + 3300_000 };
  const em = String(r.email || email).trim().toLowerCase();
  let board = "";
  try {
    const doc = await http(`${docs()}/senders/${encodeURIComponent(em)}`, { headers: { Authorization: `Bearer ${r.idToken}` } });
    board = String(doc.fields?.board?.stringValue || "");
  } catch (e) {
    if ((e as CloudError).status === 404) throw new CloudError("이 계정이 명단(senders)에 없습니다 — Firebase 콘솔에서 senders 문서를 만들어 주세요.", 403);
    throw e;
  }
  if (!board) throw new CloudError("senders 문서에 매장 열쇠(board)가 없습니다.", 403);
  saveSession({ email: em, name: name.trim() || em.split("@")[0], refresh: r.refreshToken, board });
}

export function logout() {
  token = null;
  saveSession(null);
}

async function idToken(): Promise<string> {
  const s = session();
  if (!s) throw new CloudError("로그인해 주세요.", 401);
  if (token && Date.now() < token.until) return token.id;
  const r = await http(`https://securetoken.googleapis.com/v1/token?key=${env.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(s.refresh)}`,
  });
  token = { id: r.id_token, until: Date.now() + 3300_000 };
  if (r.refresh_token && r.refresh_token !== s.refresh) saveSession({ ...s, refresh: r.refresh_token });
  return token.id;
}

/** 현장 태블릿 주소의 열쇠 (매장 열쇠가 아니라 태블릿 전용 열쇠 — 직원이 매출 보고를 열 수 없게) */
export function tabletKey(): string | null {
  const m = location.pathname.match(/\/d1\/([A-Za-z0-9_-]{16,64})/);
  return m ? m[1] : null;
}
export const tabletUrl = (floor: string) => `${location.origin}/d1/${floor}/`;

const randomKey = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[b % 62]).join("");

async function readJson<T>(board: string, coll: string, date: string, auth: boolean): Promise<T | null> {
  try {
    const headers: Record<string, string> = auth ? { Authorization: `Bearer ${await idToken()}` } : {};
    const doc = await http(`${docs()}/boards/${board}/${coll}/${date}${auth ? "" : `?key=${env.apiKey}`}`, { headers });
    const j = doc.fields?.json?.stringValue;
    return j ? (JSON.parse(j) as T) : null;
  } catch (e) {
    if ((e as CloudError).status === 404) return null;
    throw e;
  }
}

export function cloudApi(board: string, auth: boolean): Api {
  return {
    kind: "cloud",
    plan: async (date) => asPlan(await readJson<PlanDoc>(board, "plans", date, auth)),
    order: async (date) => asOrder(await readJson<OrderDoc>(board, "orders", date, auth)),
    async report(date) {
      try {
        const headers: Record<string, string> = auth ? { Authorization: `Bearer ${await idToken()}` } : {};
        const doc = await http(`${docs()}/boards/${board}/reports/${date}${auth ? "" : `?key=${env.apiKey}`}`, { headers });
        const v = doc.fields?.cafe?.stringValue;
        const cafe = v ? JSON.parse(v).p : null;
        return cafe ? { date, cafe } : null;
      } catch (e) {
        if ((e as CloudError).status === 404) return null;
        throw e;
      }
    },
    async confirm(date, kind, lines, by) {
      const doc = asOrder(await readJson<OrderDoc>(board, "orders", date, true)) || emptyOrder(date);
      doc[kind] = put(doc[kind], lines, by);
      await patchJson(`${docs()}/boards/${board}/orders/${date}`, date, doc);
      // 현장 태블릿 복사본도 (수량 · 상태만)
      const fk = await this.floorKey!();
      const plan = asPlan(await readJson<PlanDoc>(board, "plans", date, true));
      await patchJson(`${docs()}/floor/${fk}/days/${date}`, date, floorCopy(plan, doc));
      return doc;
    },
    async floorKey() {
      if (floorCache) return floorCache;
      const auth = { Authorization: `Bearer ${await idToken()}` };
      try {
        const doc = await http(`${docs()}/boards/${board}/config/floor`, { headers: auth });
        const k = String(doc.fields?.key?.stringValue || "");
        if (k) return (floorCache = k);
      } catch (e) {
        if ((e as CloudError).status !== 404) throw e;
      }
      // 처음 — 태블릿 열쇠를 만들고 (floor/{열쇠} = 이 매장), 매장 설정에 적어 둠
      const k = randomKey();
      const now = new Date().toISOString();
      await http(`${docs()}/floor?documentId=${k}`, { method: "POST", headers: { "Content-Type": "application/json", ...auth }, body: JSON.stringify({ fields: { board: { stringValue: board }, at: { timestampValue: now } } }) });
      await http(`${docs()}/boards/${board}/config/floor`, { method: "PATCH", headers: { "Content-Type": "application/json", ...auth }, body: JSON.stringify({ fields: { key: { stringValue: k }, at: { timestampValue: now } } }) });
      floorCache = k;
      // 이미 있는 계획 · 확정을 태블릿에 옮겨 둠 (어제 ~ 열흘 뒤)
      const today = nowKst().date;
      for (let i = -1; i <= 10; i++) {
        const d = addDays(today, i);
        const [p, o] = await Promise.all([readJson<PlanDoc>(board, "plans", d, true), readJson<OrderDoc>(board, "orders", d, true)]);
        const plan = asPlan(p);
        const order = asOrder(o);
        if (plan || order) await patchJson(`${docs()}/floor/${k}/days/${d}`, d, floorCopy(plan, order));
      }
      return k;
    },
  };
}
let floorCache = "";

/** { date, at, json } 문서 쓰기 */
async function patchJson(url: string, date: string, json: unknown) {
  await http(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
    body: JSON.stringify({ fields: { date: { stringValue: date }, at: { timestampValue: new Date().toISOString() }, json: { stringValue: JSON.stringify(json) } } }),
  });
}

/** 현장 태블릿 — 태블릿 열쇠로 floor/{열쇠}/days/{날짜} 복사본만 읽음 (로그인 없음) */
export function floorApi(fk: string): Api {
  const day = async (date: string): Promise<{ plan: PlanDoc | null; order: OrderDoc | null }> => {
    try {
      const doc = await http(`${docs()}/floor/${fk}/days/${date}?key=${env.apiKey}`);
      const j = JSON.parse(doc.fields?.json?.stringValue || "{}");
      return { plan: asPlan(j.plan), order: asOrder(j.order) };
    } catch (e) {
      if ((e as CloudError).status === 404) return { plan: null, order: null };
      throw e;
    }
  };
  return {
    kind: "cloud",
    plan: async (date) => (await day(date)).plan,
    order: async (date) => (await day(date)).order,
    report: async () => null,
    confirm: async () => {
      throw new CloudError("현장 태블릿에서는 확정할 수 없습니다.");
    },
  };
}

/** 확정 줄 더하기 */
function put(old: Record<string, OrderLine>, lines: Record<string, number>, by: string): Record<string, OrderLine> {
  const at = new Date().toISOString();
  const out = { ...old };
  for (const [name, qty] of Object.entries(lines)) out[name] = { qty: Math.max(0, Math.round(Number(qty) || 0)), by, at };
  return out;
}

/* ---------- 체험판 ---------- */
export function demoApi(): Api {
  const today = nowKst().date;
  const board = new Board(sampleUntilYesterday(today));
  const plans = new Map<string, PlanDoc>();
  const orders = new Map<string, OrderDoc>();
  const KEY = "bakery.demo.orders.v2";
  try {
    for (const o of Object.values(JSON.parse(localStorage.getItem(KEY) || "{}"))) {
      const x = asOrder(o);
      if (x) orders.set(x.date, x);
    }
  } catch {
    /* 처음 */
  }
  // 지난 3주 동안 이 방식으로 돌았다고 치고 계획을 미리 세움 (목요일 주간 · 매일 최종, 확정은 안 한 채로 → 자동)
  for (const d of [...Array(21).keys()].reverse().map((k) => addDays(today, -k))) {
    const asOf = addDays(d, -1);
    if (weekday(d) === WEEK_PLAN_WEEKDAY) for (const w of makeWeek(board, {}, DEFAULT_LEARNED, d, asOf)) plans.set(w.date, { ...(plans.get(w.date) || { v: 2, date: w.date }), week: w.week, ...(w.outlook ? { outlook: w.outlook } : {}) });
    const t = addDays(d, FINAL_LEAD);
    const f = makeFinal(board, {}, DEFAULT_LEARNED, d, asOf, plans.get(t) || null, orders.get(t) || null);
    if (f) plans.set(t, { ...plans.get(t)!, final: f });
  }
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(orders)));
    } catch {
      /* 이번만 */
    }
  };
  return {
    kind: "demo",
    plan: async (date) => plans.get(date) || null,
    order: async (date) => orders.get(date) || null,
    report: async (date) => board.report(date) || null,
    async confirm(date, kind, lines, by) {
      const doc = orders.get(date) || emptyOrder(date);
      doc[kind] = put(doc[kind], lines, by);
      orders.set(date, doc);
      save();
      return doc;
    },
  };
}
