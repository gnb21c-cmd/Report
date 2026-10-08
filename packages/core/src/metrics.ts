/* ============================================================
   대시보드 숫자 (순수 함수, 시험: test/metrics.test.ts) — C 가 합친 날짜별 보고 자료(DayReport)로 계산

   한 날의 숫자
   - 바리스타 · 베이커리 · 키친 = 카페아스타나 분류별 실매출
   - 기타 = 카페아스타나 기타 + 아스타나키즈 입장권 외 매출 + 자판기 · 인생네컷 · 주차
     기타로 잡히던 상품 중 사장님이 정한 것은 옮김 (rules.etcMove): 맥주 · 상품권 → 바리스타, 폭립할인 → 키친,
     키즈 음료 · 자판기상품 → 자판기, 키즈 퇴장 지연 · 열쇠 분실 · 인원추가 → 키즈입장료. 상품권 사용액은 그날 바리스타에서 뺌
   - 키즈입장료 = (네이버 입장권 + 현장 입장권) × 그날 단가 (평일 12,000 / 휴일 14,000)
       · 네이버 입장권 = A 에 넣은 시간대별 판매 입장권 합. 아직 안 넣은 날은 키즈 POS 로 추정 (0원 입장 발행 − 현장)
       · 현장 입장권 = 키즈 POS 에서 돈을 받은 입장권 (반품은 지워짐)
       · 이벤트 무료입장 = 0원 쿠폰 입장 (장 수만 셈, 입장료·잔 수에 안 들어감)
       · 총 입장권 수 = 네이버 + 현장 + 이벤트 무료입장 (kidsTickets — 보여 주기만)
   - 총매출 = 위 다섯 상자의 합 (상품권·교환권 결제는 결제 수단이라 빼지 않음)
   - 카페아스타나 방문인원 = 카페 음료·맥주 잔 수 × 0.96 (날마다 반올림), 1인 평균소비 = 총매출 ÷ 방문인원
   여러 날(누계)은 날마다의 값을 더함 (1인 평균은 합계 ÷ 합계)
   ============================================================ */
import { dayRange, daysInMonth, lyCalendar, lyDay, monthOf, monthStart, weekdayLabel } from "./dates";
import { EXTRA_KINDS, type ExtraKind } from "./extra";
import { rentalIn } from "./cash";
import { etcMove, isShortTime, kidsPrice, kidsSales, OLD_VOUCHER_PRICE, shortPrice, visitorsFromCups } from "./rules";
import { count, won } from "./format";
import { NAVER_SLOTS, sum, type DayReport, type ProductTuple, type StorePart } from "./part";
import type { KidsKind, Sector } from "./classify";

export type BoxKey = "바리스타" | "베이커리" | "키친" | "키즈입장료" | "기타";
export const BOXES: BoxKey[] = ["바리스타", "베이커리", "키친", "키즈입장료", "기타"];

export type MetricKey = "total" | BoxKey | "visitors" | "avgSpend" | "naver" | "walkIn" | "eventFree" | "newVisitors";

export const METRIC_LABEL: Record<MetricKey, string> = {
  total: "총 매출",
  바리스타: "바리스타",
  베이커리: "베이커리",
  키친: "키친",
  키즈입장료: "키즈 입장료",
  기타: "기타",
  visitors: "카페아스타나 방문인원",
  avgSpend: "1인 평균소비",
  naver: "네이버 판매 수",
  walkIn: "현장 판매 수",
  eventFree: "이벤트 무료입장",
  newVisitors: "신규방문자 수",
};

/** 금액인지 (아니면 사람·장·팀 수) */
export function isMoney(key: MetricKey): boolean {
  return !["visitors", "naver", "walkIn", "eventFree", "newVisitors"].includes(key);
}

export function unitOf(key: MetricKey): string {
  return key === "visitors" || key === "newVisitors" ? "명" : "장";
}

export function formatMetric(key: MetricKey, v: number | null): string {
  if (v == null) return "—";
  return isMoney(key) ? won(v) : count(v, unitOf(key));
}

export interface Metrics {
  from: string;
  to: string;
  /** 자료가 있는 날 수 (조각별) */
  has: { cafe: number; kids: number; naver: number };
  /** 시간대 자료(영수증별 엑셀)가 있는 카페 날 수 */
  hourlyDays: number;
  box: Record<BoxKey, number>;
  total: number;
  /** POS 실매출 합 (카페 + 키즈, 상품권 결제 줄 포함 — 참고) */
  posNet: number;
  /** 상품권·교환권 결제 (양수) */
  voucher: number;
  /** 키즈 사은권 ('[아키 2만원] 교환권', 2026-04 부터) — 키즈입장료에서 뺀 금액 */
  kidsCoupon: number;
  /** 카페 잔 수 */
  cups: number;
  /** 카페아스타나 방문인원 */
  visitors: number;
  avgSpend: number | null;
  /** 카페 팀(영수증 묶음) 수 */
  teams: number;
  /** 키즈 0원 입장 발행 */
  issued: number;
  /** 키즈 POS 로 추정한 네이버 = 발행 − 현장 */
  naverPos: number;
  /** 계산에 쓴 네이버 입장권 (A 에 넣은 값 우선) */
  naver: number;
  /** 네이버를 A 에 넣은 날 수 */
  naverInput: number;
  newVisitors: number;
  /** 신규방문자를 아는 날 수 (A 에 직접 넣은 날 — 지난 자료 정리표는 모름) */
  newKnown: number;
  walkIn: number;
  walkInPosNet: number;
  eventFree: number;
  fee: { naver: number; walkIn: number };
  kidsOtherNet: number;
  /** 키즈 POS 의 퇴장 지연 · 열쇠 분실 · 인원추가 — 기타에서 키즈입장에 옮긴 금액 */
  kidsFees: number;
  /** 상품권 1만원권 사용 — 그날 바리스타에서 뺀 금액 */
  giftUse: number;
  /** 대관 (어린이집 · 유치원 등) — 키즈 POS '대관' 상품 + 통장 대관 입금, 키즈입장에 더함 */
  rental: number;
  /** POS 밖 매출 (자판기 · 인생네컷 · 주차) — 기타 상자에 더함 */
  extra: Record<ExtraKind, number>;
}

function empty(from: string, to: string): Metrics {
  return {
    from,
    to,
    has: { cafe: 0, kids: 0, naver: 0 },
    hourlyDays: 0,
    box: { 바리스타: 0, 베이커리: 0, 키친: 0, 키즈입장료: 0, 기타: 0 },
    total: 0,
    posNet: 0,
    voucher: 0,
    kidsCoupon: 0,
    cups: 0,
    visitors: 0,
    avgSpend: null,
    teams: 0,
    issued: 0,
    naverPos: 0,
    naver: 0,
    naverInput: 0,
    newVisitors: 0,
    newKnown: 0,
    walkIn: 0,
    walkInPosNet: 0,
    eventFree: 0,
    fee: { naver: 0, walkIn: 0 },
    kidsOtherNet: 0,
    kidsFees: 0,
    giftUse: 0,
    rental: 0,
    extra: { vending: 0, photo: 0, parking: 0 },
  };
}

export function valueOf(m: Metrics, key: MetricKey): number | null {
  if (key === "total") return m.total;
  if (key === "visitors") return m.visitors;
  if (key === "avgSpend") return m.avgSpend;
  if (key === "naver") return m.naver;
  if (key === "walkIn") return m.walkIn;
  if (key === "eventFree") return m.eventFree;
  if (key === "newVisitors") return m.newVisitors;
  return m.box[key];
}

/** 키즈 총 입장권 수 = 네이버 판매 + 현장 판매 + 이벤트 무료입장 (보여 주기만 — 매출 계산에는 안 씀) */
export function kidsTickets(m: Metrics): number {
  return m.naver + m.walkIn + m.eventFree;
}

/** 매출 자료(카페 · 키즈)가 하나라도 있는지 */
export function hasData(m: Metrics): boolean {
  return m.has.cafe + m.has.kids > 0;
}

/** 이 숫자의 자료가 있는지 (네이버 숫자는 네이버를 넣었거나 키즈 자료가 있으면) */
export function hasValue(m: Metrics, key: MetricKey): boolean {
  if (key === "newVisitors") return m.newKnown > 0;
  if (key === "naver") return m.has.naver > 0 || m.has.kids > 0;
  if (key === "walkIn" || key === "eventFree") return m.has.kids > 0;
  return hasData(m) || (key === "키즈입장료" && m.has.naver > 0);
}

/** 기간 중 자료가 있는 날의 비율 (0~1) */
export function coverage(m: Metrics): number {
  const n = m.from > m.to ? 0 : dayRange(m.from, m.to).length;
  return n ? Math.max(m.has.cafe, m.has.kids) / n : 0;
}

/** 비교에 써도 될 만큼 자료가 있는지 — 기간의 80% 이상 (휴무일 감안). 작년 자료가 일부만 있으면 비교하지 않음 */
export function comparable(m: Metrics): boolean {
  return coverage(m) >= 0.8;
}

export interface ProductRow {
  name: string;
  /** 카페: 분류 · 키즈: 종류 */
  team: Sector | KidsKind;
  store: "cafe" | "kids";
  qty: number;
  net: number;
  /** 팔린 날 수 */
  days: number;
}

export class Board {
  readonly byDate = new Map<string, DayReport>();
  readonly first: string | null;
  readonly last: string | null;
  private cache = new Map<string, Metrics>();

  constructor(reports: DayReport[]) {
    for (const r of reports) if (r && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) this.byDate.set(r.date, r);
    const keys = [...this.byDate.keys()].sort();
    this.first = keys[0] ?? null;
    this.last = keys[keys.length - 1] ?? null;
  }

  report(date: string): DayReport | undefined {
    return this.byDate.get(date);
  }

  /** 매출 자료(카페 · 키즈)가 온 가장 늦은 날 = 보고 기준일 */
  latest(): string | null {
    let max: string | null = null;
    for (const [d, r] of this.byDate) if ((r.cafe || r.kids) && (!max || d > max)) max = d;
    return max;
  }

  day(date: string): Metrics {
    const hit = this.cache.get(date);
    if (hit) return hit;
    const m = empty(date, date);
    const r = this.byDate.get(date);
    const cafe = r?.cafe;
    const kids = r?.kids;
    if (cafe) {
      m.has.cafe = 1;
      if (cafe.hourly) m.hourlyDays = 1;
      m.box.바리스타 += cafe.sectors.바리스타;
      m.box.베이커리 += cafe.sectors.베이커리;
      m.box.키친 += cafe.sectors.키친;
      m.box.기타 += cafe.sectors.기타;
      m.posNet += cafe.posNet;
      m.voucher += cafe.voucher;
      // 키즈 교환권 · 사은권 — 3월까지는 쓰인 교환권, 4월부터는 사은권. 둘 다 키즈입장에서 뺌
      m.kidsCoupon += cafe.kidsCoupon || 0;
      m.cups += cafe.cups;
      m.teams += cafe.teams;
      // 예전에 기타로 저장된 상품도 볼 때 옮김 (새로 올린 날은 이미 옮겨져 저장됨 → 여기선 기타 줄만 봄)
      for (const p of cafe.products || []) {
        if (p[1] !== "기타") continue;
        const to = etcMove("cafe", p[0]);
        if (to !== "바리스타" && to !== "키친") continue;
        m.box.기타 -= p[3];
        m.box[to] += p[3];
      }
      m.giftUse += cafe.giftUse || 0;
      m.box.바리스타 -= cafe.giftUse || 0;
    }
    let i20 = 0;
    let w20 = 0;
    let sIssued = 0;
    let sWalk = 0;
    if (kids) {
      m.has.kids = 1;
      const k = kids.kids;
      m.posNet += kids.posNet;
      m.voucher += kids.voucher;
      // 키즈 매출은 2026-04-01 부터 (그 전은 교환권 방식 — 인원만)
      const sales = kidsSales(date);
      // 키즈 상품 분류에는 섹터가 없으므로 sectors 는 0 — 혹시 들어 있으면 기타로
      if (sales) m.box.기타 += kids.sectors.바리스타 + kids.sectors.베이커리 + kids.sectors.키친 + kids.sectors.기타;
      // 숏타임 장수 — 저장된 상품 목록에서 (이미 올린 날도 다시 넣지 않고 계산)
      for (const p of kids.products || []) {
        if (!isShortTime(p[0])) continue;
        if (p[1] === "입장발행") sIssued += p[2];
        else if (p[1] === "현장결제") sWalk += p[2];
      }
      if (k) {
        i20 = k.issued20 || 0;
        w20 = k.walkIn20 || 0;
        m.issued += k.issued;
        m.walkIn += k.walkIn;
        m.eventFree += k.eventFree;
        m.walkInPosNet += k.walkInNet;
        // 키즈 POS '대관' 상품 → 키즈입장 (4월부터는 기타에 들어 있던 것을 옮김)
        let rent = 0;
        for (const p of kids.products || []) if (/대관/.test(p[0]) && p[1] === "기타") rent += p[3];
        m.rental += rent;
        if (sales) {
          // 기타 중 음료 · 자판기상품 → 자판기, 퇴장 지연 · 열쇠 · 인원추가 → 키즈입장료
          let vend = 0;
          let fees = 0;
          for (const p of kids.products || []) {
            if (p[1] !== "기타" && p[1] !== "추가인원") continue;
            const to = etcMove("kids", p[0]);
            if (to === "자판기") vend += p[3];
            else if (to === "키즈입장료") fees += p[3];
          }
          m.extra.vending += vend;
          m.kidsFees += fees;
          m.kidsOtherNet += k.other - rent - vend - fees;
          m.box.기타 += k.other - rent - vend - fees;
        }
      }
    }
    m.naverPos = Math.max(0, m.issued - m.walkIn);
    if (r?.naver) {
      m.has.naver = 1;
      m.naverInput = 1;
      m.naver = sum(r.naver.tickets);
      m.newVisitors = sum(r.naver.newVisitors);
      m.newKnown = r.naver.noNew ? 0 : 1;
    } else m.naver = m.naverPos;
    const { price } = kidsPrice(date);
    // 4월부터 입장료 × 장수. 3월까지는 교환권 방식 — 네이버 × 3만원 + 현장 구매 결제액
    // 3월까지 네이버 판매 장수 = POS 입장 발행 − 현장 구매 (당일 취소가 안 돼 발행 = 판매). 키즈 엑셀이 없으면 네이버 입력
    const oldNaver = m.issued > 0 ? m.naverPos : m.naver;
    // 2025-01 평일 표는 2만원 (2만원 발행 − 2만원 현장), 나머지는 3만원
    const n20 = m.issued > 0 ? Math.min(oldNaver, Math.max(0, i20 - w20)) : 0;
    // 4월부터 숏타임은 숏타임 입장료 (네이버 숏타임 = 숏타임 발행 − 숏타임 현장)
    const sp = shortPrice(date);
    const nShort = Math.min(m.naver, Math.max(0, sIssued - sWalk));
    const wShort = Math.min(m.walkIn, sWalk);
    m.fee = kidsSales(date) ? { naver: (m.naver - nShort) * price + nShort * sp, walkIn: (m.walkIn - wShort) * price + wShort * sp } : { naver: n20 * 20000 + (oldNaver - n20) * OLD_VOUCHER_PRICE, walkIn: m.walkInPosNet };
    // 카페에서 쓴 키즈 교환권 · 사은권은 키즈 매출에서 뺌 (교환권을 더 준 실수면 − 그대로)
    // 통장으로 받은 대관료 (어린이집 · 유치원)
    m.rental += rentalIn(r?.cash);
    m.box.키즈입장료 = m.fee.naver + m.fee.walkIn - m.kidsCoupon + m.rental + m.kidsFees;
    // POS 밖 매출 (자판기 · 인생네컷 · 주차 — VAN 승인 내역) → 기타
    if (r?.extra) for (const k of EXTRA_KINDS) m.extra[k] += r.extra[k] || 0;
    // 자판기 = VAN 승인 + 키즈 POS 음료 · 자판기상품 (위에서 더함)
    m.box.기타 += m.extra.vending + m.extra.photo + m.extra.parking;
    m.total = m.box.바리스타 + m.box.베이커리 + m.box.키친 + m.box.키즈입장료 + m.box.기타;
    m.visitors = visitorsFromCups(m.cups);
    m.avgSpend = m.visitors > 0 ? Math.round(m.total / m.visitors) : null;
    this.cache.set(date, m);
    return m;
  }

  range(from: string, to: string): Metrics {
    const m = empty(from, to);
    if (from > to) return m;
    for (const d of dayRange(from, to)) {
      if (!this.byDate.has(d)) continue;
      const x = this.day(d);
      m.has.cafe += x.has.cafe;
      m.has.kids += x.has.kids;
      m.has.naver += x.has.naver;
      m.hourlyDays += x.hourlyDays;
      for (const b of BOXES) m.box[b] += x.box[b];
      m.total += x.total;
      m.posNet += x.posNet;
      m.voucher += x.voucher;
      m.kidsCoupon += x.kidsCoupon;
      m.cups += x.cups;
      m.visitors += x.visitors;
      m.teams += x.teams;
      m.issued += x.issued;
      m.naverPos += x.naverPos;
      m.naver += x.naver;
      m.naverInput += x.naverInput;
      m.newVisitors += x.newVisitors;
      m.newKnown += x.newKnown;
      m.walkIn += x.walkIn;
      m.walkInPosNet += x.walkInPosNet;
      m.eventFree += x.eventFree;
      m.fee.naver += x.fee.naver;
      m.fee.walkIn += x.fee.walkIn;
      m.kidsOtherNet += x.kidsOtherNet;
      m.kidsFees += x.kidsFees;
      m.giftUse += x.giftUse;
      m.rental += x.rental;
      for (const k of EXTRA_KINDS) m.extra[k] += x.extra[k];
    }
    m.avgSpend = m.visitors > 0 ? Math.round(m.total / m.visitors) : null;
    return m;
  }

  /** 상품별 합계 — 그 상자(섹터)의 상품만 */
  products(from: string, to: string, box: BoxKey): ProductRow[] {
    const map = new Map<string, ProductRow>();
    if (from > to) return [];
    for (const d of dayRange(from, to)) {
      const r = this.byDate.get(d);
      if (!r) continue;
      for (const part of [r.cafe, r.kids])
        for (const p of part?.products || []) {
          if (!productInBox(part!, p, box)) continue;
          const key = `${part!.store}|${p[0]}`;
          let row = map.get(key);
          if (!row) map.set(key, (row = { name: p[0], team: p[1], store: part!.store, qty: 0, net: 0, days: 0 }));
          row.qty += p[2];
          row.net += p[3];
          row.days++;
        }
    }
    return [...map.values()];
  }
}

/** 상품이 그 상자(섹터) 것인지 */
export function productInBox(part: StorePart, p: ProductTuple, box: BoxKey): boolean {
  const to = p[1] === "기타" || p[1] === "추가인원" ? etcMove(part.store, p[0]) : null;
  if (part.store === "cafe") return (to === "바리스타" || to === "키친" ? to : p[1]) === box;
  if (box === "키즈입장료") return p[1] === "현장결제" || p[1] === "입장발행" || to === "키즈입장료";
  if (box === "기타") return (p[1] === "추가인원" || p[1] === "기타") && to !== "키즈입장료";
  return false;
}

/* ---------- 대시보드 ---------- */

export interface Dashboard {
  date: string;
  weekday: string;
  day: Metrics;
  /** 지난주 같은 요일 */
  prevWeek: { date: string; m: Metrics };
  /** 당월 누계 (1일 ~ 마감일) */
  month: Metrics;
  /** 올해 누계 (1월 1일 ~ 마감일) */
  year: Metrics;
  /** 작년 같은 달 같은 기간 (1일 ~ 작년 같은 날) */
  lyMonth: Metrics;
  /** 작년 같은 기간 (작년 1월 1일 ~ 작년 같은 날) */
  lyYear: Metrics;
  lyDate: string;
  price: { price: number; kind: "평일" | "휴일"; charged: boolean };
  /** 누계 · 작년 같은 기간의 끝날 (보통 date, 오늘 마감 전 영업정보인 날은 어제) */
  cumTo: string;
}

export function dashboard(board: Board, date: string, opts: { cumTo?: string } = {}): Dashboard {
  // 작년 비교는 364일 전 (같은 주 · 같은 요일)
  const ly = lyDay(date);
  const pw = addDaysKey(date, -7);
  // 오늘 마감 전 영업정보인 날은 누계를 어제까지 (하루가 안 끝난 숫자를 작년 하루 전체와 견주지 않게)
  const to = opts.cumTo && opts.cumTo < date ? opts.cumTo : date;
  const m0 = monthStart(date);
  const y0 = `${date.slice(0, 4)}-01-01`;
  return {
    date,
    weekday: weekdayLabel(date),
    day: board.day(date),
    prevWeek: { date: pw, m: board.day(pw) },
    month: board.range(m0, to),
    year: board.range(y0, to),
    // 월간 비교는 달력 날짜 (작년 같은 달 1일 ~ 같은 날짜) — 하루 · 올해 누계는 364일
    lyMonth: to < m0 ? board.range(lyCalendar(m0), addDaysKey(lyCalendar(m0), -1)) : board.range(lyCalendar(m0), lyCalendar(to)),
    lyYear: to < y0 ? board.range(lyDay(y0), addDaysKey(lyDay(y0), -1)) : board.range(lyDay(y0), lyDay(to)),
    lyDate: ly,
    price: kidsPrice(date),
    cumTo: to,
  };
}

function addDaysKey(key: string, n: number): string {
  const d = new Date(key + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const lastDay = (month: string) => `${month}-${String(daysInMonth(`${month}-01`)).padStart(2, "0")}`;

/* ---------- 당월 누계 상세 (11-5) ---------- */

export interface MonthView {
  /** 1 ~ 그 달 마지막 날 */
  days: number[];
  /** 이번 달 날마다 쌓은 누계 (마감일까지, 그 뒤 null) */
  cur: (number | null)[];
  /** 작년 같은 달 날마다 쌓은 누계 (한 달 전체) */
  ly: (number | null)[];
  /** 이번 달 1일 ~ 마감일 */
  month: Metrics;
  /** 작년 같은 달 1일 ~ 같은 날 */
  lyMonth: Metrics;
  /** 작년 같은 달 전체 */
  lyFull: Metrics;
  day: Metrics;
}

/** 날마다 쌓은 선 — 자료가 하나도 없으면 모두 null */
function cumulate(board: Board, month: string, upto: number, total: number, key: MetricKey): (number | null)[] {
  const last = daysInMonth(`${month}-01`);
  let acc = 0;
  let any = false;
  const out: (number | null)[] = [];
  for (let d = 1; d <= total; d++) {
    if (d > last || d > upto) {
      out.push(null);
      continue;
    }
    const m = board.day(`${month}-${String(d).padStart(2, "0")}`);
    any = any || hasData(m) || m.has.naver > 0;
    acc += valueOf(m, key) || 0;
    out.push(acc);
  }
  return any ? out : out.map(() => null);
}

/** 작년 같은 달 날마다 쌓은 선 (달력 날짜 — 이번 달 n일 ↔ 작년 같은 달 n일, 그 달에 없는 날은 null) */
function cumulateLy(board: Board, month: string, total: number, key: MetricKey): (number | null)[] {
  const lyMonth = `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;
  return cumulate(board, lyMonth, total, total, key);
}

export function monthView(board: Board, date: string, key: MetricKey = "total"): MonthView {
  const total = daysInMonth(date);
  const month = monthOf(date);
  return {
    days: Array.from({ length: total }, (_, i) => i + 1),
    cur: cumulate(board, month, Number(date.slice(8, 10)), total, key),
    ly: cumulateLy(board, month, total, key),
    month: board.range(monthStart(date), date),
    lyMonth: board.range(lyCalendar(monthStart(date)), lyCalendar(date)),
    lyFull: board.range(lyCalendar(`${month}-01`), lastDay(lyCalendar(`${month}-01`).slice(0, 7))),
    day: board.day(date),
  };
}

/* ---------- 올해 누계 상세 (11-6) ---------- */

export interface YearView {
  months: number[];
  /** 올해 달마다 쌓은 누계 (마감일이 든 달은 마감일까지) */
  cur: (number | null)[];
  /** 작년 달마다 쌓은 누계 (12달 전체) */
  ly: (number | null)[];
  /** 연말(12월) 예상 누계 */
  estimate: { value: number; how: string } | null;
  year: Metrics;
  lyYear: Metrics;
  lyFull: Metrics;
  /** 마감일이 든 달 1일 ~ 마감일 */
  month: Metrics;
  /** 작년 같은 달 전체 */
  lyMonthFull: Metrics;
}

export function yearView(board: Board, date: string): YearView {
  const y = date.slice(0, 4);
  const ly = lyDay(date);
  const curMonth = Number(date.slice(5, 7));
  const cur: (number | null)[] = [];
  const last: (number | null)[] = [];
  let a = 0;
  let b = 0;
  let anyA = false;
  let anyB = false;
  for (let mo = 1; mo <= 12; mo++) {
    const mm = String(mo).padStart(2, "0");
    if (mo <= curMonth) {
      const m = board.range(`${y}-${mm}-01`, mo === curMonth ? date : lastDay(`${y}-${mm}`));
      anyA = anyA || hasData(m);
      a += m.total;
      cur.push(a);
    } else cur.push(null);
    // 작년 달마다 = 작년 같은 달 1일 ~ 말일 (달력)
    const lm = board.range(lyCalendar(`${y}-${mm}-01`), lastDay(lyCalendar(`${y}-${mm}-01`).slice(0, 7)));
    anyB = anyB || hasData(lm);
    b += lm.total;
    last.push(b);
  }
  const year = board.range(`${y}-01-01`, date);
  const lyYear = board.range(lyDay(`${y}-01-01`), ly);
  const lyFull = board.range(lyDay(`${y}-01-01`), lyDay(`${y}-12-31`));
  let estimate: YearView["estimate"] = null;
  if (anyA && year.total > 0) {
    if (comparable(lyYear) && comparable(lyFull) && lyYear.total > 0) estimate = { value: Math.round((year.total * lyFull.total) / lyYear.total), how: "작년 흐름 기준" };
    else {
      const days = dayRange(`${y}-01-01`, date).length;
      const all = dayRange(`${y}-01-01`, `${y}-12-31`).length;
      estimate = { value: Math.round((year.total / days) * all), how: "올해 하루 평균 기준" };
    }
  }
  return {
    months: Array.from({ length: 12 }, (_, i) => i + 1),
    cur: anyA ? cur : cur.map(() => null),
    ly: anyB ? last : last.map(() => null),
    estimate,
    year,
    lyYear,
    lyFull,
    month: board.range(monthStart(date), date),
    lyMonthFull: board.range(lyCalendar(monthStart(date)), lastDay(lyCalendar(monthStart(date)).slice(0, 7))),
  };
}

/* ---------- 키즈 입장권 상세 (11-8 · 현장 · 이벤트) ---------- */

/** 기간의 네이버 시간대별 합 (A 에 넣은 날만) */
export function naverSlots(board: Board, from: string, to: string): { tickets: number[]; newVisitors: number[]; days: number } {
  const tickets = NAVER_SLOTS.map(() => 0);
  const newVisitors = NAVER_SLOTS.map(() => 0);
  let days = 0;
  if (from <= to)
    for (const d of dayRange(from, to)) {
      const n = board.report(d)?.naver;
      if (!n) continue;
      days++;
      n.tickets.forEach((v, i) => (tickets[i] += v || 0));
      n.newVisitors.forEach((v, i) => (newVisitors[i] += v || 0));
    }
  return { tickets, newVisitors, days };
}

/** 그 달 1일 ~ 말일 날마다의 값 — 이번 달은 마감일까지 · 작년 같은 달은 전체 (자료 없는 날 null) */
export function monthDaily(board: Board, key: MetricKey, date: string): { days: number[]; cur: (number | null)[]; ly: (number | null)[] } {
  const total = daysInMonth(date);
  const month = monthOf(date);
  const upto = Number(date.slice(8, 10));
  // 작년은 같은 주 · 같은 요일 (n일 ↔ 그 364일 전)
  const pick = (limit: number, shift: boolean) =>
    Array.from({ length: total }, (_, i) => {
      if (i + 1 > limit) return null;
      const d = `${month}-${String(i + 1).padStart(2, "0")}`;
      const m = board.day(shift ? lyDay(d) : d);
      return hasValue(m, key) ? valueOf(m, key) : null;
    });
  return { days: Array.from({ length: total }, (_, i) => i + 1), cur: pick(upto, false), ly: pick(31, true) };
}

/** 1~12월 달마다의 값 — 올해는 마감일까지 · 작년은 12달 전체 (cumulative 면 쌓은 값) */
export function yearMonthly(board: Board, key: MetricKey, date: string, cumulative = false): { cur: (number | null)[]; ly: (number | null)[] } {
  const y = date.slice(0, 4);
  const curMonth = Number(date.slice(5, 7));
  const run = (year: string, limitMonth: number, end: string | null, shift = false) => {
    let acc = 0;
    let any = false;
    const out: (number | null)[] = [];
    for (let mo = 1; mo <= 12; mo++) {
      if (mo > limitMonth) {
        out.push(null);
        continue;
      }
      const mm = `${year}-${String(mo).padStart(2, "0")}`;
      const from = `${mm}-01`;
      const to = mo === limitMonth && end ? end : lastDay(mm);
      const m = shift ? board.range(lyCalendar(from), lyCalendar(to)) : board.range(from, to);
      const has = hasValue(m, key);
      any = any || has;
      const v = valueOf(m, key) || 0;
      acc += v;
      out.push(cumulative ? acc : has ? v : null);
    }
    return any ? out : out.map(() => null);
  };
  // 작년 달마다 = 작년 같은 달 (달력, 월간 비교)
  return { cur: run(y, curMonth, date), ly: run(y, 12, null, true) };
}

/** 방문인원 주 단위 합계 (월 ~ 일) — 1월 1일이 든 주부터 마감일이 든 주까지 (마감일 주는 마감일까지).
 *  작년 = 같은 주 · 같은 요일 (364일 전), 한 주 전체 */
export function weeklyVisitors(board: Board, date: string): { starts: string[]; cur: (number | null)[]; ly: (number | null)[] } {
  const jan1 = `${date.slice(0, 4)}-01-01`;
  const back = (weekdayIndex(jan1) + 6) % 7; // 월요일까지 거슬러
  const starts: string[] = [];
  for (let s = addDaysKey(jan1, -back); s <= date; s = addDaysKey(s, 7)) starts.push(s);
  const val = (m: Metrics) => (m.has.cafe ? m.visitors : null);
  return {
    starts,
    cur: starts.map((s) => val(board.range(s, addDaysKey(s, 6) < date ? addDaysKey(s, 6) : date))),
    ly: starts.map((s) => val(board.range(lyDay(s), lyDay(addDaysKey(s, 6))))),
  };
}

function weekdayIndex(key: string): number {
  return new Date(key + "T00:00:00Z").getUTCDay();
}
