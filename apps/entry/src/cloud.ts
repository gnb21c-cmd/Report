/* ============================================================
   클라우드 보관함(Firebase) — A 가 직접 올림 (사무실 PC C 없이)
   - 로그인: 직원 계정(이메일 · 비밀번호, Firebase 콘솔에서 만든 것) → 1시간짜리 출입증. 다시 로그인하지 않게 갱신 표만 이 PC 에 둠
   - 매장 열쇠: senders/{이메일}.board (콘솔에서 넣은 값) — 직원이 열쇠를 몰라도 됨
   - 보고: boards/{열쇠}/reports/{날짜} — 칸 cafe · kids · naver · cash(자금) 에 조각 JSON({p, by, at, file}), 보낸 칸만 바꿈 (각자 맡은 칸만 넣어도 합쳐짐)
   - 정리한 영수증 줄: boards/{열쇠}/lines/{날짜}_{매장} (규칙이 바뀌면 다시 계산용, 폰은 안 읽음)
   - 상품 분류표: boards/{열쇠}/config/products (table = JSON)
   - 날씨: boards/{열쇠}/weather/{날짜} (GitHub 가 1시간마다 기상청에서 받아 넣음 — apps/weather)
   B 가 읽는 쪽: apps/view/src/data/firebase.ts toReport
   ============================================================ */
import type { CashPart, DayReport, DayWeather, NaverPart, StorePart } from "@report/core";

export interface CloudConfig {
  apiKey: string;
  projectId: string;
}

export function cloudConfig(): CloudConfig | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  return apiKey && projectId ? { apiKey, projectId } : null;
}

export class CloudError extends Error {
  constructor(
    msg: string,
    readonly status = 0,
  ) {
    super(msg);
  }
}

const SESSION = "entry.session";
interface Session {
  email: string;
  refresh: string;
  board: string;
}
let token: { id: string; until: number } | null = null;

function loadSession(): Session | null {
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

export function sessionEmail(): string | null {
  return loadSession()?.email || null;
}

async function http(url: string, init: RequestInit = {}): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new CloudError("인터넷에 연결하지 못했습니다. 연결을 확인하고 다시 해 주세요 (입력은 임시저장해 둘 수 있습니다).");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = String(body?.error?.message || body?.[0]?.error?.message || res.status);
    if (/INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND/.test(raw)) throw new CloudError("이메일이나 비밀번호가 맞지 않습니다.", 401);
    if (/TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_NOT_FOUND|USER_DISABLED/.test(raw)) throw new CloudError("다시 로그인해 주세요.", 401);
    if (res.status === 401) throw new CloudError("다시 로그인해 주세요.", 401);
    if (res.status === 403 || /PERMISSION/.test(raw)) throw new CloudError("이 계정으로는 올릴 수 없습니다 — Firebase senders 명단에 이 이메일과 매장 열쇠(board)가 있는지 확인해 주세요.", 403);
    if (res.status === 404) throw Object.assign(new CloudError("없음", 404), { notFound: true });
    throw new CloudError(`클라우드 오류 (${raw.slice(0, 120)})`, res.status);
  }
  return body;
}

/* ---------- 로그인 ---------- */

export async function login(cfg: CloudConfig, email: string, password: string): Promise<string> {
  const r = await http(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${cfg.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim(), password, returnSecureToken: true }),
  });
  token = { id: r.idToken, until: Date.now() + (Number(r.expiresIn) || 3600) * 1000 - 300_000 };
  const em = String(r.email || email).trim().toLowerCase();
  let board = "";
  try {
    const doc = await http(`${docsBase(cfg)}/senders/${encodeURIComponent(em)}`, { headers: { Authorization: `Bearer ${r.idToken}` } });
    board = String(plain(doc.fields?.board) || "");
  } catch (e) {
    if ((e as any).notFound) throw new CloudError("이 계정이 올리기 명단(senders)에 없습니다 — Firebase 콘솔에서 senders 문서를 만들어 주세요.", 403);
    throw e;
  }
  if (!board) throw new CloudError("senders 문서에 매장 열쇠(board)가 없습니다.", 403);
  saveSession({ email: em, refresh: r.refreshToken, board });
  return em;
}

export function logout() {
  token = null;
  saveSession(null);
}

async function idToken(cfg: CloudConfig): Promise<{ id: string; board: string }> {
  const s = loadSession();
  if (!s) throw new CloudError("로그인해 주세요.", 401);
  if (token && Date.now() < token.until) return { id: token.id, board: s.board };
  const r = await http(`https://securetoken.googleapis.com/v1/token?key=${cfg.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(s.refresh)}`,
  }).catch((e) => {
    if (e instanceof CloudError && e.status === 401) saveSession(null);
    throw e;
  });
  token = { id: r.id_token, until: Date.now() + (Number(r.expires_in) || 3600) * 1000 - 300_000 };
  if (r.refresh_token && r.refresh_token !== s.refresh) saveSession({ ...s, refresh: r.refresh_token });
  return { id: token.id, board: s.board };
}

/* ---------- Firestore REST ---------- */

const docsBase = (cfg: CloudConfig) => `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents`;

function plain(v: any): any {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  return null;
}
const fieldsOf = (doc: any) => Object.fromEntries(Object.entries(doc?.fields || {}).map(([k, v]) => [k, plain(v)]));
const str = (s: string) => ({ stringValue: s });

export const PARTS = ["cafe", "kids", "naver", "cash"] as const;
export type PartKind = (typeof PARTS)[number];

/** 보고 문서 → 그날 보고 (B 와 같은 읽기) */
export function reportOf(date: string, f: Record<string, any>): DayReport | null {
  const r: DayReport = { date, meta: {}, at: f.at || undefined };
  let any = false;
  for (const k of PARTS) {
    if (!f[k]) continue;
    try {
      const x = JSON.parse(f[k]);
      (r as any)[k] = x.p;
      r.meta![k] = { by: x.by || "", at: x.at || "", ...(x.file ? { file: x.file } : {}) };
      any = true;
    } catch {
      /* 깨진 칸은 건너뜀 */
    }
  }
  return any ? r : null;
}

async function get(cfg: CloudConfig, path: string): Promise<Record<string, any> | null> {
  const t = await idToken(cfg);
  try {
    return fieldsOf(await http(`${docsBase(cfg)}/boards/${t.board}/${path}`, { headers: { Authorization: `Bearer ${t.id}` } }));
  } catch (e) {
    if ((e as any).notFound) return null;
    throw e;
  }
}

export async function readDay(cfg: CloudConfig, date: string): Promise<{ report: DayReport | null; weather: DayWeather | null }> {
  const [f, w] = await Promise.all([get(cfg, `reports/${date}`), get(cfg, `weather/${date}`)]);
  const weather = w && w.date ? ({ date: w.date, key: w.key, label: w.label, icon: w.icon, tempMax: w.tempMax ?? null, tempMin: w.tempMin ?? null, rainMm: w.rainMm ?? null, source: w.source === "observed" ? "observed" : "forecast" } as DayWeather) : null;
  return { report: f ? reportOf(date, f) : null, weather };
}

/** 여러 날 보고 한꺼번에 읽기 (지난 자료 넣기 전에 이미 있는 칸 확인) */
export async function readDays(cfg: CloudConfig, dates: string[]): Promise<Map<string, DayReport>> {
  const t = await idToken(cfg);
  const out = new Map<string, DayReport>();
  const root = `projects/${cfg.projectId}/databases/(default)/documents/boards/${t.board}/reports`;
  for (let i = 0; i < dates.length; i += 300) {
    const res = await http(`${docsBase(cfg)}:batchGet`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t.id}` },
      body: JSON.stringify({ documents: dates.slice(i, i + 300).map((d) => `${root}/${d}`) }),
    });
    for (const x of Array.isArray(res) ? res : []) {
      if (!x.found) continue;
      const date = String(x.found.name).split("/").pop()!;
      const r = reportOf(date, fieldsOf(x.found));
      if (r) out.set(date, r);
    }
  }
  return out;
}

export type Piece = { kind: PartKind; date: string; part: StorePart | NaverPart | CashPart; file?: string };

/** 조각 쓰기 — 보낸 칸(cafe · kids · naver · cash)만 바꿈. 400개씩 한 번에 (commit) */
export async function writePieces(cfg: CloudConfig, by: string, pieces: Piece[], lines?: { date: string; store: string; lines: unknown[] }[]): Promise<void> {
  const t = await idToken(cfg);
  const root = `projects/${cfg.projectId}/databases/(default)/documents/boards/${t.board}`;
  const now = new Date().toISOString();
  const writes: any[] = [];
  // 같은 날짜의 조각은 한 번에 (문서 하나)
  const byDate = new Map<string, Piece[]>();
  for (const p of pieces) byDate.set(p.date, [...(byDate.get(p.date) || []), p]);
  for (const [date, ps] of byDate) {
    const fields: Record<string, any> = { date: str(date), at: { timestampValue: now } };
    for (const p of ps) fields[p.kind] = str(JSON.stringify({ p: p.part, by, at: now, ...(p.file ? { file: p.file } : {}) }));
    writes.push({ update: { name: `${root}/reports/${date}`, fields }, updateMask: { fieldPaths: Object.keys(fields) } });
  }
  for (const l of lines || []) writes.push({ update: { name: `${root}/lines/${l.date}_${l.store}`, fields: { date: str(l.date), store: str(l.store), lines: str(JSON.stringify(l.lines)), at: { timestampValue: now } } } });
  for (let i = 0; i < writes.length; i += 400)
    await http(`${docsBase(cfg)}:commit`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t.id}` }, body: JSON.stringify({ writes: writes.slice(i, i + 400) }) });
}

export async function readProducts(cfg: CloudConfig): Promise<Record<string, string>> {
  const f = await get(cfg, "config/products");
  try {
    return f?.table ? JSON.parse(f.table) : {};
  } catch {
    return {};
  }
}

/** 분류표에 더하기 (있던 것 + 새것) */
export async function addProducts(cfg: CloudConfig, add: Record<string, string>): Promise<void> {
  if (!Object.keys(add).length) return;
  const t = await idToken(cfg);
  const table = { ...(await readProducts(cfg)), ...add };
  await http(`${docsBase(cfg)}/boards/${t.board}/config/products?updateMask.fieldPaths=table&updateMask.fieldPaths=at`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t.id}` },
    body: JSON.stringify({ fields: { table: str(JSON.stringify(table)), at: { timestampValue: new Date().toISOString() } } }),
  });
}
