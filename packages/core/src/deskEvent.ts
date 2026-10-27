/* ============================================================
   이벤트 무료입장 — 키즈 POS 통합데스크(gnb21c-cmd/astanakiz 2.1~)가 보내는 그날 현장 [이벤트 입장] 수 (2026-10-21 사장님)
   - 예전: 키즈 POS 의 0원 이벤트 상품('[평일] 한가위 무제한 쿠폰' — classify '이벤트무료') 판매 수량 → kids.eventFree
   - 이제: 이벤트 손님은 POS 를 거치지 않고 통합데스크 현장입장 창 [한가위 이벤트 입장]으로 바로 들어감
     → 통합데스크가 매일 20:00 (설문 보낼 때 같이 · 설문이 없어도) boards/{열쇠}/deskStats/event-{날짜} 에 덮어씀
       (astanakiz-event · 그날 수 · 이벤트 이름별 · 손님 정보 없음 · 20:00 뒤 숫자가 바뀌면 다시). 통합데스크 쪽은 astanakiz docs/OPERATION.md
   - 그날 이벤트 무료입장 = max(POS 0원 상품, 통합데스크) — 옮겨 가는 동안 같은 손님을 POS 에도 찍었을 수 있어 더하지 않음
   ============================================================ */
import type { DayReport } from "./part";

export const DESK_EVENT_PREFIX = "event-";

export interface DeskEvent {
  day: string;
  /** 그날 이벤트 입장 수 (명) */
  count: number;
  /** 이벤트 이름별 (예: 한가위 12) */
  names: { name: string; n: number }[];
  sentAt: string;
  /** 재방문 성공 (2026-10-27 사장님) — 옛 판은 없음 */
  revisit?: DeskRevisitOk;
}

/** 재방문 성공 수 (2026-10-27 사장님) — 재방문 이벤트 장부의 '성공'(돈까스 쿠폰이 나간 수)
 *  from = 이벤트 시작일 · today = 그 글의 날 · total = 시작일부터 누적 · days = 날마다 · asOf = 그 숫자를 센 때(이벤트 글 sentAt · 현황 글 at) */
export interface DeskRevisitOk {
  from: string;
  today: number;
  total: number;
  days: Record<string, number>;
  asOf?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const nat = (x: unknown, max: number): number | null => (typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= max ? x : null);
/** 이벤트 이름: 짧은 글만 (전화번호처럼 숫자가 많은 글은 버림) */
const nameOk = (x: unknown): string | null => (typeof x === "string" && x.length <= 20 && !/\d{3,}/.test(x) ? x.trim() || "이벤트" : null);

/** revisit 칸 검사 — 모양이 틀리면 null · 이상한 날 · 수 · 시작일 앞 날은 버림 (이벤트 글 · 현황 글 같이 씀) */
export function parseRevisitOk(x: unknown): DeskRevisitOk | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const from = String(o.from || "");
  const today = nat(o.today, 9999), total = nat(o.total, 999999);
  if (!DAY.test(from) || today == null || total == null) return null;
  const days: Record<string, number> = {};
  if (o.days && typeof o.days === "object") {
    for (const [d, v] of Object.entries(o.days as Record<string, unknown>).slice(0, 400)) {
      const n = nat(v, 9999);
      if (DAY.test(d) && d >= from && n != null && n > 0) days[d] = n;
    }
  }
  return { from, today, total, days };
}

/** 통합데스크 글(astanakiz-event) → 검사한 값. 모양이 틀리면 null */
export function parseDeskEvent(raw: unknown): DeskEvent | null {
  let x: any = raw;
  if (typeof raw === "string") {
    try {
      x = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!x || typeof x !== "object" || x.type !== "astanakiz-event" || x.v !== 1 || !DAY.test(String(x.day || ""))) return null;
  const count = nat(x.count, 9999);
  if (count == null) return null;
  const names: DeskEvent["names"] = [];
  for (const it of Array.isArray(x.names) ? x.names.slice(0, 20) : []) {
    const name = nameOk(it && it.name), n = nat(it && it.n, 9999);
    if (name != null && n != null && n > 0) names.push({ name, n });
  }
  const revisit = parseRevisitOk(x.revisit);
  return { day: x.day, count, names, sentAt: typeof x.sentAt === "string" ? x.sentAt.slice(0, 16) : "", ...(revisit ? { revisit } : {}) };
}

/** deskStats 문서들 → 가장 최근 이벤트 글의 재방문 성공 (asOf = 그 글을 보낸 때) · 없으면 null */
export function deskRevisitOkFrom(docs: { id: string; json?: unknown }[]): DeskRevisitOk | null {
  let best: DeskEvent | null = null;
  for (const d of docs) {
    if (!d.id.startsWith(DESK_EVENT_PREFIX)) continue;
    const e = parseDeskEvent(d.json);
    if (!e || d.id !== DESK_EVENT_PREFIX + e.day || !e.revisit) continue;
    if (!best || e.day > best.day || (e.day === best.day && e.sentAt > best.sentAt)) best = e;
  }
  return best && best.revisit ? { ...best.revisit, asOf: best.sentAt || best.day } : null;
}

/** 둘 중 더 늦게 센 것 (asOf 견줌 · 없는 쪽은 짐) */
export function newerRevisitOk(a: DeskRevisitOk | null | undefined, b: DeskRevisitOk | null | undefined): DeskRevisitOk | null {
  if (!a) return b || null;
  if (!b) return a;
  return String(b.asOf || "") > String(a.asOf || "") ? b : a;
}

/** 지난 날 '입장권 판매 총 수량' 카드 밑 줄 — 재방문 N장 (現누적 NN장) · 이벤트 시작일 앞 날은 null */
export function revisitOkLine(ok: DeskRevisitOk | null | undefined, date: string): { n: number; total: number } | null {
  if (!ok || !DAY.test(date) || date < ok.from) return null;
  return { n: ok.days[date] || 0, total: ok.total };
}

/** deskStats 문서들(이름 · json) → 날짜 → 그날 이벤트 입장 수 (event-날짜 문서만 · 문서 이름과 글의 날짜가 같을 때만) */
export function deskEventsFrom(docs: { id: string; json?: unknown }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of docs) {
    if (!d.id.startsWith(DESK_EVENT_PREFIX)) continue;
    const e = parseDeskEvent(d.json);
    if (e && d.id === DESK_EVENT_PREFIX + e.day) out[e.day] = e.count;
  }
  return out;
}

/** 그날 키즈 이벤트 무료입장 = max(POS 0원 상품, 통합데스크) — 키즈 칸이 있는 날만 (원래 자료는 그대로 · 바뀐 날만 새 것) */
export function withDeskEvents(reports: DayReport[], ev: Record<string, number> | null | undefined): DayReport[] {
  if (!ev || !Object.keys(ev).length) return reports;
  return reports.map((r) => {
    const n = ev[r.date];
    const k = r.kids?.kids;
    if (n == null || !k || n <= k.eventFree) return r;
    return { ...r, kids: { ...r.kids!, kids: { ...k, eventFree: n } } };
  });
}
