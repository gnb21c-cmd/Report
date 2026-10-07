/* ============================================================
   재고 자료 — E-1(재고 관리 및 설정) · F(발주app)가 같이 씀 (통합 Ver.2.0, packages/core/src/ports.ts)
   - 로그인: A · D 와 같은 직원 계정(이메일 · 비밀번호) → senders 명단의 매장 열쇠
   - boards/{열쇠}/inv/master   = { json: 공급처 · 원재료 · 레시피 }  (E-1, 운영자만 씀)
     boards/{열쇠}/inv/ledger   = { json: 장부 · 안전재고 · 발주 줄 · 상품 목록 } (E 가 매일 씀 — 읽기만)
     boards/{열쇠}/invIn/{날짜}  = { json: 그날 입고 줄 }   (창고 입구)
     boards/{열쇠}/invCount/{날짜} = { json: 실셈 }
     boards/{열쇠}/alerts/{id}  = { json: 알림, readAt }  (E · E-1 이 만들고 F 가 읽음 표시)
   공급 단가 · 원가가 있어 모두 로그인한 직원만 (B 처럼 누구나 읽는 곳에 두지 않음)
   체험판: 가짜 자료를 이 브라우저(localStorage)에만
   ============================================================ */
import {
  alertsFor,
  ledgerDoc,
  stockReport,
  type LedgerDoc,
  type Material,
  type Recipe,
  type StockAlert,
  type StockCount,
  type StockIn,
  type StockMaster,
  type Supplier,
  type UsageRow,
} from "@report/core";

export interface Api {
  kind: "cloud" | "demo";
  master(): Promise<StockMaster>;
  saveMaster(m: StockMaster): Promise<void>;
  ledger(): Promise<LedgerDoc | null>;
  ins(date: string): Promise<StockIn[]>;
  /** 그날 입고에 더함 */
  addIns(date: string, rows: StockIn[]): Promise<void>;
  counts(): Promise<StockCount[]>;
  saveCount(c: StockCount): Promise<void>;
  alerts(): Promise<StockAlert[]>;
  saveAlert(a: StockAlert): Promise<void>;
}

const env = { apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string, projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string };
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
    if (res.status === 403) throw new CloudError("이 계정으로는 할 수 없습니다 — 원재료 · 레시피는 운영자 계정만 고칠 수 있습니다.", 403);
    if (res.status === 404) throw new CloudError("없음", 404);
    throw new CloudError(`클라우드 오류 (${raw.slice(0, 100)})`, res.status);
  }
  return body;
}

/* ---------- 로그인 (A · D 와 같은 방식) ---------- */
const SESSION = "stock.session";
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

/* ---------- 클라우드 ---------- */
const str = (s: string) => ({ stringValue: s });
const parse = <T>(doc: any): T | null => {
  try {
    const j = doc?.fields?.json?.stringValue;
    return j ? (JSON.parse(j) as T) : null;
  } catch {
    return null;
  }
};

export function cloudApi(): Api {
  const s = () => session()!;
  const url = (path: string) => `${docs()}/boards/${s().board}/${path}`;
  const auth = async () => ({ Authorization: `Bearer ${await idToken()}` });
  const get = async <T>(path: string): Promise<T | null> => {
    try {
      return parse<T>(await http(url(path), { headers: await auth() }));
    } catch (e) {
      if ((e as CloudError).status === 404) return null;
      throw e;
    }
  };
  const put = async (path: string, json: unknown, extra: Record<string, unknown> = {}) => {
    const fields = { json: str(JSON.stringify(json)), at: { timestampValue: new Date().toISOString() }, ...extra };
    const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join("&");
    await http(`${url(path)}?${mask}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(await auth()) }, body: JSON.stringify({ fields }) });
  };
  const list = async <T>(coll: string): Promise<T[]> => {
    const r = await http(`${url(coll)}?pageSize=300`, { headers: await auth() }).catch((e) => {
      if ((e as CloudError).status === 404) return { documents: [] };
      throw e;
    });
    return (r.documents || []).map((d: any) => parse<T>(d)).filter(Boolean) as T[];
  };
  return {
    kind: "cloud",
    async master() {
      return (await get<StockMaster>("inv/master")) || { suppliers: [], materials: [], recipes: [] };
    },
    saveMaster: (m) => put("inv/master", m),
    ledger: () => get<LedgerDoc>("inv/ledger"),
    async ins(date) {
      return (await get<StockIn[]>(`invIn/${date}`)) || [];
    },
    async addIns(date, rows) {
      const have = (await get<StockIn[]>(`invIn/${date}`)) || [];
      await put(`invIn/${date}`, [...have, ...rows], { date: str(date) });
    },
    async counts() {
      return (await list<StockCount>("invCount")).sort((a, b) => b.date.localeCompare(a.date));
    },
    saveCount: (c) => put(`invCount/${c.date}`, c, { date: str(c.date) }),
    async alerts() {
      return (await list<StockAlert>("alerts")).sort((a, b) => b.at.localeCompare(a.at));
    },
    saveAlert: (a) => put(`alerts/${a.id}`, a),
  };
}

/* ---------- 체험판 ---------- */
const DEMO = "stock.demo.v2";
interface DemoStore {
  master: StockMaster;
  ins: Record<string, StockIn[]>;
  counts: StockCount[];
  alerts: StockAlert[];
}
const todayKst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const plus = (k: string, n: number) => new Date(Date.parse(k + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);

function demoMaster(asOf: string): StockMaster {
  const suppliers: Supplier[] = [
    { id: "s1", name: "서울우유 대리점", leadDays: 1, minOrderAmount: 50000, contact: "010-0000-0000" },
    { id: "s2", name: "원두 로스터리", leadDays: 3, orderDays: [1, 4] },
    { id: "s3", name: "제과 재료상", leadDays: 2, orderDays: [2, 5], minOrderAmount: 100000 },
  ];
  const materials: Material[] = [
    { id: "m1", name: "우유", supplierId: "s1", packSize: 1, packUnit: "L", pkgQty: 12, pkgPrice: 26400, initialStock: 100, asOf, storage: "바 냉장고" },
    { id: "m2", name: "원두 (하우스 블렌드)", supplierId: "s2", packSize: 1, packUnit: "kg", pkgQty: 1, pkgPrice: 32000, initialStock: 30, asOf, storage: "바 선반", tiers: [{ minPkgs: 5, pkgPrice: 29000 }] },
    { id: "m3", name: "강력분", supplierId: "s3", packSize: 20, packUnit: "kg", pkgQty: 1, pkgPrice: 42000, vatFree: true, initialStock: 12, asOf, storage: "건자재 창고", moqPkgs: 2 },
    { id: "m4", name: "버터", supplierId: "s3", packSize: 450, packUnit: "g", pkgQty: 20, pkgPrice: 180000, initialStock: 36, asOf, storage: "베이커리 냉동고" },
    { id: "m5", name: "생크림", supplierId: "s1", packSize: 1, packUnit: "L", pkgQty: 6, pkgPrice: 48000, initialStock: 22, asOf, storage: "바 냉장고", safetyManual: 6 },
    { id: "m6", name: "계란", supplierId: "s3", packSize: 30, packUnit: "개", pkgQty: 1, pkgPrice: 9500, vatFree: true, initialStock: 13, asOf, storage: "주방 냉장고" },
  ];
  const recipes: Recipe[] = [
    { product: "카페라떼", part: "바리스타", items: [{ materialId: "m2", qty: 20 }, { materialId: "m1", qty: 220 }] },
    { product: "아메리카노", part: "바리스타", items: [{ materialId: "m2", qty: 20 }] },
    { product: "크루아상", part: "베이커리", items: [{ materialId: "m3", qty: 80 }, { materialId: "m4", qty: 45 }] },
    { product: "소금빵", part: "베이커리", items: [{ materialId: "m3", qty: 70 }, { materialId: "m4", qty: 15 }] },
    { product: "프렌치토스트", part: "키친", items: [{ materialId: "m6", qty: 2 }, { materialId: "m1", qty: 80 }, { materialId: "m5", qty: 30 }] },
  ];
  return { suppliers, materials, recipes };
}

/** 체험판 사용량: 날마다 비슷하게 (요일마다 조금 다르게) */
function demoUsage(master: StockMaster, from: string, to: string): UsageRow[] {
  const per: Record<string, number> = { m1: 3.2, m2: 0.9, m3: 0.35, m4: 1.1, m5: 0.7, m6: 0.4 };
  const out: UsageRow[] = [];
  let i = 0;
  for (let d = from; d <= to; d = plus(d, 1), i++)
    for (const m of master.materials) out.push({ date: d, materialId: m.id, product: "체험판", part: "기타", packs: (per[m.id] || 0.5) * (1 + 0.35 * Math.sin(i * 1.3 + m.id.length)), basis: "판매" });
  return out;
}

function demoLoad(): DemoStore {
  try {
    const s = JSON.parse(localStorage.getItem(DEMO) || "null");
    if (s?.master) return s;
  } catch {
    /* 처음 */
  }
  const asOf = plus(todayKst(), -27);
  return { master: demoMaster(asOf), ins: { [plus(todayKst(), -10)]: [{ date: plus(todayKst(), -10), materialId: "m1", qty: 24, by: "체험판" }] }, counts: [], alerts: [] };
}
function demoSave(s: DemoStore) {
  try {
    localStorage.setItem(DEMO, JSON.stringify(s));
  } catch {
    /* 꽉 차면 이번만 */
  }
}
/** 체험판 장부 = E 가 하는 계산을 이 브라우저에서 (어제 끝 기준) */
function demoLedger(s: DemoStore): LedgerDoc {
  const upTo = plus(todayKst(), -1);
  const asOf = s.master.materials.reduce((a, m) => (m.asOf && m.asOf < a ? m.asOf : a), upTo);
  const ins = Object.values(s.ins).flat();
  const rep = stockReport({ master: s.master, ins, counts: s.counts, usage: demoUsage(s.master, asOf, upTo), upTo });
  const products = [
    { name: "아메리카노", sector: "바리스타", qty: 900 },
    { name: "카페라떼", sector: "바리스타", qty: 640 },
    { name: "소금빵", sector: "베이커리", qty: 520 },
    { name: "크루아상", sector: "베이커리", qty: 380 },
    { name: "프렌치토스트", sector: "키친", qty: 120 },
    { name: "딸기라떼", sector: "바리스타", qty: 90 },
  ];
  return ledgerDoc(rep, products, upTo, new Date().toISOString());
}

export function demoApi(): Api {
  return {
    kind: "demo",
    async master() {
      return demoLoad().master;
    },
    async saveMaster(m) {
      const s = demoLoad();
      demoSave({ ...s, master: m });
    },
    async ledger() {
      return demoLedger(demoLoad());
    },
    async ins(date) {
      return demoLoad().ins[date] || [];
    },
    async addIns(date, rows) {
      const s = demoLoad();
      s.ins[date] = [...(s.ins[date] || []), ...rows];
      demoSave(s);
    },
    async counts() {
      return demoLoad().counts.slice().sort((a, b) => b.date.localeCompare(a.date));
    },
    async saveCount(c) {
      const s = demoLoad();
      s.counts = [...s.counts.filter((x) => x.date !== c.date), c];
      demoSave(s);
    },
    async alerts() {
      // 체험판: E 가 만드는 알림을 그 자리에서
      const s = demoLoad();
      const fresh = alertsFor(demoLedger(s), s.master.suppliers, s.alerts.map((a) => a.id));
      if (fresh.length) {
        s.alerts = [...s.alerts, ...fresh];
        demoSave(s);
      }
      return s.alerts.slice().sort((a, b) => b.at.localeCompare(a.at));
    },
    async saveAlert(a) {
      const s = demoLoad();
      s.alerts = [...s.alerts.filter((x) => x.id !== a.id), a];
      demoSave(s);
    },
  };
}

export const api: Api = __DEMO__ ? demoApi() : cloudApi();
