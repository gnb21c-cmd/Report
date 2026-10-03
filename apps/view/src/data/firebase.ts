/* ============================================================
   클라우드 보관함(Firebase) 읽기 — 로그인 없음, 읽기만
   - 설치 주소 https://<프로젝트>.web.app/b/<열쇠>/ 의 '열쇠'로 그 매장 자료(boards/<열쇠>)를 읽음
     → 이 주소로 설치한 폰은 누구나 봄 (주소를 밖에 퍼뜨리지 않기. 새면 열쇠를 바꿈 — docs/SETUP.md)
   - reports/<날짜>: 직원 PC 의 A 가 올린 그날 조각 (칸 cafe · kids · naver, 각자 맡은 칸만 바뀜)
     마지막으로 받은 뒤 새로 올라온 것만 (at 기준) → 폰 안(IndexedDB)에 쌓아 둠
   - weather/<날짜>: GitHub 가 1시간마다 기상청에서 받아 올린 날씨 (apps/weather)
   A 가 쓰는 모양: apps/entry/src/cloud.ts writePieces
   ============================================================ */
import type { DayReport, DayWeather, WeatherKey } from "@report/core";
import type { Source } from "./source";

export interface FirebaseConfig {
  apiKey: string;
  projectId: string;
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

/** reports 문서 → 보고 자료. 칸 cafe · kids · naver = 조각 JSON {p, by, at, file} (A 가 보낸 칸만 바뀜 — apps/entry/src/cloud.ts) */
export function toReport(f: Record<string, any>): DayReport | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || "")) return null;
  const r: DayReport = { date: f.date, meta: {}, at: f.at || undefined };
  let any = false;
  for (const k of ["cafe", "kids", "naver"] as const) {
    if (!f[k]) continue;
    try {
      const x = JSON.parse(f[k]);
      if (!x || !x.p) continue;
      (r as any)[k] = x.p;
      r.meta![k] = { by: x.by || "", at: x.at || "", ...(x.file ? { file: x.file } : {}) };
      any = true;
    } catch {
      /* 깨진 칸은 건너뜀 */
    }
  }
  return any ? r : null;
}

/** at(올린 시각) 이 after 뒤인 문서들 — 오래된 것부터 */
async function since(cfg: FirebaseConfig, board: string, coll: string, after: string | null): Promise<{ docs: Record<string, any>[]; last: string | null }> {
  const docs: Record<string, any>[] = [];
  let cursor = after;
  for (let page = 0; page < 40; page++) {
    const query: any = { structuredQuery: { from: [{ collectionId: coll }], orderBy: [{ field: { fieldPath: "at" }, direction: "ASCENDING" }], limit: 300 } };
    if (cursor) query.structuredQuery.where = { fieldFilter: { field: { fieldPath: "at" }, op: "GREATER_THAN", value: { timestampValue: cursor } } };
    const res = await call(`${base(cfg, board)}:runQuery?key=${cfg.apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query) });
    const got = (Array.isArray(res) ? res : []).map((r: any) => r.document).filter(Boolean);
    for (const d of got) {
      const f = fieldsOf(d);
      cursor = f.at || cursor;
      docs.push(f);
    }
    if (got.length < 300) break;
  }
  return { docs, last: cursor };
}

export function weatherOf(f: Record<string, any>): DayWeather | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || "")) return null;
  return { date: f.date, key: f.key as WeatherKey, label: f.label, icon: f.icon, tempMax: f.tempMax ?? null, tempMin: f.tempMin ?? null, rainMm: f.rainMm ?? null, source: f.source === "observed" ? "observed" : "forecast" };
}

export function firebaseSource(cfg: FirebaseConfig, board: string): Source {
  return {
    kind: "cloud",
    async reports(after) {
      const { docs, last } = await since(cfg, board, "reports", after);
      return { reports: docs.map(toReport).filter((r): r is DayReport => !!r), last };
    },
    async weather(after) {
      const { docs, last } = await since(cfg, board, "weather", after);
      return { days: docs.map(weatherOf).filter((w): w is DayWeather => !!w), last };
    },
    async status() {
      return null;
    },
  };
}
