import { describe, expect, it } from "vitest";
import { Board, buildStorePart, etcMove, productInBox, type ReceiptLine, type StorePart } from "../src";

const line = (o: Partial<ReceiptLine>): ReceiptLine => ({ pos: "01", receipt: "0001", refund: false, time: "12:00:00", name: "", qty: 1, gross: 0, discount: 0, net: 0, ...o });
const sold = (name: string, qty: number, price: number) => line({ name, qty, gross: qty * price, net: qty * price });
// 분류표에 없으면 기타 (예전 OK포스 대분류가 '기타' 였던 상품들처럼)
const day = (store: "cafe" | "kids", date: string, lines: ReceiptLine[], sectorOf: (n: string) => any = () => "기타") =>
  buildStorePart({ store, date, file: "t.xls", sheet: { from: date, to: date, lines, sheetNet: null } as any, sectorOf }).part;

describe("기타로 잡히던 상품 옮기기 (2026-10-06 사장님 기준)", () => {
  it("상품 이름 → 옮길 곳", () => {
    expect(etcMove("cafe", "C3 [필스너]")).toBe("바리스타");
    expect(etcMove("cafe", "C5 [바이젠]")).toBe("바리스타");
    expect(etcMove("cafe", "C7 [페일에일]")).toBe("바리스타");
    expect(etcMove("cafe", "[상품권]일만원권")).toBe("바리스타");
    expect(etcMove("cafe", "[5주년이벤트]폭립할인")).toBe("키친");
    expect(etcMove("cafe", "포장백(종이)")).toBeNull();
    for (const n of ["딸기쥬스", "초코우유", "오랜지주스", "흰우유(상하)", "바나나우유", "생수(300ml)", "자판기상품_스티커"]) expect(etcMove("kids", n)).toBe("자판기");
    for (const n of ["퇴장시간 + 10~19분 지연", "퇴장시간 + 30~39분 지연", "02.51-03.00", "[분실] 열쇠뭉치 교체비", "인원추가 [평일만]"]) expect(etcMove("kids", n)).toBe("키즈입장료");
  });

  it("카페: 맥주 · 상품권 판매 → 바리스타, 폭립할인(−) → 키친에서 뺌, 상품권 사용(−) → 그날 바리스타에서 뺌", () => {
    const p = day("cafe", "2026-04-23", [
      sold("[ICE] 아메리카노", 2, 4500),
      sold("C3 [필스너]", 2, 6500),
      sold("[상품권]일만원권", 5, 10000),
      sold("폭립", 1, 25000),
      line({ name: "[5주년이벤트]폭립할인", qty: 1, gross: -5000, net: -5000 }),
      line({ name: "[종이쿠폰]만원권", qty: 2, gross: -20000, net: -20000 }),
      sold("포장백(종이)", 1, 100),
    ], (n) => (/아메리카노/.test(n) ? "바리스타" : /폭립$/.test(n) ? "키친" : "기타"));
    expect(p.giftUse).toBe(20000);
    const m = new Board([{ date: "2026-04-23", cafe: p }]).day("2026-04-23");
    expect(m.box.바리스타).toBe(9000 + 13000 + 50000 - 20000);
    expect(m.box.키친).toBe(25000 - 5000);
    expect(m.box.기타).toBe(100);
    expect(m.total).toBe(52000 + 20000 + 100);
    expect(m.cups).toBe(4); // 맥주도 잔
  });

  it("예전에 올린 날(기타로 저장된 상품)도 볼 때 옮김", () => {
    // 이 규칙 전에 올린 날: 바이젠이 기타로 저장돼 있음
    const now = day("cafe", "2025-06-01", [sold("C5 [바이젠]", 3, 6500), sold("이벤트 초", 1, 3500)]);
    const old: StorePart = { ...now, sectors: { ...now.sectors, 바리스타: 0, 기타: 19500 + 3500 }, products: now.products.map((p) => [p[0], "기타", p[2], p[3]]) };
    const m = new Board([{ date: "2025-06-01", cafe: old }]).day("2025-06-01");
    expect([m.box.바리스타, m.box.기타]).toEqual([19500, 3500]);
    expect(productInBox(old, old.products.find((x) => x[0] === "C5 [바이젠]")!, "바리스타")).toBe(true);
    expect(productInBox(old, old.products.find((x) => x[0] === "C5 [바이젠]")!, "기타")).toBe(false);
  });

  it("키즈: 음료 · 스티커 → 자판기, 퇴장 지연 · 열쇠 · 인원추가 → 키즈입장료 (키즈 매출을 잡는 4월부터)", () => {
    const lines = [
      sold("딸기쥬스", 2, 2500),
      sold("자판기상품_스티커", 1, 4000),
      sold("퇴장시간 + 10~19분 지연", 1, 5000),
      sold("02.51-03.00", 1, 30000),
      sold("[분실] 열쇠뭉치 교체비", 1, 10000),
      sold("인원추가 [평일만]", 1, 3000),
      sold("키링", 1, 2000),
    ];
    const m = new Board([{ date: "2026-05-13", kids: day("kids", "2026-05-13", lines) }]).day("2026-05-13");
    expect(m.extra.vending).toBe(9000);
    expect(m.box.키즈입장료).toBe(48000);
    expect(m.box.기타).toBe(2000 + 9000); // 자판기는 기타 상자 안
    expect(m.kidsOtherNet).toBe(2000);
    expect(m.total).toBe(59000);
    const before = new Board([{ date: "2026-03-13", kids: day("kids", "2026-03-13", lines) }]).day("2026-03-13");
    expect([before.extra.vending, before.box.키즈입장료, before.box.기타]).toEqual([0, 0, 0]);
  });
});

describe("키즈 총 입장권 수 (보여 주기만)", async () => {
  const { kidsTickets, METRIC_LABEL, unitOf } = await import("../src");
  it("네이버 + 현장 + 이벤트 무료입장, 이름 · 단위는 '장'", () => {
    const m = new Board([{ date: "2026-10-05", kids: day("kids", "2026-10-05", [sold("[휴일] 1시간 50분 입장권", 16, 14000), line({ name: "[평일] 무제한 이용", qty: 152 })]) }]).day("2026-10-05");
    expect([m.naver, m.walkIn]).toEqual([136, 16]); // 네이버 미입력이면 발행 − 현장
    expect(kidsTickets(m)).toBe(152);
    expect([METRIC_LABEL.naver, METRIC_LABEL.walkIn, METRIC_LABEL.eventFree]).toEqual(["네이버 판매 수", "현장 판매 수", "이벤트 무료입장"]);
    expect(unitOf("eventFree")).toBe("장");
  });
});
