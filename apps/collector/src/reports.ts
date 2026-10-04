/* 클라우드 읽기 — 보고(reports) · 날씨(weather) · 설정(settings/main) 전부. 보고 앱 data/firebase.ts 와 같은 모양 (매장 열쇠 경로라 읽기는 로그인 없이) */
import { cleanSettings, type DayReport, type DayWeather, type ReportSettings, type WeatherKey, type WeatherMap } from "@report/core";

export interface ReadCfg {
  apiKey: string;
  projectId: string;
  board: string;
}

const base = (c: ReadCfg) => `https://firestore.googleapis.com/v1/projects/${c.projectId}/databases/(default)/documents/boards/${c.board}`;

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

async function call(url: string, init: RequestInit = {}) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`클라우드 읽기 오류 ${res.status}`);
  return body;
}

/** 모음 전부 — 문서 이름 순 300개씩 */
async function all(c: ReadCfg, coll: string): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = [];
  let last: string | null = null;
  for (let n = 0; n < 100; n++) {
    const q: any = { structuredQuery: { from: [{ collectionId: coll }], orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }], limit: 300 } };
    if (last) q.structuredQuery.startAt = { values: [{ referenceValue: last }], before: false };
    const res = await call(`${base(c)}:runQuery?key=${c.apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(q) });
    const docs = (Array.isArray(res) ? res : []).map((r: any) => r.document).filter(Boolean);
    for (const d of docs) out.push(fieldsOf(d));
    if (docs.length < 300) break;
    last = docs[docs.length - 1].name;
  }
  return out;
}

export function toReport(f: Record<string, any>): DayReport | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || "")) return null;
  const r: DayReport = { date: f.date, meta: {} };
  let any = false;
  for (const k of ["cafe", "kids", "naver", "cash", "extra"] as const) {
    if (!f[k]) continue;
    try {
      const x = JSON.parse(f[k]);
      if (!x?.p) continue;
      (r as any)[k] = x.p;
      r.meta![k] = { by: x.by || "", at: x.at || "" };
      any = true;
    } catch {
      /* 깨진 칸은 건너뜀 */
    }
  }
  return any ? r : null;
}

export async function readAll(c: ReadCfg): Promise<{ reports: DayReport[]; weather: WeatherMap; settings: ReportSettings | null }> {
  const reports = (await all(c, "reports")).map(toReport).filter((r): r is DayReport => !!r);
  const weather: WeatherMap = {};
  for (const f of await all(c, "weather")) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || "")) continue;
    weather[f.date] = { date: f.date, key: f.key as WeatherKey, label: f.label, icon: f.icon, tempMax: f.tempMax ?? null, tempMin: f.tempMin ?? null, rainMm: f.rainMm ?? null, source: f.source === "observed" ? "observed" : "forecast" } as DayWeather;
  }
  let settings: ReportSettings | null = null;
  try {
    const doc = await call(`${base(c)}/settings/main?key=${c.apiKey}`);
    const f = fieldsOf(doc);
    settings = f.json ? cleanSettings(JSON.parse(f.json)) : null;
  } catch {
    /* 설정 없음 = 기본값 */
  }
  return { reports, weather, settings };
}
