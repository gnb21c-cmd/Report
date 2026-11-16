/* ============================================================
   재방문 이벤트 돈까스를 받은 손님의 소비 (2026-11-16 사장님)
   - 매일 아침 카페 영수증별 자료를 받을 때(buildStorePart) [이벤트] 돈까스가 들어간 결제 건마다 그 영수증 소비 금액을 남김
     → 카페 칸 eventMeal (매일 자동 · 지난 날은 정리한 영수증 줄로 다시 셈 — apps/collector/src/eventMeal.ts)
   - 결제 건 = 같은 포스번호 + 영수증번호 (팀과 같음)
   - 소비 금액 = 그 영수증 상품 줄 실매출 합 (할인 뒤 · 상품권 · 쿠폰 · 교환권으로 낸 줄은 결제 수단이라 빼고 · 반품 짝은 이미 뺌)
     돈까스만 받아 간 건 = 0원 · 함께 산 건 = 그 금액
   - 쿠폰은 받은 날 안 쓰고 다음에 와서 써도 됨 → 돈까스가 찍힌 날(쓴 날)로 셈. 발행(통합데스크 재방문 성공)과 사용은 따로 셈
   - 견줌: 같은 날 카페 결제 1건 평균 (같은 방법 — 상품 줄이 있는 모든 영수증)
   ============================================================ */
import { dayRange } from "./dates";
import { dayKind } from "./forecast";
import { isEventDonkatsu, isVoucherPayment } from "./rules";
import type { DayReport } from "./part";

/** 카페 칸에 남기는 하루치 — amounts = 돈까스가 든 결제 건마다 소비 금액(작은 순) · qty = 돈까스 개수 · all = [그날 카페 결제 건 수, 그 소비 금액 합] */
export interface EventMeal {
  amounts: number[];
  qty: number;
  all: [number, number];
}

/** 정리한 영수증 줄(반품 짝을 뺀 것) → 그날 돈까스 결제 건 */
export function eventMealOf(
  lines: { pos: string; receipt: string; name: string; qty: number; net: number }[],
): EventMeal {
  const rec = new Map<string, { sum: number; dk: number; goods: boolean }>();
  for (const l of lines) {
    const key = `${l.pos}|${l.receipt}`;
    let r = rec.get(key);
    if (!r) rec.set(key, (r = { sum: 0, dk: 0, goods: false }));
    if (isVoucherPayment(l)) continue;
    r.goods = true;
    r.sum += l.net;
    if (isEventDonkatsu(l.name)) r.dk += l.qty;
  }
  const amounts: number[] = [];
  let qty = 0,
    n = 0,
    total = 0;
  for (const r of rec.values()) {
    if (!r.goods) continue;
    n++;
    total += r.sum;
    if (r.dk > 0) {
      amounts.push(r.sum);
      qty += r.dk;
    }
  }
  amounts.sort((a, b) => a - b);
  return { amounts, qty, all: [n, total] };
}

/** 저장된 칸 검사 (옛 날 · 이상한 모양은 null) */
export function asEventMeal(x: unknown): EventMeal | null {
  const o = x as EventMeal;
  if (!o || !Array.isArray(o.amounts) || !o.amounts.every((a) => typeof a === "number" && Number.isFinite(a)))
    return null;
  if (
    typeof o.qty !== "number" ||
    !Array.isArray(o.all) ||
    o.all.length !== 2 ||
    !o.all.every((a) => typeof a === "number" && Number.isFinite(a))
  )
    return null;
  return o;
}

export interface EventMealDay {
  d: string;
  /** 휴일(토 · 일 · 공휴일) */
  holiday: boolean;
  receipts: number;
  /** 돈까스만 (소비 0원 이하) */
  zero: number;
  qty: number;
  sum: number;
  /** 결제 건 평균 (0원 포함) */
  avg: number | null;
  /** 그날 통합데스크 쿠폰 발행 (재방문 성공) — 모르면 null */
  issued: number | null;
}
export interface EventMealGroup {
  receipts: number;
  zero: number;
  /** 함께 산 건 */
  withBuy: number;
  qty: number;
  sum: number;
  /** 결제 건 평균 (돈까스만 0원 포함) */
  avg: number | null;
  /** 함께 산 건만 평균 */
  avgWithBuy: number | null;
  /** 가운데 값 (0원 포함) */
  median: number | null;
  /** 같은 날들 카페 결제 1건 평균 */
  cafeAvg: number | null;
}
export interface EventMealSummary {
  from: string;
  to: string;
  days: EventMealDay[];
  all: EventMealGroup;
  weekday: EventMealGroup;
  holiday: EventMealGroup;
  /** 카페 칸은 있는데 이 칸이 아직 없는 날 (예전에 받은 날 — 다시 셈 전) */
  missing: string[];
  /** 통합데스크 쿠폰 발행 누적 (같은 기간) — 모르면 null */
  issued: number | null;
}

const round = (x: number) => Math.round(x);
function groupOf(ms: { m: EventMeal }[]): EventMealGroup {
  const amounts = ms.flatMap((x) => x.m.amounts).sort((a, b) => a - b);
  const receipts = amounts.length;
  const zero = amounts.filter((a) => a <= 0).length;
  const sum = amounts.reduce((a, b) => a + b, 0);
  const buy = amounts.filter((a) => a > 0);
  const cafeN = ms.reduce((a, x) => a + x.m.all[0], 0),
    cafeSum = ms.reduce((a, x) => a + x.m.all[1], 0);
  const mid = receipts
    ? receipts % 2
      ? amounts[(receipts - 1) / 2]
      : (amounts[receipts / 2 - 1] + amounts[receipts / 2]) / 2
    : null;
  return {
    receipts,
    zero,
    withBuy: buy.length,
    qty: ms.reduce((a, x) => a + x.m.qty, 0),
    sum,
    avg: receipts ? round(sum / receipts) : null,
    avgWithBuy: buy.length ? round(buy.reduce((a, b) => a + b, 0) / buy.length) : null,
    median: mid == null ? null : round(mid),
    cafeAvg: cafeN ? round(cafeSum / cafeN) : null,
  };
}

/** 이벤트 시작일 ~ to 의 마감 보고 → 날마다 · 모두 · 평일 / 휴일 (issuedDays = 통합데스크 재방문 성공 날마다) */
export function eventMealSummary(
  report: (d: string) => DayReport | undefined,
  from: string,
  to: string,
  issuedDays?: Record<string, number> | null,
): EventMealSummary {
  const days: EventMealDay[] = [];
  const got: { d: string; m: EventMeal; holiday: boolean }[] = [];
  const missing: string[] = [];
  let issued = issuedDays ? 0 : null;
  for (const d of from <= to ? dayRange(from, to) : []) {
    if (issuedDays && issued != null) issued += issuedDays[d] || 0;
    const cafe = report(d)?.cafe;
    if (!cafe) continue;
    const m = asEventMeal((cafe as { eventMeal?: unknown }).eventMeal);
    if (!m) {
      if (cafe.basis === "receipt") missing.push(d);
      continue;
    }
    const holiday = dayKind(d) === "휴일";
    got.push({ d, m, holiday });
    const sum = m.amounts.reduce((a, b) => a + b, 0);
    days.push({
      d,
      holiday,
      receipts: m.amounts.length,
      zero: m.amounts.filter((a) => a <= 0).length,
      qty: m.qty,
      sum,
      avg: m.amounts.length ? round(sum / m.amounts.length) : null,
      issued: issuedDays ? issuedDays[d] || 0 : null,
    });
  }
  return {
    from,
    to,
    days,
    all: groupOf(got),
    weekday: groupOf(got.filter((x) => !x.holiday)),
    holiday: groupOf(got.filter((x) => x.holiday)),
    missing,
    issued,
  };
}
