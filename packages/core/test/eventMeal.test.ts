import { describe, expect, it } from "vitest";
import {
  buildStorePart,
  eventMealOf,
  eventMealSummary,
  guessSector,
  isEventDonkatsu,
  type DayReport,
  type ReceiptLine,
} from "../src";

/* 2026-11-16 사장님 — 재방문 이벤트 돈까스를 받은 손님의 결제 건 평균 (지어낸 영수증 · 금액)
   결제 건 = 포스번호 + 영수증번호 · 소비 금액 = 상품 줄 실매출 합 (상품권 · 쿠폰으로 낸 줄은 결제 수단이라 뺌)
   돈까스만 받아 간 건 = 0원 · 쿠폰을 다음 날 써도 돈까스가 찍힌 날로 셈 */

const line = (
  pos: string,
  receipt: string,
  name: string,
  net: number,
  qty = 1,
  time = "12:00:00",
): ReceiptLine => ({ pos, receipt, refund: false, time, name, qty, gross: net, discount: 0, net });
const DK = "[이벤트] 수제돈까스";

const LINES: ReceiptLine[] = [
  // 돈까스만 받아 감 → 0원
  line("01", "0001", DK, 0),
  // 돈까스 + 음료 · 파스타 → 25,000
  line("01", "0002", DK, 0),
  line("01", "0002", "아메리카노", 5000),
  line("01", "0002", "볼로네제라구파스타", 20000),
  // 돈까스 없음 → 견줌(카페 결제 1건)에만
  line("01", "0003", "아메리카노", 4500),
  // 돈까스 + 피자 18,000 을 상품권 10,000 + 카드로 → 소비 18,000 (상품권 줄은 빼고)
  line("02", "0001", DK, 0),
  line("02", "0001", "마르게리타피자", 18000),
  line("02", "0001", "상품권", -10000),
];

describe("돈까스 결제 건 — 하루치", () => {
  it("돈까스 상품 이름 (0원이어도)", () => {
    expect(isEventDonkatsu(DK)).toBe(true);
    expect(isEventDonkatsu("수제돈까스")).toBe(false);
  });

  it("결제 건마다 소비 금액 · 돈까스만은 0원 · 상품권 결제 줄은 뺌 · 포스가 다르면 다른 건", () => {
    const m = eventMealOf(LINES);
    expect(m.amounts).toEqual([0, 18000, 25000]);
    expect(m.qty).toBe(3);
    // 카페 결제 4건 (돈까스 3 + 아메리카노 1) · 소비 합 0 + 25,000 + 4,500 + 18,000
    expect(m.all).toEqual([4, 47500]);
  });

  it("상품권만 있는 줄 묶음은 결제 건으로 세지 않음", () => {
    const m = eventMealOf([line("01", "0009", "상품권", -5000), line("01", "0010", DK, 0, 2)]);
    expect(m.amounts).toEqual([0]);
    expect(m.qty).toBe(2);
    expect(m.all).toEqual([1, 0]);
  });

  it("아침 수집(영수증별 → 카페 칸)에 저절로 들어감 · 키즈 칸에는 없음", () => {
    const sheet = { from: "2026-11-13", to: "2026-11-13", lines: LINES, sheetNet: null, sheetQty: null };
    const cafe = buildStorePart({
      store: "cafe",
      date: "2026-11-13",
      file: "t",
      sheet,
      sectorOf: guessSector,
    }).part;
    expect(cafe.eventMeal).toEqual(eventMealOf(LINES));
    const kids = buildStorePart({
      store: "kids",
      date: "2026-11-13",
      file: "t",
      sheet,
      sectorOf: guessSector,
    }).part;
    expect(kids.eventMeal).toBeUndefined();
  });
});

describe("돈까스 결제 건 — 기간 모음", () => {
  // 11/12(목) = 예전에 받은 날(칸 없음) · 11/13(금) 평일 · 11/14(토) 휴일
  const reports: Record<string, DayReport> = {
    "2026-11-12": { date: "2026-11-12", cafe: { basis: "receipt" } as any },
    "2026-11-13": {
      date: "2026-11-13",
      cafe: { basis: "receipt", eventMeal: { amounts: [0, 18000, 25000], qty: 3, all: [4, 47500] } } as any,
    },
    "2026-11-14": {
      date: "2026-11-14",
      cafe: {
        basis: "receipt",
        eventMeal: { amounts: [0, 0, 30000, 41000], qty: 5, all: [6, 90000] },
      } as any,
    },
  };
  const s = eventMealSummary((d) => reports[d], "2026-11-11", "2026-11-14", {
    "2026-11-11": 2,
    "2026-11-13": 4,
    "2026-11-14": 6,
  });

  it("모두 — 평균(0원 포함) · 함께 산 건 평균 · 가운데 값 · 같은 날 카페 1건 평균", () => {
    expect(s.all.receipts).toBe(7);
    expect(s.all.zero).toBe(3);
    expect(s.all.withBuy).toBe(4);
    expect(s.all.qty).toBe(8);
    expect(s.all.sum).toBe(114000);
    expect(s.all.avg).toBe(Math.round(114000 / 7));
    expect(s.all.avgWithBuy).toBe(Math.round(114000 / 4));
    // 0 · 0 · 0 · 18,000 · 25,000 · 30,000 · 41,000 → 가운데 18,000
    expect(s.all.median).toBe(18000);
    expect(s.all.cafeAvg).toBe(Math.round((47500 + 90000) / 10));
  });

  it("평일 · 휴일 나눔 · 날마다 · 칸이 없는 날은 따로 알림 · 쿠폰 발행 누적", () => {
    expect(s.weekday.receipts).toBe(3);
    expect(s.holiday.receipts).toBe(4);
    expect(s.holiday.avg).toBe(Math.round(71000 / 4));
    expect(s.days.map((x) => [x.d, x.holiday, x.receipts, x.zero, x.issued])).toEqual([
      ["2026-11-13", false, 3, 1, 4],
      ["2026-11-14", true, 4, 2, 6],
    ]);
    expect(s.missing).toEqual(["2026-11-12"]);
    // 11/11 은 카페 칸이 없어도 발행은 셈
    expect(s.issued).toBe(12);
  });

  it("발행을 모르면 null · 자료가 없으면 평균 null", () => {
    const e = eventMealSummary(() => undefined, "2026-11-01", "2026-11-02");
    expect(e.issued).toBeNull();
    expect(e.all.avg).toBeNull();
    expect(e.all.median).toBeNull();
  });
});
