/* ============================================================
   근무자 화면 (2026-10-22 사장님) — 관리자 보고 앱(B)에서 수량만 발췌해 근무자가 간단히 보는 화면 (apps/bakery …/w/<키>/)
   - 첫 화면: 베이커리 · 키친 두 칸 (매장 한 곳에 붙인 QR 로 근무자만 열어 그때그때 봄 — 공유 기능 없음)
   - 베이커리: 현장 태블릿(…/d1/) 생산 명령서 그대로 (d1 은 이 화면으로 합침)
   - 키친: 재방문 이벤트 돈까스 예정(오늘 아직 안 온 이벤트 대상 예약 · 내일 · 2일 뒤 · 3일 뒤 — 통합데스크 deskLive/now 의 revisitDue, docs/WORK.md)
           + [이벤트] 돈까스 평일 · 휴일 평균 판매량 + 키친 상품별 오늘 · 1주 · 그 달 판매량
   - 근무자 주소는 현장 태블릿과 같은 키 번호 — 이 숫자만 복사해 둔 문서만 읽음 (매출 금액 · 손님 정보 없음)
     floor/{키}/work/now = 섹터 숫자 (바리스타 POS 하루 수집이 15분 칸마다, apps/collector/src/work.ts)
     floor/{키}/work/event = 재방문 이벤트 예정 수 (하루 수집이 1분마다 통합데스크 현황에서 옮김, liveLoop.ts)
   ============================================================ */
import { addDays, dayRange } from "./dates";
import type { DeskLive } from "./deskLive";
import { dayKind } from "./forecast";
import type { Board } from "./metrics";

/** 평균을 내는 날 수 (오늘 빼고 지난 28일 — 4주) */
export const WORK_AVG_DAYS = 28;

export interface WorkItem {
  name: string;
  today: number;
  week: number;
  month: number;
}
/** 재방문 이벤트 돈까스 예정 (통합데스크 revisitDue — 손님 정보 없이 수만) */
export interface WorkEvent {
  /** 통합데스크 현황 시각 "YYYY-MM-DD HH:MM" */
  at: string;
  day: string;
  /** 오늘 아직 안 온(이용완료 전) 이벤트 대상 예약 수 */
  today: number | null;
  /** 내일 · 2일 뒤 · 3일 뒤 이벤트 대상 예약 수 */
  ahead: { date: string; n: number }[];
}
/** floor/{키}/work/now — 키친 화면 숫자 */
export interface WorkDoc {
  v: 1;
  date: string;
  /** 센 시각 ISO */
  at: string;
  kitchen: {
    /** [이벤트] 돈까스 하루 평균 판매량 (평일 = 월 ~ 금, 휴일 = 토 · 일 · 공휴일 · 처음 팔린 날부터 지난 4주) — 아직 안 팔렸으면 null */
    donkatsu: { weekday: number | null; holiday: number | null };
    /** 키친 상품별 오늘 · 1주 · 그 달 */
    items: WorkItem[];
  };
}
/** floor/{키}/work/event — 통합데스크가 아직 안 보내면 event = null */
export interface WorkEventDoc {
  v: 1;
  event: WorkEvent | null;
}

/** 재방문 이벤트 사은품 돈까스 상품 — 이름에 '이벤트'(또는 '재방문')와 '돈까스'가 함께 (0원으로 찍어도 셈 · 2026-10-26 ~) */
export function isEventDonkatsu(name: string): boolean {
  const n = (name || "").replace(/\s+/g, "");
  return /돈까스|돈가스/.test(n) && /이벤트|재방문/.test(n);
}

/** 키친 목록에 넣는 상품인지 — 판 값이 있는 줄만(0원 서비스 · 반품 남은 줄 빼고), 이벤트 돈까스는 0원이어도 */
const inList = (name: string, qty: number, net: number) => qty > 0 && (net > 0 || isEventDonkatsu(name));

/** 그날 키친 상품 수량 (그날 자료가 없으면 null) */
function dayQty(board: Board, date: string): Map<string, number> | null {
  if (!board.report(date)?.cafe) return null;
  const m = new Map<string, number>();
  for (const p of board.products(date, date, "키친")) if (p.store === "cafe" && inList(p.name, p.qty, p.net)) m.set(p.name, (m.get(p.name) || 0) + p.qty);
  return m;
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** 근무자 화면 키친 숫자 — date = 오늘(마감 전 카페가 들어간 Board), at = 센 시각 */
export function workSummary(board: Board, date: string, at: string): Omit<WorkDoc, "v"> {
  const monthFrom = `${date.slice(0, 8)}01`;
  const weekFrom = addDays(date, -6);
  const days = new Map<string, Map<string, number> | null>();
  for (const d of dayRange(monthFrom < weekFrom ? monthFrom : weekFrom, date)) days.set(d, dayQty(board, d));
  const qtyIn = (from: string, name: string) => [...days].filter(([d]) => d >= from).reduce((a, [, m]) => a + (m?.get(name) || 0), 0);
  const names = new Set<string>();
  for (const m of days.values()) for (const n of m?.keys() || []) names.add(n);
  const items = [...names]
    .map((name) => ({ name, today: days.get(date)?.get(name) || 0, week: qtyIn(weekFrom, name), month: qtyIn(monthFrom, name) }))
    .filter((i) => i.today + i.week + i.month > 0)
    .sort((a, b) => b.month - a.month || b.week - a.week || a.name.localeCompare(b.name, "ko"));
  // 이벤트 돈까스 평균 — 지난 4주 중 처음 팔린 날부터 (그 전 날은 0 이 아니라 '이벤트 전'), 문 닫은 날 · 자료 없는 날 뺌
  const wd: number[] = [];
  const hd: number[] = [];
  let started = false;
  for (const d of dayRange(addDays(date, -WORK_AVG_DAYS), addDays(date, -1))) {
    const m = dayQty(board, d);
    if (!m) continue;
    const n = [...m].filter(([k]) => isEventDonkatsu(k)).reduce((a, [, q]) => a + q, 0);
    if (!started && !n) continue;
    started = true;
    (dayKind(d) === "휴일" ? hd : wd).push(n);
  }
  return { date, at, kitchen: { donkatsu: { weekday: avg(wd), holiday: avg(hd) }, items } };
}

/** 통합데스크 현황의 재방문 이벤트 예정 → 근무자 화면 숫자 (통합데스크가 아직 안 보내면 null) */
export function workEventOf(live: DeskLive | null | undefined): WorkEvent | null {
  if (!live?.revisitDue) return null;
  return { at: live.at.slice(0, 16), day: live.day, today: live.revisitDue.today, ahead: live.revisitDue.ahead };
}

const PHONE = /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/;
const isCount = (x: unknown) => typeof x === "number" && Number.isInteger(x) && x >= 0;

/** 근무자 문서 검사 — 문제 목록 (없으면 []). 화면은 문제가 있으면 숫자를 보여 주지 않음 */
export function checkWorkDoc(d: WorkDoc): string[] {
  const e: string[] = [];
  if (!d || d.v !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(d.date || "") || !d.kitchen || !Array.isArray(d.kitchen.items)) return ["모양이 다름"];
  for (const k of ["weekday", "holiday"] as const) if (d.kitchen.donkatsu?.[k] != null && !isCount(d.kitchen.donkatsu[k])) e.push("돈까스 평균이 숫자가 아님");
  if (!d.kitchen.items.every((i) => typeof i.name === "string" && i.name.length <= 60 && isCount(i.today) && isCount(i.week) && isCount(i.month))) e.push("키친 상품 줄 모양이 다름");
  if (PHONE.test(JSON.stringify(d))) e.push("개인정보(전화번호)로 보이는 글이 있음");
  return e;
}

/** 이벤트 문서 검사 — 문제 목록 (없으면 []) */
export function checkWorkEvent(d: WorkEventDoc): string[] {
  if (!d || d.v !== 1) return ["모양이 다름"];
  const ev = d.event;
  if (ev == null) return [];
  const e: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.day || "")) e.push("날짜가 이상함");
  if (!(ev.today == null || isCount(ev.today))) e.push("오늘 수가 숫자가 아님");
  if (!Array.isArray(ev.ahead) || ev.ahead.length > 3 || !ev.ahead.every((a) => /^\d{4}-\d{2}-\d{2}$/.test(a.date) && isCount(a.n))) e.push("앞날 수 모양이 다름");
  if (PHONE.test(JSON.stringify(d))) e.push("개인정보(전화번호)로 보이는 글이 있음");
  return e;
}
