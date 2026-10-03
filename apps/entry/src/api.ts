/* ============================================================
   A 가 자료를 주고받는 곳 — 클라우드 보관함(Firebase, cloud.ts)에 직접
   - 체험판: 클라우드 없이 이 브라우저 저장소(localStorage)에 흉내
   ============================================================ */
import { addDays, mergeNaverPast, type CashPart, type DayReport, type DayWeather, type NaverPart, type ReceiptLine, type StorePart } from "@report/core";
import { addProducts, cloudConfig, CloudError, login, logout, PARTS, readDay, readDays, readProducts, sessionEmail, writePieces, type Piece } from "./cloud";

export const APP_VERSION = "0.4.0";

/** 자금 전일 잔고를 찾을 때 거슬러 보는 날 수 */
export const CASH_LOOKBACK = 31;
const daysBefore = (date: string) => Array.from({ length: CASH_LOOKBACK }, (_, i) => addDays(date, -(i + 1)));

/** 지난 자료 한 조각 — 매장 하루치(상품별 · 영수증별) 또는 네이버 정리표 하루 */
export type PastPart = StorePart | NaverPart;

export interface Info {
  /** 연결된 곳 이름 */
  name: string;
  version: string;
  /** 로그인한 계정 (없으면 로그인 필요) */
  email: string | null;
}

export interface DayInfo {
  date: string;
  report: DayReport | null;
  weather: DayWeather | null;
}

export interface SubmitBody {
  date: string;
  by: string;
  parts: { cafe?: StorePart; kids?: StorePart; naver?: NaverPart; cash?: CashPart };
  lines?: { cafe?: ReceiptLine[]; kids?: ReceiptLine[] };
  products?: Record<string, string>;
}

export interface SubmitResult {
  ok: boolean;
  report: DayReport;
  publish: { ok: boolean; message: string };
}

export { CloudError as ApiError };

const ME = "entry.me";
/** 입력자 이름 (보고에 남음) — 계정 이메일과 따로, PC 마다 한 번 */
export interface Me {
  name: string;
}
export function loadMe(): Me {
  try {
    return { name: "", ...(JSON.parse(localStorage.getItem(ME) || "{}") as Partial<Me>) };
  } catch {
    return { name: "" };
  }
}
export function saveMe(me: Me) {
  try {
    localStorage.setItem(ME, JSON.stringify({ name: me.name }));
  } catch {
    /* 저장 안 돼도 이번에는 씀 */
  }
}

function cfg() {
  const c = cloudConfig();
  if (!c) throw new CloudError("클라우드 주소(VITE_FIREBASE_API_KEY · VITE_FIREBASE_PROJECT_ID)가 없는 판입니다. 다시 만들어 주세요.");
  return c;
}

const real = {
  async info(): Promise<Info> {
    return { name: "클라우드", version: APP_VERSION, email: sessionEmail() };
  },
  login: (email: string, password: string) => login(cfg(), email, password),
  logout,
  async day(date: string): Promise<DayInfo> {
    return { date, ...(await readDay(cfg(), date)) };
  },
  products: () => readProducts(cfg()),
  /** 그 날짜 앞(최근 31일)의 자금 보고 — 전일 잔고 · 환율 · 대출 이어받기 */
  async cashBefore(date: string): Promise<CashPart[]> {
    const m = await readDays(cfg(), daysBefore(date));
    return [...m.values()].map((r) => r.cash).filter((c): c is CashPart => !!c);
  },
  async submit(body: SubmitBody): Promise<SubmitResult> {
    const pieces: Piece[] = [];
    for (const k of PARTS) {
      const p = body.parts[k];
      if (p) pieces.push({ kind: k, date: body.date, part: p, file: k === "cafe" || k === "kids" ? (p as StorePart).file : undefined });
    }
    const lines = (["cafe", "kids"] as const).filter((k) => body.lines?.[k]).map((k) => ({ date: body.date, store: k, lines: body.lines![k]! }));
    await writePieces(cfg(), body.by, pieces, lines);
    if (body.products) await addProducts(cfg(), body.products);
    const { report } = await readDay(cfg(), body.date);
    return { ok: true, report: report || mergeReport(null, body.date, body.by, body.parts), publish: { ok: true, message: "클라우드에 올렸습니다. 폰(B)에서 앱을 다시 열면 보입니다." } };
  },
  /** 지난 자료 — 이미 A 에서 넣은 칸(영수증별 · 네이버)은 상품별 · 네이버 정리표로 덮지 않음 */
  async importPast(body: { by: string; parts: PastPart[]; products?: Record<string, string> }) {
    const have = await readDays(cfg(), [...new Set(body.parts.map((p) => p.date))]);
    const pieces: Piece[] = [];
    let skipped = 0;
    for (const p of body.parts) {
      const old = have.get(p.date);
      if ("tickets" in p) {
        // 낮 · 밤 캡처를 따로 넣어도 같은 날로 합침 (A 에서 넣은 값은 그대로)
        const merged = mergeNaverPast(old?.naver, p);
        if (!merged) {
          skipped++;
          continue;
        }
        if (old) old.naver = merged;
        else have.set(p.date, { date: p.date, naver: merged });
        pieces.push({ kind: "naver", date: p.date, part: merged });
      } else {
        const prev = old?.[p.store];
        if (p.basis === "daily" && prev && prev.basis === "receipt") {
          skipped++;
          continue;
        }
        pieces.push({ kind: p.store, date: p.date, part: p, file: p.file });
      }
    }
    await writePieces(cfg(), body.by, pieces);
    if (body.products) await addProducts(cfg(), body.products);
    return { ok: true, saved: pieces.length, skipped };
  },
};

/* ---------- 체험판: 클라우드 흉내 ---------- */
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
/** 같은 날짜의 조각을 합침 (지난 자료(daily)는 영수증 자료를 덮지 않음) — 미리보기 · 체험판용 */
export function mergeReport(prev: DayReport | null, date: string, by: string, parts: SubmitBody["parts"]): DayReport {
  const at = new Date().toISOString();
  const r: DayReport = { ...(prev || { date }), date, meta: { ...(prev?.meta || {}) }, at };
  for (const k of PARTS) {
    const p = parts[k];
    if (!p) continue;
    const store = k === "cafe" || k === "kids";
    const old = r[k] as StorePart | undefined;
    if (store && (p as StorePart).basis === "daily" && old && old.basis === "receipt") continue;
    (r as any)[k] = p;
    r.meta![k] = { by, at, file: store ? (p as StorePart).file : undefined };
  }
  return r;
}
const demo = {
  async info(): Promise<Info> {
    return { name: "체험판", version: "체험판", email: "체험판" };
  },
  async login(email: string) {
    return email;
  },
  logout() {},
  async day(date: string): Promise<DayInfo> {
    return { date, report: demoLoad().reports[date] || null, weather: null };
  },
  async products() {
    return demoLoad().products;
  },
  async cashBefore(date: string): Promise<CashPart[]> {
    const s = demoLoad();
    return daysBefore(date)
      .map((d) => s.reports[d]?.cash)
      .filter((c): c is CashPart => !!c);
  },
  async submit(body: SubmitBody): Promise<SubmitResult> {
    const s = demoLoad();
    const report = mergeReport(s.reports[body.date] || null, body.date, body.by, body.parts);
    s.reports[body.date] = report;
    Object.assign(s.products, body.products || {});
    demoSave(s);
    return { ok: true, report, publish: { ok: false, message: "체험판이라 이 브라우저에만 저장했습니다 (클라우드 · 폰으로는 가지 않음)." } };
  },
  async importPast(body: { by: string; parts: PastPart[]; products?: Record<string, string> }) {
    const s = demoLoad();
    let saved = 0;
    let skipped = 0;
    for (const p of body.parts) {
      const prev = s.reports[p.date] || null;
      if ("tickets" in p) {
        const merged = mergeNaverPast(prev?.naver, p);
        if (!merged) {
          skipped++;
          continue;
        }
        s.reports[p.date] = mergeReport(prev, p.date, body.by, { naver: merged });
      } else {
        const old = prev?.[p.store];
        if (p.basis === "daily" && old && old.basis === "receipt") {
          skipped++;
          continue;
        }
        s.reports[p.date] = mergeReport(prev, p.date, body.by, { [p.store]: p });
      }
      saved++;
    }
    Object.assign(s.products, body.products || {});
    demoSave(s);
    return { ok: true, saved, skipped };
  },
};

export const api = __DEMO__ ? demo : real;
