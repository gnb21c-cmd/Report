/* ============================================================
   키즈 실시간 — 키즈 POS 통합데스크(gnb21c-cmd/astanakiz)가 보내는 지금 현황 (2026-10-16 사장님)
   - 통합데스크가 1분마다 · 바뀌면 5초 안에 boards/{열쇠}/deskLive/now 문서 하나에 덮어씀 (json = 현황 글 astanakiz-live)
     글 모양 · 통합데스크 쪽 설명은 astanakiz docs/LIVE.md
   - B 첫 화면 '입장권 판매 총 수량' 칸 → '키즈 실시간' 화면: 열 때 · 아래로 당길 때 다시 읽음
     네이버(완료 · 미입장 · 잔여 + 시간 칸) · 오늘 입장(네이버 + 현장) · 입장료 매출(장수 × 단가 + 초과요금) · 열쇠 45칸(번호 · 색, 누르면 손님 이름 · 전화)
   - 손님 이름 · 전화번호가 들어감 — 사장님 지시(열쇠 미반납 때 관리자가 전화). 문서 하나만 덮어써서 지난 기록은 안 쌓임
   ============================================================ */
import { kidsPrice } from "./rules";

export const DESK_LIVE = "deskLive";
/** 이만큼(분) 넘게 새 현황이 없으면 '통합데스크 소식 없음' — 통합데스크는 1분마다 보냄 */
export const DESK_LIVE_STALE_MIN = 3;

export type DeskKeyColor = "in" | "pink" | "red";
export interface DeskKey {
  c: DeskKeyColor;
  /** 반납 시각 HH:MM (null = 무제한) */
  end: string | null;
  /** holders 몇 번째 */
  h: number;
}
export interface DeskHolder {
  /** n 네이버 · w 현장 · s 서비스 키 (판매 아님) */
  kind: "n" | "w" | "s";
  name: string;
  /** 숫자만 */
  phone: string;
  /** 대리예약 방문자 "이름(전화)" */
  visitor: string;
  keys: number[];
  /** 입장 시각 · 예약(현장은 입장 타임) HH:MM */
  in: string;
  slot: string;
  /** 네이버 예약번호 · 현장 POS 번호 */
  no: string;
  pos: string;
  qty: number;
  product: string;
  /** 지금 낼 초과요금 · 이미 결제한 초과요금 */
  over: number;
  paid: number;
  /** 서비스 키 수령인 문구 ("10번 김채원님에게 추가 서비스 지급된 열쇠") */
  of: string;
  staff: boolean;
}
export interface DeskSlot {
  t: string;
  done: number;
  conf: number;
  left: number;
  cap: number;
}
export interface DeskLive {
  day: string;
  /** 통합데스크 시각 "YYYY-MM-DD HH:MM:SS" */
  at: string;
  build: string;
  dayKind: string;
  golden: string | null;
  rules: { keys: number; useMinutes: number; pinkUntil: number; overFee: number; overUnitMin: number };
  naver: { done: number; conf: number; left: number; test: number; slots: DeskSlot[]; products: { name: string; done: number }[] };
  people: { naver: number; walk: number; total: number };
  walk: { tickets: number; extra: number; service: number };
  over: { paid: number; count: number; due: number };
  keys: { total: number; used: number; free: number; walkable: number; flex: number; map: Record<number, DeskKey>; holders: DeskHolder[] };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^\d{1,2}:\d{2}$/;
const n0 = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.round(x) : 0);
const str = (x: unknown, max = 80): string => (typeof x === "string" ? x.slice(0, max) : "");
const hm = (x: unknown): string => (typeof x === "string" && HM.test(x) ? x : "");

/** 통합데스크 현황 글 → 검사한 현황 (모양이 틀리면 null — 틀린 숫자를 보여 주지 않음) */
export function parseDeskLive(json: unknown): DeskLive | null {
  let x: any;
  try {
    x = typeof json === "string" ? JSON.parse(json) : json;
  } catch {
    return null;
  }
  if (!x || x.type !== "astanakiz-live" || x.v !== 1 || !DAY.test(x.day || "") || typeof x.at !== "string" || !x.at.startsWith(x.day)) return null;
  if (!x.naver || !Array.isArray(x.naver.slots) || !x.people || !x.keys || !Array.isArray(x.keys.holders) || !x.keys.map || typeof x.keys.map !== "object") return null;
  const r = x.rules || {};
  const total = n0(x.keys.total) || 45;
  const holders: DeskHolder[] = x.keys.holders.map((h: any) => ({
    kind: h && (h.kind === "w" || h.kind === "s") ? h.kind : "n",
    name: str(h?.name, 40),
    phone: str(h?.phone, 20).replace(/\D/g, ""),
    visitor: str(h?.visitor, 60),
    keys: Array.isArray(h?.keys) ? h.keys.map(n0).filter((k: number) => k >= 1 && k <= total) : [],
    in: hm(h?.in),
    slot: hm(h?.slot),
    no: str(h?.no, 30),
    pos: str(h?.pos, 30),
    qty: n0(h?.qty),
    product: str(h?.product, 60),
    over: n0(h?.over),
    paid: n0(h?.paid),
    of: str(h?.of, 120),
    staff: !!h?.staff,
  }));
  const map: Record<number, DeskKey> = {};
  for (const [k, v] of Object.entries(x.keys.map as Record<string, any>)) {
    const no = Number(k);
    if (!(no >= 1 && no <= total) || !v || !holders[v.h]) continue;
    map[no] = { c: v.c === "pink" || v.c === "red" ? v.c : "in", end: hm(v.end) || null, h: Number(v.h) };
  }
  return {
    day: x.day,
    at: x.at.slice(0, 19),
    build: str(x.build, 20),
    dayKind: str(x.dayKind, 60),
    golden: hm(x.golden) || null,
    rules: { keys: total, useMinutes: n0(r.useMinutes) || 110, pinkUntil: n0(r.pinkUntil) || 120, overFee: n0(r.overFee), overUnitMin: n0(r.overUnitMin) || 10 },
    naver: {
      done: n0(x.naver.done),
      conf: n0(x.naver.conf),
      left: n0(x.naver.left),
      test: n0(x.naver.test),
      slots: x.naver.slots.filter((s: any) => s && HM.test(s.t || "")).map((s: any) => ({ t: s.t, done: n0(s.done), conf: n0(s.conf), left: n0(s.left), cap: n0(s.cap) })),
      products: Array.isArray(x.naver.products) ? x.naver.products.map((p: any) => ({ name: str(p?.name, 60), done: n0(p?.done) })).filter((p: { done: number }) => p.done > 0) : [],
    },
    people: { naver: n0(x.people.naver), walk: n0(x.people.walk), total: n0(x.people.total) },
    walk: { tickets: n0(x.walk?.tickets), extra: n0(x.walk?.extra), service: n0(x.walk?.service) },
    over: { paid: n0(x.over?.paid), count: n0(x.over?.count), due: n0(x.over?.due) },
    keys: { total, used: Object.keys(map).length, free: total - Object.keys(map).length, walkable: n0(x.keys.walkable), flex: n0(x.keys.flex), map, holders },
  };
}

/** 통합데스크 시각 → 몇 분 전 (폰 시각 기준, 한국 시간) */
export function deskLiveAgeMin(live: Pick<DeskLive, "at">, now: Date = new Date()): number {
  const t = Date.parse(`${live.at.replace(" ", "T")}+09:00`);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / 60_000)) : Infinity;
}

/** 입장료 매출 (그 시각 기준) — 입장권 장수 × 그날 단가(kidsPrice) + 결제한 초과요금. 받을 초과요금은 따로 */
export function deskLiveSales(live: DeskLive): { tickets: number; price: number; kind: "평일" | "휴일"; fee: number; over: number; total: number; due: number } {
  const { price, kind } = kidsPrice(live.day);
  const tickets = live.people.total;
  const fee = tickets * price;
  return { tickets, price, kind, fee, over: live.over.paid, total: fee + live.over.paid, due: live.over.due };
}

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** 지금 칸 — 시작 시각이 지금(+5분) 이전인 마지막 칸 */
export function deskLiveSlotNow(live: DeskLive, nowHm: string): string | null {
  const m = toMin(nowHm);
  let cur: string | null = null;
  for (const s of live.naver.slots) if (toMin(s.t) <= m + 5) cur = s.t;
  return cur;
}
