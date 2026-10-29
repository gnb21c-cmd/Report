/* ============================================================
   클라우드 보관함(Firebase) 읽기 — 로그인 없음, 읽기만
   - 설치 주소 https://<프로젝트>.web.app/b/<열쇠>/ 의 '열쇠'로 그 매장 자료(boards/<열쇠>)를 읽음
     → 이 주소로 설치한 폰은 누구나 봄 (주소를 밖에 퍼뜨리지 않기. 새면 열쇠를 바꿈 — docs/SETUP.md)
   - reports/<날짜>: 직원 PC 의 A 가 올린 그날 조각 (칸 cafe · kids · naver, 각자 맡은 칸만 바뀜)
     마지막으로 받은 뒤 새로 올라온 것만 (at 기준) → 폰 안(IndexedDB)에 쌓아 둠
   - weather/<날짜>: GitHub 가 1시간마다 기상청에서 받아 올린 날씨 (apps/weather)
   A 가 쓰는 모양: apps/entry/src/cloud.ts writePieces
   ============================================================ */
import { addDays, asOrder, asPlan, cleanSettings, cleanSurveys, DESK_EVENT_PREFIX, DESK_LIVE, DESK_REVISIT, DESK_STATS, deskEventsFrom, deskRevisitOkFrom, mergeSurveyDocs, parseDeskEvent, parseDeskLive, parseDeskRevisit, SURVEY_INBOX, surveysFromInbox, todayKst, type DayReport, type DayWeather, type DeskLive, type DeskRevisit, type LiveDoc, type OrderDoc, type PlanDoc, type WeatherKey } from "@report/core";
import demoDeskLive from "./demoDeskLive.json";
import demoRevisit from "./demoRevisit.json";
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

/** reports 문서 → 보고 자료. 칸 cafe · kids · naver · cash · extra = 조각 JSON {p, by, at, file} (A 가 보낸 칸만 바뀜 — apps/entry/src/cloud.ts) */
export function toReport(f: Record<string, any>): DayReport | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || "")) return null;
  const r: DayReport = { date: f.date, meta: {}, at: f.at || undefined };
  let any = false;
  for (const k of ["cafe", "kids", "naver", "cash", "extra"] as const) {
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
  // 다음 묶음은 (올린 시각, 문서 이름) 바로 다음부터 — ④ 로 한꺼번에 넣으면 수백 개가 같은 시각이라, 시각만으로 이으면 300개 경계에서 나머지를 건너뜀
  let page: { at: string; name: string } | null = null;
  for (let n = 0; n < 200; n++) {
    const query: any = {
      structuredQuery: {
        from: [{ collectionId: coll }],
        orderBy: [
          { field: { fieldPath: "at" }, direction: "ASCENDING" },
          { field: { fieldPath: "__name__" }, direction: "ASCENDING" },
        ],
        limit: 300,
      },
    };
    if (after) query.structuredQuery.where = { fieldFilter: { field: { fieldPath: "at" }, op: "GREATER_THAN", value: { timestampValue: after } } };
    if (page) query.structuredQuery.startAt = { values: [{ timestampValue: page.at }, { referenceValue: page.name }], before: false };
    const res = await call(`${base(cfg, board)}:runQuery?key=${cfg.apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query) });
    const got = (Array.isArray(res) ? res : []).map((r: any) => r.document).filter(Boolean);
    for (const d of got) {
      const f = fieldsOf(d);
      cursor = f.at || cursor;
      if (f.at) page = { at: f.at, name: d.name };
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
    live: (date) => liveDoc(cfg, board, date),
    async status() {
      return null;
    },
    async settings() {
      try {
        const doc = await call(`${base(cfg, board)}/settings/main?key=${cfg.apiKey}`);
        const f = fieldsOf(doc);
        return f.json ? cleanSettings(JSON.parse(f.json)) : null;
      } catch {
        return null; // 아직 설정을 저장한 적 없음 (기본값)
      }
    },
    // 통합데스크 설문 — 키즈 POS 통합데스크가 바로 쓰는 보고함(surveyInbox, 설문마다 한 문서) + 예전 파일 수집(settings/surveys) 을 합침
    async surveys() {
      const legacy = async () => {
        try {
          const f = fieldsOf(await call(`${base(cfg, board)}/settings/surveys?key=${cfg.apiKey}`));
          return f.json ? cleanSurveys(JSON.parse(f.json)) : null;
        } catch {
          return null; // 예전 길로는 받은 적 없음
        }
      };
      const inbox = async () => {
        try {
          const res = await call(`${base(cfg, board)}/${SURVEY_INBOX}?pageSize=300&key=${cfg.apiKey}`, { cache: "no-store" });
          return surveysFromInbox((res?.documents || []).map(fieldsOf));
        } catch {
          return null; // 아직 통합데스크가 보낸 적 없음
        }
      };
      const [a, b] = await Promise.all([legacy(), inbox()]);
      return mergeSurveyDocs(a, b);
    },
    // 통합데스크 이벤트 입장 수 (2026-10-21) — deskStats 의 event-날짜 문서 모두 (하루 한 문서 · 손님 정보 없음)
    async deskEvents() {
      const docs: { id: string; json?: unknown }[] = [];
      let token = "";
      for (let n = 0; n < 30; n++) {
        const res = await call(`${base(cfg, board)}/${DESK_STATS}?pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ""}&key=${cfg.apiKey}`, { cache: "no-store" });
        for (const d of res?.documents || []) docs.push({ id: String(d.name || "").split("/").pop() || "", json: fieldsOf(d).json });
        token = res?.nextPageToken || "";
        if (!token) break;
      }
      return { counts: deskEventsFrom(docs), revisit: deskRevisitOkFrom(docs) };
    },
    // 재방문 성공 지금 (2026-10-27) — 키즈 실시간과 같은 현황 글 하나 · 오늘 것만
    async deskOkNow() {
      const { live } = await deskLiveNow();
      return live && live.revisit && live.day === todayKst() ? { ...live.revisit, asOf: live.at } : null;
    },
    async deskEventDay(date) {
      const res = await fetch(`${base(cfg, board)}/${DESK_STATS}/${DESK_EVENT_PREFIX}${date}?key=${cfg.apiKey}`, { cache: "no-store" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`이벤트 입장 수 받기 오류 ${res.status}`);
      const e = parseDeskEvent(fieldsOf(await res.json()).json);
      return e && e.day === date ? e.count : null;
    },
  };
}

/** 베이커리 작업지시 — 그날 계획(plans) · 매니저 확정(orders). 보고 앱 베이커리 '생산 · 폐기' 칸에 씀 (체험판 · 없으면 null) */
export async function bakeryDay(date: string): Promise<{ plan: PlanDoc | null; order: OrderDoc | null } | null> {
  const cfg = firebaseConfig();
  const board = boardKey();
  if (__DEMO__ || !cfg || !board) return null;
  const one = async <T,>(coll: string): Promise<T | null> => {
    try {
      const res = await fetch(`${base(cfg, board)}/${coll}/${date}?key=${cfg.apiKey}`);
      if (!res.ok) return null;
      const j = fieldsOf(await res.json()).json;
      return j ? (JSON.parse(j) as T) : null;
    } catch {
      return null;
    }
  };
  const [plan, order] = await Promise.all([one<unknown>("plans"), one<unknown>("orders")]);
  return { plan: asPlan(plan), order: asOrder(order) };
}

/** 오늘 마감 전 영업정보 — live/{날짜} 한 문서 (없으면 null). 칸 cafe · kids · naver = 조각 JSON {p, by, at} */
export async function liveDoc(cfg: FirebaseConfig, board: string, date: string): Promise<LiveDoc | null> {
  // 문서가 없으면(아직 수집 전) null · 인터넷 오류는 throw (갖고 있던 것을 그대로 쓰게)
  const res = await fetch(`${base(cfg, board)}/live/${date}?key=${cfg.apiKey}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`마감 전 영업정보 받기 오류 ${res.status}`);
  const f = fieldsOf(await res.json());
  const doc: LiveDoc = { date, at: f.at || undefined };
  for (const k of ["cafe", "kids", "naver"] as const) {
    if (!f[k]) continue;
    try {
      const x = JSON.parse(f[k]);
      if (x && x.p) (doc as any)[k] = x;
    } catch {
      /* 깨진 칸은 검사에서 빠짐 */
    }
  }
  return doc;
}

/** 키즈 실시간 — 키즈 POS 통합데스크가 1분마다 · 바뀌면 바로 덮어쓰는 deskLive/now (astanakiz docs/LIVE.md)
    없으면 live: null · 모양이 틀리면 bad · 인터넷 · 권한 오류는 throw (화면이 갖고 있던 것을 그대로 두게) */
export async function deskLiveNow(): Promise<{ live: DeskLive | null; bad?: boolean }> {
  if (__DEMO__) {
    // 체험판: 통합데스크 체험판(10/5 13:50) 글을 오늘 · 지금 받은 것처럼
    const k = new Date(Date.now() + 9 * 3600e3).toISOString();
    const day = todayKst();
    // 재방문 손님의 앞 방문 날도 오늘에 맞춤 ('며칠 만에'는 그대로)
    const revisit = { ...demoDeskLive.revisit, who: demoDeskLive.revisit.who.map((w) => ({ ...w, prev: addDays(day, -w.gap) })) };
    return { live: parseDeskLive({ ...demoDeskLive, day, at: `${k.slice(0, 10)} ${k.slice(11, 19)}`, revisit }) };
  }
  const cfg = firebaseConfig();
  const board = boardKey();
  if (!cfg || !board) return { live: null };
  let res: Response;
  try {
    res = await fetch(`${base(cfg, board)}/${DESK_LIVE}/now?key=${cfg.apiKey}`, { cache: "no-store" });
  } catch {
    throw new Error("인터넷에 연결하지 못했습니다. 연결을 확인하고 다시 당겨 주세요.");
  }
  if (res.status === 404) return { live: null };
  if (res.status === 403) throw new Error("키즈 실시간을 읽을 수 없습니다 — 클라우드 보안 규칙에 deskLive 가 들어갔는지 확인해 주세요 (docs/KIDS_LIVE.md).");
  if (!res.ok) throw new Error(`키즈 실시간 받기 오류 (${res.status})`);
  const f = fieldsOf(await res.json());
  const live = parseDeskLive(f.json);
  return live ? { live } : { live: null, bad: true };
}

/** 재방문 간격 — 키즈 POS 통합데스크가 매일 20:00 덮어쓰는 deskStats/revisit (astanakiz docs/REVISIT.md · 손님 정보 없음)
    없으면 revisit: null · 모양이 틀리면 bad · 인터넷 · 권한 오류는 throw */
export async function deskRevisitNow(): Promise<{ revisit: DeskRevisit | null; bad?: boolean }> {
  if (__DEMO__) {
    // 체험판: 예시 날짜를 어제 보낸 것처럼 옮김 (체험판 보고 자료와 날짜가 맞아야 재방문자 비율이 나옴)
    const off = (Date.parse(addDays(todayKst(), -1)) - Date.parse(demoRevisit.day)) / 86400e3;
    return { revisit: parseDeskRevisit(JSON.stringify(demoRevisit).replace(/\d{4}-\d{2}-\d{2}/g, (d) => addDays(d, off))) };
  }
  const cfg = firebaseConfig();
  const board = boardKey();
  if (!cfg || !board) return { revisit: null };
  let res: Response;
  try {
    res = await fetch(`${base(cfg, board)}/${DESK_STATS}/${DESK_REVISIT}?key=${cfg.apiKey}`, { cache: "no-store" });
  } catch {
    throw new Error("인터넷에 연결하지 못해 재방문 간격을 받지 못했습니다.");
  }
  if (res.status === 404) return { revisit: null };
  if (res.status === 403) throw new Error("재방문 간격을 읽을 수 없습니다 — 클라우드 보안 규칙에 deskStats 가 들어갔는지 확인해 주세요 (docs/KIDS_REVISIT.md).");
  if (!res.ok) throw new Error(`재방문 간격 받기 오류 (${res.status})`);
  const f = fieldsOf(await res.json());
  const revisit = parseDeskRevisit(f.json);
  return revisit ? { revisit } : { revisit: null, bad: true };
}
