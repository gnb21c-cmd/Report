/* ============================================================
   네이버 예약 자동 수집 — 다음 날 아침 '예약현황 → 일간 → 전체'에서 어제를 읽어 A 의 네이버 칸(30분마다)을 채움
   - 판매입장권: 회차 칸의 '이용완료 N' (수량 합 = 1건 1장) — 상품은 '평일 무제한' · '야간자유 입장' 두 가지만
   - 신규방문자: 칸을 눌러 나오는 완료자 목록(1줄 = 예약 1건)을 어제 하루 모아, 한 손님이 나온 줄 수가 그 손님의 '완료 N' 과 같으면 처음 온 손님
     '완료 N' 은 손님 아이디를 따라가는 지금까지의 이용완료 예약 건수 — 3장을 한 번에 예약하면 1줄 · 완료 1, 1장씩 3번이면 3줄 · 모두 완료 3
     누적이라 다음 날 아침(다시 오기 전)에 본 어제만 맞음 — 지난 날은 noNew
     문 연 뒤 다시 읽으면 오늘 이용완료 목록도 같이 읽어, 그 손님의 오늘 줄 수만큼 빼고 견줌
   - 10:00 ~ 19:30 칸만 (NAVER_SLOTS). 두 상품은 시간이 겹치지 않음 — 겹치면 더하고 기록에 '겹침'으로 남김
   - 사람이 A 에서 넣은 네이버 칸은 덮지 않음 (자동 수집이 넣은 칸만 다시 씀)
   같은 손님인지는 이름 · 전화번호 뒷자리로 맞춰 보되, 수집기가 읽자마자 알아볼 수 없는 표시(who)로 바꿔 메모리에서만 씀 — 저장 · 기록 · 클라우드에 남기지 않음
   ============================================================ */
import { NAVER_SLOTS, type NaverPart } from "./part";

export const NAVER_AUTO_BY = "자동 수집 (네이버)";

/** 판매입장권으로 세는 상품 — 평일 무제한 · 야간자유 입장 (단체 · 열쇠분실 · 매진 시 상품 · 지난 상품은 뺌) */
export function isNaverTicketProduct(name: string): boolean {
  const s = name.replace(/\s+/g, "");
  if (/~?\d{2}\.\d{1,2}\.\d{1,2}/.test(s)) return false; // '~26.3.31 …' 같은 지난 상품
  return /평일무제한/.test(s) || /야간자유/.test(s);
}

/** '오전10:00' · '오후6:30' · '오후 12:30' · '18:00' · '1:30'(오후) → 'HH:MM' (모르면 null) */
export function naverTime(text: string): string | null {
  const m = text.replace(/\s+/g, "").match(/(오전|오후)?(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let h = Number(m[2]);
  if (m[1] === "오후" && h < 12) h += 12;
  if (m[1] === "오전" && h === 12) h = 0;
  // 오전 · 오후가 없으면 영업시간(10:00 ~ 19:30)으로 — 1:00 ~ 9:59 는 오후
  if (!m[1] && h >= 1 && h <= 9) h += 12;
  return `${String(h).padStart(2, "0")}:${m[3]}`;
}

/** 칸 하나를 읽은 값 */
export interface NaverCellRead {
  product: string;
  /** 회차 시각 (화면 글 그대로, 예: '오전10:00') */
  time: string;
  /** 이용완료 수 */
  done: number;
  /** 신규방문자 — 목록(NaverVisit)을 함께 주면 무시하고 0 이면 됨 · 목록을 못 읽었으면 null */
  first: number | null;
}

/** 완료자 목록의 한 줄 (예약 1건) */
export interface NaverVisit {
  /** 그 줄이 나온 칸의 회차 시각 · 상품 */
  time: string;
  product: string;
  /** 같은 손님 표시 (이름 · 전화 뒷자리를 바꾼 것, 못 알아보면 '') */
  who: string;
  /** 그 손님의 '완료 N' */
  n: number;
  /** 예약번호 (같은 줄 두 번 세지 않으려고) */
  id: string;
}

/** 예약번호로 한 줄씩 (같은 줄 두 번 세지 않음) */
function uniqRows(visits: NaverVisit[], skip = new Set<string>()): [string, NaverVisit][] {
  const rows = new Map<string, NaverVisit>();
  visits.forEach((v, i) => {
    const id = v.id || `#${i}`;
    if (!skip.has(id)) rows.set(id, v);
  });
  return [...rows];
}

/** 오늘(문 연 뒤) 이용완료 목록에서 손님마다 줄 수 — 어제 줄과 같은 예약번호는 뺌 */
function laterRows(visits: NaverVisit[], later: NaverVisit[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const [, v] of uniqRows(later, new Set(visits.map((x) => x.id).filter(Boolean)))) if (v.who) out.set(v.who, (out.get(v.who) || 0) + 1);
  return out;
}

/** 어제 손님별로 묶음 (못 알아본 줄은 한 줄씩) */
function groupsOf(visits: NaverVisit[]): { groups: Map<string, NaverVisit[]>; unknown: number } {
  const groups = new Map<string, NaverVisit[]>();
  let unknown = 0;
  for (const [id, v] of uniqRows(visits)) {
    if (!v.who) unknown++;
    const k = v.who ? `w:${v.who}` : `i:${id}`;
    groups.set(k, [...(groups.get(k) || []), v]);
  }
  return { groups, unknown };
}

/** 어제 완료자 목록 → 30분 칸마다 신규방문자 — 어제 나온 줄 수 = '완료 N' 이면 처음 온 손님, 처음 들어온 판매입장권 칸에 1명
 *  later = 같은 실행에서 읽은 오늘 이용완료 목록 (문 연 뒤 다시 읽을 때) — 그 손님의 오늘 줄 수만큼 '완료 N' 에서 뺌 */
export function naverNewVisitors(visits: NaverVisit[], later: NaverVisit[] = []): { bySlot: number[]; people: number; unknown: number } {
  const bySlot = NAVER_SLOTS.map(() => 0);
  const { groups, unknown } = groupsOf(visits);
  const after = laterRows(visits, later);
  let people = 0;
  for (const [k, g] of groups) {
    const n = Math.max(...g.map((v) => v.n));
    // 못 알아본 줄은 그 줄 하나만 보고 '완료 1' 이면 신규
    if (k.startsWith("i:") ? n !== 1 : g.length + (after.get(k.slice(2)) || 0) !== n) continue;
    const slots = g
      .filter((v) => isNaverTicketProduct(v.product))
      .map((v) => NAVER_SLOTS.indexOf(naverTime(v.time) || ""))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    if (!slots.length) continue;
    bySlot[slots[0]]++;
    people++;
  }
  return { bySlot, people, unknown };
}

/** 어제 · 오늘 모두 이용완료한 손님 — 손님마다 어제 줄 수 · 오늘 줄 수 · '완료 N' · 어제 신규인지 (이름 · 전화 없이) */
export function naverRepeaters(visits: NaverVisit[], later: NaverVisit[]): { yesterday: number; today: number; done: number; isNew: boolean }[] {
  const { groups } = groupsOf(visits);
  const after = laterRows(visits, later);
  const out: { yesterday: number; today: number; done: number; isNew: boolean }[] = [];
  for (const [k, g] of groups) {
    const t = k.startsWith("w:") ? after.get(k.slice(2)) || 0 : 0;
    if (!t) continue;
    const done = Math.max(...g.map((v) => v.n));
    out.push({ yesterday: g.length, today: t, done, isNew: g.length + t === done });
  }
  return out;
}

/** 읽은 칸들 → 네이버 칸 (30분마다 판매입장권 · 신규방문자) */
export function naverPartFrom(date: string, cells: NaverCellRead[], visits?: NaverVisit[], later: NaverVisit[] = []): { part: NaverPart; used: number; skipped: string[]; overlap: string[] } {
  const tickets = NAVER_SLOTS.map(() => 0);
  const newVisitors = NAVER_SLOTS.map(() => 0);
  const by = NAVER_SLOTS.map(() => new Set<string>());
  const skipped: string[] = [];
  let used = 0;
  let unknownFirst = false;
  for (const c of cells) {
    if (!isNaverTicketProduct(c.product)) continue;
    const t = naverTime(c.time);
    const i = t ? NAVER_SLOTS.indexOf(t) : -1;
    if (i < 0) {
      if (c.done > 0) skipped.push(t || c.time);
      continue;
    }
    tickets[i] += c.done;
    if (c.first == null) unknownFirst = unknownFirst || c.done > 0;
    else newVisitors[i] += c.first;
    if (c.done > 0) by[i].add(c.product);
    used++;
  }
  const overlap = NAVER_SLOTS.filter((_, i) => by[i].size > 1);
  if (visits && !unknownFirst) naverNewVisitors(visits, later).bySlot.forEach((n, i) => (newVisitors[i] = n));
  const part: NaverPart = { v: 1, date, tickets, newVisitors, ...(unknownFirst ? { noNew: true } : {}) };
  return { part, used, skipped, overlap };
}

/** 자동 수집이 이 날 네이버 칸을 써도 되나 — 비었거나 자동 수집이 넣은 칸만 */
export function naverAutoWritable(old: { by?: string } | null | undefined): boolean {
  return !old || old.by === NAVER_AUTO_BY;
}

/** 두 네이버 칸을 견줌 — 다른 칸의 시각만 (숫자는 돌려주지 않음, 기록에 남기지 않으려고) */
export function naverDiff(a: NaverPart, b: NaverPart): { tickets: string[]; newVisitors: string[] } {
  const d = (x: number[], y: number[]) => NAVER_SLOTS.filter((_, i) => (x[i] || 0) !== (y[i] || 0));
  return { tickets: d(a.tickets, b.tickets), newVisitors: a.noNew || b.noNew ? [] : d(a.newVisitors, b.newVisitors) };
}

/* ---------- A [신규 다시 확인] — 이 계정만 누를 수 있음 (보안 규칙 firebase/firestore.rules 에도 같은 이메일) ---------- */
export const NAVER_ASK_EMAIL = "mssong@aphavision.co.kr";

/** 요청 — config/naverAsk.json */
export interface NaverAsk {
  /** 누른 시각 (ISO) — 요청 번호로 씀 */
  at: string;
  by: string;
}

/** 결과 — config/naverResult.json (POS 메인 PC 수집이 씀, 이름 · 전화 없음) */
export interface NaverAskResult {
  /** 어느 요청의 결과인지 (NaverAsk.at) */
  ask: string;
  /** run = GitHub 이 수집을 시작시킴 · done = 끝 · fail = 다 못 읽음/멈춤 */
  state: "run" | "done" | "fail";
  at: string;
  date?: string;
  /** 어제 판매입장권 합 */
  tickets?: number;
  /** 어제 신규방문자 (모르면 null) */
  newPeople?: number | null;
  /** 오늘 이용완료 칸 수 · 못 읽은 칸 */
  todayCells?: number;
  todayFail?: number;
  /** 어제 · 오늘 모두 온 손님 — 어제 줄 수 · 오늘 줄 수 · '완료 N' · 어제 신규인지 */
  repeaters?: { yesterday: number; today: number; done: number; isNew: boolean }[];
  problems?: number;
  stopped?: boolean;
}
