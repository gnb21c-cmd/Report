/* ============================================================
   마감 전 영업정보 (오늘) — live/{날짜} 문서 검사
   - 카페 · 키즈 칸은 확정 보고와 같은 계산(buildStorePart)으로 만든 StorePart 를 그대로 받음 → B 의 숫자 · 통계 계산이 확정 날과 같은 길
   - 통합데스크(C) 칸(desk)은 숫자만: 30분 칸별 입장 + 네이버 · 현장 · 이벤트 무료
   - 받은 조각을 검사해 틀리면 B 에 보이지 않고 '확인 필요'로 (틀린 숫자를 보여 주지 않음)
   - 개인정보(전화번호처럼 생긴 글 · 이름 칸)가 섞이면 막음 — 고객 대장은 키즈 POS 안에만 (docs/V2_INTEGRATION.md 정할 것 ③)
   ============================================================ */
import { NAVER_SLOTS, sum, type StorePart } from "./part";
import type { StoreId } from "./types";

/** 통합데스크(C)가 보내는 오늘 숫자 */
export interface DeskLive {
  v: 1;
  date: string;
  /** NAVER_SLOTS 순서 — 30분 칸별 입장 인원 */
  entries: number[];
  /** 그중 네이버 예약 · 현장 구매 · 이벤트 무료 */
  naver: number;
  onsite: number;
  eventFree: number;
}

const PHONE = /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/;
const isCount = (x: unknown) => typeof x === "number" && Number.isInteger(x) && x >= 0;
const isMoney = (x: unknown) => typeof x === "number" && Number.isFinite(x);

/** 글자 칸을 모두 훑어 전화번호처럼 생긴 것이 있는지 */
function hasPhone(x: unknown): boolean {
  if (typeof x === "string") return PHONE.test(x);
  if (Array.isArray(x)) return x.some(hasPhone);
  if (x && typeof x === "object") return Object.values(x).some(hasPhone);
  return false;
}

/** 카페 · 키즈 조각 검사 — 문제 목록 (없으면 []) */
export function checkLivePiece(p: StorePart, store: StoreId, date: string): string[] {
  const e: string[] = [];
  if (!p || typeof p !== "object") return ["조각이 없음"];
  if (p.date !== date) e.push(`날짜가 다름 (${p.date})`);
  if (p.store !== store) e.push(`매장이 다름 (${p.store})`);
  if (p.basis !== "receipt") e.push("영수증별 계산이 아님");
  for (const k of ["posNet", "voucher"] as const) if (!isMoney(p[k])) e.push(`${k} 가 숫자가 아님`);
  for (const k of ["cups", "teams"] as const) if (!isMoney(p[k]) || p[k] < 0) e.push(`${k} 가 숫자가 아님`);
  if (!Array.isArray(p.teamSizes) || sum(p.teamSizes) !== p.teams) e.push("잔 수별 팀 합 ≠ 팀 수");
  if (!p.sectors || !Object.values(p.sectors).every(isMoney)) e.push("분류별 매출이 숫자가 아님");
  if (p.hourly) {
    if (sum(p.hourly.teams) > p.teams) e.push("시간대 팀 합 > 팀 수");
    if (sum(p.hourly.cups) > p.cups + 1e-6) e.push("시간대 잔 합 > 잔 수");
  }
  if (!Array.isArray(p.products) || !p.products.every((t) => Array.isArray(t) && t.length === 4 && isMoney(t[2]) && isMoney(t[3]))) e.push("상품 줄 모양이 다름");
  if (hasPhone(p)) e.push("개인정보(전화번호)로 보이는 글이 있음");
  return e;
}

/** 통합데스크(C) 숫자 검사 */
export function checkDeskLive(d: DeskLive, date: string): string[] {
  const e: string[] = [];
  if (!d || typeof d !== "object") return ["조각이 없음"];
  const allowed = new Set(["v", "date", "entries", "naver", "onsite", "eventFree"]);
  const extra = Object.keys(d).filter((k) => !allowed.has(k));
  if (extra.length) e.push(`정해지지 않은 칸 (${extra.join(",")}) — 개인정보가 섞이지 않게 숫자 칸만`);
  if (d.v !== 1) e.push("모양 번호가 다름");
  if (d.date !== date) e.push(`날짜가 다름 (${d.date})`);
  if (!Array.isArray(d.entries) || d.entries.length !== NAVER_SLOTS.length || !d.entries.every(isCount)) e.push("30분 칸 입장 수 모양이 다름");
  for (const k of ["naver", "onsite", "eventFree"] as const) if (!isCount(d[k])) e.push(`${k} 가 0 이상 정수가 아님`);
  if (!e.length && sum(d.entries) !== d.naver + d.onsite + d.eventFree) e.push("시간대 입장 합 ≠ 네이버 + 현장 + 이벤트");
  if (hasPhone(d)) e.push("개인정보(전화번호)로 보이는 글이 있음");
  return e;
}

/** 마지막으로 받은 지 30분이 넘었는지 (B 에 '늦음' 표시) */
export function liveStale(at: string, now: Date = new Date(), minutes = 30): boolean {
  const t = Date.parse(at);
  return !Number.isFinite(t) || now.getTime() - t > minutes * 60_000;
}
