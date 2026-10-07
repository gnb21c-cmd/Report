/* ============================================================
   아스타나키즈 통합데스크(C) 하루 기록 → B 마감 전 숫자 (DeskLive)
   - C 는 키즈 POS 의 %APPDATA%\아스타나키즈 입장 데스크\desk-state\YYYY-MM-DD.json 에 그날 입장을 남김 (astanakiz docs/SHARE.md 3장)
   - 이 함수는 그 파일을 C(키즈 POS) 안에서 읽어 숫자만 만듦 → live/{날짜}.desk 로 보냄. 이름 · 전화는 이 함수 안에서만 쓰고 밖으로 안 나감
   - 네이버 입장 = 이용완료(status 완료) 장수 − 시험 기록(x), 신규 = 네이버 '완료 n' 이 이번이 처음(prevDone 0)인 손님 1명 (연속예약은 한 사람)
   - 30분 칸은 NAVER_SLOTS (10:00 ~ 19:30). 앞뒤 칸 밖 입장은 숫자를 잃지 않게 첫 · 끝 칸에 넣고 outside 로 알림
   ============================================================ */
import type { DeskLive } from "./live";
import { NAVER_SLOTS } from "./part";

/** desk-state 파일 (필요한 칸만) */
export interface DeskState {
  v?: number;
  b?: { no: string; name?: string; phone?: string; slot: number; qty: number; status: string; prevDone?: number | null; chainHead?: string | null }[];
  w?: { id?: string; phone?: string; qty: number; slot: number | null }[];
  x?: string[];
}

/** 분(840 = 14:00) → 30분 칸 번호 (칸 밖이면 첫 · 끝 칸, out = true) */
function slotIndex(min: number | null | undefined): { i: number; out: boolean } {
  if (min == null || !Number.isFinite(min)) return { i: 0, out: true };
  const i = Math.floor((min - 600) / 30);
  if (i < 0) return { i: 0, out: true };
  if (i >= NAVER_SLOTS.length) return { i: NAVER_SLOTS.length - 1, out: true };
  return { i, out: false };
}

export function deskFromState(s: DeskState, date: string): { desk: DeskLive; outside: number } {
  const z = () => NAVER_SLOTS.map(() => 0);
  const naver = z();
  const naverNew = z();
  const onsite = z();
  let outside = 0;
  const skip = new Set(s.x || []);
  // 신규 손님은 한 사람에 한 번 — 같은 이름 + 전화(연속예약)는 가장 이른 칸에 (이 함수 안에서만)
  const firstNew = new Map<string, number>();
  for (const b of s.b || []) {
    if (b.status !== "완료" || skip.has(b.no)) continue;
    const { i, out } = slotIndex(b.slot);
    if (out) outside++;
    naver[i] += Math.max(0, Math.round(Number(b.qty) || 0));
    if (b.prevDone === 0) {
      const who = b.name || b.phone ? `${b.name || ""}|${b.phone || ""}` : `#${b.no}`;
      const prev = firstNew.get(who);
      if (prev == null || i < prev) firstNew.set(who, i);
    }
  }
  for (const i of firstNew.values()) naverNew[i]++;
  for (const w of s.w || []) {
    const { i, out } = slotIndex(w.slot);
    if (out) outside++;
    onsite[i] += Math.max(0, Math.round(Number(w.qty) || 0));
  }
  return { desk: { v: 1, date, naver, naverNew, onsite, eventFree: 0 }, outside };
}
