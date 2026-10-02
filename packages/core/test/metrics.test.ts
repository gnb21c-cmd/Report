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
// 입장 발행 12장 (네이버 10 + 현장 2), 현장 결제 3장 중 1장 환불
const KIDS = [
  line("[평일] 1시간 50분 입장권", 3, 36000),
  line("[평일] 1시간 50분 입장권", -1, -12000, "", -12000, "환불"),
  line("[평일] 무제한 이용", 12, 0, "", 0),
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
    // 2026-10-02 카페 실제 자료에서 찾은 것: 0원 옵션 · 아이스크림은 잔이 아님, 맥주는 잔
    expect(isCup("cafe", { name: "연하게", cat1: "바리스타", gross: 0, net: 0 }, "바리스타")).toBe(false);
    expect(isCup("cafe", { name: "상하목장아이스크림", cat1: "바리스타", gross: 37500, net: 37500 }, "바리스타")).toBe(false);
    expect(isCup("cafe", { name: "디카페인 변경", cat1: "바리스타", gross: 1000, net: 1000 }, "바리스타")).toBe(false);
    expect(isCup("cafe", { name: "생맥주[켈리]", cat1: "바리스타", gross: 27500, net: 27500 }, "바리스타")).toBe(true);
    expect(isCup("cafe", { name: "(D_ICE)아메리카노", cat1: "바리스타", gross: 77000, net: 77000 }, "바리스타")).toBe(true);
    // 9/27: 무료 음료 쿠폰은 잔, less ice 같은 0원 옵션은 아님
    expect(isCup("cafe", { name: "[종이] ICE 아메", cat1: "서비스.쿠폰", gross: 0, net: 0 }, "기타")).toBe(true);
    expect(isCup("cafe", { name: "less ice", cat1: "바리스타", gross: 0, net: 0 }, "바리스타")).toBe(false);
  });
  it("세트 메뉴는 이름의 잔 수만큼 (2026-10-01 카페: 맥주2+감자튀김 · 와인2+리코타샐러드M)", async () => {
    const { cupsPerItem } = await import("../src");
    expect([cupsPerItem("맥주2+감자튀김"), cupsPerItem("와인2+리코타샐러드M"), cupsPerItem("[ICE] 아메리카노"), cupsPerItem("생맥주[켈리]")]).toEqual([2, 2, 1, 1]);
    expect(isCup("cafe", { name: "맥주2+감자튀김", cat1: "키친", gross: 28500, net: 28500 }, "키친")).toBe(true);
    expect(isCup("cafe", { name: "밥으로 변경", cat1: "키친", gross: 0, net: 0 }, "키친")).toBe(false);
    expect(isCup("cafe", { name: "+ 헤이즐넛시럽", cat1: "바리스타", gross: 500, net: 500 }, "바리스타")).toBe(false);
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
    expect([m.issued, m.naverPos, m.naver, m.walkIn, m.walkInPosNet]).toEqual([12, 10, 10, 2, 24000]);
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
    const h = boardOf([batch("kids", "2026-10-05", [line("3시 20분 퇴장 [1시30분 입장]", 7, 0, "", 0), line("[휴일] 1시간 50분 입장권", 2, 28000)])]).day("2026-10-05");
    expect(h.box.키즈입장료).toBe(7 * 14000);
  });
});

describe("키즈 실제 자료", () => {
  it("2026-10-01: 발행 20(무제한 17 + 야간 3) − 현장 4 = 네이버 16, 이벤트 무료 2팀", () => {
    const m = boardOf([
      batch("kids", "2026-10-01", [
        line("[평일] 1시간 50분 입장권", 4, 48000, "기타 유료"),
        line("인원추가 [평일만]", 1, 3000, "기타 유료"),
        line("야간자유입장권", 3, 0, "기타 유료", 0),
        line("[평일] 한가위 무제한 쿠폰", 2, 0, "서비스.쿠폰", 0),
        line("[평일] 무제한 이용", 17, 0, "기타 유료", 0),
      ]),
    ]).day("2026-10-01");
    expect([m.issued, m.walkIn, m.naver, m.eventFree]).toEqual([20, 4, 16, 2]);
    expect(m.box.키즈입장료).toBe(20 * 12000);
    expect(m.box.기타).toBe(3000);
  });
  it("2026-09-27(일): 시간대별 발행 133 − 현장 5 = 네이버 128, 휴일 14,000", () => {
    const slots = [8, 12, 10, 4, 2, 10, 11, 15, 9, 9, 10, 8, 4, 8, 1, 7, 5];
    const rows = [line("[휴일] 1시간 50분 입장권", 5, 70000, "기타 유료"), line("야간자유입장권", slots[0], 0, "", 0)];
    slots.slice(1).forEach((q, i) => rows.push(line(`${i + 1}시 퇴장 [${i}시 입장]`, q, 0, "", 0)));
    const m = boardOf([batch("kids", "2026-09-27", rows)]).day("2026-09-27");
    expect([m.issued, m.walkIn, m.naver]).toEqual([133, 5, 128]);
    expect(m.box.키즈입장료).toBe(133 * 14000);
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

describe("날씨와 함께 본 분석", () => {
  it("그날 날씨·기간 한 줄, 비 온 날과 맑은 날 평균 비교", async () => {
    const { analyzeWeather } = await import("../src");
    const batches: DayBatch[] = [];
    const weather: Record<string, any> = {};
    for (let i = 1; i <= 30; i++) {
      const d = `2026-09-${String(i).padStart(2, "0")}`;
      const rainy = i % 5 === 0;
      batches.push(batch("cafe", d, [line("아메리카노", 10, rainy ? 30000 : 60000, "바리스타")]));
      weather[d] = { date: d, key: rainy ? "rain" : "sunny", label: rainy ? "비" : "맑음", icon: rainy ? "🌧️" : "☀️", tempMax: 25, tempMin: 15, rainMm: rainy ? 5 : 0, source: "observed" };
    }
    const lines = analyzeWeather(boardOf(batches), "total", "2026-09-30", weather);
    expect(lines[0]).toContain("🌧️ 비, 최고 25° · 최저 15° · 강수 5mm (기상청 관측)");
    expect(lines[1]).toContain("비·눈 온 날(6일) 하루 평균 30,000원");
    expect(lines[1]).toContain("-50.0% 낮습니다");
  });
});
