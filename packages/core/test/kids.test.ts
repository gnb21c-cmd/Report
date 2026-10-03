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

describe("2026-03-31 까지 — 키즈 매출 없음 (교환권 방식), 인원만", () => {
  const sheet = (date: string, lines: ReceiptLine[]) => ({ from: date, to: date, lines, sheetNet: null }) as any;
  const cafeDay = (date: string, lines: ReceiptLine[]) => buildStorePart({ store: "cafe", date, file: "c.xls", sheet: sheet(date, lines), sectorOf: () => "키친" as any }).part;

  it("3/31 까지 키즈입장 0원 · 키즈 기타 매출 0원, 입장 인원은 그대로", async () => {
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
    expect(m.box.키즈입장료).toBe(0);
    expect(m.box.기타).toBe(0);
    expect(m.total).toBe(0);
    const h = hourDay(b, before, "키즈입장료")!;
    expect(h.people[0]).toBe(6); // 인원은 시간대별로 그대로
    expect(h.total).toBe(0);
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
