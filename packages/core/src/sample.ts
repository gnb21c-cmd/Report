/* ============================================================
   체험판용 가짜 매출 — 날짜마다 늘 같은 값이 나옴 (실제 매출 아님)
   ============================================================ */
import { addDays, dayRange, weekday } from "./dates";
import { isOffDay, kidsPrice } from "./rules";
import type { DayBatch, PosId, SaleLine } from "./types";

interface Item {
  code: string;
  name: string;
  cat1: string;
  price: number;
  /** 평일 하루 평균 수량 */
  base: number;
}

const CAFE: Item[] = [
  ["[ICE] 아메리카노", 5000, 38], ["[HOT] 아메리카노", 4500, 16], ["[ICE] 카페라떼", 5500, 22], ["[HOT] 카페라떼", 5500, 9],
  ["바닐라라떼", 6000, 11], ["아인슈페너", 6500, 7], ["자몽에이드", 6500, 8], ["레몬에이드", 6000, 6],
  ["딸기스무디", 7000, 6], ["얼그레이 밀크티", 6500, 5], ["유자차", 6000, 4], ["아이스티", 5000, 7],
  ["생맥주 500", 6000, 5], ["샷 추가", 500, 9],
].map(([name, price, base], i) => ({ code: `1${String(i).padStart(4, "0")}`, name: String(name), cat1: "바리스타", price: Number(price), base: Number(base) }))
  .concat(
    [
      ["소금빵", 3800, 18], ["크루아상", 4200, 9], ["바스크 치즈케이크", 7500, 6], ["블루베리 스콘", 4000, 5],
      ["크로플", 6500, 7], ["마들렌", 3000, 6], ["휘낭시에", 3200, 5], ["초코 쿠키", 3500, 4],
    ].map(([name, price, base], i) => ({ code: `2${String(i).padStart(4, "0")}`, name: String(name), cat1: "베이커리", price: Number(price), base: Number(base) })),
  )
  .concat(
    [
      ["트러플 크림파스타", 18000, 9], ["로제 파스타", 17000, 7], ["리코타 샐러드", 14000, 5], ["브런치 플레이트", 19000, 6],
      ["불고기 덮밥", 15000, 5], ["마르게리타 피자", 19000, 4],
    ].map(([name, price, base], i) => ({ code: `3${String(i).padStart(4, "0")}`, name: String(name), cat1: "키친", price: Number(price), base: Number(base) })),
  )
  .concat([{ code: "40000", name: "애견 간식", cat1: "기타 유료", price: 4000, base: 3 }]);

// 키즈 POS 실제 모양 (2026-10-01): 돈 받은 입장권 = 현장 구매, 0원 '무제한 이용'·'야간자유입장권' = 입장 발행(네이버 + 현장 모두),
// 0원 쿠폰 = 이벤트 무료입장, '인원추가' = 추가 인원
const KIDS: Item[] = [
  { code: "000782", name: "1시간 50분 입장권", cat1: "기타 유료", price: -1, base: 6 },
  { code: "000787", name: "인원추가", cat1: "기타 유료", price: 3000, base: 2 },
];

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
  const weekend = isOffDay(date) ? 1.9 : w === 5 ? 1.2 : 1;
  const month = Number(date.slice(5, 7));
  const season = [0, 0.85, 0.85, 0.95, 1.05, 1.15, 1.0, 1.2, 1.25, 1.05, 1.1, 0.95, 1.0][month];
  // 해가 갈수록 조금씩 늘어남
  const growth = 1 + (Date.parse(date) - Date.parse("2025-01-01")) / (365 * 86400_000) * 0.12;
  return weekend * season * growth * (0.85 + rand(date) * 0.3);
}

function kidsLines(date: string): SaleLine[] {
  const f = dayFactor(date) * 1.1;
  const off = isOffDay(date);
  const tag = off ? "[휴일]" : "[평일]";
  const price = kidsPrice(date).price;
  const walk = Math.max(0, Math.round(5 * f * (0.6 + rand(date + "walk") * 0.8)));
  const naver = Math.max(0, Math.round(16 * f * (0.6 + rand(date + "naver") * 0.8)));
  const night = Math.round(naver * 0.15);
  const out: SaleLine[] = [];
  const add = (code: string, name: string, qty: number, unit: number, cat1 = "기타 유료") => {
    if (qty) out.push({ code, name, cat1, cat2: "", cat3: "", qty, gross: qty * unit, discount: 0, net: qty * unit });
  };
  add(off ? "000783" : "000782", `${tag} 1시간 50분 입장권`, walk, price);
  add("000787", `인원추가 ${tag}`, Math.round(walk * 0.4), 3000);
  add("900001", `${tag} 무제한 이용`, naver + walk - night, 0);
  add("000291", "야간자유입장권", night, 0);
  if (date <= "2026-11-30" && date >= "2026-09-20") add("000865", `${tag} 한가위 무제한 쿠폰`, Math.round(rand(date + "ev") * 3), 0, "서비스.쿠폰");
  return out;
}

function lines(pos: PosId, date: string): SaleLine[] {
  if (pos === "kids") return kidsLines(date);
  const items = CAFE;
  const f = dayFactor(date);
  const out: SaleLine[] = [];
  for (const it of items) {
    const qty = Math.max(0, Math.round(it.base * f * (0.6 + rand(date + it.code) * 0.8)));
    if (!qty) continue;
    const price = it.price < 0 ? kidsPrice(date).price : it.price;
    const gross = qty * price;
    const discount = price > 0 && it.price > 0 && rand(date + it.code + "d") < 0.25 ? Math.round(gross * 0.05 / 100) * 100 : 0;
    out.push({ code: it.code, name: it.name, cat1: it.cat1, cat2: "", cat3: "", qty, gross, discount, net: gross - discount });
  }
  return out;
}

/** from ~ to 의 체험판 묶음. 설날·추석 당일은 휴무로 뺌 */
export function sampleBatches(from: string, to: string): DayBatch[] {
  const closed = new Set(["2025-01-29", "2025-10-06", "2026-02-17", "2026-09-25"]);
  const out: DayBatch[] = [];
  for (const date of dayRange(from, to)) {
    if (closed.has(date)) continue;
    out.push({ pos: "cafe", date, rows: lines("cafe", date), sentAt: `${date}T13:08:00.000Z`, source: "체험판" });
    out.push({ pos: "kids", date, rows: lines("kids", date), sentAt: `${date}T12:41:00.000Z`, source: "체험판" });
  }
  return out;
}

/** 체험판: 오늘 기준 어제까지 (작년 1월 1일부터 — 작년 비교가 보이게) */
export function sampleUntilYesterday(today: string): DayBatch[] {
  return sampleBatches(`${Number(today.slice(0, 4)) - 1}-01-01`, addDays(today, -1));
}
