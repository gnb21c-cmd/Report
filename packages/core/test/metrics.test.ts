import { describe, expect, it } from "vitest";
import {
  analyze,
  comparable,
  cumulative,
  Board,
  dailySeries,
  dashboard,
  isCup,
  kidsPrice,
  latestBatches,
  monthCumulative,
  monthlySeries,
  movingAverage,
  salesOf,
  SalesIndex,
  visitorsFromCups,
  yearCumulative,
  type Adjusts,
  type DayBatch,
  type SaleLine,
} from "../src";

const line = (name: string, qty: number, net: number, cat1 = "", gross = net, code = name): SaleLine => ({ code, name, cat1, cat2: "", cat3: "", qty, gross, discount: gross - net, net });
const batch = (pos: "cafe" | "kids", date: string, rows: SaleLine[]): DayBatch => ({ pos, date, rows, sentAt: `${date}T13:00:00Z` });
const boardOf = (batches: DayBatch[], adj: Adjusts = {}) =>
  new Board(
    new SalesIndex(
      salesOf(batches),
      latestBatches(batches).map((b) => ({ pos: b.pos, date: b.date })),
    ),
    adj,
  );

const CAFE = [
  line("[ICE] 아메리카노", 20, 100000, "바리스타"),
  line("샷 추가", 5, 2500, "바리스타"),
  line("생맥주 500", 5, 30000),
  line("소금빵", 10, 38000, "베이커리"),
  line("트러플 크림파스타", 3, 54000, "키친"),
];
const KIDS = [
  line("자유입장권", 3, 36000),
  line("자유입장권", -1, -12000, "", -12000, "환불"),
  line("네이버 입장권", 10, 0, "", 0),
  line("추가인원", 2, 10000),
  line("키즈 주스", 4, 12000),
];

describe("키즈 입장료 단가", () => {
  it("평일 12,000 · 토·일·공휴일·대체공휴일 14,000", () => {
    expect(kidsPrice("2026-10-01")).toEqual({ price: 12000, kind: "평일" }); // 목
    expect(kidsPrice("2026-10-03").price).toBe(14000); // 토 · 개천절
    expect(kidsPrice("2026-10-04").price).toBe(14000); // 일
    expect(kidsPrice("2026-10-05").price).toBe(14000); // 월 · 개천절 대체 휴일
    expect(kidsPrice("2026-10-06").price).toBe(12000); // 화
    expect(kidsPrice("2025-10-08").price).toBe(14000); // 수 · 추석 대체 휴일
  });
});

describe("방문자 추정", () => {
  it("음료·맥주는 잔으로, 옵션(샷 추가)은 빼고", () => {
    expect(isCup("cafe", { name: "[ICE] 아메리카노", cat1: "바리스타" }, "바리스타")).toBe(true);
    expect(isCup("cafe", { name: "샷 추가", cat1: "바리스타" }, "바리스타")).toBe(false);
    expect(isCup("cafe", { name: "생맥주 500", cat1: "" }, "기타")).toBe(true);
    expect(isCup("cafe", { name: "소금빵", cat1: "베이커리" }, "베이커리")).toBe(false);
    expect(isCup("kids", { name: "키즈 주스", cat1: "" }, "키즈")).toBe(true);
  });
  it("잔 수 × 0.96 반올림", () => {
    expect(visitorsFromCups(29)).toBe(28);
    expect(visitorsFromCups(100)).toBe(96);
    expect(visitorsFromCups(-3)).toBe(0);
  });
});

describe("하루 숫자", () => {
  const b = boardOf([batch("cafe", "2026-10-01", CAFE), batch("kids", "2026-10-01", KIDS)]);
  const m = b.day("2026-10-01");

  it("팀별 상자 · 기타에는 맥주와 키즈 POS 의 입장권 외 매출", () => {
    expect(m.box).toEqual({ 바리스타: 102500, 베이커리: 38000, 키친: 54000, 키즈입장료: 144000, 기타: 52000 });
    expect(m.kidsOtherNet).toBe(22000);
  });

  it("키즈 입장료 = (네이버 10 + 현장 3-1) × 평일 12,000", () => {
    expect([m.naverPos, m.naver, m.walkIn, m.walkInPosNet]).toEqual([10, 10, 2, 24000]);
    expect(m.fee).toEqual({ naver: 120000, walkIn: 24000 });
  });

  it("총매출 = 다섯 상자 합, 방문자 = 29잔 × 0.96, 1인 평균 = 총매출 ÷ 방문자", () => {
    expect(m.total).toBe(390500);
    expect(m.posNet).toBe(270500);
    expect([m.cups, m.visitors, m.avgSpend]).toEqual([29, 28, Math.round(390500 / 28)]);
  });

  it("관리자가 고친 네이버 수로 다시 계산", () => {
    const fixed = boardOf([batch("cafe", "2026-10-01", CAFE), batch("kids", "2026-10-01", KIDS)], { "2026-10-01": { naver: 8, by: "점장" } }).day("2026-10-01");
    expect([fixed.naverPos, fixed.naver, fixed.naverAdjusted]).toEqual([10, 8, 1]);
    expect(fixed.box.키즈입장료).toBe(120000);
    expect(fixed.total).toBe(366500);
  });

  it("휴일은 14,000 으로", () => {
    const h = boardOf([batch("kids", "2026-10-05", [line("네이버 입장권", 5, 0, "", 0), line("자유입장권", 2, 28000)])]).day("2026-10-05");
    expect(h.box.키즈입장료).toBe(7 * 14000);
  });
});

describe("대시보드 누계", () => {
  // 2025-10 · 2026-01~10 날마다 카페 아메리카노 10잔 50,000
  const batches: DayBatch[] = [];
  const add = (from: string, to: string) => {
    for (let d = new Date(from + "T00:00:00Z"); d <= new Date(to + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1))
      batches.push(batch("cafe", d.toISOString().slice(0, 10), [line("아메리카노", 10, 50000, "바리스타")]));
  };
  add("2025-01-01", "2025-12-31");
  add("2026-01-01", "2026-10-01");
  const b = boardOf(batches);
  const d = dashboard(b, "2026-10-01");

  it("당월 · 올해 · 작년 같은 달 · 작년 같은 기간", () => {
    expect(d.weekday).toBe("목");
    expect(d.prevWeek.date).toBe("2026-09-24");
    expect(d.month.total).toBe(50000);
    expect(d.year.total).toBe(274 * 50000);
    expect(d.lyDate).toBe("2025-10-01");
    expect(d.lyMonth.total).toBe(50000);
    expect(d.lyYear.total).toBe(274 * 50000);
    expect(d.year.visitors).toBe(274 * 10); // 날마다 10 × 0.96 = 9.6 → 10
  });

  it("추세 · 이동 평균 · 달별", () => {
    const s = dailySeries(b, "total", "2026-10-01", 14);
    expect(s).toHaveLength(14);
    expect(s.every((p) => p.v === 50000)).toBe(true);
    expect(movingAverage(s, 7)[13].v).toBe(50000);
    const mo = monthlySeries(b, "total", "2026-10-01", 2);
    expect(mo.cur.map((p) => [p.x, p.v])).toEqual([
      ["2026-09", 30 * 50000],
      ["2026-10", 50000],
    ]);
    expect(mo.ly.map((p) => p.v)).toEqual([30 * 50000, 50000]);
  });

  it("누계 선 — 이번 달은 기준일까지, 작년은 달 전체", () => {
    const mc = monthCumulative(b, "2026-10-01");
    expect(mc.days).toHaveLength(31);
    expect(mc.cur.slice(0, 2)).toEqual([50000, null]);
    expect(mc.ly[30]).toBe(31 * 50000);
    const yc = yearCumulative(b, "2026-10-01");
    expect(yc.cur[8]).toBe(273 * 50000);
    expect(yc.cur[9]).toBe(274 * 50000);
    expect(yc.cur[10]).toBeNull();
    expect(yc.ly[11]).toBe(365 * 50000);
  });

  it("분석 설명 — 숫자로만", () => {
    const lines = analyze(b, "total", "2026-10-01");
    expect(lines[0]).toContain("지난주");
    expect(lines.some((l) => l.includes("이달 누계"))).toBe(true);
    expect(analyze(b, "visitors", "2026-10-01").some((l) => l.includes("× 0.96"))).toBe(true);
    expect(analyze(b, "total", "2026-11-01")[0]).toContain("자료가 없습니다");
  });
});

describe("누계 상세", () => {
  const batches: DayBatch[] = [];
  const days = (from: string, to: string) => {
    const out: string[] = [];
    for (let d = new Date(from + "T00:00:00Z"); d <= new Date(to + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
    return out;
  };
  for (const d of [...days("2025-10-01", "2025-10-31"), "2026-09-01", "2026-10-01"]) batches.push(batch("cafe", d, [line("아메리카노", 10, 50000, "바리스타")]));
  const b = boardOf(batches);
  it("당월 — 작년 같은 기간 · 작년 그 달 전체 · 지난달 같은 기간", () => {
    const v = cumulative(b, "month", "2026-10-01");
    expect([v.cur.total, v.ly.total, v.lyFull.total, v.prev?.total]).toEqual([50000, 50000, 31 * 50000, 50000]);
    expect(v.lines.some((l) => l.includes("3.2%를 채웠습니다"))).toBe(true);
  });
  it("올해 — 1월 1일부터. 작년 자료가 일부(31일치)뿐이면 비교하지 않음", () => {
    const v = cumulative(b, "year", "2026-10-01");
    expect([v.cur.total, v.ly.total, v.lyFull.total, v.prev]).toEqual([100000, 50000, 31 * 50000, null]);
    expect(comparable(v.ly)).toBe(false);
    expect(v.lines.some((l) => l.includes("1일치뿐이라 비교하지 않았습니다"))).toBe(true);
    expect(v.lines.some((l) => l.includes("채웠습니다"))).toBe(false);
  });
});
