/* ============================================================
   오늘 마감 전 영업정보 — live/{날짜} 문서 검사 · 확정 보고와 합치기
   - POS 메인 PC(GitHub 실행기 nice-pos)의 하루 수집이 15분마다 매시 0 · 15 · 30 · 45분(10:00 ~ 21:30 · 마지막 21:40 · 21:45 — 2026-10-27 전엔 22:45, 2026-10-19 — 예전 15 · 45분, 아래 liveLoopStep)에 OKPOS 점주 웹에서 오늘 카페 · 키즈 영수증별 엑셀을 받아
     확정 보고와 같은 계산(buildStorePart)으로 만든 StorePart 를 live/{오늘} 의 cafe · kids 칸에 올림 (apps/collector/src/live.ts)
     → B 의 숫자 · 통계 계산이 확정 날과 같은 길
   - 같은 때 네이버 예약현황(오늘)에서 30분 칸별 이용완료 + 확정(입장예정) 장수 → naver 칸 (liveNaverPart, 입장권 상품만 · 신규는 모름)
     → B 키즈 입장료 = (네이버 + 현장) × 그날 단가 (확정 날과 같은 식). 다음 날 아침 확정 네이버(이용완료만)가 오면 그것이 이김
   - B 는 받은 조각을 검사해 틀리면 보이지 않고 '확인 필요'로 (틀린 숫자를 보여 주지 않음)
   - 다음 날 아침 09:12 확정 수집(reports)이 들어오면 칸마다 확정이 이김
   ============================================================ */
import { addDays } from "./dates";
import { deskLiveAgeMin, type DeskLive } from "./deskLive";
import { isNaverTicketProduct, naverTime } from "./naverAuto";
import { NAVER_SLOTS, sum, type DayReport, type NaverPart, type StorePart } from "./part";
import type { StoreId } from "./types";

export const LIVE_LABEL = "마감 전 영업정보";
/** 받는 시간 (한국 시간) — 15분마다 매시 0 · 15 · 30 · 45분 (apps/collector/src/liveLoop.ts · .github/workflows/live-collect.yml) */
export const LIVE_FROM = "10:00";
/** 15분마다 받는 마지막 칸 — 그 뒤는 마지막 두 번(LIVE_LAST_SLOTS) */
export const LIVE_GRID_TO = "21:30";
/** 그날 마지막 집계 두 번 — 매장 포스(POS 메인 PC)가 밤 9시 40 ~ 50분쯤 꺼짐 (일찍 · 늦게 꺼질 수도) (2026-10-27 사장님, 그 전엔 22:45 까지 15분마다) */
export const LIVE_LAST_SLOTS: readonly string[] = ["21:40", "21:45"];
/** 마지막 칸 */
export const LIVE_TO = "21:45";
/** 이만큼(분) 넘게 새 숫자가 없으면 B 에 '늦음' — 15분마다 받지만 PC 를 다시 켰거나 다른 일에 비켜 주는 동안을 넉넉히 */
export const LIVE_STALE_MIN = 60;

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

/* ---------- 통합데스크로 대신 받기 (2026-10-19 사장님 — 네이버를 직접 못 읽거나 오래 걸리면) ----------
   키즈 POS 통합데스크도 같은 네이버 예약현황(입장권 칸 이용완료 · 확정)을 읽어 1분마다 deskLive/now 로 보냄 (docs/KIDS_LIVE.md)
   → 시간 칸마다 이용완료 + 확정 = 보고 앱이 직접 읽는 것과 같은 값 (2026-10-19 19:18 견줌 — 20칸 모두 같음)
   통합데스크는 네이버를 30분마다(:20 · :50, 19:20 까지) · 입장 처리 때 다시 읽어 조금 늦을 수 있음 → 먼저 받은 것보다 합이 작으면 덮지 않음 */
/** 통합데스크 소식이 이만큼(분) 넘게 없으면 쓰지 않음 (키즈 POS 꺼짐 등) */
export const DESK_NAVER_MAX_MIN = 10;

/** 통합데스크 현황 → 마감 전 네이버 칸 (못 쓰면 part = null · why = 까닭). prev = 지금 live 에 있는 네이버 칸 */
export function deskNaverPart(desk: DeskLive | null, date: string, now: Date = new Date(), prev?: NaverPart | null): { part: NaverPart | null; why: string } {
  const no = (why: string) => ({ part: null, why });
  if (!desk) return no("통합데스크 현황이 없거나 모양이 틀림");
  if (desk.day !== date) return no(`통합데스크 현황이 오늘 것이 아님 (${desk.day})`);
  const age = deskLiveAgeMin(desk, now);
  if (age > DESK_NAVER_MAX_MIN) return no(`통합데스크 소식이 ${Number.isFinite(age) ? `${age}분째` : "오래"} 없음`);
  if (desk.naver.products.some((x) => !isNaverTicketProduct(x.name))) return no("통합데스크 네이버 상품이 보고 기준(입장권 상품)과 다름");
  const tickets = NAVER_SLOTS.map(() => 0);
  for (const s of desk.naver.slots) {
    const i = NAVER_SLOTS.indexOf(s.t.padStart(5, "0"));
    if (i < 0) {
      if (s.done + s.conf > 0) return no(`보고 칸에 없는 시각 ${s.t}`);
      continue;
    }
    tickets[i] += s.done + s.conf;
  }
  if (prev && Array.isArray(prev.tickets) && sum(prev.tickets) > sum(tickets)) return no("통합데스크 숫자가 먼저 받은 것보다 작음 (아직 다시 안 읽었을 수 있음)");
  return { part: { v: 1, date, tickets, newVisitors: NAVER_SLOTS.map(() => 0), noNew: true }, why: "" };
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

/** live 문서 → 그날 보고 (검사를 통과한 조각만) · 문제 목록 · 받은 시각
    받은 시각 = 카페 · 키즈 영수 숫자를 받은 시각(둘이 다르면 오래된 쪽) — 문서 시각(at)은 네이버만 새로 올려도 바뀌어서,
    카페를 못 받은 차례에도 '20시 새로고침'으로 보이고 빵 숫자는 19:45 그대로였음 (2026-10-27 사장님). 영수 조각이 없으면 문서 시각 */
export function liveReport(doc: LiveDoc, date: string): { report: DayReport | null; problems: string[]; at: string | null } {
  const problems: string[] = [];
  const r: DayReport = { date, meta: {} };
  const posAt: string[] = [];
  for (const k of ["cafe", "kids"] as const) {
    const x = doc[k];
    if (!x) continue;
    const bad = checkLivePiece(x.p, k, date);
    if (bad.length) problems.push(`${k === "cafe" ? "카페" : "키즈"}: ${bad.join(" · ")}`);
    else {
      r[k] = x.p;
      r.meta![k] = { by: x.by || LIVE_LABEL, at: x.at || doc.at || "" };
      if (x.at && !Number.isNaN(Date.parse(x.at))) posAt.push(x.at);
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
  const oldest = posAt.sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  return { report: r.cafe || r.kids || r.naver ? r : null, problems, at: oldest || doc.at || null };
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

/** 새 숫자가 늦는지 — 받는 시간(10:00 ~ 21:45) 안에서 LIVE_STALE_MIN 분 넘게 새 숫자가 없으면 (첫 수집 직후 · 마지막 뒤 밤에는 아님) */
export function liveStale(at: string | null | undefined, now: Date = new Date(), limit = LIVE_STALE_MIN): boolean {
  const t = minutes(new Date(now.getTime() + 9 * 3600e3).toISOString().slice(11, 16));
  if (t < minutes(LIVE_FROM) + limit || t > minutes(LIVE_TO) + limit) return false;
  const a = at ? Date.parse(at) : NaN;
  return !Number.isFinite(a) || now.getTime() - a > limit * 60_000;
}

/* ---------- 하루 실시간 수집 시간표 (2026-10-19 사장님) ----------
   POS 메인 PC 실행기가 아침에 한 번 시작해 LIVE_LOOP_END 까지 켜져 있으면서 자기 시계로 받을 칸(매시 0 · 15 · 30 · 45분)마다 바로 받음
   (apps/collector/src/liveLoop.ts · .github/workflows/live-collect.yml — GitHub 예약은 '시작'만 맡김. 예약 실행이 20분 남짓 늦거나 자주 건너뛰어서) */
/** 받는 간격(분) */
export const LIVE_EVERY_MIN = 15;
/** 그날 집계를 끝내는 시각 — 21:40 · 21:45 집계가 늦어지거나 포스가 꺼져 응답이 없어도 이 뒤에는 새로 집계하지 않음 (다음 날 10:00 첫 집계) */
export const LIVE_LOOP_END = "21:50";

/** 하루 받을 칸 — 0시부터 분 (10:00 ~ 21:30 은 15분마다 · 마지막 21:40 · 21:45) */
export function liveSlots(): number[] {
  const out: number[] = [];
  for (let t = minutes(LIVE_FROM); t <= minutes(LIVE_GRID_TO); t += LIVE_EVERY_MIN) out.push(t);
  for (const hm of LIVE_LAST_SLOTS) out.push(minutes(hm));
  return out;
}

/** 한국 시간 0시부터 분 (초까지 소수) */
export function kstMinutes(now: Date = new Date()): number {
  const k = new Date(now.getTime() + 9 * 3600e3);
  return k.getUTCHours() * 60 + k.getUTCMinutes() + k.getUTCSeconds() / 60 + k.getUTCMilliseconds() / 60000;
}

/** 클라우드 live 문서의 받은 시각(at)이 들어 있는 칸 — 그 칸은 이미 받음 (다른 날 · 10:00 전 · 없음 → null) */
export function liveSlotBy(at: string | null | undefined, date: string): number | null {
  const a = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(a)) return null;
  if (new Date(a + 9 * 3600e3).toISOString().slice(0, 10) !== date) return null;
  const t = kstMinutes(new Date(a));
  const done = liveSlots().filter((s) => s <= t);
  return done.length ? done[done.length - 1] : null;
}

export type LiveLoopStep = { act: "run"; slot: number } | { act: "wait"; slot: number } | { act: "end" };

/** 다음에 할 일 — now = 지금(분), last = 마지막으로 받은 칸(없으면 null), end = 끝낼 시각(분)
 *  지난 칸을 아직 못 받았으면(15분 안 — 가장 최근 칸 하나만) 바로 받기 · 아니면 다음 칸까지 기다림 · 다음 칸이 끝 시각을 넘으면 끝 */
export function liveLoopStep(now: number, last: number | null, end: number): LiveLoopStep {
  if (now >= end) return { act: "end" };
  const slots = liveSlots().filter((s) => last === null || s > last);
  const due = slots.filter((s) => s <= now);
  const cur = due[due.length - 1];
  if (cur !== undefined && now - cur < LIVE_EVERY_MIN) return { act: "run", slot: cur };
  const next = slots.find((s) => s > now);
  return next === undefined || next >= end ? { act: "end" } : { act: "wait", slot: next };
}

/* ---------- 스스로 이어 가기 (2026-10-27) ----------
   GitHub 예약 실행이 몇 시간씩 늦거나 빠짐 (10-26 은 매시 날씨가 하루 5번 · 하루 수집이 14:05 에야 시작, 10-27 은 아침 수집까지 하나도 안 돎)
   매장 포스(POS 메인 PC)는 밤 9시 40 ~ 50분쯤 꺼지고(일찍 · 늦게 꺼질 수도) 아침 9시 10 ~ 20분쯤 켜짐 (사장님)
   → 하루 수집을 시작할 때 '다음 차례' 하루 수집을 GitHub 에 맡겨 두고 3시간마다 새로 맡김(LIVE_REARM_MIN — 같은 줄에서 가장 새것 하나만 기다림,
     컴퓨터가 꺼지면 실행기를 기다림, 하루까지 · 오래 기다린 것이 하루 한도에 걸리지 않게 새로). 언제 꺼져도 아침에 켜지면 기다리던 다음 차례를 바로 받음
     → 09:27 까지 밤 대기 → 오늘 아직 한 번도 안 돈 아침 수집(자판기 · 네컷 · 주차 / POS 확정 / 네이버)을 시작시키고 끝 → 다음 차례가 하루 수집으로
   - 하루 수집은 21:45 칸을 받고(21:50 에) 끝나면 컴퓨터가 꺼질 때까지 붙들고 있음 (다음 차례가 그 뒤에 줄을 섬) — 꺼지지 않은 밤이면 05:00 에 놓아 줌
   - 다시 시작할 때마다 새 작업이라 GitHub 열쇠(24시간 한도) · 코드가 새로 받아짐
   - 예약은 그대로 둠 (낮에 PC 를 껐다 켰을 때 등 — 하루 수집이 이미 돌고 있거나 줄을 서 있으면 건너뜀)
   - 09:27 = 예약된 아침 수집(09:10 ~ 09:25)이 제때 돌았으면 건드리지 않도록 그 뒤 · 첫 칸 10:00 전 */
export const LIVE_MORNING_KICK = "09:27";

/** 다음 차례를 새로 맡기는 간격(분) — 하루 수집을 시작할 때 맡기고 이만큼마다 · 끝날 때 새로 */
export const LIVE_REARM_MIN = 180;
/** 끝난 뒤 붙들고 있다가 놓아 주는 시각 — 꺼지지 않은 밤 (GitHub 열쇠 24시간 한도 안에서 새 작업으로) */
export const LIVE_HOLD_UNTIL = "05:00";

/** 다음 차례를 (새로) 맡길 때인지 — armedAt = 마지막으로 맡긴 시각(분, 없으면 null) */
export const liveArmDue = (now: number, armedAt: number | null): boolean => armedAt === null || now - armedAt >= LIVE_REARM_MIN;
/** 끝난 뒤 붙들고 있기를 그만둘 때인지 — 자정을 넘어 05:00 ~ 아침 시작(09:27) 전 (21:45 칸을 받고 바로 놓아 주지 않게) */
export const liveHoldOver = (now: number): boolean => now >= minutes(LIVE_HOLD_UNTIL) && now < minutes(LIVE_MORNING_KICK);

/** 하루 수집 프로그램이 지금 할 일 — 끝 시각 뒤 · 아침 시작 전은 밤 대기, 그 사이는 하루 수집 */
export function liveLoopMode(now: number, end: number): "night" | "day" {
  return now >= end || now < minutes(LIVE_MORNING_KICK) ? "night" : "day";
}

/** 아침에 시작시킬 일 (오늘 아직 한 번도 안 돈 것만 — liveLoop.ts) · POS 확정은 어제 날짜를 정해서 (손으로 시작하면 비운 날짜가 오늘이라) */
export function morningJobs(today: string): { file: string; inputs: Record<string, string> }[] {
  return [
    { file: "extra-collect.yml", inputs: {} },
    { file: "pos-collect.yml", inputs: { date: addDays(today, -1) } },
    { file: "naver-collect.yml", inputs: {} },
  ];
}

/* ---------- 보고 앱 오늘 화면 (2026-10-27 사장님) ----------
   첫 집계(10:00) 전인 아침 9시 55분부터 보고 앱이 오늘(마감 전) 화면을 보여 줌 — 그 전(자정 ~ 09:54)은 어제까지 */
export const LIVE_SHOW_FROM = "09:55";

/** 보고 앱이 오늘 화면을 보여 줄 때인지 (한국 시간) */
export const liveShowToday = (now: Date = new Date()): boolean => kstMinutes(now) >= minutes(LIVE_SHOW_FROM);

/** 다음 그 시각(한국 시간 HH:MM)까지 남은 밀리초 — 지금이 딱 그 시각이면 내일 */
export function msUntilKst(hm: string, now: Date = new Date()): number {
  const day = 24 * 3600_000;
  const left = (minutes(hm) - kstMinutes(now)) * 60_000;
  const ms = Math.round(left);
  return ms > 0 ? ms : ms + day;
}
