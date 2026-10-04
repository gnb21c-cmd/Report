/* ============================================================
   네이버 예약 자동 수집 — 다음 날 아침 '예약현황 → 일간 → 전체'에서 어제를 읽어 A 의 네이버 칸(30분마다)을 채움
   - 판매입장권: 회차 칸의 '이용완료 N' (수량 합 = 1건 1장) — 상품은 '평일 무제한' · '야간자유 입장' 두 가지만
   - 신규방문자: 그 칸을 눌러 나오는 완료자 목록에서 이름 밑이 '완료 1' 인 사람 수 (그날까지 방문 1회 = 처음 온 손님)
     '완료 N' 은 손님 아이디를 따라가는 지금까지의 누적이라 다음 날 아침(다시 오기 전)에 본 어제만 맞음 — 지난 날은 noNew
   - 10:00 ~ 19:30 칸만 (NAVER_SLOTS). 두 상품은 시간이 겹치지 않음 — 겹치면 더하고 기록에 '겹침'으로 남김
   - 사람이 A 에서 넣은 네이버 칸은 덮지 않음 (자동 수집이 넣은 칸만 다시 씀)
   이름 · 전화번호는 읽지도 저장하지도 않음 ('완료 N' 의 숫자만 셈)
   ============================================================ */
import { NAVER_SLOTS, type NaverPart } from "./part";

export const NAVER_AUTO_BY = "자동 수집 (네이버)";

/** 판매입장권으로 세는 상품 — 평일 무제한 · 야간자유 입장 (단체 · 열쇠분실 · 매진 시 상품 · 지난 상품은 뺌) */
export function isNaverTicketProduct(name: string): boolean {
  const s = name.replace(/\s+/g, "");
  if (/~?\d{2}\.\d{1,2}\.\d{1,2}/.test(s)) return false; // '~26.3.31 …' 같은 지난 상품
  return /평일무제한/.test(s) || /야간자유/.test(s);
}

/** '오전10:00' · '오후6:30' · '오후 12:30' · '18:00' → 'HH:MM' (모르면 null) */
export function naverTime(text: string): string | null {
  const m = text.replace(/\s+/g, "").match(/(오전|오후)?(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let h = Number(m[2]);
  if (m[1] === "오후" && h < 12) h += 12;
  if (m[1] === "오전" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[3]}`;
}

/** 칸 하나를 읽은 값 */
export interface NaverCellRead {
  product: string;
  /** 회차 시각 (화면 글 그대로, 예: '오전10:00') */
  time: string;
  /** 이용완료 수 */
  done: number;
  /** 그중 '완료 1' (모르면 null) */
  first: number | null;
}

/** 읽은 칸들 → 네이버 칸 (30분마다 판매입장권 · 신규방문자) */
export function naverPartFrom(date: string, cells: NaverCellRead[]): { part: NaverPart; used: number; skipped: string[]; overlap: string[] } {
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
