/* ============================================================
   오늘 마감 전 영업정보 — live/{날짜} 문서 검사 · 확정 보고와 합치기
   - POS 메인 PC(GitHub 실행기 nice-pos)가 매시 15분 · 45분(10:15 ~ 22:45)에 OKPOS 점주 웹에서 오늘 카페 · 키즈 영수증별 엑셀을 받아
     확정 보고와 같은 계산(buildStorePart)으로 만든 StorePart 를 live/{오늘} 의 cafe · kids 칸에 올림 (apps/collector/src/live.ts)
     → B 의 숫자 · 통계 계산이 확정 날과 같은 길
   - 같은 때 네이버 예약현황(오늘)에서 30분 칸별 이용완료 + 확정(입장예정) 장수 → naver 칸 (liveNaverPart, 입장권 상품만 · 신규는 모름)
     → B 키즈 입장료 = (네이버 + 현장) × 그날 단가 (확정 날과 같은 식). 다음 날 아침 확정 네이버(이용완료만)가 오면 그것이 이김
   - B 는 받은 조각을 검사해 틀리면 보이지 않고 '확인 필요'로 (틀린 숫자를 보여 주지 않음)
   - 다음 날 아침 09:12 확정 수집(reports)이 들어오면 칸마다 확정이 이김
   ============================================================ */
import { isNaverTicketProduct, naverTime } from "./naverAuto";
import { NAVER_SLOTS, sum, type DayReport, type NaverPart, type StorePart } from "./part";
import type { StoreId } from "./types";

export const LIVE_LABEL = "마감 전 영업정보";
/** 받는 시간 (한국 시간) — 매시 15분 · 45분 (.github/workflows/live-collect.yml) */
export const LIVE_FROM = "10:15";
export const LIVE_TO = "22:45";
/** 이만큼(분) 넘게 새 숫자가 없으면 B 에 '늦음' — 30분마다 받지만 GitHub 예약이 늦게 시작할 때가 있어 넉넉히 */
export const LIVE_STALE_MIN = 70;

/** 그 날짜가 확정(어제까지) · 마감 전(오늘) · 앞날 중 어디인지 */
export function dayStage(date: string, today: string): "closed" | "live" | "future" {
  return date < today ? "closed" : date === today ? "live" : "future";
}

const PHONE = /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/;
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

const isCount = (x: unknown) => typeof x === "number" && Number.isInteger(x) && x >= 0;

/** 오늘 네이버 — 예약현황 칸(상품 · 회차 시각 · 장수)을 이용완료 · 확정(입장예정) 따로 읽은 것을 30분 칸으로 합침 (입장권 상품만) */
export function liveNaverPart(date: string, done: { product: string; time: string; done: number }[], booked: { product: string; time: string; done: number }[]): NaverPart {
  const tickets = NAVER_SLOTS.map(() => 0);
  for (const c of [...done, ...booked]) {
    if (!isNaverTicketProduct(c.product)) continue;
    const t = naverTime(c.time);
    const i = t ? NAVER_SLOTS.indexOf(t) : -1;
    if (i >= 0 && isCount(c.done)) tickets[i] += c.done;
  }
  return { v: 1, date, tickets, newVisitors: NAVER_SLOTS.map(() => 0), noNew: true };
}

/** 네이버 칸 검사 — 30분 칸 20개 · 0 이상 정수 · 정해진 칸만 (이름 · 전화 같은 것이 섞이지 않게) */
export function checkLiveNaver(p: NaverPart, date: string): string[] {
  const e: string[] = [];
  if (!p || typeof p !== "object") return ["조각이 없음"];
  const extra = Object.keys(p).filter((k) => !["v", "date", "tickets", "newVisitors", "noNew"].includes(k));
  if (extra.length) e.push(`정해지지 않은 칸 (${extra.join(",")})`);
  if (p.v !== 1) e.push("모양 번호가 다름");
  if (p.date !== date) e.push(`날짜가 다름 (${p.date})`);
  for (const k of ["tickets", "newVisitors"] as const) if (!Array.isArray(p[k]) || p[k].length !== NAVER_SLOTS.length || !p[k].every(isCount)) e.push(`${k} 30분 칸 모양이 다름`);
  if (hasPhone(p)) e.push("개인정보(전화번호)로 보이는 글이 있음");
  return e;
}

type Piece<T> = { p: T; at?: string; by?: string } | undefined;
export type LiveKind = "cafe" | "kids" | "naver";

/** live/{날짜} 문서 (칸마다 조각 JSON 을 푼 것) */
export interface LiveDoc {
  date: string;
  at?: string;
  cafe?: Piece<StorePart>;
  kids?: Piece<StorePart>;
  naver?: Piece<NaverPart>;
}

/** live 문서 → 그날 보고 (검사를 통과한 조각만) · 문제 목록 · 받은 시각 */
export function liveReport(doc: LiveDoc, date: string): { report: DayReport | null; problems: string[]; at: string | null } {
  const problems: string[] = [];
  const r: DayReport = { date, meta: {} };
  for (const k of ["cafe", "kids"] as const) {
    const x = doc[k];
    if (!x) continue;
    const bad = checkLivePiece(x.p, k, date);
    if (bad.length) problems.push(`${k === "cafe" ? "카페" : "키즈"}: ${bad.join(" · ")}`);
    else {
      r[k] = x.p;
      r.meta![k] = { by: x.by || LIVE_LABEL, at: x.at || doc.at || "" };
    }
  }
  if (doc.naver) {
    const bad = checkLiveNaver(doc.naver.p, date);
    if (bad.length) problems.push(`네이버: ${bad.join(" · ")}`);
    else {
      r.naver = doc.naver.p;
      r.meta!.naver = { by: doc.naver.by || LIVE_LABEL, at: doc.naver.at || doc.at || "" };
    }
  }
  return { report: r.cafe || r.kids || r.naver ? r : null, problems, at: doc.at || null };
}

/** 확정 보고와 마감 전 보고 합치기 — 칸마다 확정이 있으면 확정, 없으면 마감 전 (provisional 에 그 칸) */
export function mergeLive(confirmed: DayReport | undefined, live: DayReport | null): DayReport & { provisional?: LiveKind[] } {
  const out: DayReport & { provisional?: LiveKind[] } = confirmed ? { ...confirmed, meta: { ...confirmed.meta } } : { date: live?.date || "", meta: {} };
  if (!live) return out;
  const prov: LiveKind[] = [];
  for (const k of ["cafe", "kids", "naver"] as const) {
    if (out[k] || !live[k]) continue;
    (out as any)[k] = live[k];
    out.meta![k] = live.meta?.[k];
    prov.push(k);
  }
  if (prov.length) out.provisional = prov;
  return out;
}

/**
 * 아직 확정 카페 칸이 없는 날을 그날 마감 전 숫자(검사를 통과한 카페 칸)로 채운 보고 목록 — 목요일 새벽 주간 계획에서 수요일
 * 확정 카페가 있으면 그대로 · 마감 전 문서가 없거나 검사에 걸려도 그대로 (그때는 화요일까지로 셈). at = 그 카페 숫자를 받은 시각
 */
export function withLiveCafe(reports: DayReport[], doc: LiveDoc | null | undefined, date: string): { reports: DayReport[]; at: string | null } {
  if (!doc || reports.some((r) => r.date === date && r.cafe)) return { reports, at: null };
  const lr = liveReport(doc, date);
  const cafe = lr.report?.cafe;
  if (!cafe) return { reports, at: null };
  const had = reports.find((r) => r.date === date);
  const day: DayReport = { ...(had || { date }), date, cafe, meta: { ...had?.meta, cafe: lr.report!.meta!.cafe } };
  return { reports: [...reports.filter((r) => r.date !== date), day], at: doc.cafe?.at || lr.at };
}

const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** 새 숫자가 늦는지 — 받는 시간(10:15 ~ 22:45) 안에서 LIVE_STALE_MIN 분 넘게 새 숫자가 없으면 (첫 수집 직후 · 마지막 뒤 밤에는 아님) */
export function liveStale(at: string | null | undefined, now: Date = new Date(), limit = LIVE_STALE_MIN): boolean {
  const t = minutes(new Date(now.getTime() + 9 * 3600e3).toISOString().slice(11, 16));
  if (t < minutes(LIVE_FROM) + limit || t > minutes(LIVE_TO) + limit) return false;
  const a = at ? Date.parse(at) : NaN;
  return !Number.isFinite(a) || now.getTime() - a > limit * 60_000;
}
