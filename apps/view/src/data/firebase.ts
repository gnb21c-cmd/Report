/* ============================================================
   클라우드 보관함(Firebase) 읽기 — 우리가 운영하는 서버 없이, A 가 올린 하루치를 받아 옴
   - 로그인: 관리자 이메일·비밀번호 (Firebase 콘솔에서 만든 계정 5개) → 출입증(idToken), 다시 받기용 refreshToken 은 폰에 저장
   - 받기: days 중 마지막으로 받은 뒤 새로 온 것만 (sentAt 기준) → 폰 안(IndexedDB)에 쌓아 둠 → 인터넷 없어도 지난 보고를 봄
   - 보안 규칙(firebase/firestore.rules): viewers/{이메일} 에 있는 사람만 읽기
   A 가 쓰는 모양: apps/sender/src/report_sender/relay.py day_doc
   ============================================================ */
import type { DayBatch, PosId, SaleLine } from "@report/core";

export interface FirebaseConfig {
  apiKey: string;
  projectId: string;
}

export interface Session {
  email: string;
  idToken: string;
  refreshToken: string;
  /** idToken 만료 시각 (ms) */
  expires: number;
}

export interface DeviceStatus {
  pos: PosId;
  at: string;
  lastDate: string;
  pending: number;
  lastError: string;
  source: string;
  version: string;
}

export class FirebaseError extends Error {
  constructor(
    message: string,
    readonly auth = false,
  ) {
    super(message);
  }
}

export function firebaseConfig(): FirebaseConfig | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  return apiKey && projectId ? { apiKey, projectId } : null;
}

const LOGIN_MSG: Record<string, string> = {
  INVALID_LOGIN_CREDENTIALS: "이메일 또는 비밀번호가 맞지 않습니다.",
  INVALID_PASSWORD: "이메일 또는 비밀번호가 맞지 않습니다.",
  EMAIL_NOT_FOUND: "이메일 또는 비밀번호가 맞지 않습니다.",
  USER_DISABLED: "사용이 중지된 계정입니다.",
  TOO_MANY_ATTEMPTS_TRY_LATER: "잠시 뒤에 다시 시도해 주세요 (시도가 너무 많음).",
};

async function call(url: string, init: RequestInit): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new FirebaseError("인터넷에 연결하지 못했습니다. 저장된 자료로 보여 드립니다.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = String(body?.error?.message || body?.[0]?.error?.message || res.status);
    const key = raw.split(" ")[0];
    if (LOGIN_MSG[key]) throw new FirebaseError(LOGIN_MSG[key], true);
    if (res.status === 401 || res.status === 403 || /TOKEN|PERMISSION/.test(raw))
      throw new FirebaseError(res.status === 403 ? "이 계정은 보고를 볼 권한이 없습니다. 관리자에게 등록을 요청해 주세요." : "다시 로그인해 주세요.", true);
    throw new FirebaseError(`클라우드 보관함 오류 (${raw.slice(0, 120)})`);
  }
  return body;
}

export async function login(cfg: FirebaseConfig, email: string, password: string): Promise<Session> {
  const r = await call(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${cfg.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return { email: r.email, idToken: r.idToken, refreshToken: r.refreshToken, expires: Date.now() + (Number(r.expiresIn) - 300) * 1000 };
}

/** 출입증이 곧 만료면 새로 받음 */
export async function fresh(cfg: FirebaseConfig, s: Session): Promise<Session> {
  if (Date.now() < s.expires) return s;
  const r = await call(`https://securetoken.googleapis.com/v1/token?key=${cfg.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(s.refreshToken)}`,
  });
  return { email: s.email, idToken: r.id_token, refreshToken: r.refresh_token, expires: Date.now() + (Number(r.expires_in) - 300) * 1000 };
}

const docs = (cfg: FirebaseConfig) => `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents`;

/** Firestore REST 값 → 자바스크립트 값 */
function plain(v: any): any {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  return null;
}
function fieldsOf(doc: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(doc?.fields || {})) out[k] = plain(v);
  return out;
}

export function toBatch(doc: any): DayBatch | null {
  const f = fieldsOf(doc);
  if ((f.pos !== "cafe" && f.pos !== "kids") || !/^\d{4}-\d{2}-\d{2}$/.test(f.date || "")) return null;
  let rows: SaleLine[] = [];
  try {
    rows = JSON.parse(f.rows || "[]");
  } catch {
    rows = [];
  }
  return { pos: f.pos, date: f.date, rows, sentAt: f.sentAt || "", source: f.source || "" };
}

/** after(ISO) 뒤에 보낸 하루치들 (처음이면 전부) — 오래된 것부터 */
export async function fetchDays(cfg: FirebaseConfig, s: Session, after: string | null): Promise<DayBatch[]> {
  const out: DayBatch[] = [];
  let cursor = after;
  // 한 번에 300개씩 (처음 받을 때 1년치 ≈ 730개)
  for (let page = 0; page < 20; page++) {
    const query: any = {
      structuredQuery: {
        from: [{ collectionId: "days" }],
        orderBy: [{ field: { fieldPath: "sentAt" }, direction: "ASCENDING" }],
        limit: 300,
      },
    };
    if (cursor) query.structuredQuery.where = { fieldFilter: { field: { fieldPath: "sentAt" }, op: "GREATER_THAN", value: { timestampValue: cursor } } };
    const res = await call(`${docs(cfg)}:runQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.idToken}` },
      body: JSON.stringify(query),
    });
    const got = (Array.isArray(res) ? res : []).map((r: any) => r.document).filter(Boolean);
    for (const d of got) {
      const b = toBatch(d);
      if (b) out.push(b);
    }
    if (got.length < 300) break;
    cursor = out[out.length - 1].sentAt;
  }
  return out;
}

export async function fetchDevices(cfg: FirebaseConfig, s: Session): Promise<DeviceStatus[]> {
  const res = await call(`${docs(cfg)}/devices`, { headers: { Authorization: `Bearer ${s.idToken}` } });
  return (res.documents || []).map((d: any) => {
    const f = fieldsOf(d);
    return { pos: String(d.name).split("/").pop() as PosId, at: f.at || "", lastDate: f.lastDate || "", pending: f.pending || 0, lastError: f.lastError || "", source: f.source || "", version: f.version || "" };
  });
}

/** 보는 사람 명단에 있는지 (없으면 FirebaseError) */
export async function checkViewer(cfg: FirebaseConfig, s: Session): Promise<void> {
  await call(`${docs(cfg)}/viewers/${encodeURIComponent(s.email.toLowerCase())}`, { headers: { Authorization: `Bearer ${s.idToken}` } });
}
