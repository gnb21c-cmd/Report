import { describe, expect, it } from "vitest";
import { Board, buildStorePart, HOURS, hourDay, kidsKind, NAVER_SLOTS, naverPastPart, type ReceiptLine } from "../src";

const line = (o: Partial<ReceiptLine>): ReceiptLine => ({ pos: "01", receipt: "0001", refund: false, time: "10:00:00", name: "", qty: 1, gross: 0, discount: 0, net: 0, ...o });
const kidsDay = (date: string, lines: ReceiptLine[]) =>
  buildStorePart({ store: "kids", date, file: "k.xls", sheet: { from: date, to: date, lines, sheetNet: null } as any, sectorOf: () => "기타" as any }).part;

describe("키즈 현장 입장 — 12,000원(평일) · 14,000원(휴일) 결제", () => {
  it("이름에 '입장'이 없어도 입장료 금액으로 결제했으면 현장 입장", () => {
    expect(kidsKind({ name: "1시간 50분", qty: 2, gross: 24000, net: 24000 })).toBe("현장결제");
    expect(kidsKind({ name: "키즈 [휴일]", qty: 1, gross: 14000, net: 13000 })).toBe("현장결제"); // 할인돼도 정가로 봄
    expect(kidsKind({ name: "[평일] 1시간 50분 입장권", qty: 1, gross: 12000, net: 12000 })).toBe("현장결제"); // 이미 잡히던 것 그대로
    expect(kidsKind({ name: "아이스 아메리카노", qty: 1, gross: 4500, net: 4500 })).toBe("기타");
    expect(kidsKind({ name: "인원추가 [평일만]", qty: 1, gross: 12000, net: 12000 })).toBe("추가인원"); // 10/2 정한 기준 유지
  });

  it("결제 시각 칸에 수량만큼 — 같은 줄을 두 번 세지 않음", () => {
    const p = kidsDay("2026-09-29", [
      line({ receipt: "0001", time: "10:40:00", name: "1시간 50분", qty: 2, gross: 24000, net: 24000 }),
      line({ receipt: "0002", time: "13:05:00", name: "[평일] 1시간 50분 입장권", qty: 1, gross: 12000, net: 12000 }),
      line({ receipt: "0002", time: "13:05:00", name: "[평일] 무제한 이용", qty: 1 }),
      line({ receipt: "0003", time: "13:20:00", name: "딸기주스", qty: 1, gross: 4000, net: 4000 }),
    ]);
    expect(p.kids!.walkIn).toBe(3);
    expect(p.kids!.walkInNet).toBe(36000);
    expect(p.kids!.hourly!.walkIn[0]).toBe(2); // 10시
    expect(p.kids!.hourly!.walkIn[3]).toBe(1); // 13시
    expect(p.kids!.other).toBe(4000);
  });

  it("시간대 방문 = 네이버(예약 시간, 지난 자료) + 현장(결제 시각)", () => {
    const date = "2026-09-29";
    const tickets = NAVER_SLOTS.map(() => 0);
    tickets[0] = 3; // 10:00
    tickets[7] = 4; // 13:30
    const b = new Board([{ date, kids: kidsDay(date, [line({ time: "10:40:00", name: "1시간 50분", qty: 2, gross: 24000, net: 24000 }), line({ receipt: "0002", time: "13:05:00", name: "1시간 50분", qty: 1, gross: 12000, net: 12000 })]), naver: naverPastPart({ date, tickets }) }]);
    const h = hourDay(b, date, "키즈입장료")!;
    expect(h.people[0]).toBe(5); // 네이버 3 + 현장 2
    expect(h.people[3]).toBe(5); // 네이버 4 + 현장 1
    expect(h.people.reduce((a, x) => a + x, 0)).toBe(10);
    expect(HOURS.length).toBe(h.people.length);
    const m = b.day(date);
    expect(m.naver).toBe(7);
    expect(m.walkIn).toBe(3);
    expect(m.newKnown).toBe(0); // 지난 자료는 신규 모름
  });
});

describe("네이버 지난 자료 — 낮 · 밤 캡처 합치기", () => {
  it("칸마다 큰 값, A 입력은 덮지 않음", async () => {
    const { mergeNaverPast } = await import("../src");
    const day = NAVER_SLOTS.map((s) => (s < "18:00" ? 2 : 0));
    const night = NAVER_SLOTS.map((s) => (s >= "18:00" ? 5 : 0));
    const a = naverPastPart({ date: "2025-09-20", tickets: day });
    const m = mergeNaverPast(a, naverPastPart({ date: "2025-09-20", tickets: night }))!;
    expect(m.tickets.reduce((x, y) => x + y, 0)).toBe(16 * 2 + 4 * 5);
    expect(mergeNaverPast(m, naverPastPart({ date: "2025-09-20", tickets: night }))!.tickets).toEqual(m.tickets); // 두 번 넣어도 그대로
    expect(m.noNew).toBe(true);
    expect(mergeNaverPast({ ...a, noNew: undefined }, m)).toBeNull();
  });
});

describe("2026-03-31 까지 — 교환권 방식", () => {
  const sheet = (date: string, lines: ReceiptLine[]) => ({ from: date, to: date, lines, sheetNet: null }) as any;
  const cafeDay = (date: string, lines: ReceiptLine[]) => buildStorePart({ store: "cafe", date, file: "c.xls", sheet: sheet(date, lines), sectorOf: () => "키친" as any }).part;

  it("3/31 까지 키즈입장 = 네이버 × 3만원 + 현장 결제 − 카페 교환권 사용, 키즈 기타 매출 0원, 인원은 그대로", async () => {
    const { Board } = await import("../src");
    const tickets = NAVER_SLOTS.map(() => 0);
    tickets[0] = 4;
    const kidsLines = [line({ time: "10:40:00", name: "1시간 50분", qty: 2, gross: 24000, net: 24000 }), line({ receipt: "0002", time: "11:10:00", name: "딸기주스", qty: 1, gross: 4000, net: 4000 })];
    const before = "2026-03-27";
    const after = "2026-04-03";
    const b = new Board([
      { date: before, kids: kidsDay(before, kidsLines), naver: naverPastPart({ date: before, tickets }) },
      { date: after, kids: kidsDay(after, kidsLines), naver: naverPastPart({ date: after, tickets }) },
    ]);
    const m = b.day(before);
    expect(m.naver).toBe(4);
    expect(m.walkIn).toBe(2);
    // 카페 자료가 없는 날은 교환권 사용 0 — 네이버 4 × 30,000 + 현장 24,000
    expect(m.box.키즈입장료).toBe(4 * 30000 + 24000);
    expect(m.box.기타).toBe(0);
    const h = hourDay(b, before, "키즈입장료")!;
    expect(h.people[0]).toBe(6); // 인원은 시간대별로 그대로
    // 4/1 부터는 입장료 · 키즈 기타 매출
    const n = b.day(after);
    expect(n.box.키즈입장료).toBe(6 * 12000);
    expect(n.box.기타).toBe(4000);
  });

  it("카페의 키즈 교환권 −3만원 줄은 매출에서 빼지 않음 (네이버로 이미 받은 돈)", () => {
    const p = cafeDay("2026-03-14", [
      line({ name: "부라타토마토파스타", qty: 2, gross: 46000, net: 46000 }),
      line({ name: "[아키 3만원] 교환권", qty: 1, gross: -30000, net: -30000 }),
    ]);
    expect(p.sectors.키친).toBe(46000);
    expect(p.voucher).toBe(30000);
  });
});

describe("2026-03 까지 키즈 현장 손님 — '현장 구매 30,000원' (실제 2025-12-20 파일)", () => {
  it("현장 구매는 현장 입장 인원 (결제 시각 칸에), 3월까지 키즈 매출은 교환권 값으로", async () => {
    const { Board } = await import("../src");
    expect(kidsKind({ name: "현장 구매 30,000원", qty: 1, gross: 30000, net: 30000 })).toBe("현장결제");
    expect(kidsKind({ name: "[분실] 열쇠뭉치 교체비", qty: 1, gross: 10000, net: 10000 })).toBe("기타");
    const date = "2025-12-20";
    const p = kidsDay(date, [
      line({ time: "19:20:34", name: "현장 구매 30,000원", qty: 1, gross: 30000, net: 30000 }),
      line({ receipt: "0002", time: "20:03:21", name: "현장 구매 30,000원", qty: 1, gross: 30000, net: 30000 }),
      line({ receipt: "0003", time: "12:30:00", name: "2시 20분 퇴장 [12시30분입장]", qty: 10 }),
    ]);
    expect(p.kids!.walkIn).toBe(2);
    expect(p.kids!.issued).toBe(10);
    expect(p.kids!.hourly!.walkIn[9]).toBe(1); // 19시
    expect(p.kids!.hourly!.walkIn[10]).toBe(1); // 20시
    const m = new Board([{ date, kids: p }]).day(date);
    expect(m.walkIn).toBe(2);
    // 네이버 입력이 없으면 POS 추정(발행 10 − 현장 2 = 8) × 3만원 + 현장 결제 6만원, 카페 자료 없음 → 교환권 사용 0
    expect(m.box.키즈입장료).toBe(8 * 30000 + 60000);
    expect(m.box.기타).toBe(0);
  });
});

describe("'[아키 2만원] 교환권' — 카페 매출은 그대로, 키즈 매출에서 뺌 (3월까지 쓰인 교환권 · 4월부터 사은권)", () => {
  const cafeOf = (date: string) =>
    buildStorePart({
      store: "cafe",
      date,
      file: "c.xls",
      sheet: { from: date, to: date, lines: [line({ name: "부라타토마토파스타", qty: 2, gross: 46000, net: 46000 }), line({ name: "[아키 2만원] 교환권", qty: 1, gross: -20000, net: -20000 }), line({ name: "[종이쿠폰]만원권", qty: 1, gross: -10000, net: -10000 })], sheetNet: null } as any,
      sectorOf: () => "키친" as any,
    }).part;
  it("카페 매출은 언제나 그대로, 키즈 매출에서 교환권 · 사은권만큼 뺌", async () => {
    const { Board } = await import("../src");
    const kidsLines = [line({ time: "10:40:00", name: "[평일] 1시간 50분 입장권", qty: 3, gross: 36000, net: 36000 })];
    const before = "2026-03-26";
    const after = "2026-04-02";
    const b = new Board([
      { date: before, cafe: cafeOf(before), kids: kidsDay(before, kidsLines) },
      { date: after, cafe: cafeOf(after), kids: kidsDay(after, kidsLines) },
    ]);
    const p = cafeOf(after);
    expect(p.voucher).toBe(30000);
    expect(p.kidsCoupon).toBe(20000);
    const m0 = b.day(before);
    expect(m0.box.키친).toBe(46000);
    // 3월까지: 현장 결제 36,000 − 카페에서 쓴 교환권 20,000
    expect(m0.kidsCoupon).toBe(20000);
    expect(m0.box.키즈입장료).toBe(36000 - 20000);
    const m1 = b.day(after);
    expect(m1.box.키친).toBe(46000);
    expect(m1.kidsCoupon).toBe(20000);
    expect(m1.box.키즈입장료).toBe(3 * 12000 - 20000);
    expect(m1.total).toBe(46000 + 16000);
    expect(b.range(before, after).kidsCoupon).toBe(40000);
  });
});

describe("2026-03 까지 키즈 매출 = 받은 교환권 값 − 카페에서 쓴 교환권 (2025-12-20 실제 숫자)", () => {
  const cafeWith = (date: string, n: number) =>
    buildStorePart({ store: "cafe", date, file: "c", sheet: { from: date, to: date, lines: [line({ name: "[A세트]시그니처플래터", qty: 50, gross: 2150000, net: 2150000 }), line({ name: "[아키 2만원] 교환권", qty: n, gross: -30000 * n, net: -30000 * n })], sheetNet: null } as any, sectorOf: () => "키친" as any }).part;
  it("안 쓰고 간 교환권만큼 + 키즈 매출, 더 쓰이면 − 키즈 매출", async () => {
    const { Board } = await import("../src");
    const date = "2025-12-20";
    const tickets = NAVER_SLOTS.map(() => 0);
    tickets[0] = 201;
    const kids = kidsDay(date, [line({ time: "19:20:34", name: "현장 구매 30,000원", qty: 3, gross: 90000, net: 90000 })]);
    const naver = naverPastPart({ date, tickets });
    const plus = new Board([{ date, cafe: cafeWith(date, 200), kids, naver }]).day(date);
    expect(plus.box.키즈입장료).toBe(201 * 30000 + 90000 - 200 * 30000); // +120,000
    expect(plus.box.키친).toBe(2150000); // 카페 매출은 교환권을 빼지 않음
    expect(plus.kidsCoupon).toBe(6000000);
    const minus = new Board([{ date, cafe: cafeWith(date, 206), kids, naver }]).day(date);
    expect(minus.box.키즈입장료).toBe(-60000); // 교환권을 더 준 실수 → − 키즈 매출
  });
});

describe("2026-03 까지 네이버 판매 장수 = POS 입장 발행 − 현장 구매 (당일 취소가 안 되어 발행 = 판매)", () => {
  it("2025-12-20: 발행 204 − 현장 3 = 네이버 201장 → 201 × 3만 + 9만 − 교환권 600만 = +12만", async () => {
    const { Board } = await import("../src");
    const date = "2025-12-20";
    const tickets = NAVER_SLOTS.map(() => 0);
    tickets[0] = 196; // 캡처로 옮긴 숫자 (시간대 인원용)
    const kids = kidsDay(date, [
      line({ time: "10:00:00", name: "11시20분 퇴장 [10시 입장]", qty: 204 }),
      line({ receipt: "0002", time: "19:20:34", name: "현장 구매 30,000원", qty: 3, gross: 90000, net: 90000 }),
    ]);
    const cafe = buildStorePart({ store: "cafe", date, file: "c", sheet: { from: date, to: date, lines: [line({ name: "[아키 2만원] 교환권", qty: 200, gross: -6000000, net: -6000000 })], sheetNet: null } as any, sectorOf: () => "키친" as any }).part;
    const m = new Board([{ date, cafe, kids, naver: naverPastPart({ date, tickets }) }]).day(date);
    expect(m.fee.naver).toBe(201 * 30000);
    expect(m.box.키즈입장료).toBe(120000);
  });
});

describe("'퍼피 정산' (2025-09 까지 아스타나퍼피 선결제 1만원 교환권) — 결제 수단", () => {
  it("다른 POS · 네이버에서 이미 받은 돈이라 카페 매출에서 빼지 않음, 키즈 매출과도 무관", async () => {
    const { isVoucherPayment, isKidsCoupon } = await import("../src");
    expect(isVoucherPayment({ name: "퍼피 정산", net: -10000 })).toBe(true);
    expect(isKidsCoupon({ name: "퍼피 정산", net: -10000 })).toBe(false);
    const date = "2025-06-14";
    const p = buildStorePart({ store: "cafe", date, file: "c", sheet: { from: date, to: date, lines: [line({ name: "수제돈까스", qty: 1, gross: 14000, net: 14000 }), line({ name: "퍼피 정산", qty: 1, gross: -10000, net: -10000 })], sheetNet: null } as any, sectorOf: () => "키친" as any }).part;
    expect(p.sectors.키친).toBe(14000);
    expect(p.voucher).toBe(10000);
    expect(p.kidsCoupon || 0).toBe(0);
  });
});

describe("'[키즈]' (2025-01 초 카페 POS — '[아키 2만원] 교환권' 이전 이름) — 카페 교환권", () => {
  it("음수 줄이면 결제 수단 + 키즈 교환권 (기타 매출이 아님), 0원 줄은 무시", async () => {
    const { isVoucherPayment, isKidsCoupon } = await import("../src");
    expect(isVoucherPayment({ name: "[키즈]", net: -20000 })).toBe(true);
    expect(isKidsCoupon({ name: "[키즈]", net: -20000 })).toBe(true);
    expect(isVoucherPayment({ name: "[키즈]", net: 0 })).toBe(false);
    expect(isKidsCoupon({ name: "[키즈]플래터", net: -20000 })).toBe(false);
    const date = "2025-01-02";
    const p = buildStorePart({ store: "cafe", date, file: "c", sheet: { from: date, to: date, lines: [line({ name: "수제돈까스", qty: 1, gross: 14000, net: 14000 }), line({ name: "[키즈]", qty: 2, gross: -40000, net: -40000 })], sheetNet: null } as any, sectorOf: () => "키친" as any }).part;
    expect(p.sectors.키친).toBe(14000);
    expect(p.sectors.기타 || 0).toBe(0);
    expect(p.voucher).toBe(40000);
    expect(p.kidsCoupon).toBe(40000);
  });
});

describe("2025-01 교환권 값 바꾸는 달 — 평일 표는 2만원 ('/평일-20,000원'), 숏타임은 3만원", () => {
  it("평일 2만원 표 · 평일 현장결제 2만원 · 숏타임 3만원", () => {
    const date = "2025-01-02";
    const ks = [
      line({ name: "11시50분 퇴장/평일-20,000원 [10시입장]", qty: 10 }),
      line({ name: "12시50분 퇴장 [11시 입장]", qty: 2 }),
      line({ name: "11시20분 퇴장/평일-20,000원 [10시입장]", qty: 3 }),
      line({ name: "평일 현장결제 20,000원", qty: 1, gross: 20000, net: 20000 }),
    ];
    expect(kidsKind({ name: "평일 현장결제 20,000원", qty: 1, gross: 20000, net: 20000 })).toBe("현장결제");
    const kids = buildStorePart({ store: "kids", date, file: "k", sheet: { from: date, to: date, lines: ks, sheetNet: null } as any, sectorOf: () => "기타" as any }).part;
    const m = new Board([{ date, kids }]).day(date);
    expect(m.issued).toBe(15);
    expect(m.walkIn).toBe(1);
    expect(m.naverPos).toBe(14);
    // 2만원 표 10장 − 현장 2만원 1장 = 9장 × 2만 + 3만원 표(일반 2 + 숏타임 3) 5장 × 3만
    expect(m.fee.naver).toBe(9 * 20000 + 5 * 30000);
    expect(m.fee.walkIn).toBe(20000);
  });
});

describe("'퇴장시간 + 10~19분 지연' — 연장 요금은 입장 인원이 아니라 키즈 기타 매출", () => {
  it("이름에 '퇴장'이 있어도 '지연'이면 기타", () => {
    expect(kidsKind({ name: "퇴장시간 + 10~19분 지연", qty: 1, gross: 5000, net: 5000 })).toBe("기타");
    expect(kidsKind({ name: "퇴장시간 + 20~29분 지연", qty: 1, gross: 10000, net: 10000 })).toBe("기타");
    expect(kidsKind({ name: "11시20분 퇴장 [10시 입장]", qty: 1, gross: 0, net: 0 })).toBe("입장발행");
    expect(kidsKind({ name: "[휴일] 1시간 50분 입장권", qty: 1, gross: 14000, net: 14000 })).toBe("현장결제");
  });
});

describe("'9월 이벤트(시간제한X)/30,000원' — 이름에 금액이 붙은 0원 이벤트 입장 = 네이버에서 판 입장권 (입장 발행)", () => {
  it("발행으로 셈 (무료 이벤트 아님), 금액 없는 쿠폰 입장은 그대로 이벤트 무료", () => {
    expect(kidsKind({ name: "9월 이벤트(시간제한X)/30,000원", qty: 1, gross: 0, net: 0 })).toBe("입장발행");
    expect(kidsKind({ name: "[평일] 한가위 무제한 쿠폰", qty: 1, gross: 0, net: 0 })).toBe("이벤트무료");
  });
});
