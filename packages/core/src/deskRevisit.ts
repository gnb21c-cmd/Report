/* ============================================================
   재방문 간격 — 키즈 POS 통합데스크(gnb21c-cmd/astanakiz)가 보내는 일수 모음 (2026-10-19 사장님)
   - 네이버 예약 손님이 며칠 만에 다시 오는지: 통합데스크가 날마다 네이버 이용완료 손님을 그 PC 에만 기록(해시)하고
     매일 20:00 boards/{열쇠}/deskStats/revisit 문서 하나에 일수 모음(astanakiz-revisit)을 덮어씀 — 손님 정보 없음
     글 모양 · 통합데스크 쪽 설명은 astanakiz docs/REVISIT.md
   - B '네이버 판매 수' 세부 화면 맨 위: 반반(왼쪽 과거 4/1 ~ 10/25 · 오른쪽 이벤트 10/26 ~)
     재방문까지 걸린 일수 많은 순 7개를 골라 빨리 온 순(일수 짧은 순)으로 보여 줌 "1일 9명 · 2일 8명 …" (2026-10-21 사장님 — 예전엔 많은 순 "1위 7일 23명")
     아래 칸: 월 평균 재방문 수 · 재방문자 비율 (2026-10-23 사장님 — 위 한 줄 요약 · 맨 아래 설명은 뺌, revisitStats)
   ============================================================ */
import { naverSlots, type Board } from "./metrics";

export const DESK_STATS = "deskStats";
export const DESK_REVISIT = "revisit";
/** 순위 몇 개까지 */
export const REVISIT_TOP = 7;

export interface RevisitTop {
  rank: number;
  /** 재방문까지 걸린 일수 */
  days: number;
  /** 그 일수로 다시 온 횟수(사람 수) */
  count: number;
}
export interface RevisitPeriod {
  from: string;
  /** 지금까지(오늘 또는 끝난 날) */
  to: string;
  /** 재방문 수 · 재방문한 손님 수 */
  revisits: number;
  people: number;
  top: RevisitTop[];
}
export interface RevisitRecent {
  from: string;
  to: string;
  /** 30일 안에 온 손님 · 그중 전에도 온 손님 */
  people: number;
  revisits: number;
  /** 가장 많은 일수 */
  mode: { days: number; count: number } | null;
  avg: number | null;
  median: number | null;
}
export interface DeskRevisit {
  day: string;
  /** 보낸 시각 "YYYY-MM-DD HH:MM" */
  sentAt: string;
  /** 통합데스크 방문 기록이 있는 날 */
  history: { from: string; to: string; days: number };
  recent: RevisitRecent;
  past: RevisitPeriod | null;
  /** end = 이벤트 종료일 · started = 시작했나 (시작 전이면 빈 목록) · 이벤트를 안 정했으면 null */
  event: (RevisitPeriod & { end: string; started: boolean }) | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (x: unknown): string => (typeof x === "string" && DAY.test(x) ? x : "");
const n0 = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.round(x) : 0);
const int = (x: unknown): number | null => (typeof x === "number" && Number.isInteger(x) && x >= 0 ? x : null);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.round(x * 10) / 10 : null);

function topOf(x: unknown): RevisitTop[] {
  if (!Array.isArray(x)) return [];
  const out: RevisitTop[] = [];
  for (const t of x) {
    const d = int(t?.days), c = int(t?.count);
    if (d == null || !c) continue;
    out.push({ rank: out.length + 1, days: d, count: c });
    if (out.length >= REVISIT_TOP) break;
  }
  return out;
}
function periodOf(x: any): RevisitPeriod | null {
  if (!x || typeof x !== "object" || !day(x.from)) return null;
  return { from: x.from, to: day(x.to) || x.from, revisits: n0(x.revisits), people: n0(x.people), top: topOf(x.top) };
}

/** 통합데스크 일수 모음 → 검사한 것 (모양이 틀리면 null — 틀린 숫자를 보여 주지 않음) */
export function parseDeskRevisit(json: unknown): DeskRevisit | null {
  let x: any;
  try {
    x = typeof json === "string" ? JSON.parse(json) : json;
  } catch {
    return null;
  }
  if (!x || x.type !== "astanakiz-revisit" || x.v !== 1 || !day(x.day) || !x.recent || typeof x.recent !== "object") return null;
  const r = x.recent;
  const mode = r.mode && int(r.mode.days) != null && int(r.mode.count) ? { days: r.mode.days as number, count: r.mode.count as number } : null;
  const past = periodOf(x.past);
  const ev = periodOf(x.event);
  return {
    day: x.day,
    sentAt: typeof x.sentAt === "string" && x.sentAt.startsWith(x.day) ? x.sentAt.slice(0, 16) : x.day,
    history: { from: day(x.history?.from), to: day(x.history?.to), days: n0(x.history?.days) },
    recent: { from: day(r.from), to: day(r.to) || x.day, people: n0(r.people), revisits: n0(r.revisits), mode, avg: num(r.avg), median: num(r.median) },
    past,
    event: ev ? { ...ev, end: day(x.event.end), started: x.event.started !== false } : null,
  };
}

/** 맨 위 한 줄 — "가장 많은 7일 (23명) · 평균 11.3일 · 가운데 8일 · 재방문 96명" */
export function revisitSummary(r: RevisitRecent): string {
  if (!r.revisits || !r.mode) return "아직 재방문 없음";
  const parts = [`가장 많은 ${r.mode.days}일 (${r.mode.count}명)`];
  if (r.avg != null) parts.push(`평균 ${r.avg}일`);
  if (r.median != null) parts.push(`가운데 ${r.median}일`);
  parts.push(`재방문 ${r.revisits}명`);
  return parts.join(" · ");
}

/** 보여 줄 순서 — 많은 순으로 고른 7개를 빨리 온 순(일수 짧은 순)으로 (2026-10-21 사장님) · rank(많은 순 순위)는 그대로 남김 */
export function revisitByDays(top: RevisitTop[]): RevisitTop[] {
  return [...top].sort((a, b) => a.days - b.days || b.count - a.count);
}

/** 좌우 줄 — 순위마다 왼쪽(과거) · 오른쪽(이벤트), 짧은 쪽은 null */
export function revisitRows(r: Pick<DeskRevisit, "past" | "event">): { rank: number; left: RevisitTop | null; right: RevisitTop | null }[] {
  const a = r.past?.top || [], b = r.event?.top || [];
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => ({ rank: i + 1, left: a[i] || null, right: b[i] || null }));
}

/* ---------- 아래 칸 — 월 평균 재방문 수 · 재방문자 비율 (2026-10-23 사장님) ---------- */
/** 한 달 = 365.25 ÷ 12 일 */
export const MONTH_DAYS = 30.44;
/** 이만큼(일) 모여야 월 평균을 냄 — 그 전에는 지금까지 수 · 일수만 (며칠치로 한 달을 부풀리지 않게) */
export const REVISIT_MONTH_MIN_DAYS = 30;

export interface RevisitStats {
  /** 숫자가 나온 기간 — 통합데스크가 지난 방문 기록을 아직 다 안 읽었으면 읽은 첫날부터 */
  from: string;
  to: string;
  days: number;
  revisits: number;
  /** 월 평균 재방문 수 (모인 날이 30일 안 되면 null) */
  perMonth: number | null;
  /** 같은 날짜들의 네이버 판매수량 (보고 앱 — 자동 수집 · 일괄 등록, 장) · 하루라도 없으면 null */
  tickets: number | null;
  /** 재방문자 비율 % = 재방문 수 ÷ 네이버 판매수량 (소수 한 자리) — 보고 앱 '총인원 대비 신규 비율(신규 ÷ 판매수량)'과 같은 방식
   *  통합데스크에는 그 기간 전체 손님 수가 없어 보고 앱 자료로 (2026-10-23 사장님) · 판매수량이 빠진 날이 있으면 null (부풀린 비율을 보여 주지 않음) */
  rate: number | null;
}

const dayNo = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86400e3;

export function revisitStats(p: RevisitPeriod, history: DeskRevisit["history"], board?: Board | null): RevisitStats {
  const from = history.from && history.from > p.from ? history.from : p.from;
  const days = from <= p.to ? dayNo(p.to) - dayNo(from) + 1 : 0;
  // 분모 = 같은 날짜들의 네이버 판매수량 — 하루도 빠지지 않았을 때만 (오늘은 마감 전 숫자)
  const nv = board && days ? naverSlots(board, from, p.to) : null;
  const tickets = nv && nv.days === days ? nv.tickets.reduce((a, b) => a + b, 0) : null;
  return {
    from,
    to: p.to,
    days,
    revisits: p.revisits,
    perMonth: days >= REVISIT_MONTH_MIN_DAYS ? Math.round(p.revisits / (days / MONTH_DAYS)) : null,
    tickets,
    rate: tickets ? Math.round((p.revisits / tickets) * 1000) / 10 : null,
  };
}
