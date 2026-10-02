/* ============================================================
   C(사무실 PC)와 주고받기 — A 화면은 C 가 보여 주므로 같은 주소의 /api 를 부름
   - 입력자 이름 · 사무실 비밀번호(설정했으면)를 머리글로 보냄
   - 체험판: C 없이 이 브라우저 저장소(localStorage)에 흉내
   C 쪽: apps/office/src/report_office/server.py
   ============================================================ */
import type { DayReport, DayWeather, NaverPart, ReceiptLine, StorePart } from "@report/core";

export interface Info {
  name: string;
  version: string;
  /** 클라우드 보관함 설정 전 (폰에는 안 가고 C 에만 쌓임) */
  trial: boolean;
  publish: { pending: number; at: string | null; error: string };
  weather: { ok: boolean; error: string };
  pin: boolean;
}

export interface DayInfo {
  date: string;
  report: DayReport | null;
  weather: DayWeather | null;
}

export interface SubmitBody {
  date: string;
  by: string;
  parts: { cafe?: StorePart; kids?: StorePart; naver?: NaverPart };
  lines?: { cafe?: ReceiptLine[]; kids?: ReceiptLine[] };
  products?: Record<string, string>;
}

export interface SubmitResult {
  ok: boolean;
  report: DayReport;
  publish: { ok: boolean; message: string };
}

export class ApiError extends Error {
  constructor(
    msg: string,
    readonly status = 0,
  ) {
    super(msg);
  }
}

const ME = "entry.me";
export interface Me {
  name: string;
  pin: string;
}
export function loadMe(): Me {
  try {
    return { name: "", pin: "", ...(JSON.parse(localStorage.getItem(ME) || "{}") as Partial<Me>) };
  } catch {
    return { name: "", pin: "" };
  }
}
export function saveMe(me: Me) {
  try {
    localStorage.setItem(ME, JSON.stringify(me));
  } catch {
    /* 저장 안 돼도 이번에는 씀 */
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const me = loadMe();
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      cache: "no-store",
      headers: { "Content-Type": "application/json; charset=utf-8", "X-Office-Pin": encodeURIComponent(me.pin || ""), "X-Office-User": encodeURIComponent(me.name || ""), ...(init.headers || {}) },
    });
  } catch {
    throw new ApiError("사무실 PC(C)에 연결하지 못했습니다. C 가 켜져 있는지, 같은 사무실 인터넷(공유기)에 연결됐는지 확인해 주세요.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body?.error || `사무실 PC(C) 오류 ${res.status}`, res.status);
  return body as T;
}

const real = {
  info: () => call<Info>("/api/info"),
  day: (date: string) => call<DayInfo>(`/api/day?date=${date}`),
  products: () => call<{ products: Record<string, string> }>("/api/products").then((r) => r.products || {}),
  submit: (body: SubmitBody) => call<SubmitResult>("/api/submit", { method: "POST", body: JSON.stringify(body) }),
  importPast: (body: { by: string; parts: StorePart[]; products?: Record<string, string> }) => call<{ ok: boolean; saved: number; skipped: number }>("/api/import", { method: "POST", body: JSON.stringify(body) }),
};

/* ---------- 체험판: C 흉내 ---------- */
const DEMO = "entry.demo";
interface DemoStore {
  reports: Record<string, DayReport>;
  products: Record<string, string>;
}
function demoLoad(): DemoStore {
  try {
    return { reports: {}, products: {}, ...(JSON.parse(localStorage.getItem(DEMO) || "{}") as Partial<DemoStore>) };
  } catch {
    return { reports: {}, products: {} };
  }
}
function demoSave(s: DemoStore) {
  try {
    localStorage.setItem(DEMO, JSON.stringify(s));
  } catch {
    /* 꽉 차면 이번만 */
  }
}
/** C 가 하는 것과 같게: 같은 날짜의 조각을 합침 (지난 자료(daily)는 영수증 자료를 덮지 않음) */
export function mergeReport(prev: DayReport | null, date: string, by: string, parts: SubmitBody["parts"]): DayReport {
  const at = new Date().toISOString();
  const r: DayReport = { ...(prev || { date }), date, meta: { ...(prev?.meta || {}) }, at };
  for (const k of ["cafe", "kids", "naver"] as const) {
    const p = parts[k];
    if (!p) continue;
    const old = r[k] as StorePart | undefined;
    if (k !== "naver" && (p as StorePart).basis === "daily" && old && old.basis === "receipt") continue;
    (r as any)[k] = p;
    r.meta![k] = { by, at, file: k === "naver" ? undefined : (p as StorePart).file };
  }
  return r;
}
const demo = {
  async info(): Promise<Info> {
    return { name: "체험판 (C 없음)", version: "체험판", trial: true, publish: { pending: 0, at: null, error: "" }, weather: { ok: true, error: "" }, pin: false };
  },
  async day(date: string): Promise<DayInfo> {
    return { date, report: demoLoad().reports[date] || null, weather: null };
  },
  async products() {
    return demoLoad().products;
  },
  async submit(body: SubmitBody): Promise<SubmitResult> {
    const s = demoLoad();
    const report = mergeReport(s.reports[body.date] || null, body.date, body.by, body.parts);
    s.reports[body.date] = report;
    Object.assign(s.products, body.products || {});
    demoSave(s);
    return { ok: true, report, publish: { ok: false, message: "체험판이라 이 브라우저에만 저장했습니다 (C · 폰으로는 가지 않음)." } };
  },
  async importPast(body: { by: string; parts: StorePart[]; products?: Record<string, string> }) {
    const s = demoLoad();
    let saved = 0;
    let skipped = 0;
    for (const p of body.parts) {
      const prev = s.reports[p.date] || null;
      const old = prev?.[p.store];
      if (old && old.basis === "receipt") {
        skipped++;
        continue;
      }
      s.reports[p.date] = mergeReport(prev, p.date, body.by, { [p.store]: p });
      saved++;
    }
    Object.assign(s.products, body.products || {});
    demoSave(s);
    return { ok: true, saved, skipped };
  },
};

export const api = __DEMO__ ? demo : real;
