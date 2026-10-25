import { describe, expect, it } from "vitest";
import { Board, buildStorePart, etcDetail, etcMove, extraTotal, NOT_BREAD, productInBox, type ExtraPart, type ReceiptLine, type StorePart } from "../src";

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
    // 퇴장 지연은 기타 안 '퇴장지연페널티' 칸 (2026-10-25 사장님 — 예전엔 키즈입장료), 열쇠 · 인원추가는 그대로 키즈입장료
    for (const n of ["퇴장시간 + 10~19분 지연", "퇴장시간 + 30~39분 지연", "02.51-03.00"]) expect(etcMove("kids", n)).toBe("퇴장지연");
    for (const n of ["[분실] 열쇠뭉치 교체비", "인원추가 [평일만]"]) expect(etcMove("kids", n)).toBe("키즈입장료");
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

  it("원두 · 드립백 · 콜드브루 원액 → 바리스타, 흑미로만든수수부꾸미(빵) → 베이커리 (2026-10-14 사장님)", () => {
    for (const n of ["[원액500ml]콜드브루", "[원두200g]블랙수트", "[드립백]블랙수트", "[드립백]블랙수트1ea", "[드립백]디카프1ea", "[원두200g]디카프", "[드립백]디카프"])
      expect(etcMove("cafe", n)).toBe("바리스타");
    expect(etcMove("cafe", "흑미로만든수수부꾸미")).toBe("베이커리");
    // 정하지 않은 것은 그대로 기타
    for (const n of ["[5월]드립백/머그세트", "딸기잼", "몽블랑박스", "이벤트 초", "머그컵(13oz)"]) expect(etcMove("cafe", n)).toBeNull();
    // 키즈 POS 에는 이 규칙을 쓰지 않음
    expect(etcMove("kids", "[드립백]블랙수트")).toBeNull();
  });

  it("새로 올린 날: 원두 · 드립백 · 원액은 바리스타지만 잔이 아님, 수수부꾸미는 베이커리 · 빵 목록", () => {
    const p = day("cafe", "2026-10-13", [
      sold("[ICE] 아메리카노", 2, 4500),
      sold("[원액500ml]콜드브루", 1, 13728),
      sold("[원두200g]블랙수트", 1, 16500),
      sold("[드립백]블랙수트1ea", 2, 1500),
      sold("흑미로만든수수부꾸미", 12, 2704),
      sold("딸기잼", 1, 1500),
      sold("포장백(종이)", 1, 100),
    ], (n) => (/아메리카노/.test(n) ? "바리스타" : "기타"));
    expect(p.sectors.바리스타).toBe(9000 + 13728 + 16500 + 3000);
    expect(p.sectors.베이커리).toBe(12 * 2704);
    expect(p.sectors.기타).toBe(1500 + 100);
    expect(p.cups).toBe(2); // 아메리카노 2잔만 — 원액 · 원두 · 드립백은 잔이 아님
    const b = new Board([{ date: "2026-10-13", cafe: p }]);
    const m = b.day("2026-10-13");
    expect([m.box.바리스타, m.box.베이커리, m.box.기타]).toEqual([42228, 32448, 1600]);
    expect(b.products("2026-10-13", "2026-10-13", "베이커리").map((x) => x.name)).toEqual(["흑미로만든수수부꾸미"]);
  });

  it("예전에 올린 날(원두 · 드립백 · 원액 · 수수부꾸미가 기타로 저장됨)도 볼 때 옮김 — 합계는 그대로", () => {
    const now = day("cafe", "2026-09-01", [sold("[원액500ml]콜드브루", 2, 13728), sold("[드립백]디카프", 1, 14000), sold("흑미로만든수수부꾸미", 3, 2704), sold("이벤트 초", 1, 3500)]);
    const old: StorePart = {
      ...now,
      sectors: { 바리스타: 0, 베이커리: 0, 키친: 0, 기타: 27456 + 14000 + 8112 + 3500 },
      products: now.products.map((p) => [p[0], "기타", p[2], p[3]]),
    };
    const b = new Board([{ date: "2026-09-01", cafe: old }]);
    const m = b.day("2026-09-01");
    expect([m.box.바리스타, m.box.베이커리, m.box.기타]).toEqual([27456 + 14000, 8112, 3500]);
    expect(m.total).toBe(27456 + 14000 + 8112 + 3500);
    const bun = old.products.find((x) => x[0] === "흑미로만든수수부꾸미")!;
    expect([productInBox(old, bun, "베이커리"), productInBox(old, bun, "기타")]).toEqual([true, false]);
    expect(b.products("2026-09-01", "2026-09-01", "기타").map((x) => x.name)).toEqual(["이벤트 초"]);
    expect(b.products("2026-09-01", "2026-09-01", "바리스타").map((x) => x.name).sort()).toEqual(["[드립백]디카프", "[원액500ml]콜드브루"]);
  });

  it("빵이 아닌 상품 — 포션크림치즈 · 발사믹소스 · 소스 따로는 기타 (2026-10-19 사장님, 잼과 같이)", () => {
    for (const n of ["딸기잼", "블루베리잼", "라즈베리잼", "포션크림치즈", "발사믹소스", "소스 따로", "음료먼저", "감튀시즈닝따로"]) expect(NOT_BREAD.has(n)).toBe(true);
    const p = day("cafe", "2026-10-19", [sold("소금빵", 3, 3500), sold("포션크림치즈", 1, 1500), sold("발사믹소스", 2, 1200), sold("소스 따로", 1, 0)], () => "베이커리");
    expect(p.sectors.베이커리).toBe(10500);
    expect(p.sectors.기타).toBe(1500 + 2400);
    const b = new Board([{ date: "2026-10-19", cafe: p }]);
    expect(b.products("2026-10-19", "2026-10-19", "베이커리").map((x) => x.name)).toEqual(["소금빵"]);
  });

  it("예전에 올린 날(포션크림치즈 · 발사믹소스 · 소스 따로 · 잼이 베이커리로 저장됨)도 볼 때 기타로 — 합계는 그대로", () => {
    const now = day("cafe", "2026-10-18", [sold("소금빵", 3, 3500), sold("포션크림치즈", 1, 1500), sold("발사믹소스", 2, 1200), sold("소스 따로", 2, 0), sold("딸기잼", 1, 1500)], () => "베이커리");
    const old: StorePart = {
      ...now,
      sectors: { 바리스타: 0, 베이커리: 10500 + 1500 + 2400 + 1500, 키친: 0, 기타: 0 },
      products: now.products.map((p) => [p[0], "베이커리", p[2], p[3]]),
    };
    const b = new Board([{ date: "2026-10-18", cafe: old }]);
    const m = b.day("2026-10-18");
    expect([m.box.베이커리, m.box.기타]).toEqual([10500, 1500 + 2400 + 1500]);
    expect(m.total).toBe(10500 + 1500 + 2400 + 1500);
    expect(b.products("2026-10-18", "2026-10-18", "베이커리").map((x) => x.name)).toEqual(["소금빵"]);
    expect(b.products("2026-10-18", "2026-10-18", "기타").map((x) => x.name).sort()).toEqual(["딸기잼", "발사믹소스", "소스 따로", "포션크림치즈"].sort());
    const sauce = old.products.find((x) => x[0] === "발사믹소스")!;
    expect([productInBox(old, sauce, "베이커리"), productInBox(old, sauce, "기타")]).toEqual([false, true]);
  });

  it("키즈: 음료 · 스티커 → 자판기, 퇴장 지연 → 기타 안 퇴장지연페널티, 열쇠 · 인원추가 → 키즈입장료 (키즈 매출을 잡는 4월부터)", () => {
    const lines = [
      sold("딸기쥬스", 2, 2500),
      sold("자판기상품_스티커", 1, 4000),
      sold("퇴장시간 + 10~19분 지연", 1, 5000),
      sold("02.51-03.00", 1, 30000),
      sold("[분실] 열쇠뭉치 교체비", 1, 10000),
      sold("인원추가 [평일만]", 1, 3000),
      sold("키링", 1, 2000),
    ];
    const kp = day("kids", "2026-05-13", lines);
    const b = new Board([{ date: "2026-05-13", kids: kp }]);
    const m = b.day("2026-05-13");
    expect(m.extra.vending).toBe(9000);
    expect(m.kidsFees).toBe(10000 + 3000);
    expect(m.box.키즈입장료).toBe(13000);
    expect(m.kidsLate).toBe(5000 + 30000);
    expect(m.box.기타).toBe(2000 + 9000 + 35000); // 자판기 · 퇴장지연페널티는 기타 상자 안
    expect(m.kidsOtherNet).toBe(2000);
    expect(m.total).toBe(59000); // 총매출은 그대로
    // 상품 목록도 같은 상자로
    const late = kp.products.find((x) => x[0] === "퇴장시간 + 10~19분 지연")!;
    expect([productInBox(kp, late, "기타"), productInBox(kp, late, "키즈입장료")]).toEqual([true, false]);
    expect(b.products("2026-05-13", "2026-05-13", "키즈입장료").map((x) => x.name).sort()).toEqual(["[분실] 열쇠뭉치 교체비", "인원추가 [평일만]"].sort());
    // 여러 날 합계
    const b2 = new Board([{ date: "2026-05-13", kids: kp }, { date: "2026-05-14", kids: { ...kp, date: "2026-05-14" } }]);
    expect(b2.range("2026-05-13", "2026-05-14").kidsLate).toBe(70000);
    const before = new Board([{ date: "2026-03-13", kids: day("kids", "2026-03-13", lines) }]).day("2026-03-13");
    expect([before.extra.vending, before.box.키즈입장료, before.box.기타, before.kidsLate]).toEqual([0, 0, 0, 0]);
  });
});

describe("기타 화면 박스를 누르면 — 자판기 · 네컷 · 주차는 건별(최근 것 먼저), 퇴장지연페널티 · 매장 소액 기타는 상품별 (2026-10-14 · 25)", () => {
  const date = "2026-10-13";
  const cafeP = day("cafe", date, [sold("[ICE] 아메리카노", 1, 4500), sold("포장백(종이)", 2, 100), sold("이벤트 초", 1, 3500), sold("흑미로만든수수부꾸미", 1, 2704), line({ name: "테이크아웃", qty: 3 })], (n) => (/아메리카노/.test(n) ? "바리스타" : "기타"));
  const kidsP = day("kids", date, [sold("딸기쥬스", 2, 2500), sold("키링", 1, 2000), sold("퇴장시간 + 10~19분 지연", 1, 5000)]);
  it("건별은 최근 시각이 맨 위, 0원인 칸은 빈 목록, 자판기 칸의 키즈 POS 음료 · 매장 소액 기타 상품 — 합이 화면 금액과 같음", () => {
    const extra: ExtraPart = { v: 1, date, vending: 4000, photo: 8000, parking: 0, items: { vending: [["10:05:00", 2500], ["15:30:00", 1500]], photo: [["12:00:00", 4000], ["18:10:00", 4000]] } };
    const b = new Board([{ date, cafe: cafeP, kids: kidsP, extra }]);
    const e = etcDetail(b, date);
    expect(e.card.vending).toEqual([["15:30:00", 1500], ["10:05:00", 2500]]);
    expect(e.card.photo).toEqual([["18:10:00", 4000], ["12:00:00", 4000]]);
    expect(e.card.parking).toEqual([]);
    expect(e.kidsVend).toEqual([{ name: "딸기쥬스", store: "kids", qty: 2, net: 5000 }]);
    expect(e.late).toEqual([{ name: "퇴장시간 + 10~19분 지연", store: "kids", qty: 1, net: 5000 }]);
    expect(e.small.map((x) => [x.name, x.store, x.qty, x.net])).toEqual([["이벤트 초", "cafe", 1, 3500], ["키링", "kids", 1, 2000], ["포장백(종이)", "cafe", 2, 200], ["테이크아웃", "cafe", 3, 0]]);
    const m = b.day(date);
    expect(m.kidsLate).toBe(5000);
    expect(e.late.reduce((a, x) => a + x.net, 0)).toBe(m.kidsLate);
    // 기타 화면 다섯 칸을 더하면 기타 상자와 같음
    expect(e.small.reduce((a, x) => a + x.net, 0)).toBe(m.box.기타 - extraTotal(m.extra) - m.kidsLate);
    expect(extraTotal(m.extra) + m.kidsLate + e.small.reduce((a, x) => a + x.net, 0)).toBe(m.box.기타);
    expect(e.kidsVend.reduce((a, x) => a + x.net, 0) + 4000).toBe(m.extra.vending);
  });
  it("건별 시각이 없는 날(합계만 있음)은 null — 키즈 매출을 안 잡는 3월까지는 키즈 상품도 없음", () => {
    const d = "2026-03-13";
    const b = new Board([{ date: d, cafe: { ...cafeP, date: d }, kids: { ...kidsP, date: d }, extra: { v: 1, date: d, vending: 3000, photo: 0, parking: 0 } }]);
    const e = etcDetail(b, d);
    expect([e.card.vending, e.card.photo, e.card.parking]).toEqual([null, [], []]);
    expect(e.kidsVend).toEqual([]);
    expect(e.late).toEqual([]);
    expect(e.small.every((x) => x.store === "cafe")).toBe(true);
    const m = b.day(d);
    expect(m.kidsLate).toBe(0);
    expect(e.small.reduce((a, x) => a + x.net, 0)).toBe(m.box.기타 - extraTotal(m.extra) - m.kidsLate);
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
