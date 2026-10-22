/* ============================================================
   근무자 화면 (2026-10-22 사장님) — 관리자 보고 앱(B)에서 수량만 발췌해 근무자가 간단히 보는 화면 (apps/bakery …/w/<키>/)
   - 맨 위: 재방문 이벤트 돈까스 예정 — 오늘 아직 안 온(이용완료 전) 이벤트 대상 예약 · 내일 · 모레 · 글피 이벤트 대상 예약
     (손님 장부는 키즈 POS 통합데스크에만 있어 통합데스크가 deskLive/now 의 revisitDue 로 보냄 — docs/WORK.md)
   - 바리스타 · 베이커리 · 키친 버튼 → 섹터 화면: 평일 · 휴일 하루 평균 수요량 두 칸 + 상품별 오늘 · 1주 · 월 판매량
   - 근무자 주소는 현장 태블릿과 같은 키 번호 — 이 숫자만 복사해 둔 문서만 읽음 (매출 금액 · 손님 정보 없음)
     floor/{키}/work/now = 섹터 숫자 (바리스타 POS 하루 수집이 15분 칸마다, apps/collector/src/work.ts)
     floor/{키}/work/event = 재방문 이벤트 예정 수 (하루 수집이 1분마다 통합데스크 현황에서 옮김, liveLoop.ts)
   ============================================================ */
import { addDays, dayRange } from "./dates";
import { sortBread } from "./bakery";
import type { DeskLive } from "./deskLive";
import { dayKind } from "./forecast";
import type { Board } from "./metrics";
import { isNotCupName } from "./rules";

export type WorkSectorKey = "바리스타" | "베이커리" | "키친";
export const WORK_SECTORS: WorkSectorKey[] = ["바리스타", "베이커리", "키친"];
/** 평일 · 휴일 평균을 내는 날 수 (오늘 빼고 지난 28일 — 4주) */
export const WORK_AVG_DAYS = 28;

export interface WorkItem {
  name: string;
  today: number;
  week: number;
  month: number;
}
export interface WorkSector {
  /** 바리스타 = 잔 · 베이커리 · 키친 = 개 */
  unit: "잔" | "개";
  /** 하루 평균 수요량 (그 섹터 목록의 하루 합 · 평일 = 월 ~ 금, 휴일 = 토 · 일 · 공휴일) */
  avg: { weekday: number | null; holiday: number | null };
  items: WorkItem[];
}
/** 재방문 이벤트 돈까스 예정 (통합데스크 revisitDue — 손님 정보 없이 수만) */
export interface WorkEvent {
  /** 통합데스크 현황 시각 "YYYY-MM-DD HH:MM" */
  at: string;
  day: string;
  /** 오늘 아직 안 온(이용완료 전) 이벤트 대상 예약 수 */
  today: number | null;
  /** 내일 · 모레 · 글피 이벤트 대상 예약 수 */
  ahead: { date: string; n: number }[];
}
/** floor/{키}/work/now */
export interface WorkDoc {
  v: 1;
  date: string;
  /** 센 시각 ISO */
  at: string;
  sectors: Record<WorkSectorKey, WorkSector>;
}
/** floor/{키}/work/event — 통합데스크가 아직 안 보내면 event = null */
export interface WorkEventDoc {
  v: 1;
  event: WorkEvent | null;
}

/** 근무자 목록에 넣는 상품인지 — 판 값이 있는 줄만(0원 옵션 · 반품 남은 줄 빼고), 바리스타는 잔인 것만(샷 추가 · 원두 · 드립백 등 빼고) */
const inList = (sector: WorkSectorKey, name: string, qty: number, net: number) => qty > 0 && net > 0 && !(sector === "바리스타" && isNotCupName(name));

/** 섹터마다 하루 상품 수량 (그날 자료가 없으면 null) */
function dayQty(board: Board, date: string, sector: WorkSectorKey): Map<string, number> | null {
  if (!board.report(date)?.cafe) return null;
  const m = new Map<string, number>();
  for (const p of board.products(date, date, sector)) if (p.store === "cafe" && inList(sector, p.name, p.qty, p.net)) m.set(p.name, (m.get(p.name) || 0) + p.qty);
  return m;
}

const sum = (m: Map<string, number> | null) => (m ? [...m.values()].reduce((a, b) => a + b, 0) : 0);
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** 근무자 화면 숫자 — date = 오늘(마감 전 카페가 들어간 Board), at = 센 시각 */
export function workSummary(board: Board, date: string, at: string): Omit<WorkDoc, "v"> {
  const monthFrom = `${date.slice(0, 8)}01`;
  const weekFrom = addDays(date, -6);
  const avgDays = dayRange(addDays(date, -WORK_AVG_DAYS), addDays(date, -1));
  const sectors = {} as Record<WorkSectorKey, WorkSector>;
  for (const s of WORK_SECTORS) {
    const days = new Map<string, Map<string, number> | null>();
    for (const d of dayRange(monthFrom < weekFrom ? monthFrom : weekFrom, date)) days.set(d, dayQty(board, d, s));
    const qtyIn = (from: string, name: string) => [...days].filter(([d]) => d >= from).reduce((a, [, m]) => a + (m?.get(name) || 0), 0);
    const names = new Set<string>();
    for (const [d, m] of days) if (d >= monthFrom || d >= weekFrom) for (const n of m?.keys() || []) names.add(n);
    let items = [...names].map((name) => ({ name, today: days.get(date)?.get(name) || 0, week: qtyIn(weekFrom, name), month: qtyIn(monthFrom, name) })).filter((i) => i.today + i.week + i.month > 0);
    items = s === "베이커리" ? sortBread(items) : items.sort((a, b) => b.month - a.month || b.week - a.week || a.name.localeCompare(b.name, "ko"));
    const wd: number[] = [];
    const hd: number[] = [];
    for (const d of avgDays) {
      const m = dayQty(board, d, s);
      if (!m || !sum(m)) continue;
      (dayKind(d) === "휴일" ? hd : wd).push(sum(m));
    }
    sectors[s] = { unit: s === "바리스타" ? "잔" : "개", avg: { weekday: avg(wd), holiday: avg(hd) }, items };
  }
  return { date, at, sectors };
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
  if (!d || d.v !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(d.date || "")) return ["모양이 다름"];
  for (const s of WORK_SECTORS) {
    const x = d.sectors?.[s];
    if (!x || !Array.isArray(x.items)) {
      e.push(`${s} 칸이 없음`);
      continue;
    }
    for (const k of ["weekday", "holiday"] as const) if (x.avg?.[k] != null && !isCount(x.avg[k])) e.push(`${s} 평균이 숫자가 아님`);
    if (!x.items.every((i) => typeof i.name === "string" && i.name.length <= 60 && isCount(i.today) && isCount(i.week) && isCount(i.month))) e.push(`${s} 상품 줄 모양이 다름`);
  }
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
