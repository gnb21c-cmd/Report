import { describe, expect, it } from "vitest";
import {
  buildDailyPart,
  buildNaverPart,
  buildStorePart,
  guessSector,
  hourIndex,
  parseDailySheet,
  parseReceiptSheet,
  partCheck,
  removeRefunds,
  sectorLookup,
  SheetError,
  type ReceiptLine,
} from "../src";

// 2026-10-02 카페아스타나 '영수증별 매출 상세현황' 모양 (실제 파일의 머리글 · 줄 몇 개를 그대로 옮김)
const HEAD = ["포스번호", "영수증번호", "구분", "테이블명", "최초주문", "결제시각", "상품코드", "바코드", "상품명", "수량", "총매출액", "ERP 매핑코드", "비고", "할인액", "할인구분", "실매출액", "가액", "부가세"];
const row = (pos: string, rec: string, kind: string, time: string, name: string, qty: number, gross: number, discount = 0) => [pos, rec, kind, "", time, time, "000000", "", name, qty, gross, "", "", discount, discount ? "회원할인" : "", gross - discount, 0, 0];
const sheet = (rows: unknown[][], date = "2026-10-02") => {
  const net = rows.reduce((s, r) => s + Number(r[15]), 0);
  const qty = rows.reduce((s, r) => s + Number(r[9]), 0);
  return [["영수증별매출상세현황"], [], [`조회일자 : ${date}     `], [], [" "], HEAD, ...rows, ["합계", "", "", "", "", "", "", "", "", qty, 0, "", "", 0, "", net, 0, 0]];
};

const ROWS = [
  // 01-0001 한 팀: 음료 2잔 → 2명
  row("01", "0001", "매출", "10:02:27", "자몽에이드", 1, 7500),
  row("01", "0001", "매출", "10:02:27", "[ICE] 아메리카노", 1, 6500),
  row("01", "0001", "매출", "10:02:27", "수제돈까스", 1, 14000),
  row("01", "0001", "매출", "10:02:27", "갑오징어크림리조또", 1, 24000),
  row("01", "0001", "매출", "10:02:27", "흑미찹쌀치즈볼(9ea)", 1, 10000),
  // 02-0001 서브 포스의 같은 번호 = 다른 팀
  row("02", "0001", "매출", "10:38:02", "[HOT] 카페라떼", 3, 21000, 4200),
  // 01-0002 빵만 포장 (0잔 팀)
  row("01", "0002", "매출", "10:03:22", "시나몬롤", 1, 4500),
  row("01", "0002", "매출", "10:03:22", "소금빵", 2, 7600),
  // 01-0160 → 01-0161 에서 통째로 반품
  row("01", "0160", "매출", "16:33:36", "쫀득크림빵", 1, 6200),
  row("01", "0160", "매출", "16:33:36", "(D_ICE)아메리카노", 1, 7000),
  row("01", "0161", "반품", "16:34:30", "쫀득크림빵", -1, -6200),
  row("01", "0161", "반품", "16:34:30", "(D_ICE)아메리카노", -1, -7000),
  // 같은 상품을 판 다른 영수증은 그대로
  row("01", "0150", "매출", "16:13:13", "쫀득크림빵", 1, 6200),
  // 상품권 결제 (음수, 결제 수단)
  row("01", "0039", "매출", "12:06:35", "[종이쿠폰]만원권", 9, -90000),
  row("01", "0039", "매출", "12:06:35", "[ICE] 아메리카노", 2, 13000),
  // 22시 넘은 주문은 21시 칸
  row("01", "0245", "매출", "22:10:00", "생맥주[켈리]", 2, 11000),
];

describe("영수증별 엑셀 읽기", () => {
  it("머리글 · 조회일자 · 합계 줄", () => {
    const s = parseReceiptSheet(sheet(ROWS));
    expect([s.from, s.to]).toEqual(["2026-10-02", "2026-10-02"]);
    expect(s.lines).toHaveLength(ROWS.length);
    expect(s.lines[0]).toEqual({ pos: "01", receipt: "0001", refund: false, time: "10:02:27", name: "자몽에이드", qty: 1, gross: 7500, discount: 0, net: 7500 });
    expect(s.lines.filter((l) => l.refund)).toHaveLength(2);
    expect(s.sheetNet).toBe(ROWS.reduce((t, r) => t + Number(r[15]), 0));
  });
  it("다른 엑셀이면 알아듣게 알려 줌", () => {
    expect(() => parseReceiptSheet([["상품별 (일자별)"], ["조회일자 : 2026-10-01 ~ 2026-10-01"], ["대분류", "중분류", "소분류", "상품코드", "상품명", "일자"]])).toThrow(/상품별 \(일자별\)/);
    expect(() => parseReceiptSheet([["아무거나"]])).toThrow(SheetError);
  });
  it("시간 칸: 글자 · 엑셀 시간 숫자", () => {
    const s = parseReceiptSheet([HEAD, ["01", "0001", "매출", "", 0.5, "", "", "", "소금빵", 1, 3800, "", "", 0, "", 3800]]);
    expect(s.lines[0].time).toBe("12:00:00");
    expect([hourIndex("09:59:00"), hourIndex("10:00:00"), hourIndex("21:59:59"), hourIndex("23:30:00"), hourIndex("")]).toEqual([0, 0, 11, 11, null]);
  });
});

const L = (pos: string, receipt: string, name: string, qty: number, net: number, time = "12:00:00", refund = qty < 0): ReceiptLine => ({ pos, receipt, refund, time, name, qty, gross: net, discount: 0, net });

describe("반품 지우기", () => {
  it("반품 영수증의 상품이 모두 든 앞선 영수증을 통째로 지움 (같은 상품을 판 다른 영수증은 그대로)", () => {
    const r = removeRefunds(parseReceiptSheet(sheet(ROWS)).lines);
    expect(r.matches).toEqual([{ pos: "01", receipt: "0161", time: "16:34:30", from: { pos: "01", receipt: "0160" }, lines: 2, amount: 13200, how: "영수증" }]);
    expect(r.lines.some((l) => l.receipt === "0160" || l.refund)).toBe(false);
    expect(r.lines.filter((l) => l.name === "쫀득크림빵")).toHaveLength(1);
  });
  it("10/2 실제 모양: 100% 서비스 할인(0원) 영수증을 반품 → 0원끼리도 짝", () => {
    const r = removeRefunds([L("01", "0190", "필스너[해태]", 8, 0, "18:32:09"), L("01", "0151", "필스너[해태]", 1, 7500, "16:13:52"), L("01", "0193", "필스너[해태]", -8, 0, "18:34:46")]);
    expect(r.matches[0].from).toEqual({ pos: "01", receipt: "0190" });
    expect(r.lines.map((l) => l.receipt)).toEqual(["0151"]);
  });
  it("가장 가까운 앞선 영수증 (같은 포스 먼저)", () => {
    const r = removeRefunds([
      L("01", "0010", "[ICE] 아메리카노", 2, 13000, "11:00:00"),
      L("02", "0011", "[ICE] 아메리카노", 2, 13000, "12:30:00"),
      L("01", "0012", "[ICE] 아메리카노", 2, 13000, "12:00:00"),
      L("01", "0013", "[ICE] 아메리카노", 2, 13000, "14:00:00"),
      L("01", "0020", "[ICE] 아메리카노", -2, -13000, "13:00:00"),
    ]);
    expect(r.matches[0].from).toEqual({ pos: "01", receipt: "0012" });
    expect(r.lines.map((l) => l.receipt).sort()).toEqual(["0010", "0011", "0013"]);
  });
  it("일부 반품은 수량을 뺌, 짝이 없으면 음수로 남기고 알림", () => {
    const r = removeRefunds([L("01", "0001", "소금빵", 3, 11400, "10:00:00"), L("01", "0005", "소금빵", -1, -3800, "11:00:00"), L("01", "0006", "몽블랑", -1, -6500, "11:10:00")]);
    expect(r.lines.find((l) => l.name === "소금빵")).toMatchObject({ qty: 2, net: 7600 });
    expect(r.matches.map((m) => m.how)).toEqual(["상품", "못찾음"]);
    expect(r.unmatched.map((l) => l.name)).toEqual(["몽블랑"]);
    expect(r.lines.find((l) => l.name === "몽블랑")).toMatchObject({ qty: -1, net: -6500 });
  });
});

describe("상품 분류 짐작 (분류표에 없는 새 상품)", () => {
  it("2026-09-27 · 10-02 실제 상품명 → OK포스 대분류와 같게", () => {
    const want: [string, string][] = [
      ["[ICE] 아메리카노", "바리스타"], ["(D_HOT)카페라떼", "바리스타"], ["블루베리요거트", "바리스타"], ["상하목장아이스크림", "바리스타"], ["생맥주[켈리]", "바리스타"], ["페일에일[스타피쉬]", "바리스타"], ["아이스티", "바리스타"], ["+ 샷 추가", "바리스타"],
      ["소금빵", "베이커리"], ["메가모카번", "베이커리"], ["감자파니니", "베이커리"], ["스파이시 파누쪼", "베이커리"], ["감계무량샌드위치", "베이커리"], ["먹물트리플치즈", "베이커리"], ["티라미두유볼(소)", "베이커리"], ["시나몬롤", "베이커리"], ["아스타나버터떡", "베이커리"],
      ["치즈불고기파누쪼", "키친"], ["흑미찹쌀치즈볼(9ea)", "키친"], ["부라타토마토파스타", "키친"], ["왕새우튀김(5ea)", "키친"], ["리코타치즈샐러드", "키친"], ["[이벤트]바베큐폭립", "키친"],
      ["테이크아웃", "기타"], ["아크릴키링", "기타"], ["[종이쿠폰]만원권", "기타"],
    ];
    expect(want.map(([n]) => [n, guessSector(n)])).toEqual(want);
  });
  it("분류표에 있으면 그것을 씀", () => {
    expect(sectorLookup({ 여름사냥: "바리스타" })("여름사냥")).toBe("바리스타");
    expect(sectorLookup({})("여름사냥")).toBe("기타");
  });
});

describe("매장 하루치 계산", () => {
  const s = parseReceiptSheet(sheet(ROWS));
  const { part, matches } = buildStorePart({ store: "cafe", date: "2026-10-02", file: "영수증별 매출 상세현황 (27).xls", sheet: s, sectorOf: sectorLookup({}) });

  it("반품을 지워도 엑셀 합계와 같음 · 상품권은 결제 수단으로 따로", () => {
    expect(matches).toHaveLength(1);
    expect(partCheck(part)).toEqual({ ok: true, text: "엑셀 합계와 일치" });
    expect(part.voucher).toBe(90000);
    expect(part.sectors).toEqual({ 바리스타: 7500 + 6500 + 16800 + 13000 + 11000, 베이커리: 4500 + 7600 + 6200, 키친: 14000 + 24000 + 10000, 기타: 0 });
  });
  it("팀 = 포스번호 + 영수증번호, 팀 인원 = 잔 수", () => {
    // 01-0001(2잔) · 02-0001(3잔) · 01-0002(0잔) · 01-0150(0잔) · 01-0039(2잔) · 01-0245(맥주 2잔)
    expect(part.teams).toBe(6);
    expect(part.cups).toBe(9);
    expect(part.teamSizes).toEqual([2, 0, 3, 1, 0, 0]);
  });
  it("시간대: 최초주문 시각, 22시 넘은 주문은 마지막 칸", () => {
    const h = part.hourly!;
    expect(h.sectors.키친[0]).toBe(48000);
    expect(h.sectors.바리스타[11]).toBe(11000);
    expect(h.cups).toEqual([5, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 2]);
    expect(h.teams.reduce((a, b) => a + b, 0)).toBe(6);
  });
  it("상품별 합계 (반품한 것은 빠짐)", () => {
    expect(part.products.find((p) => p[0] === "쫀득크림빵")).toEqual(["쫀득크림빵", "베이커리", 1, 6200]);
    expect(part.products.find((p) => p[0] === "(D_ICE)아메리카노")).toBeUndefined();
  });

  it("키즈: 입장 발행 · 현장 · 이벤트 무료 · 추가 인원을 시간대별로", () => {
    const k = parseReceiptSheet(
      sheet([
        row("01", "0001", "매출", "10:30:00", "[평일] 무제한 이용", 3, 0),
        row("01", "0002", "매출", "11:05:00", "[평일] 1시간 50분 입장권", 1, 12000),
        row("01", "0002", "매출", "11:05:00", "[평일] 무제한 이용", 1, 0),
        row("01", "0003", "매출", "13:00:00", "[평일] 한가위 무제한 쿠폰", 2, 0),
        row("01", "0004", "매출", "13:20:00", "인원추가 [평일만]", 1, 3000),
      ]),
    );
    const kp = buildStorePart({ store: "kids", date: "2026-10-01", file: "키즈.xls", sheet: k, sectorOf: sectorLookup({}) }).part;
    expect(kp.kids).toMatchObject({ issued: 4, walkIn: 1, walkInNet: 12000, eventFree: 2, other: 3000 });
    expect(kp.kids!.hourly!.issued.slice(0, 2)).toEqual([3, 1]);
    expect(kp.kids!.hourly!.eventFree[3]).toBe(2);
    expect(kp.sectors).toEqual({ 바리스타: 0, 베이커리: 0, 키친: 0, 기타: 0 });
  });
});

describe("베이커리 생산품이 아닌 상품", () => {
  it("딸기잼은 분류표에 베이커리로 있어도 기타 판매품", () => {
    const s = parseReceiptSheet(sheet([row("01", "0001", "", "12:00:00", "딸기잼", 2, 3000), row("01", "0002", "", "12:01:00", "소금빵", 1, 3500)]));
    const { part } = buildStorePart({ store: "cafe", date: "2026-10-02", file: "t.xls", sheet: s, sectorOf: sectorLookup({ 딸기잼: "베이커리" }) });
    expect(part.sectors.베이커리).toBe(3500);
    expect(part.sectors.기타).toBe(3000);
    expect(part.products.find((p) => p[0] === "딸기잼")?.[1]).toBe("기타");
  });

  it("블루베리잼도 딸기잼처럼 기타 판매품 (베이커리 생산 명령 대상 아님)", () => {
    const s = parseReceiptSheet(sheet([row("01", "0001", "", "12:00:00", "블루베리잼", 1, 3000), row("01", "0002", "", "12:01:00", "소금빵", 1, 3500)]));
    const { part } = buildStorePart({ store: "cafe", date: "2026-10-08", file: "t.xls", sheet: s, sectorOf: sectorLookup({ 블루베리잼: "베이커리" }) });
    expect(part.products.find((p) => p[0] === "블루베리잼")?.[1]).toBe("기타");
    expect(part.sectors.베이커리).toBe(3500);
  });
});

describe("베이커리 50% 할인 (저녁 8시 30분 뒤)", () => {
  it("20:30 뒤 반값 줄만 셈 — 앞 시간 할인 · 음료 · 반품은 뺌", () => {
    const s = parseReceiptSheet(
      sheet([
        row("01", "0001", "", "20:35:10", "소금빵", 3, 10500, 5250), // 반값 3개
        row("01", "0002", "", "20:50:00", "크루아상", 1, 4200, 2100), // 반값 1개
        row("01", "0003", "", "19:10:00", "소금빵", 2, 7000, 3500), // 8시 30분 전 → 아님
        row("01", "0004", "", "20:40:00", "소금빵", 1, 3500, 350), // 10% 회원할인 → 아님
        row("01", "0005", "", "20:45:00", "아메리카노", 2, 9000, 4500), // 음료 → 아님
        row("01", "0006", "", "20:28:40", "크루아상", 2, 8400, 4200), // 8시 30분 1~2분 전에 집어 온 반값 → 셈
        row("01", "0007", "", "20:10:00", "크루아상", 1, 4200, 2100), // 20분 전 → 아님
      ]),
    );
    const { part } = buildStorePart({ store: "cafe", date: "2026-10-02", file: "t.xls", sheet: s, sectorOf: sectorLookup({}) });
    expect(part.bakeryHalf).toBe(6);
    expect(part.bakeryHalfBy).toEqual({ 소금빵: 3, 크루아상: 3 });
  });
});

describe("네이버 입력 · 지난 자료", () => {
  it("네이버 표: 20칸(10:00~19:30), 빈칸·음수·소수는 고침", () => {
    const n = buildNaverPart("2026-10-01", ["3", "", -1, 2.6], [1, null]);
    expect(n.tickets).toHaveLength(20);
    expect(n.tickets.slice(0, 5)).toEqual([3, 0, 0, 3, 0]);
    expect(n.newVisitors.slice(0, 2)).toEqual([1, 0]);
  });
  it("상품별(일자별) 엑셀: 기간 · 날짜별 · 대분류로 분류표 채우기", () => {
    const rows = [
      ["상품별 (일자별)"],
      ["조회일자 : 2025-10-01 ~ 2025-10-02", "", "조회줄수 : 50000"],
      ["대분류", "중분류", "소분류", "상품코드", "상품명", "일자", "수량", "총매출액", "총할인액", "실매출액"],
      ["바리스타", "", "", "000096", "[ICE] 아메리카노", "2025-10-01", 10, 65000, 0, 65000],
      ["베이커리", "", "", "000272", "소금빵", "2025-10-01", 5, 19000, 0, 19000],
      ["바리스타", "", "", "000484", "여름사냥", "2025-10-02", 2, 16000, 0, 16000],
      ["기타 유료", "", "", "000193", "[종이쿠폰]만원권", "2025-10-02", 1, -10000, 0, -10000],
      ["합계", "", "", "", "", "", 18, 90000, 0, 90000],
    ];
    const d = parseDailySheet(rows);
    expect([d.from, d.to, d.totalOk, d.truncated]).toEqual(["2025-10-01", "2025-10-02", true, false]);
    expect(d.categories.get("여름사냥")).toBe("바리스타");
    const p = buildDailyPart({ store: "cafe", date: "2025-10-02", file: "상품별.xls", rows: d.days.get("2025-10-02")!, sectorOf: sectorLookup({}) });
    expect([p.basis, p.hourly, p.sectors.바리스타, p.voucher, p.cups]).toEqual(["daily", null, 16000, 10000, 2]);
  });
});

describe("네이버 지난 자료 · 매장 짐작", async () => {
  const { parseNaverPast, naverPastPart, guessStore } = await import("../src");
  it("날짜 × 30분 칸 표 (빈칸 0, 같은 날 두 줄이면 더함)", () => {
    const rows = [["날짜", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30", "19:00", "19:30"], ["2025-10-01", 2, "", 3], ["2025.10.02", 1], ["2025-10-01", 1]];
    const r = parseNaverPast(rows);
    expect(r.map((x) => x.date)).toEqual(["2025-10-01", "2025-10-02"]);
    expect(r[0].tickets.slice(0, 3)).toEqual([3, 0, 3]);
    expect(naverPastPart(r[0])).toMatchObject({ noNew: true });
    expect(() => parseNaverPast([["아무거나"]])).toThrow(/10:00/);
  });
  it("매장 짐작", () => {
    const l = (name: string, net: number) => ({ name, gross: net, net, refund: false });
    expect(guessStore([l("[ICE] 아메리카노", 6500), l("소금빵", 3800)])).toBe("cafe");
    expect(guessStore([l("[평일] 무제한 이용", 0), l("[평일] 1시간 50분 입장권", 12000)])).toBe("kids");
    expect(guessStore([l("[ICE] 아메리카노", 6500), l("[평일] 무제한 이용", 0)])).toBeNull();
  });
});
