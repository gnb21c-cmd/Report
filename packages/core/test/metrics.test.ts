import { describe, expect, it } from "vitest";
import {
  Board,
  bottomProducts,
  comparable,
  cupsPerItem,
  dashboard,
  forecastNext,
  HOURS,
  hourDay,
  hourlyInsights,
  isCup,
  kidsPrice,
  monthDaily,
  monthView,
  naverSlots,
  sampleUntilYesterday,
  visitorsFromCups,
  weeksAverage,
  weeksTrend,
  yearMonthly,
  yearView,
  type DayReport,
  type NaverPart,
  type ProductTuple,
  type StorePart,
} from "../src";

const H = (xs: number[] = []) => HOURS.map((_, i) => xs[i] || 0);
function cafe(date: string, o: { 바리스타?: number; 베이커리?: number; 키친?: number; 기타?: number; cups?: number; voucher?: number; hourly?: Partial<Record<"바리스타" | "베이커리" | "키친" | "기타", number[]>> & { cups?: number[] }; products?: ProductTuple[]; daily?: boolean } = {}): StorePart {
  const sectors = { 바리스타: o.바리스타 || 0, 베이커리: o.베이커리 || 0, 키친: o.키친 || 0, 기타: o.기타 || 0 };
  const posNet = sectors.바리스타 + sectors.베이커리 + sectors.키친 + sectors.기타 - (o.voucher || 0);
  return {
    v: 1,
    store: "cafe",
    date,
    basis: o.daily ? "daily" : "receipt",
    file: "t.xls",
    sheetNet: posNet,
    posNet,
    voucher: o.voucher || 0,
    sectors,
    cups: o.cups || 0,
    teams: 0,
    teamSizes: [0, 0, 0, 0, 0, 0],
    hourly: o.daily ? null : { sectors: { 바리스타: H(o.hourly?.바리스타), 베이커리: H(o.hourly?.베이커리), 키친: H(o.hourly?.키친), 기타: H(o.hourly?.기타) }, cups: H(o.hourly?.cups), teams: H() },
    products: o.products || [],
    refunds: { receipts: 0, lines: 0, unmatched: 0, amount: 0 },
    kids: null,
  };
}
function kids(date: string, k: { issued?: number; walkIn?: number; eventFree?: number; other?: number; walkInH?: number[]; issuedH?: number[] }): StorePart {
  const price = kidsPrice(date).price;
  return {
    ...cafe(date),
    store: "kids",
    hourly: null,
    posNet: (k.walkIn || 0) * price + (k.other || 0),
    kids: {
      issued: k.issued || 0,
      walkIn: k.walkIn || 0,
      walkInNet: (k.walkIn || 0) * price,
      eventFree: k.eventFree || 0,
      other: k.other || 0,
      hourly: { issued: H(k.issuedH), walkIn: H(k.walkInH), eventFree: H(), other: H() },
    },
  };
}
const naver = (date: string, tickets: number[], newVisitors: number[] = []): NaverPart => ({ v: 1, date, tickets: Array.from({ length: 20 }, (_, i) => tickets[i] || 0), newVisitors: Array.from({ length: 20 }, (_, i) => newVisitors[i] || 0) });
const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = new Date(from + "T00:00:00Z"); d <= new Date(to + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};

describe("규칙", () => {
  it("키즈 단가: 평일 12,000 · 토·일·공휴일·대체공휴일 14,000", () => {
    expect(kidsPrice("2026-10-01")).toEqual({ price: 12000, kind: "평일", charged: true });
    expect([kidsPrice("2026-10-03").price, kidsPrice("2026-10-04").price, kidsPrice("2026-10-05").price, kidsPrice("2026-10-06").price, kidsPrice("2026-05-05").price]).toEqual([14000, 14000, 14000, 12000, 14000]);
    // 2026-03-31 까지는 교환권 방식 — 키즈 매출 없음
    expect(kidsPrice("2025-10-08")).toEqual({ price: 0, kind: "휴일", charged: false });
    expect(kidsPrice("2026-03-31").price).toBe(0);
    expect(kidsPrice("2026-04-01").price).toBe(12000);
  });
  it("잔: 음료·맥주는 잔, 옵션·0원·아이스크림은 아님, 세트는 이름의 잔 수", () => {
    expect(isCup("cafe", { name: "[ICE] 아메리카노", cat1: "" }, "바리스타")).toBe(true);
    expect(isCup("cafe", { name: "샷 추가", cat1: "" }, "바리스타")).toBe(false);
    expect(isCup("cafe", { name: "연하게", cat1: "", gross: 0, net: 0 }, "바리스타")).toBe(false);
    expect(isCup("cafe", { name: "상하목장아이스크림", cat1: "", gross: 7500, net: 7500 }, "바리스타")).toBe(false);
    expect(isCup("cafe", { name: "필스너[해태]", cat1: "", gross: 7500, net: 7500 }, "기타")).toBe(true);
    expect(isCup("cafe", { name: "[종이] ICE 아메", cat1: "", gross: 0, net: 0 }, "기타")).toBe(true);
    expect([cupsPerItem("맥주2+감자튀김"), cupsPerItem("와인2+리코타샐러드M"), cupsPerItem("[ICE] 아메리카노")]).toEqual([2, 2, 1]);
  });
  it("방문인원 = 잔 × 0.96 반올림", () => {
    expect([visitorsFromCups(29), visitorsFromCups(100), visitorsFromCups(-3)]).toEqual([28, 96, 0]);
  });
});

describe("하루 숫자", () => {
  const D = "2026-10-01";
  const r: DayReport = {
    date: D,
    cafe: cafe(D, { 바리스타: 100000, 베이커리: 38000, 키친: 54000, 기타: 3500, cups: 29, voucher: 90000 }),
    kids: kids(D, { issued: 20, walkIn: 4, eventFree: 2, other: 3000 }),
  };
  it("2026-10-01 키즈 실제: 네이버를 안 넣었으면 발행 20 − 현장 4 = 16 으로 추정", () => {
    const m = new Board([r]).day(D);
    expect([m.issued, m.walkIn, m.naver, m.naverPos, m.naverInput, m.eventFree]).toEqual([20, 4, 16, 16, 0, 2]);
    expect(m.box).toEqual({ 바리스타: 100000, 베이커리: 38000, 키친: 54000, 키즈입장료: 20 * 12000, 기타: 6500 });
    expect(m.total).toBe(100000 + 38000 + 54000 + 240000 + 6500);
    expect(m.voucher).toBe(90000);
    expect([m.cups, m.visitors, m.avgSpend]).toEqual([29, 28, Math.round(m.total / 28)]);
  });
  it("A 에 넣은 네이버 판매 입장권이 있으면 그 값 (신규 방문자도)", () => {
    const m = new Board([{ ...r, naver: naver(D, [2, 3, 4, 5], [1, 1]) }]).day(D);
    expect([m.naver, m.naverInput, m.newVisitors, m.has.naver]).toEqual([14, 1, 2, 1]);
    expect(m.box.키즈입장료).toBe((14 + 4) * 12000);
  });
  it("휴일 14,000", () => {
    const m = new Board([{ date: "2026-10-05", kids: kids("2026-10-05", { issued: 7, walkIn: 2 }) }]).day("2026-10-05");
    expect(m.box.키즈입장료).toBe(7 * 14000);
  });
});

describe("누계", () => {
  const reports: DayReport[] = [...days("2025-01-01", "2025-12-31"), ...days("2026-01-01", "2026-10-01")].map((d) => ({ date: d, cafe: cafe(d, { 바리스타: 50000, cups: 10 }) }));
  const b = new Board(reports);
  it("대시보드: 당월 · 올해 · 작년 같은 기간", () => {
    const d = dashboard(b, "2026-10-01");
    expect([d.weekday, d.prevWeek.date, d.month.total, d.year.total, d.lyDate, d.lyMonth.total, d.lyYear.total]).toEqual(["목", "2026-09-24", 50000, 274 * 50000, "2025-10-01", 50000, 274 * 50000]);
    expect(d.year.visitors).toBe(274 * 10);
  });
  it("당월 상세: 이번 달은 마감일까지 · 작년 같은 달은 한 달 전체 (지난달 없음)", () => {
    const v = monthView(b, "2026-10-01");
    expect(v.days).toHaveLength(31);
    expect(v.cur.slice(0, 2)).toEqual([50000, null]);
    expect(v.ly[30]).toBe(31 * 50000);
    expect([v.month.visitors, v.lyMonth.visitors, v.lyFull.total]).toEqual([10, 10, 31 * 50000]);
  });
  it("올해 상세: 작년 12달 회색 · 올해 마감월까지 · 연말 예상 = 올해 누계 × 작년 전체 ÷ 작년 같은 기간", () => {
    const v = yearView(b, "2026-10-01");
    expect(v.cur[9]).toBe(274 * 50000);
    expect(v.cur[10]).toBeNull();
    expect(v.ly[11]).toBe(365 * 50000);
    expect(v.estimate).toEqual({ value: Math.round((274 * 50000 * 365 * 50000) / (274 * 50000)), how: "작년 흐름 기준" });
    expect([v.month.visitors, v.lyMonthFull.visitors]).toEqual([10, 310]);
  });
  it("작년 자료가 일부뿐이면 비교 안 함 · 연말 예상은 올해 하루 평균으로", () => {
    const part = new Board(reports.filter((r) => r.date >= "2025-12-01"));
    expect(comparable(part.range("2025-01-01", "2025-10-01"))).toBe(false);
    expect(yearView(part, "2026-10-01").estimate?.how).toBe("올해 하루 평균 기준");
  });
});

describe("키즈 입장권 상세 (네이버 · 현장 · 이벤트)", () => {
  const reports: DayReport[] = [
    { date: "2025-10-01", kids: kids("2025-10-01", { issued: 10, walkIn: 2, eventFree: 1 }), naver: naver("2025-10-01", [1, 2]) },
    { date: "2025-10-20", kids: kids("2025-10-20", { issued: 10, walkIn: 3 }) },
    { date: "2026-10-01", kids: kids("2026-10-01", { issued: 20, walkIn: 4, eventFree: 2 }), naver: naver("2026-10-01", [3, 4, 0, 1], [1]) },
  ];
  const b = new Board(reports);
  it("시간대별 합 · 날마다 · 달마다 (작년 전체 · 올해 마감일까지)", () => {
    expect(naverSlots(b, "2026-10-01", "2026-10-01").tickets.slice(0, 4)).toEqual([3, 4, 0, 1]);
    expect(naverSlots(b, "2025-10-01", "2025-10-31")).toMatchObject({ days: 1 });
    const d = monthDaily(b, "walkIn", "2026-10-01");
    expect([d.cur[0], d.cur[1], d.ly[0], d.ly[19], d.ly[1]]).toEqual([4, null, 2, 3, null]);
    const y = yearMonthly(b, "naver", "2026-10-01");
    expect([y.cur[9], y.cur[10], y.ly[9]]).toEqual([8, null, 3 + 7]);
    expect(yearMonthly(b, "eventFree", "2026-10-01", true).ly[11]).toBe(1);
  });
});

describe("시간대 분석 (섹터 상세)", () => {
  // 목요일 다섯 번: 점심(12~14시)은 줄고 오후(15~17시)는 늘어남
  const thu = ["2026-09-03", "2026-09-10", "2026-09-17", "2026-09-24", "2026-10-01"];
  const reports: DayReport[] = thu.map((d, w) => ({
    date: d,
    cafe: cafe(d, {
      바리스타: 0,
      hourly: { 바리스타: [50000, 50000, 200000 - w * 25000, 200000 - w * 25000, 80000, 60000 + w * 25000, 60000 + w * 25000, 40000, 50000, 50000, 30000, 10000], cups: [10, 10, 30, 30, 12, 10, 10, 6, 8, 8, 4, 1] },
      cups: 139,
      products: [
        ["[ICE] 아메리카노", "바리스타", 50, 325000],
        ["[ICE]쿨민트", "바리스타", 1, 6500],
        ["연하게", "바리스타", 3, 0],
        ["아이스티", "바리스타", 2, 15000],
      ],
    }),
  }));
  // 매출 합은 시간대 합과 같게
  for (const r of reports) r.cafe!.sectors.바리스타 = r.cafe!.hourly!.sectors.바리스타.reduce((a, b) => a + b, 0);
  const b = new Board(reports);

  it("마감일 막대: 시간대 매출 · 막대 위 추정 인원 (잔 × 0.96)", () => {
    const h = hourDay(b, "2026-10-01", "바리스타")!;
    expect(h.sales[2]).toBe(100000);
    expect(h.people[2]).toBe(29);
    expect(hourDay(b, "2026-10-02", "바리스타")).toBeNull();
  });
  it("지난 4주 같은 요일 평균 · 시간마다 오름/내림", () => {
    const a = weeksAverage(b, "2026-10-01", "바리스타");
    expect(a.dates).toEqual(["2026-09-24", "2026-09-17", "2026-09-10", "2026-09-03"]);
    expect(a.sales[2]).toBe((200000 + 175000 + 150000 + 125000) / 4);
    const t = weeksTrend(b, "2026-10-01", "바리스타");
    expect(t.days.map((d) => d.weeksAgo)).toEqual([4, 3, 2, 1, 0]);
    expect([t.dir[2], t.dir[5], t.dir[0]]).toEqual([-1, 1, 0]);
  });
  it("분석 문장: 선호 이동 · 피크 · 매출 속도 · 다음 주 예측", () => {
    const lines = hourlyInsights(b, "2026-10-01", "바리스타", {});
    expect(lines[0]).toContain("점심(12~14시)에서 오후(15~17시)로 옮겨가고 있습니다");
    expect(lines.some((l) => l.startsWith("점심 피크(12~14시) 4주 평균") && l.includes("흐름 ▼ 주마다"))).toBe(true);
    expect(lines.some((l) => l.includes("날씨 자료가 없어"))).toBe(true);
    expect(lines.some((l) => l.startsWith("매출 속도:"))).toBe(true);
    expect(lines.some((l) => l.startsWith("다음 주 10/8(목) 예상"))).toBe(true);
    const f = forecastNext(b, "2026-10-01", "바리스타")!;
    expect(f.date).toBe("2026-10-08");
    expect(f.n).toBe(5);
    expect(hourlyInsights(b, "2026-10-02", "바리스타", {})[0]).toContain("시간대 자료가 없습니다");
  });
  it("하위 5개: 옵션·0원 빼고 적게 팔린 순, 그달은 최근 90일 안에 팔린 적 있는 상품의 0개 포함", () => {
    expect(bottomProducts(b, "2026-10-01", "바리스타", "day").map((p) => [p.name, p.qty])).toEqual([
      ["[ICE]쿨민트", 1],
      ["아이스티", 2],
      ["[ICE] 아메리카노", 50],
    ]);
    const nb = new Board([...reports, { date: "2026-08-20", cafe: cafe("2026-08-20", { 바리스타: 7000, products: [["여름사냥", "바리스타", 1, 8000]] }) }]);
    expect(bottomProducts(nb, "2026-10-01", "바리스타", "month")[0]).toMatchObject({ name: "여름사냥", qty: 0 });
  });
  it("키즈 입장료 시간대 = (네이버 예약 시간 30분 두 칸 + 현장 결제 시각) × 단가", () => {
    const kb = new Board([{ date: "2026-10-01", kids: kids("2026-10-01", { issued: 9, walkIn: 2, walkInH: [0, 1, 1] }), naver: naver("2026-10-01", [1, 2, 3, 1]) }]);
    const h = hourDay(kb, "2026-10-01", "키즈입장료")!;
    expect(h.people.slice(0, 3)).toEqual([3, 5, 1]);
    expect(h.total).toBe((7 + 2) * 12000);
  });
});

describe("체험판 자료", () => {
  it("작년 1월 1일부터 어제까지 · 하루 숫자가 계산됨", () => {
    const r = sampleUntilYesterday("2026-10-02");
    expect(r[0].date).toBe("2025-01-01");
    expect(r[r.length - 1].date).toBe("2026-10-01");
    const b = new Board(r);
    const m = b.day("2026-10-01");
    expect(m.total).toBeGreaterThan(0);
    expect(m.naverInput).toBe(1);
    expect(hourDay(b, "2026-10-01", "키친")!.total).toBeCloseTo(m.box.키친, -3);
  });
});
