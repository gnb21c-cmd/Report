/* ============================================================
   마감 전 영업정보 (오늘) — live/{날짜} 문서 검사
   - 카페 · 키즈 칸은 확정 보고와 같은 계산(buildStorePart)으로 만든 StorePart 를 그대로 받음 → B 의 숫자 · 통계 계산이 확정 날과 같은 길
   - 통합데스크(C) 칸(desk)은 숫자만: 30분 칸별 입장 + 네이버 · 현장 · 이벤트 무료
   - 받은 조각을 검사해 틀리면 B 에 보이지 않고 '확인 필요'로 (틀린 숫자를 보여 주지 않음)
   - 개인정보(전화번호처럼 생긴 글 · 이름 칸)가 섞이면 막음 — 고객 대장은 키즈 POS 안에만 (docs/V2_INTEGRATION.md 정할 것 ③)
   ============================================================ */
import { NAVER_SLOTS, sum, type DayReport, type StorePart } from "./part";
import type { StoreId } from "./types";

/** 통합데스크(C)가 보내는 오늘 숫자 — 모두 NAVER_SLOTS(30분 칸 20개) 순서. 손님 이름 · 전화 없음
 *  C 의 desk-state 에서: 네이버 입장 장수(이용완료, '기록 삭제' 뺌) · 그중 처음 온 손님(네이버 '완료 n' 이 이번이 첫 번째) · 현장 구매 장수 */
export interface DeskLive {
  v: 1;
  date: string;
  /** 네이버 예약 입장 (장) */
  naver: number[];
  /** 그중 신규 손님 (명) — 처음 들어온 칸에 1명 */
  naverNew: number[];
  /** 현장 구매 입장 (장) — POS 영수증(kids 칸)과 견주는 용도 */
  onsite: number[];
  /** 이벤트 무료 입장 (장) */
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
  if (
    !Array.isArray(p.products) ||
    !p.products.every((t) => Array.isArray(t) && t.length === 4 && isMoney(t[2]) && isMoney(t[3]))
  )
    e.push("상품 줄 모양이 다름");
  if (hasPhone(p)) e.push("개인정보(전화번호)로 보이는 글이 있음");
  return e;
}

/** 통합데스크(C) 숫자 검사 */
export function checkDeskLive(d: DeskLive, date: string): string[] {
  const e: string[] = [];
  if (!d || typeof d !== "object") return ["조각이 없음"];
  const allowed = new Set(["v", "date", "naver", "naverNew", "onsite", "eventFree"]);
  const extra = Object.keys(d).filter((k) => !allowed.has(k));
  if (extra.length) e.push(`정해지지 않은 칸 (${extra.join(",")}) — 개인정보가 섞이지 않게 숫자 칸만`);
  if (d.v !== 1) e.push("모양 번호가 다름");
  if (d.date !== date) e.push(`날짜가 다름 (${d.date})`);
  const slots = (x: unknown) => Array.isArray(x) && x.length === NAVER_SLOTS.length && x.every(isCount);
  for (const k of ["naver", "naverNew", "onsite"] as const)
    if (!slots(d[k])) e.push(`${k} 30분 칸 모양이 다름`);
  if (!isCount(d.eventFree)) e.push("eventFree 가 0 이상 정수가 아님");
  if (!e.length && d.naverNew.some((n, i) => n > d.naver[i]))
    e.push("신규 손님 > 네이버 입장 장수인 칸이 있음");
  if (hasPhone(d)) e.push("개인정보(전화번호)로 보이는 글이 있음");
  return e;
}

type Piece<T> = { p: T; at?: string; by?: string } | undefined;

/** live/{날짜} 문서 (칸마다 조각 JSON 을 푼 것) */
export interface LiveDoc {
  date: string;
  at?: string;
  cafe?: Piece<StorePart>;
  kids?: Piece<StorePart>;
  desk?: Piece<DeskLive>;
}

/** live 문서 → 그날 보고 (검사를 통과한 조각만) · 문제 목록 · 데스크 현장 장수(견주기용) */
export function liveReport(
  doc: LiveDoc,
  date: string,
): { report: DayReport | null; problems: string[]; at: string | null; deskOnsite: number | null } {
  const problems: string[] = [];
  const r: DayReport = { date, meta: {} };
  for (const k of ["cafe", "kids"] as const) {
    const x = doc[k];
    if (!x) continue;
    const bad = checkLivePiece(x.p, k, date);
    if (bad.length) problems.push(`${k === "cafe" ? "카페" : "키즈"}: ${bad.join(" · ")}`);
    else {
      r[k] = x.p;
      r.meta![k] = { by: x.by || "마감 전", at: x.at || doc.at || "" };
    }
  }
  let deskOnsite: number | null = null;
  if (doc.desk) {
    const bad = checkDeskLive(doc.desk.p, date);
    if (bad.length) problems.push(`통합데스크: ${bad.join(" · ")}`);
    else {
      const d = doc.desk.p;
      r.naver = { v: 1, date, tickets: [...d.naver], newVisitors: [...d.naverNew] };
      r.meta!.naver = { by: doc.desk.by || "통합데스크", at: doc.desk.at || doc.at || "" };
      deskOnsite = sum(d.onsite);
    }
  }
  const any = !!(r.cafe || r.kids || r.naver);
  return { report: any ? r : null, problems, at: doc.at || null, deskOnsite };
}

/** 확정 보고와 마감 전 보고 합치기 — 칸마다 확정이 있으면 확정, 없으면 마감 전 (provisional 에 그 칸) */
export function mergeLive(
  confirmed: DayReport | undefined,
  live: DayReport | null,
): DayReport & { provisional?: ("cafe" | "kids" | "naver")[] } {
  const out: DayReport & { provisional?: ("cafe" | "kids" | "naver")[] } = confirmed
    ? { ...confirmed, meta: { ...confirmed.meta } }
    : { date: live?.date || "", meta: {} };
  if (!live) return out;
  const prov: ("cafe" | "kids" | "naver")[] = [];
  for (const k of ["cafe", "kids", "naver"] as const) {
    if (out[k] || !live[k]) continue;
    (out as any)[k] = live[k];
    out.meta![k] = live.meta?.[k];
    prov.push(k);
  }
  if (prov.length) out.provisional = prov;
  return out;
}

/** 마지막으로 받은 지 30분이 넘었는지 (B 에 '늦음' 표시) */
export function liveStale(at: string, now: Date = new Date(), minutes = 30): boolean {
  const t = Date.parse(at);
  return !Number.isFinite(t) || now.getTime() - t > minutes * 60_000;
}
