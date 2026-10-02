import { describe, expect, it } from "vitest";
import {
  dailyReport,
  forecastMonth,
  kidsKind,
  latestBatches,
  monthlyRows,
  posStatus,
  reportDate,
  salesOf,
  SalesIndex,
  sameDayYearsAgo,
  teamOf,
  type DayBatch,
  type SaleLine,
} from "../src";

const line = (name: string, net: number, qty = 1, extra: Partial<SaleLine> = {}): SaleLine => ({
  code: extra.code ?? name,
  name,
  cat1: extra.cat1 ?? "",
  cat2: "",
  cat3: "",
  qty,
  gross: extra.gross ?? net,
  discount: extra.discount ?? 0,
  net,
});
const batch = (pos: "cafe" | "kids", date: string, rows: SaleLine[], sentAt = `${date}T13:00:00Z`): DayBatch => ({ pos, date, rows, sentAt });
const index = (batches: DayBatch[]) =>
  new SalesIndex(
    salesOf(batches),
    latestBatches(batches).map((b) => ({ pos: b.pos, date: b.date })),
  );

describe("묶음 정리", () => {
  it("같은 POS·날짜는 늦게 보낸 것만 (두 번 더하지 않음)", () => {
    const b = [
      batch("cafe", "2026-10-01", [line("아메리카노", 5000)], "2026-10-01T12:00:00Z"),
      batch("cafe", "2026-10-01", [line("아메리카노", 10000, 2)], "2026-10-01T13:00:00Z"),
      batch("kids", "2026-10-01", [line("자유입장권", 15000)]),
    ];
    const idx = index(b);
    expect(idx.net("2026-10-01", "2026-10-01")).toBe(25000);
    expect(latestBatches(b)).toHaveLength(2);
  });

  it("상품명 공백 정리 — VAN 변경으로 코드가 달라도 이름이 같으면 한 상품", () => {
    const b = [
      batch("cafe", "2026-06-30", [line("야간자유입장권　　[7시 입장]", 10000, 1, { code: "000164" })]),
      batch("cafe", "2026-07-01", [line(" 야간자유입장권 [7시 입장] ", 10000, 1, { code: "000779" })]),
    ];
    const rows = index(b).products("2026-06-01", "2026-07-31");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "야간자유입장권 [7시 입장]", qty: 2, net: 20000, codes: ["000164", "000779"] });
  });

  it("기준일은 받은 자료 중 가장 늦은 날, POS 별 마지막 송부", () => {
    const b = [batch("cafe", "2026-10-01", []), batch("kids", "2026-09-30", [])];
    expect(reportDate(b)).toBe("2026-10-01");
    expect(posStatus(b).map((s) => [s.pos, s.lastDate])).toEqual([
      ["cafe", "2026-10-01"],
      ["kids", "2026-09-30"],
    ]);
  });
});

describe("팀 · 키즈 구분", () => {
  it("대분류가 있으면 그대로, 없으면 상품명으로, 키즈 POS 는 모두 키즈", () => {
    expect(teamOf("cafe", { cat1: "바리스타", name: "무엇이든" })).toBe("바리스타");
    expect(teamOf("cafe", { cat1: "", name: "소금빵" })).toBe("베이커리");
    expect(teamOf("cafe", { cat1: "", name: "트러플 크림파스타" })).toBe("키친");
    expect(teamOf("cafe", { cat1: "쿠폰", name: "종이쿠폰" })).toBe("기타");
    expect(teamOf("kids", { cat1: "", name: "아메리카노" })).toBe("키즈");
  });

  it("0원 입장권은 네이버, 돈 받은 입장권은 현장, '추가'는 추가 인원", () => {
    expect(kidsKind({ name: "네이버 입장권", gross: 0, net: 0 })).toBe("네이버입장");
    expect(kidsKind({ name: "자유입장권", gross: 15000, net: 15000 })).toBe("현장입장");
    expect(kidsKind({ name: "추가인원", gross: 5000, net: 5000 })).toBe("추가인원");
    expect(kidsKind({ name: "키즈 주스", gross: 3000, net: 3000 })).toBe("기타");
  });

  it("키즈 입장 집계 — 네이버 발행 장수, 반품은 음수로 빠짐", () => {
    const idx = index([
      batch("kids", "2026-10-01", [
        line("자유입장권", 45000, 3),
        line("자유입장권 반품", -15000, -1, { code: "x" }),
        line("네이버 입장권", 0, 5, { gross: 0 }),
        line("추가인원", 10000, 2),
        line("키즈 주스", 6000, 2),
      ]),
    ]);
    expect(idx.kids("2026-10-01", "2026-10-01")).toEqual({ walkIn: 2, naver: 5, extra: 2, tickets: 7, admissionNet: 40000, otherNet: 6000 });
  });
});

describe("일일 보고", () => {
  // 2026-09: 날마다 카페 10만 + 키즈 5만, 2025-10: 날마다 카페 8만
  const b: DayBatch[] = [];
  for (let d = 1; d <= 30; d++) {
    const date = `2026-09-${String(d).padStart(2, "0")}`;
    b.push(batch("cafe", date, [line("아메리카노", 100000, 20, { cat1: "바리스타" })]));
    b.push(batch("kids", date, [line("자유입장권", 50000, 4)]));
  }
  for (let d = 1; d <= 31; d++) b.push(batch("cafe", `2025-10-${String(d).padStart(2, "0")}`, [line("아메리카노", 80000, 16)]));
  b.push(batch("cafe", "2026-10-01", [line("아메리카노", 120000, 24, { cat1: "바리스타" }), line("소금빵", 30000, 8)]));
  b.push(batch("kids", "2026-10-01", [line("자유입장권", 60000, 4), line("네이버 입장권", 0, 6, { gross: 0 })]));
  const idx = index(b);
  const r = dailyReport(idx, "2026-10-01");

  it("전일 · 팀별 · POS 별", () => {
    expect(r.weekday).toBe("목");
    expect(r.day.net).toBe(210000);
    expect(r.day.byPos).toEqual({ cafe: 150000, kids: 60000 });
    expect(r.day.byTeam).toMatchObject({ 바리스타: 120000, 베이커리: 30000, 키즈: 60000, 키친: 0 });
    expect(r.missing).toEqual([]);
  });

  it("지난주 같은 요일 · 지난달 같은 기간 · 작년 같은 날", () => {
    expect(r.prevWeek).toMatchObject({ date: "2026-09-24" });
    expect(r.prevWeek.agg.net).toBe(150000);
    expect(r.prevMonth).toEqual({ from: "2026-09-01", to: "2026-09-01", net: 150000 });
    expect(r.lastYear).toMatchObject({ sameDay: "2025-10-01", sameDayNet: 80000, monthNet: 80000, monthFullNet: 80000 * 31, has: true });
  });

  it("예상 월매출 — 최근 4주 같은 요일 평균으로 남은 날 채움", () => {
    // 최근 4주는 하루 15만(9월) + 오늘(목) 21만. 목요일만 (15만×3 + 21만)/4 = 16.5만
    const f = forecastMonth(idx, "2026-10-01");
    const thursdays = ["2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29"].length;
    expect(f.net).toBe(210000 + 150000 * (30 - thursdays) + 165000 * thursdays);
  });

  it("자료 없는 POS 는 missing", () => {
    const only = index([batch("cafe", "2026-10-02", [line("아메리카노", 5000)])]);
    expect(dailyReport(only, "2026-10-02").missing).toEqual(["kids"]);
  });

  it("월별 — 작년 같은 달 비교, 이번 달은 기준일까지", () => {
    const rows = monthlyRows(idx, "2026-10-01", 2);
    expect(rows.map((m) => m.month)).toEqual(["2026-09", "2026-10"]);
    expect(rows[0]).toMatchObject({ net: 4500000, days: 30, lastYear: null });
    expect(rows[1]).toMatchObject({ net: 210000, days: 1, lastYear: 80000 });
  });

  it("상품 순위 — 실매출 큰 순", () => {
    expect(r.top.day.map((p) => p.name)).toEqual(["아메리카노", "자유입장권", "소금빵", "네이버 입장권"]);
  });
});

describe("날짜", () => {
  it("윤년 2월 29일의 작년 같은 날은 28일", () => {
    expect(sameDayYearsAgo("2028-02-29")).toBe("2027-02-28");
  });
});
