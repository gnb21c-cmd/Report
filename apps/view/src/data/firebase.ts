/* ============================================================
   클라우드 보관함(Firebase) 읽기·쓰기 — 로그인 없음
   - 설치 주소 https://<프로젝트>.web.app/b/<열쇠>/ 의 '열쇠'로 그 매장 자료(boards/<열쇠>)를 읽음
     → 이 주소로 설치한 폰은 누구나 봄 (주소를 밖에 퍼뜨리지 않기. 새면 열쇠를 바꿈 — docs/SETUP.md)
   - 받기: days 중 마지막으로 받은 뒤 새로 온 것만 (sentAt 기준) → 폰 안(IndexedDB)에 쌓아 둠
   - 쓰기: 네이버 입장권 고친 값(adjust/<날짜>)만. 매출(days)은 POS PC 계정만 쓸 수 있음 (firebase/firestore.rules)
   A 가 쓰는 모양: apps/sender/src/report_sender/relay.py day_doc
   ============================================================ */
import type { Adjusts, DayBatch, DayWeather, KidsAdjust, PosId, SaleLine, WeatherKey } from "@report/core";

export interface FirebaseConfig {
  apiKey: string;
  projectId: string;
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

export function firebaseConfig(): FirebaseConfig | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  return apiKey && projectId ? { apiKey, projectId } : null;
}

const KEY_STORE = "report.board";

/** 설치 주소의 열쇠 (/b/<열쇠>/). 주소에 없으면 전에 열었던 열쇠 */
export function boardKey(): string | null {
  const m = location.pathname.match(/\/b\/([A-Za-z0-9_-]{16,64})/);
  try {
    if (m) {
      localStorage.setItem(KEY_STORE, m[1]);
      return m[1];
    }
    return localStorage.getItem(KEY_STORE);
  } catch {
    return m ? m[1] : null;
  }
}

async function call(url: string, init: RequestInit = {}): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("인터넷에 연결하지 못했습니다. 폰에 저장된 자료로 보여 드립니다.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = String(body?.error?.message || body?.[0]?.error?.message || res.status);
    if (res.status === 403 || /PERMISSION/.test(raw)) throw new Error("이 주소로는 자료를 볼 수 없습니다. 설치 주소를 다시 확인해 주세요.");
    throw new Error(`클라우드 보관함 오류 (${raw.slice(0, 120)})`);
  }
  return body;
}

const base = (cfg: FirebaseConfig, board: string) => `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/boards/${board}`;

/** Firestore REST 값 → 자바스크립트 값 */
function plain(v: any): any {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  return null;
}
function fieldsOf(doc: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(doc?.fields || {})) out[k] = plain(v);
  return out;
}
const idOf = (doc: any) => String(doc?.name || "").split("/").pop() || "";

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
export async function fetchDays(cfg: FirebaseConfig, board: string, after: string | null): Promise<DayBatch[]> {
  const out: DayBatch[] = [];
  let cursor = after;
  for (let page = 0; page < 30; page++) {
    const query: any = {
      structuredQuery: {
        from: [{ collectionId: "days" }],
        orderBy: [{ field: { fieldPath: "sentAt" }, direction: "ASCENDING" }],
        limit: 300,
      },
    };
    if (cursor) query.structuredQuery.where = { fieldFilter: { field: { fieldPath: "sentAt" }, op: "GREATER_THAN", value: { timestampValue: cursor } } };
    const res = await call(`${base(cfg, board)}:runQuery?key=${cfg.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

async function list(cfg: FirebaseConfig, board: string, coll: string): Promise<any[]> {
  const out: any[] = [];
  let token = "";
  for (let page = 0; page < 20; page++) {
    const res = await call(`${base(cfg, board)}/${coll}?key=${cfg.apiKey}&pageSize=300${token ? `&pageToken=${token}` : ""}`);
    out.push(...(res.documents || []));
    token = res.nextPageToken || "";
    if (!token) break;
  }
  return out;
}

export async function fetchDevices(cfg: FirebaseConfig, board: string): Promise<DeviceStatus[]> {
  return (await list(cfg, board, "devices")).map((d) => {
    const f = fieldsOf(d);
    return { pos: idOf(d) as PosId, at: f.at || "", lastDate: f.lastDate || "", pending: f.pending || 0, lastError: f.lastError || "", source: f.source || "", version: f.version || "" };
  });
}

export async function fetchAdjusts(cfg: FirebaseConfig, board: string): Promise<Adjusts> {
  const out: Adjusts = {};
  for (const d of await list(cfg, board, "adjust")) {
    const f = fieldsOf(d);
    if (Number.isFinite(f.naver)) out[idOf(d)] = { naver: f.naver, by: f.by || "", at: f.at || "" };
  }
  return out;
}

/** 네이버 입장권 고친 값 저장 (null 이면 POS 값으로 되돌림) */
export async function saveAdjust(cfg: FirebaseConfig, board: string, date: string, adj: KidsAdjust | null): Promise<void> {
  const url = `${base(cfg, board)}/adjust/${date}?key=${cfg.apiKey}`;
  if (!adj) {
    await call(url, { method: "DELETE" });
    return;
  }
  await call(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        naver: { integerValue: String(Math.max(0, Math.round(adj.naver))) },
        by: { stringValue: (adj.by || "").slice(0, 20) },
        at: { timestampValue: new Date().toISOString() },
      },
    }),
  });
}

/** 날씨 — at(올린 시각) 이 after 뒤인 것만 (처음이면 전부). A 가 기상청에서 받아 쌓아 둔 값 */
export async function fetchWeather(cfg: FirebaseConfig, board: string, after: string | null): Promise<{ days: DayWeather[]; last: string | null }> {
  const days: DayWeather[] = [];
  let cursor = after;
  for (let page = 0; page < 20; page++) {
    const query: any = { structuredQuery: { from: [{ collectionId: "weather" }], orderBy: [{ field: { fieldPath: "at" }, direction: "ASCENDING" }], limit: 300 } };
    if (cursor) query.structuredQuery.where = { fieldFilter: { field: { fieldPath: "at" }, op: "GREATER_THAN", value: { timestampValue: cursor } } };
    const res = await call(`${base(cfg, board)}:runQuery?key=${cfg.apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query) });
    const got = (Array.isArray(res) ? res : []).map((r: any) => r.document).filter(Boolean);
    for (const d of got) {
      const f = fieldsOf(d);
      cursor = f.at || cursor;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || "")) continue;
      days.push({ date: f.date, key: f.key as WeatherKey, label: f.label, icon: f.icon, tempMax: f.tempMax ?? null, tempMin: f.tempMin ?? null, rainMm: f.rainMm ?? null, source: f.source === "observed" ? "observed" : "forecast" });
    }
    if (got.length < 300) break;
  }
  return { days, last: cursor };
}
