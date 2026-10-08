/* ============================================================
   보고 규칙 (사장님이 정한 기준) — 바꾸면 test/metrics.test.ts 에 시험을 먼저 더함
   - 키즈 입장료 단가: 평일 12,000원 · 평일 외(토·일·공휴일·대체공휴일) 14,000원
   - 2026-03-31 까지는 교환권 방식: 네이버(3만원) · 키즈 현장 구매(3만원)로 카페 교환권을 사고, 카페에서 −3만원으로 씀
     → 카페 매출은 교환권 줄을 빼지 않은 원래 금액(isVoucherPayment)
     → 키즈입장 = 네이버 × 3만원 + 현장 구매 결제액 − 카페에서 쓴 교환권. 네이버 장수 = POS 입장 발행 − 현장 구매 (당일 취소 없음) 안 쓰고 간 교환권만큼 +, 교환권을 더 준 실수는 − 그대로
     → 키즈 기타 매출은 0원. 인원(네이버 · 현장)은 시간대별로 셈
   - 카페아스타나 방문인원 = 음료·맥주 잔 수 × 0.96 (두 잔 마시는 사람을 감안). 한 팀(영수증)의 인원 = 그 팀의 잔 수
   - 1인 평균 소비금액 = 총매출 ÷ 방문인원
   ============================================================ */
import { weekday } from "./dates";
import { EXTRA_HOLIDAYS, HOLIDAYS } from "./holidays";
import { currentSettings } from "./settings";
import type { SaleLine, StoreId } from "./types";

/** 키즈 입장권 단가 (from 날짜부터 적용, 늦은 것이 우선) — 값이 바뀌면 줄을 더함 */
export const KIDS_PRICES: { from: string; weekday: number; holiday: number }[] = [{ from: "2025-01-01", weekday: 12000, holiday: 14000 }];

/** 추정 방문자 = 잔 수 × 이 값 */
export const VISITOR_FACTOR = 0.96;

/** 휴일 이름 — 공휴일 표 + 설정에서 더한 날, 설정에서 뺀 날은 휴일 아님 */
export function holidayName(date: string): string | null {
  const s = currentSettings();
  if (s.holidaysOff.includes(date)) return null;
  return s.holidaysAdd[date] || HOLIDAYS[date] || EXTRA_HOLIDAYS[date] || null;
}

/** 평일 외 = 토·일·공휴일·대체공휴일 */
export function isOffDay(date: string): boolean {
  const w = weekday(date);
  return w === 0 || w === 6 || !!holidayName(date);
}

/** 베이커리 매대에서 팔아도 베이커리 생산품이 아닌 상품 → 늘 '기타' (작업지시 생산 목록에서도 빠짐) */
export const NOT_BREAD: ReadonlySet<string> = new Set(["딸기잼", "블루베리잼"]);

/** 베이커리 마감 할인 — 저녁 8시 30분부터 남은 빵 50% (이 시각 뒤에 팔린 빵 = 인기가 낮거나 많이 만든 빵)
    1~2분 일찍 집어 와 계산하는 손님이 있어 20:25 부터 봄 (매출에 할인 표기가 있는 줄만이라 앞 시간 정가 판매는 섞이지 않음) */
export const HALF_OFF_FROM = "20:25";
/** 반값 줄 — 20:25 뒤 · 할인이 정가의 40% 이상 (회원할인 10% 등은 아님) */
export function isHalfOff(l: { time: string; gross: number; discount: number; refund?: boolean }): boolean {
  return !l.refund && !!l.time && l.time.slice(0, 5) >= HALF_OFF_FROM && l.gross > 0 && l.discount / l.gross >= 0.4;
}

/** 이날부터 키즈 매출(입장료 · 키즈 POS 기타)을 잡음 — 그 전은 교환권 방식이라 인원만 */
export const KIDS_SALES_FROM = "2026-04-01";

/** 2026-03 까지 네이버 · 현장에서 받은 카페 교환권 한 장 값 (원) */
export const OLD_VOUCHER_PRICE = 30000;

/** 숏타임 (방학 · 휴일 10시 입장 → 11시20분 퇴장, 네이버 10장) — 이름에 2만원이 붙어도 3만원 표 */
export function isShortTime(name: string): boolean {
  return (/11시\s*20분\s*퇴장/.test(name || "") && /10시\s*입장/.test(name || "")) || /숏\s*타임/.test(name || "");
}

/** 2026-04 부터 숏타임 입장료 (평일 · 휴일) */
export const SHORT_PRICE = { weekday: 10000, holiday: 11000 };
export function shortPrice(date: string): number {
  return isOffDay(date) ? SHORT_PRICE.holiday : SHORT_PRICE.weekday;
}

/** 교환권 방식 때 입장 발행 한 장 값 — 2025-01 은 값을 바꾸던 달이라 평일 표가 '/평일-20,000원' (2만원), 나머지는 3만원 */
export function oldTicketPrice(name: string): number {
  return /20,000\s*원/.test(name || "") && !isShortTime(name) ? 20000 : OLD_VOUCHER_PRICE;
}

/** 그날 키즈 매출을 잡는지 (입장료 방식) — 그 전 날은 교환권 방식: 받은 교환권 값 − 카페에서 쓴 교환권 (metrics) */
export const kidsSales = (date: string) => date >= KIDS_SALES_FROM;

/** 그날 키즈 입장권 단가 (키즈 매출을 안 잡는 날은 0원) */
export function kidsPrice(date: string): { price: number; kind: "평일" | "휴일"; charged: boolean } {
  const rule = [...KIDS_PRICES].reverse().find((r) => r.from <= date) || KIDS_PRICES[0];
  const kind = isOffDay(date) ? "휴일" : "평일";
  if (!kidsSales(date)) return { price: 0, kind, charged: false };
  return { price: kind === "휴일" ? rule.holiday : rule.weekday, kind, charged: true };
}

/** 잔 수에서 뺄 것 (옵션·원두·상품 등) */
const NOT_CUP = /추가|변경|사이즈|업그레이드|연하게|진하게|원두|드립백|시럽|굿즈|텀블러|쿠폰|상품권|할인|포장비|봉투|컵\s*홀더|아이스크림/;
/** 잔으로 셀 것 — 카페 POS 바리스타 상품 + 이름으로 맥주 등 */
const CUP_NAME = /맥주|beer|생맥|필스너|에일|라거|하이볼|와인|커피|라떼|아메리카노|아메(?![가-힣])|에스프레소|에이드|주스|스무디|프라페|밀크티|티(?![가-힣])|차(?![가-힣])|tea|coffee/i;

/** 방문자 추정용 '잔'인지 */
export function isCup(pos: StoreId, line: Pick<SaleLine, "name" | "cat1"> & Partial<Pick<SaleLine, "gross" | "net">>, team: string): boolean {
  const name = line.name || "";
  if (NOT_CUP.test(name)) return false;
  // 0원 상품은 옵션(연하게·less ice·테이크아웃 등)이라 잔으로 세지 않음 — 단 '[종이] ICE 아메' 같은 무료 음료 쿠폰은 잔
  if (line.gross === 0 && line.net === 0) return CUP_NAME.test(name);
  if (pos === "cafe" && team === "바리스타") return true;
  return CUP_NAME.test(name) || /주류|맥주|음료/.test(line.cat1 || "");
}

/** 한 상품이 몇 잔인지 — '맥주2+감자튀김' · '와인2+리코타샐러드M' 처럼 이름에 잔 수가 붙은 세트는 그 수만큼 */
export function cupsPerItem(name: string): number {
  const m = (name || "").match(/(?:맥주|와인|하이볼|에이드|커피|라떼|아메리카노)\s*(\d)\s*(?:잔|ea)?\s*\+/i);
  return m ? Math.max(1, Number(m[1])) : 1;
}

/** 현금성 상품권으로 결제한 줄 ('[종이쿠폰]만원권' · '[아키 2만원] 교환권' · '퍼피 정산', 음수) — 상품이 아니라 결제 수단
 *  '퍼피 정산'(2025-09 까지): 아스타나퍼피 선결제 1만원 교환권 — 퍼피 POS · 네이버에서 이미 받은 돈 (따로 계산하지 않음)
 *  상품은 이미 제값으로 팔린 것으로 잡혀 있으므로, 이 음수 줄은 매출에서 빼지 않고 '상품권 결제' 로 따로 보여 줌 */
export function isVoucherPayment(line: Pick<SaleLine, "name" | "net">): boolean {
  return line.net < 0 && (/종이쿠폰|상품권|교환권|금액권|퍼피\s*정산/.test(line.name || "") || OLD_KIDS_COUPON.test(line.name || ""));
}

/** 2025-01 초(~1/18) 카페 POS 의 카페 교환권 이름 — 1/19 부터 '[아키 2만원] 교환권' 으로 바뀜 (분류 서비스.쿠폰 › 선결제 › 네이버 결제) */
const OLD_KIDS_COUPON = /^\s*\[키즈\]\s*$/;

export function visitorsFromCups(cups: number): number {
  return Math.max(0, Math.round(cups * VISITOR_FACTOR));
}

/** 키즈 쪽 교환권 · 사은권 줄 ('[아키 2만원] 교환권' — POS 키는 그대로 두고 이름만 바꿔 씀)
 *  2025-01-18 까지는 이름이 '[키즈]' (같은 교환권)
 *  2026-03 까지: 네이버로 미리 받은 카페 교환권(−3만원) → 카페 결제 수단일 뿐 (키즈 매출 없음)
 *  2026-04 부터: 마일리지 손님에게 주는 2만원 사은권 → 카페 매출은 그대로, 키즈 매출에서 뺌 (metrics) */
export function isKidsCoupon(line: Pick<SaleLine, "name" | "net">): boolean {
  return isVoucherPayment(line) && (/아키/.test(line.name || "") || OLD_KIDS_COUPON.test(line.name || ""));
}

/* ---------- 기타로 잡히던 상품 옮기기 (2026-10-06 사장님 기준) ----------
   카페: 생맥주(C3 필스너 · C5 바이젠 · C7 페일에일) · 상품권 판매 → 바리스타, 폭립할인(−) → 키친
         상품권(1만원권) 사용 '[종이쿠폰]만원권'(−) → 그날 바리스타에서 뺌 (giftUse — 판 날 이미 바리스타 매출로 잡았으므로)
   키즈: 음료(쥬스 · 우유 · 생수) · 자판기상품 → 자판기 매출, 퇴장 지연(이름이 '02.51-03.00' 같은 시각 칸인 것 포함) · 열쇠 분실 · 인원추가 → 키즈입장료
   대관은 따로 (metrics 의 rental) */
export type EtcMove = "바리스타" | "키친" | "자판기" | "키즈입장료";
export function etcMove(store: StoreId, name: string): EtcMove | null {
  const n = name || "";
  if (store === "cafe") {
    if (/필스너|바이젠|페일에일/.test(n)) return "바리스타";
    if (/상품권/.test(n)) return "바리스타";
    if (/폭립\s*할인/.test(n)) return "키친";
    return null;
  }
  if (/대관/.test(n)) return null;
  if (/쥬스|주스|우유|생수|자판기상품/.test(n)) return "자판기";
  if (/지연/.test(n) || /^\s*\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2}\s*$/.test(n)) return "키즈입장료";
  if (/열쇠/.test(n)) return "키즈입장료";
  if (/추가/.test(n)) return "키즈입장료";
  return null;
}

/** 상품권 1만원권으로 결제한 줄 ('[종이쿠폰]만원권', 음수) — 그날 바리스타 매출에서 뺌 */
export function isGiftUse(line: Pick<SaleLine, "name" | "net">): boolean {
  return isVoucherPayment(line) && !isKidsCoupon(line) && /만원권/.test(line.name || "");
}
