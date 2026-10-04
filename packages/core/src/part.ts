/* ============================================================
   매장 하루치 계산 (A 에서 함) → C 로 보내는 '보고 자료'
   - StorePart: 영수증별 엑셀 한 개(한 매장 하루) → 분류별 · 시간대별 매출, 잔 · 팀(영수증) 수, 상품별 합계, 키즈 입장권
   - NaverPart: A 에 손으로 넣은 네이버 예약 시간대별 판매 입장권 수 · 신규 방문자 수
   - DayReport: C 가 한 날짜의 조각들을 합친 것 (B 가 읽음)
   시간대: 10시 ~ 22시를 한 시간씩 12칸 (10시 전 주문은 10시 칸, 22시 넘은 주문은 21시 칸에)
   ============================================================ */
import { guessSector, kidsKind, SECTORS, sectorFromCategory, type KidsKind, type Sector } from "./classify";
import { cupsPerItem, isCup, isHalfOff, isKidsCoupon, isVoucherPayment, oldTicketPrice } from "./rules";
import { removeRefunds, type ReceiptLine, type ReceiptSheet, type RefundMatch } from "./receipt";
import type { SaleLine, StoreId } from "./types";
import type { CashPart } from "./cash";
import type { ExtraPart } from "./extra";

export const HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
export const hourLabel = (h: number) => `${h}시`;

/** 'HH:MM:SS' → 시간 칸 번호 0~11 (모르면 null) */
export function hourIndex(time: string): number | null {
  const m = /^(\d{1,2}):/.exec(time || "");
  if (!m) return null;
  const h = Number(m[1]);
  return Math.min(HOURS.length - 1, Math.max(0, h - HOURS[0]));
}

/** 네이버 예약 시간대 (30분) — 10:00 ~ 19:30 */
export const NAVER_SLOTS = Array.from({ length: 20 }, (_, i) => `${String(10 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

const zeros = (n = HOURS.length) => Array.from({ length: n }, () => 0);
const bySector = <T,>(f: () => T): Record<Sector, T> => ({ 바리스타: f(), 베이커리: f(), 키친: f(), 기타: f() });

export interface KidsNumbers {
  /** 0원 입장 발행 (네이버 + 현장 손님 모두) */
  issued: number;
  /** 돈 받은 입장권 */
  walkIn: number;
  walkInNet: number;
  /** 교환권 방식 2만원 입장 발행 · 2만원 현장 결제 (2025-01 평일) — 없으면 0 */
  issued20?: number;
  walkIn20?: number;
  /** 0원 쿠폰 입장 (팀) */
  eventFree: number;
  /** 입장권 외 매출 (추가 인원 · 간식 등 → 기타) */
  other: number;
  hourly: { issued: number[]; walkIn: number[]; eventFree: number[]; other: number[] } | null;
}

/** [상품명, 분류(카페: 섹터 · 키즈: 종류), 수량, 실매출] */
export type ProductTuple = [string, Sector | KidsKind, number, number];

export interface StorePart {
  v: 1;
  store: StoreId;
  date: string;
  /** receipt = 영수증별 엑셀 (시간대·팀 있음) · daily = 상품별(일자별) 엑셀 (지난 자료, 하루 합계뿐) */
  basis: "receipt" | "daily";
  file: string;
  /** 엑셀 합계 줄 실매출 (검산) */
  sheetNet: number | null;
  /** 정리한 실매출 합 (상품권 결제 줄 포함 = POS 실매출) */
  posNet: number;
  /** 상품권·교환권 결제 (양수) — 결제 수단이라 매출에서 빼지 않음 */
  voucher: number;
  /** 그중 키즈 교환권 · 사은권 ('[아키 2만원] 교환권', 양수) — 2026-04 부터 키즈 매출에서 뺌 (없으면 0) */
  kidsCoupon?: number;
  /** 베이커리 50% 마감 할인으로 팔린 개수 (영수증별 · 카페만. 이 칸이 생기기 전에 올린 날은 없음 = 모름) */
  bakeryHalf?: number;
  /** 분류별 실매출 (카페아스타나). 아스타나키즈는 모두 0 (kids 칸에) */
  sectors: Record<Sector, number>;
  cups: number;
  /** 팀 = 영수증 묶음 (같은 포스번호 + 영수증번호) */
  teams: number;
  /** 잔 수별 팀 수 [0잔, 1, 2, 3, 4, 5잔 이상] */
  teamSizes: number[];
  hourly: { sectors: Record<Sector, number[]>; cups: number[]; teams: number[] } | null;
  products: ProductTuple[];
  refunds: { receipts: number; lines: number; unmatched: number; amount: number };
  kids: KidsNumbers | null;
}

export interface NaverPart {
  v: 1;
  date: string;
  /** NAVER_SLOTS 순서 — 판매 입장권 수 */
  tickets: number[];
  /** 신규 방문자 수 (마감 현재 방문 완료 횟수 1인 사람) */
  newVisitors: number[];
  /** 지난 자료(캡처 정리) — 신규방문자는 알 수 없음 (방문 횟수가 계속 쌓여 그날 1회째였는지 지금은 모름) */
  noNew?: boolean;
}

export interface PartMeta {
  /** 넣은 사람 */
  by: string;
  /** 받은 시각 ISO */
  at: string;
  file?: string;
}

/** 한 날짜의 보고 자료 (C 가 조각을 합침) */
export interface DayReport {
  date: string;
  cafe?: StorePart;
  kids?: StorePart;
  naver?: NaverPart;
  /** 자금 현황 (cash.ts) */
  cash?: CashPart;
  /** POS 밖 매출 — 자판기 · 인생네컷 · 주차 (extra.ts) */
  extra?: ExtraPart;
  meta?: { cafe?: PartMeta; kids?: PartMeta; naver?: PartMeta; cash?: PartMeta; extra?: PartMeta };
  /** C 가 합친 시각 ISO */
  at?: string;
}

export const sum = (xs: number[]) => xs.reduce((s, x) => s + (Number(x) || 0), 0);

/** 상품명 → 분류 (분류표에 있으면 그것, 없으면 짐작) */
export type SectorOf = (name: string) => Sector;

export function sectorLookup(table: Record<string, string>): SectorOf {
  return (name) => {
    const v = table[name];
    return v === "바리스타" || v === "베이커리" || v === "키친" || v === "기타" ? v : guessSector(name);
  };
}

export interface BuildResult {
  part: StorePart;
  matches: RefundMatch[];
  /** 짝을 못 찾은 반품 */
  unmatched: ReceiptLine[];
  /** 정리한 줄 (C 에 함께 보관 — 규칙이 바뀌면 다시 계산) */
  lines: ReceiptLine[];
}

/** 영수증별 엑셀 → 매장 하루치 */
export function buildStorePart(input: { store: StoreId; date: string; file: string; sheet: ReceiptSheet; sectorOf: SectorOf }): BuildResult {
  const { store, date, file, sheet, sectorOf } = input;
  const { lines, matches, unmatched } = removeRefunds(sheet.lines);
  const part = emptyPart(store, date, "receipt", file, sheet.sheetNet);
  if (store === "cafe") part.bakeryHalf = 0;
  const hourly = (part.hourly = { sectors: bySector(() => zeros()), cups: zeros(), teams: zeros() });
  const kh = store === "kids" ? (part.kids!.hourly = { issued: zeros(), walkIn: zeros(), eventFree: zeros(), other: zeros() }) : null;
  const teams = new Map<string, { cups: number; hour: number | null; time: string }>();
  const products = new Map<string, ProductTuple>();

  for (const l of lines) {
    part.posNet += l.net;
    const h = hourIndex(l.time);
    const key = `${l.pos}|${l.receipt}`;
    let team = teams.get(key);
    if (!team) teams.set(key, (team = { cups: 0, hour: h, time: l.time }));
    else if (l.time && (!team.time || l.time < team.time)) Object.assign(team, { hour: h, time: l.time });
    if (isVoucherPayment(l)) {
      part.voucher -= l.net;
      if (isKidsCoupon(l)) part.kidsCoupon = (part.kidsCoupon || 0) - l.net;
      continue;
    }
    const cls = addLine(part, store, l, sectorOf, products);
    if (store === "cafe" && cls.sector === "베이커리" && isHalfOff(l)) part.bakeryHalf = (part.bakeryHalf || 0) + l.qty;
    if (cls.cups) {
      team.cups += cls.cups;
      if (h != null) hourly.cups[h] += cls.cups;
    }
    if (h == null) continue;
    if (store === "cafe") hourly.sectors[cls.sector as Sector][h] += l.net;
    else if (kh) {
      if (cls.sector === "입장발행") kh.issued[h] += l.qty;
      else if (cls.sector === "현장결제") kh.walkIn[h] += l.qty;
      else if (cls.sector === "이벤트무료") kh.eventFree[h] += l.qty;
      else kh.other[h] += l.net;
    }
  }
  for (const t of teams.values()) {
    part.teams++;
    part.teamSizes[Math.min(5, Math.max(0, Math.round(t.cups)))]++;
    if (t.hour != null) hourly.teams[t.hour]++;
  }
  part.products = finishProducts(products);
  part.refunds = {
    receipts: matches.length,
    lines: matches.reduce((s, m) => s + m.lines, 0),
    unmatched: unmatched.length,
    amount: matches.reduce((s, m) => s + m.amount, 0),
  };
  return { part, matches, unmatched, lines };
}

/** 상품별(일자별) 엑셀의 하루치 → 매장 하루치 (지난 자료: 시간대 · 팀 없음) */
export function buildDailyPart(input: { store: StoreId; date: string; file: string; rows: SaleLine[]; sectorOf: SectorOf }): StorePart {
  const { store, date, file, rows, sectorOf } = input;
  const part = emptyPart(store, date, "daily", file, null);
  const products = new Map<string, ProductTuple>();
  for (const r of rows) {
    part.posNet += r.net;
    if (isVoucherPayment(r)) {
      part.voucher -= r.net;
      if (isKidsCoupon(r)) part.kidsCoupon = (part.kidsCoupon || 0) - r.net;
      continue;
    }
    const fromCat = sectorFromCategory(r.cat1);
    addLine(part, store, r, fromCat ? () => fromCat : sectorOf, products, r.cat1);
  }
  part.hourly = null;
  if (part.kids) part.kids.hourly = null;
  part.products = finishProducts(products);
  return part;
}

function emptyPart(store: StoreId, date: string, basis: StorePart["basis"], file: string, sheetNet: number | null): StorePart {
  return {
    v: 1,
    store,
    date,
    basis,
    file: file.slice(0, 120),
    sheetNet,
    posNet: 0,
    voucher: 0,
    sectors: bySector(() => 0),
    cups: 0,
    teams: 0,
    teamSizes: zeros(6),
    hourly: null,
    products: [],
    refunds: { receipts: 0, lines: 0, unmatched: 0, amount: 0 },
    kids: store === "kids" ? { issued: 0, walkIn: 0, walkInNet: 0, eventFree: 0, other: 0, hourly: null } : null,
  };
}

/** 한 줄을 매장 하루치에 더함 → 분류 · 잔 수 */
function addLine(
  part: StorePart,
  store: StoreId,
  l: { name: string; qty: number; gross: number; net: number },
  sectorOf: SectorOf,
  products: Map<string, ProductTuple>,
  cat1 = "",
): { sector: Sector | KidsKind; cups: number } {
  let sector: Sector | KidsKind;
  let cups = 0;
  if (store === "cafe") {
    const s = sectorOf(l.name);
    sector = s;
    part.sectors[s] += l.net;
    if (isCup("cafe", { name: l.name, cat1, gross: l.gross, net: l.net }, s)) cups = l.qty * cupsPerItem(l.name);
  } else {
    const k = kidsKind({ name: l.name, gross: l.gross, net: l.net, cat1, qty: l.qty });
    sector = k;
    const kids = part.kids!;
    if (k === "입장발행") {
      kids.issued += l.qty;
      if (oldTicketPrice(l.name) === 20000) kids.issued20 = (kids.issued20 || 0) + l.qty;
    } else if (k === "현장결제") {
      kids.walkIn += l.qty;
      kids.walkInNet += l.net;
      if (l.qty && Math.round(l.gross / l.qty) === 20000) kids.walkIn20 = (kids.walkIn20 || 0) + l.qty;
    } else if (k === "이벤트무료") kids.eventFree += l.qty;
    else {
      kids.other += l.net;
      if (isCup("kids", { name: l.name, cat1, gross: l.gross, net: l.net }, "기타")) cups = l.qty * cupsPerItem(l.name);
    }
  }
  part.cups += cups;
  const key = `${sector}|${l.name}`;
  const p = products.get(key);
  if (p) {
    p[2] += l.qty;
    p[3] += l.net;
  } else products.set(key, [l.name, sector, l.qty, l.net]);
  return { sector, cups };
}

function finishProducts(map: Map<string, ProductTuple>): ProductTuple[] {
  return [...map.values()].filter((p) => p[2] !== 0 || p[3] !== 0).sort((a, b) => b[3] - a[3] || b[2] - a[2] || a[0].localeCompare(b[0]));
}

/** 네이버 표 → 조각 (빈칸 = 0, 음수·소수는 고침) */
export function buildNaverPart(date: string, tickets: (number | string | null)[], newVisitors: (number | string | null)[]): NaverPart {
  const fix = (xs: (number | string | null)[]) => NAVER_SLOTS.map((_, i) => Math.max(0, Math.round(Number(xs[i]) || 0)));
  return { v: 1, date, tickets: fix(tickets), newVisitors: fix(newVisitors) };
}

/** 분류별 합이 맞는지 등 — A 가 보내기 전에 보여 줄 확인 */
export function partCheck(part: StorePart): { ok: boolean; text: string } {
  if (part.sheetNet == null) return { ok: true, text: "엑셀 합계 줄 없음" };
  const diff = Math.round(part.posNet - part.sheetNet);
  return diff === 0 ? { ok: true, text: "엑셀 합계와 일치" } : { ok: false, text: `엑셀 합계와 ${diff.toLocaleString("ko-KR")}원 차이` };
}

/** 분류 합계 (상품권 결제 빼고) */
export function partSales(part: StorePart): number {
  return SECTORS.reduce((s, k) => s + part.sectors[k], 0) + (part.kids ? part.kids.walkInNet + part.kids.other : 0);
}
