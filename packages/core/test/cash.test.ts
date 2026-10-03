import { describe, expect, it } from "vitest";
import { cashBook, cashOnDay, cashSummary, cleanCashPart, emptyCashRow, money, startCashPart, type CashPart, type CashRow } from "../src/cash";

const row = (x: Partial<CashRow>): CashRow => ({ ...emptyCashRow(), ...x });

/** 지금 엑셀 캡처의 숫자 그대로 */
function sheet(): CashPart {
  return {
    date: "2026-10-02",
    rates: { usd: 1362.5, jpy: 863.46 },
    open: { cashAlpha: 3798210, cashCafe: 500000, nh: 115115572, shinhan: 23141205, ibk: 9188, keb: 316, hana: 328, securities: 200000000, shinhanUsd2: 9.75, citiUsd: 33.92, kebUsd: 19.32 },
    rows: {
      cashAlpha: [row({ inWho: "카페아스타나", inMemo: "현금매출", inAmt: 43500 })],
      nh: [row({ inWho: "카드가맹점", inAmt: 3995966 })],
      shinhan: [row({ inWho: "네이버페이정산", inMemo: "아스타나 키즈 예약", inAmt: 162652, outWho: "관리비", outAmt: 610000 })],
    },
    loans: [
      { label: "신한 대출 1", amount: 840000000 },
      { label: "신한 대출 2", amount: 200000000 },
    ],
  };
}

describe("자금요약", () => {
  it("엑셀과 같은 숫자 (계좌 · 원화 합계 · 외화 환산 · 대출 제외)", () => {
    const s = cashSummary(sheet());
    const by = Object.fromEntries(s.lines.map((l) => [l.account.id, l]));
    expect(by.nh.close).toBe(119111538);
    expect(by.shinhan.close).toBe(22693857);
    expect(by.cashAlpha.close).toBe(3841710);
    expect(s.group.cash.close).toBe(4341710);
    // 보통예금 금일 잔고 합 · 입출금 합은 엑셀과 같음 (엑셀의 전일 잔고 합계 83,661,501 은 줄 합과 다름 → 여기선 줄 합)
    expect(s.group.deposit).toEqual({ open: 138266609, in: 4158618, out: 610000, close: 141815227 });
    expect(s.krw).toEqual({ open: 342564819, in: 4202118, out: 610000, close: 346156937 });
    expect(s.group.usd.close).toBe(62.99);
    expect(s.usdKrw).toBe(85824);
    expect(s.jpyKrw).toBe(0);
    // 잔액 합계는 증권계좌(2억)를 빼고 따로 — 대출 제외 자금은 증권계좌 포함 (엑셀과 같음)
    expect(s.securities).toBe(200000000);
    expect(s.total).toBe(146242761);
    expect(s.net).toBe(-693757239);
  });

  it("빈칸은 0, 빈 줄은 뺌, 모든 계좌를 채움", () => {
    const p = cleanCashPart({ ...sheet(), rows: { nh: [row({ inAmt: "12" as any }), emptyCashRow()], citiUsd: [row({ outAmt: 1.006 })] }, open: { nh: "" as any } });
    expect(p.open.woori).toBe(0);
    expect(p.open.nh).toBe(0);
    expect(p.rows.nh).toHaveLength(1);
    expect(p.rows.nh[0].inAmt).toBe(12);
    expect(p.rows.woori).toEqual([]);
    expect(p.rows.citiUsd[0].outAmt).toBe(1.01);
  });

  it("전일 잔고 = 앞 자금 보고의 금일 잔고 (앞날을 고치면 뒷날도 맞춰짐 · 빠진 날 건너뜀)", () => {
    const d1 = sheet();
    const d3: CashPart = { date: "2026-10-04", rates: { usd: 1367.1, jpy: 865.69 }, open: { nh: 1 }, rows: { nh: [row({ outAmt: 111538 })] }, loans: d1.loans };
    const book = cashBook([d3, d1]);
    const s3 = book.get("2026-10-04")!;
    expect(s3.openFrom).toBe("2026-10-02");
    expect(s3.lines.find((l) => l.account.id === "nh")!.open).toBe(119111538);
    expect(s3.lines.find((l) => l.account.id === "nh")!.close).toBe(119000000);
    expect(s3.rateChange.usd).toBe(4.6);
    expect(s3.rateChange.jpy).toBe(2.23);
    expect(book.get("2026-10-02")!.rateChange.usd).toBeNull();
  });

  it("새 날짜는 앞 자금 보고의 금일 잔고 · 환율 · 대출을 이어받음", () => {
    const { part, openFrom } = startCashPart("2026-10-03", [sheet()]);
    expect(openFrom).toBe("2026-10-02");
    expect(part.open.nh).toBe(119111538);
    expect(part.rates.usd).toBe(1362.5);
    expect(part.loans).toHaveLength(2);
    expect(part.rows.nh).toHaveLength(1);
    const first = startCashPart("2026-10-03", []);
    expect(first.openFrom).toBeNull();
    expect(first.part.open).toEqual({});
  });

  it("금액 보이기 — 0 은 '-'", () => {
    expect(money(0, "KRW")).toBe("-");
    expect(money(-693757239, "KRW")).toBe("-693,757,239");
    expect(money(9.75, "USD")).toBe("$9.75");
    expect(money(0, "JPY", false)).toBe("¥0.00");
  });
});

describe("정산 총계 · 지급 수수료 (1/1 ~ 마감일)", () => {
  it("매출 정산 입금만 더함 — 카드가맹점 · 네이버페이 · 배달 · 금고 현금매출 (계좌이체 · 임대료 · 이자 등은 뺌)", async () => {
    const { settlements, isSettlement } = await import("../src/cash");
    expect(isSettlement("nh", row({ inWho: "카드가맹점", inMemo: "7/14 입금액", inAmt: 1 }))).toBe("card");
    expect(isSettlement("shinhan", row({ inWho: "네이버페이정산", inMemo: "카페아스타나 제품예약", inAmt: 1 }))).toBe("naver");
    expect(isSettlement("shinhan", row({ inWho: "Npay정산", inMemo: "아스타나 키즈 예약", inAmt: 1 }))).toBe("naver");
    expect(isSettlement("shinhan", row({ inWho: "배달의 민족", inMemo: "배달 매출 정산", inAmt: 1 }))).toBe("delivery");
    expect(isSettlement("cashAlpha", row({ inWho: "카페아스타나", inMemo: "7/7 현금매출", inAmt: 1 }))).toBe("cash");
    expect(isSettlement("cashCafe", row({ inWho: "아스타나키즈", inMemo: "키즈 시재금 추가", inAmt: 1 }))).toBeNull();
    expect(isSettlement("shinhan", row({ inWho: "알파비젼㈜", inMemo: "계좌이체(농협→신한)", inAmt: 1 }))).toBeNull();
    expect(isSettlement("shinhan", row({ inWho: "하은옥", inMemo: "임대료", inAmt: 1 }))).toBeNull();
    expect(isSettlement("nh", row({ inWho: "(잔고 맞춤)", inMemo: "", inAmt: 1 }))).toBeNull();
    const a = { ...sheet(), date: "2025-12-31" };
    const b: CashPart = { ...sheet(), date: "2026-01-02", rows: { nh: [row({ inWho: "카드가맹점", inAmt: 1000000 })], shinhan: [row({ inWho: "네이버페이정산", inAmt: 300000 }), row({ inWho: "알파비젼㈜", inMemo: "계좌이체", inAmt: 5000000 })], cashAlpha: [row({ inWho: "카페아스타나", inMemo: "1/2 현금매출", inAmt: 50000 })] } };
    const s = settlements([a, b], "2026-01-01", "2026-01-31");
    expect(s.total).toBe(1350000);
    expect(s.by).toEqual({ card: 1000000, naver: 300000, delivery: 0, cash: 50000 });
    expect(s.days).toBe(1);
  });
});

describe("휴일 자금 — 입출금 없이 가장 최근 잔액", () => {
  it("보고 없는 휴일(토 · 일 · 공휴일)은 앞 보고의 금일 잔고, 입출금 0", () => {
    const parts = [sheet()]; // 10/2 금
    const book = cashBook(parts);
    const fri = book.get("2026-10-02")!;
    for (const d of ["2026-10-03", "2026-10-04"]) {
      const x = cashOnDay(book, parts, d)!;
      expect(x.carriedFrom).toBe("2026-10-02");
      expect(x.sum.total).toBe(fri.total);
      expect(x.sum.net).toBe(fri.net);
      expect(x.sum.krw.in).toBe(0);
      expect(x.sum.krw.out).toBe(0);
      expect(x.sum.krw.open).toBe(fri.krw.close);
      expect(x.part.date).toBe(d);
    }
  });
  it("평일에 보고가 없으면 없음 · 보고가 있는 날은 그대로", () => {
    const parts = [sheet()];
    const book = cashBook(parts);
    expect(cashOnDay(book, parts, "2026-10-06")).toBeNull(); // 화요일
    expect(cashOnDay(book, parts, "2026-10-05")!.carriedFrom).toBe("2026-10-02"); // 개천절 대체 휴일
    expect(cashOnDay(book, parts, "2026-10-02")!.carriedFrom).toBeNull();
    // 사이에 평일이 비어 있으면 휴일이라도 이어받지 않음
    expect(cashOnDay(book, parts, "2026-10-10")).toBeNull();
  });
});

