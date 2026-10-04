/* ============================================================
   작업지시 자료 — 클라우드(Firebase) 의 plans/{날짜} (16시 계획) · orders/{날짜} (매니저 확정)
   - D(매니저): 이메일 · 비밀번호 로그인 → senders 명단의 매장 열쇠로 읽고 씀
   - D-1(현장 태블릿): 주소 /d1/<열쇠>/ 의 열쇠로 읽기만 (로그인 없음)
   - 체험판: 가짜 실적으로 계획을 바로 세고, 확정은 이 브라우저에만 저장
   ============================================================ */
import { addDays, Board, DEFAULT_LEARNED, makePlans, nowKst, sampleUntilYesterday, type DayReport, type OrderDoc, type OrderLine, type PlanDoc } from "@report/core";

export interface Api {
  kind: "cloud" | "demo";
  plan(date: string): Promise<PlanDoc | null>;
  order(date: string): Promise<OrderDoc | null>;
  /** 그날 카페 실적 (빵 판매 · 50% 할인) — 매출 금액은 화면에 쓰지 않음 */
  report(date: string): Promise<DayReport | null>;
  /** 빵 몇 개를 확정 (있던 확정에 더해 씀) */
  confirm(date: string, lines: Record<string, number>, by: string): Promise<OrderDoc>;
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

/** 현장 태블릿 주소의 열쇠 */
export function tabletKey(): string | null {
  const m = location.pathname.match(/\/d1\/([A-Za-z0-9_-]{16,64})/);
  return m ? m[1] : null;
}
export const tabletUrl = (board: string) => `${location.origin}/d1/${board}/`;

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
    plan: (date) => readJson<PlanDoc>(board, "plans", date, auth),
    order: (date) => readJson<OrderDoc>(board, "orders", date, auth),
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
    async confirm(date, lines, by) {
      const old = (await readJson<OrderDoc>(board, "orders", date, true)) || { v: 1 as const, date, items: {} };
      const at = new Date().toISOString();
      const items: Record<string, OrderLine> = { ...old.items };
      for (const [name, qty] of Object.entries(lines)) items[name] = { qty: Math.max(0, Math.round(qty)), by, at };
      const doc: OrderDoc = { v: 1, date, items };
      await http(`${docs()}/boards/${board}/orders/${date}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
        body: JSON.stringify({ fields: { date: { stringValue: date }, at: { timestampValue: at }, json: { stringValue: JSON.stringify(doc) } } }),
      });
      return doc;
    },
  };
}

/* ---------- 체험판 ---------- */
export function demoApi(): Api {
  const today = nowKst().date;
  const board = new Board(sampleUntilYesterday(today));
  const plans = new Map<string, PlanDoc>();
  // 그제 · 어제 · 오늘 16시에 센 계획 (오늘 · 내일은 이미 확정 기준일이 지남)
  for (const k of [2, 1, 0]) {
    const day = addDays(today, -k);
    for (const p of makePlans(board, {}, DEFAULT_LEARNED, day, addDays(day, -1), (d) => plans.get(d))) plans.set(p.date, p);
  }
  const KEY = "bakery.demo.orders";
  const load = (): Record<string, OrderDoc> => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "{}");
    } catch {
      return {};
    }
  };
  return {
    kind: "demo",
    plan: async (date) => plans.get(date) || null,
    report: async (date) => board.report(date) || null,
    order: async (date) => load()[date] || null,
    async confirm(date, lines, by) {
      const all = load();
      const old = all[date] || { v: 1 as const, date, items: {} };
      const at = new Date().toISOString();
      for (const [name, qty] of Object.entries(lines)) old.items[name] = { qty: Math.max(0, Math.round(qty)), by, at };
      all[date] = old;
      try {
        localStorage.setItem(KEY, JSON.stringify(all));
      } catch {
        /* 이번만 */
      }
      return old;
    },
  };
}
