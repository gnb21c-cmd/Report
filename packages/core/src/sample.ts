/* ============================================================
   체험판용 가짜 보고 자료 — 날짜마다 늘 같은 값이 나옴 (실제 매출 아님)
   C 가 합친 모양(DayReport) 그대로: 카페 · 키즈 영수증 계산 결과 + 네이버 시간대 입력
   ============================================================ */
import { addDays, dayRange, weekday } from "./dates";
import { isOffDay, kidsPrice } from "./rules";
import { HOURS, NAVER_SLOTS, type DayReport, type ProductTuple, type StorePart } from "./part";
import type { Sector } from "./classify";
import { CASH_ACCOUNTS, type CashPart, type CashRow } from "./cash";

interface Item {
  name: string;
  sector: Sector;
  price: number;
  /** 평일 하루 평균 수량 */
  base: number;
  /** 잔 수 (음료 1, 아니면 0) */
  cup: number;
}

const item = (sector: Sector, cup: number) => ([name, price, base]: [string, number, number]): Item => ({ name, sector, price, base, cup });
const MENU: Item[] = [
  ...(
    [
      ["[ICE] 아메리카노", 6500, 70], ["[HOT] 아메리카노", 6500, 30], ["[ICE] 카페라떼", 7000, 18], ["[HOT] 카페라떼", 7000, 10],
      ["[ICE] 바닐라라떼", 7500, 9], ["[ICE] 딸기라떼", 7500, 12], ["레몬에이드", 7500, 8], ["자몽에이드", 7500, 6],
      ["문경오미자에이드", 7500, 6], ["블루베리요거트", 8000, 6], ["아이스티", 7500, 6], ["[HOT]로얄캐모마일", 6500, 5],
      ["[ICE]콜드브루", 7500, 3], ["생맥주[켈리]", 5500, 4],
    ] as [string, number, number][]
  ).map(item("바리스타", 1)),
  ...(
    [
      ["소금빵", 3800, 34], ["쫀득크림빵", 6200, 22], ["감자파니니", 6500, 18], ["몽블랑", 6500, 15], ["메가모카번", 5500, 13],
      ["우유모닝빵", 5200, 12], ["에그타르트", 3700, 10], ["시나몬롤", 4500, 9], ["갈릭바게트볼", 5500, 10], ["초코스콘", 4600, 6],
      ["무화과파운드", 4900, 4], ["딸기잼", 1500, 2],
    ] as [string, number, number][]
  ).map(item("베이커리", 0)),
  ...(
    [
      ["부라타토마토파스타", 23000, 10], ["갑오징어크림리조또", 24000, 8], ["수제돈까스", 14000, 14], ["볼로네제라구파스타", 24000, 6],
      ["소불고기덮밥", 17000, 6], ["모듬버섯샐러드", 16000, 5], ["시그니처 플래터", 43000, 3], ["비프스테이크(230g)", 28000, 3], ["프렌치프라이", 12000, 3],
    ] as [string, number, number][]
  ).map(item("키친", 0)),
  ...([["아크릴키링", 5900, 1], ["이벤트 초", 3500, 1]] as [string, number, number][]).map(item("기타", 0)),
];

/** 분류별 시간대 모양 (10시 ~ 21시) */
const PROFILE: Record<Sector, number[]> = {
  바리스타: [6, 7, 11, 12, 12, 10, 9, 6, 6, 7, 5, 2],
  베이커리: [10, 9, 9, 7, 12, 11, 9, 5, 4, 4, 3, 1],
  키친: [3, 8, 17, 14, 2, 4, 5, 9, 14, 12, 6, 1],
  기타: [1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 0],
};

/** 날짜·상품마다 같은 값이 나오는 0~1 난수 */
function rand(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function dayFactor(date: string): number {
  const w = weekday(date);
  const weekend = isOffDay(date) ? 1.8 : w === 5 ? 1.2 : 1;
  const month = Number(date.slice(5, 7));
  const season = [0, 0.85, 0.85, 0.95, 1.05, 1.15, 1.0, 1.2, 1.25, 1.05, 1.1, 0.95, 1.0][month];
  const growth = 1 + ((Date.parse(date) - Date.parse("2025-01-01")) / (365 * 86400_000)) * 0.12;
  return weekend * season * growth * (0.85 + rand(date) * 0.3);
}

/** 최근 몇 주 동안 점심 손님이 오후로 조금씩 옮겨 가는 흐름 (체험판에서 추세가 보이게) */
function drift(date: string): number {
  const weeks = (Date.parse(date) - Date.parse("2026-08-20")) / (7 * 86400_000);
  return Math.max(0, Math.min(7, weeks));
}

/** qty 개를 시간대 모양대로 나눔 */
function spread(qty: number, profile: number[], seed: string): number[] {
  const tot = profile.reduce((s, x) => s + x, 0);
  const out = profile.map((w) => Math.floor((qty * w) / tot));
  let left = qty - out.reduce((s, x) => s + x, 0);
  for (let i = 0; left > 0; i++, left--) {
    let best = 0;
    let bestV = -1;
    profile.forEach((w, j) => {
      const v = w * (0.5 + rand(`${seed}${i}${j}`));
      if (v > bestV) [best, bestV] = [j, v];
    });
    out[best]++;
  }
  return out;
}

function cafePart(date: string): StorePart {
  const f = dayFactor(date);
  const dr = drift(date);
  const sectors: Record<Sector, number> = { 바리스타: 0, 베이커리: 0, 키친: 0, 기타: 0 };
  const hs: Record<Sector, number[]> = { 바리스타: HOURS.map(() => 0), 베이커리: HOURS.map(() => 0), 키친: HOURS.map(() => 0), 기타: HOURS.map(() => 0) };
  const cupsH = HOURS.map(() => 0);
  const products: ProductTuple[] = [];
  let cups = 0;
  for (const it of MENU) {
    const qty = Math.max(0, Math.round(it.base * f * (0.6 + rand(date + it.name) * 0.8)));
    if (!qty) continue;
    const disc = rand(date + it.name + "d") < 0.2 ? 0.95 : 1;
    const net = Math.round((qty * it.price * disc) / 100) * 100;
    sectors[it.sector] += net;
    products.push([it.name, it.sector, qty, net]);
    const prof = PROFILE[it.sector].map((w, i) => (i === 2 || i === 3 ? w * (1 - 0.03 * dr) : i === 5 || i === 6 ? w * (1 + 0.04 * dr) : w));
    const per = spread(qty, prof, date + it.name);
    per.forEach((q, i) => {
      hs[it.sector][i] += Math.round((net * q) / qty);
      if (it.cup) cupsH[i] += q;
    });
    cups += qty * it.cup;
  }
  const teamsH = cupsH.map((c, i) => Math.round(c / 1.9 + (hs.베이커리[i] / 12000) * 0.6));
  const teams = teamsH.reduce((s, x) => s + x, 0);
  const posNet = Object.values(sectors).reduce((s, x) => s + x, 0);
  return {
    v: 1,
    store: "cafe",
    date,
    basis: "receipt",
    file: "체험판",
    sheetNet: posNet,
    posNet,
    voucher: 0,
    sectors,
    cups,
    teams,
    teamSizes: [Math.round(teams * 0.28), Math.round(teams * 0.23), Math.round(teams * 0.31), Math.round(teams * 0.11), Math.round(teams * 0.04), Math.round(teams * 0.03)],
    hourly: { sectors: hs, cups: cupsH, teams: teamsH },
    products: products.sort((a, b) => b[3] - a[3]),
    refunds: { receipts: 0, lines: 0, unmatched: 0, amount: 0 },
    kids: null,
  };
}

const NAVER_PROFILE = [3, 5, 7, 8, 9, 9, 8, 9, 10, 9, 8, 7, 6, 6, 5, 4, 3, 3, 2, 1];

function kidsDay(date: string): { kids: StorePart; naver: DayReport["naver"] } {
  const f = dayFactor(date) * 1.1;
  const off = isOffDay(date);
  const tag = off ? "[휴일]" : "[평일]";
  const price = kidsPrice(date).price;
  const walk = Math.max(0, Math.round(5 * f * (0.6 + rand(date + "walk") * 0.8)));
  const naverTotal = Math.max(0, Math.round(16 * f * (0.6 + rand(date + "naver") * 0.8)));
  const event = date >= "2026-09-20" && date <= "2026-11-30" ? Math.round(rand(date + "ev") * 3) : Math.round(rand(date + "ev2") * 1.2);
  const extra = Math.round(walk * 0.4);
  const tickets = spread(naverTotal, NAVER_PROFILE, date + "slots");
  const newVisitors = tickets.map((t, i) => Math.min(t, Math.round(t * (0.15 + rand(date + "new" + i) * 0.25))));
  const walkH = spread(walk, [2, 4, 6, 6, 7, 7, 6, 5, 3, 2, 1, 0], date + "walkH");
  const naverH = HOURS.map((_, i) => (tickets[i * 2] || 0) + (tickets[i * 2 + 1] || 0));
  const issuedH = naverH.map((n, i) => n + walkH[i]);
  const eventH = spread(event, [1, 2, 3, 3, 3, 2, 2, 1, 1, 0, 0, 0], date + "evH");
  const otherH = spread(extra, [1, 2, 3, 3, 3, 2, 2, 1, 1, 0, 0, 0], date + "exH").map((q) => q * 3000);
  const products: ProductTuple[] = [];
  if (walk) products.push([`${tag} 1시간 50분 입장권`, "현장결제", walk, walk * price]);
  if (extra) products.push([`인원추가 ${tag}`, "추가인원", extra, extra * 3000]);
  if (naverTotal + walk) products.push([`${tag} 무제한 이용`, "입장발행", naverTotal + walk, 0]);
  if (event) products.push([`${tag} 이벤트 무료 쿠폰`, "이벤트무료", event, 0]);
  const kids: StorePart = {
    v: 1,
    store: "kids",
    date,
    basis: "receipt",
    file: "체험판",
    sheetNet: walk * price + extra * 3000,
    posNet: walk * price + extra * 3000,
    voucher: 0,
    sectors: { 바리스타: 0, 베이커리: 0, 키친: 0, 기타: 0 },
    cups: 0,
    teams: walk + naverTotal,
    teamSizes: [walk + naverTotal, 0, 0, 0, 0, 0],
    hourly: null,
    products,
    refunds: { receipts: 0, lines: 0, unmatched: 0, amount: 0 },
    kids: { issued: naverTotal + walk, walkIn: walk, walkInNet: walk * price, eventFree: event, other: extra * 3000, hourly: { issued: issuedH, walkIn: walkH, eventFree: eventH, other: otherH } },
  };
  return { kids, naver: { v: 1, date, tickets, newVisitors } };
}

/** 날짜로 늘 같은 0~1 값 */
function rnd(date: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (const ch of date) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}
const SAMPLE_OPEN: Record<string, number> = { cashAlpha: 3798210, cashCafe: 500000, nh: 115115572, shinhan: 23141205, ibk: 9188, keb: 316, hana: 328, securities: 200000000, shinhanUsd2: 9.75, citiUsd: 33.92, kebUsd: 19.32 };

/** 체험판 자금 보고 (가짜) — 카드 정산 · 네이버 정산 입금, 관리비 · 거래처 출금 */
function cashDay(date: string): CashPart {
  const row = (x: Partial<CashRow>): CashRow => ({ inWho: "", inMemo: "", inAmt: 0, outWho: "", outMemo: "", outAmt: 0, ...x });
  const rows: Record<string, CashRow[]> = Object.fromEntries(CASH_ACCOUNTS.map((a) => [a.id, []]));
  const md = `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  rows.nh = [row({ inWho: "카드가맹점", inMemo: `${md} 입금액`, inAmt: Math.round(2500000 + rnd(date, 1) * 3000000) })];
  rows.shinhan = [row({ inWho: "네이버페이정산", inMemo: "아스타나 키즈 예약", inAmt: Math.round(100000 + rnd(date, 2) * 200000), ...(rnd(date, 3) > 0.6 ? { outWho: "관리비", outMemo: "건물 관리비", outAmt: 610000 } : {}) })];
  if (rnd(date, 4) > 0.7) rows.nh.push(row({ outWho: "식자재", outMemo: "원두 · 우유", outAmt: Math.round(800000 + rnd(date, 5) * 1500000) }));
  rows.cashAlpha = [row({ inWho: "카페아스타나", inMemo: `${md} 현금매출`, inAmt: Math.round(rnd(date, 6) * 100) * 500 })];
  return {
    date,
    rates: { usd: Math.round((1355 + rnd(date, 7) * 20) * 100) / 100, jpy: Math.round((855 + rnd(date, 8) * 15) * 100) / 100 },
    open: { ...SAMPLE_OPEN },
    rows,
    loans: [
      { label: "신한 대출 (예시 1)", amount: 840000000 },
      { label: "신한 대출 (예시 2)", amount: 200000000 },
    ],
  };
}

/** from ~ to 의 체험판 보고 자료. 설날·추석 당일은 휴무로 뺌 */
export function sampleReports(from: string, to: string): DayReport[] {
  const closed = new Set(["2025-01-29", "2025-10-06", "2026-02-17", "2026-09-25"]);
  const out: DayReport[] = [];
  for (const date of dayRange(from, to)) {
    if (closed.has(date)) continue;
    const { kids, naver } = kidsDay(date);
    const at = `${addDays(date, 1)}T01:10:00.000Z`;
    const cash = date >= addDays(to, -45) ? cashDay(date) : undefined;
    out.push({ date, cafe: cafePart(date), kids, naver, ...(cash ? { cash } : {}), meta: { cafe: { by: "체험판", at }, kids: { by: "체험판", at }, naver: { by: "체험판", at }, ...(cash ? { cash: { by: "체험판", at } } : {}) }, at });
  }
  return out;
}

/** 체험판: 오늘 기준 어제까지 (작년 1월 1일부터 — 작년 비교가 보이게) */
export function sampleUntilYesterday(today: string): DayReport[] {
  return sampleReports(`${Number(today.slice(0, 4)) - 1}-01-01`, addDays(today, -1));
}

export const SAMPLE_SLOTS = NAVER_SLOTS.length;
