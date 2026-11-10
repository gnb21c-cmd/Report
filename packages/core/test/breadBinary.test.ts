import { describe, expect, it } from "vitest";
import {
  addDays,
  BINARY_FROM,
  Board,
  dayKind,
  dayRange,
  DEFAULT_LEARNED,
  demandOf,
  demandOn,
  halfway,
  hitDay,
  hitReport,
  hitWeekDays,
  makeWeek,
  snapUnit,
  trendDay,
  type DayReport,
  type PlanDoc,
  type StorePart,
} from "../src";

/* 2026-11-10 사장님 — 반반(바이너리) 규칙: 11-12 목 발표 주간안(11-16 ~ 22)부터
   발표 = 반올림((지난 같은 요일 판매 + 추세) ÷ 2) · 지난 판매 = 정가 + 할인 × 0.5
   지난 같은 요일 = 목요일 발표 때 이미 끝난 가장 최근 같은 요일 (다음 주 월 ~ 수 → 이번 주 월 ~ 수, 목 ~ 일 → 지난주 목 ~ 일)
   하루 목표 · 빵별 더하기 · 정한 수량 · 할인 많은 빵 줄이기 · 두 계획 견주기는 그만 (사장님 '가')
   적중률 = 2주 전 목요일에 발표한 목 ~ 일 + 1주 전 목요일에 발표한 월 ~ 수를 실제 판매 수요와 견줌 */

describe("반반 규칙 — 계산", () => {
  it("사장님 예: 남음 7 · 추세 12 → 10 / 매진 10 · 추세 12 → 11 / 매진 10 · 추세 8 → 9", () => {
    expect(halfway(7, 12)).toBe(10);
    expect(halfway(10, 12)).toBe(11);
    expect(halfway(10, 8)).toBe(9);
    // 지난 판매에 할인 반이 들어가 소수 → 가운데를 반올림
    expect(halfway(7.5, 12)).toBe(10);
    expect(halfway(3, 4)).toBe(4); // 3.5 → 4
  });

  it("지난 판매 = 정가 + 할인 × 0.5", () => {
    expect(demandOf(7, 2)).toBe(8);
    expect(demandOf(5, 0)).toBe(5);
    expect(demandOf(0, 3)).toBe(1.5);
  });

  it("11-12 목 발표 주간안(11-16 계획)부터", () => {
    expect(BINARY_FROM).toBe("2026-11-16");
  });
});

/* ---------- 주간안 — 가짜 자료 (breadTrend.test.ts 와 같은 모양) ---------- */
const H = () => Array.from({ length: 12 }, () => 0);
function day(date: string, bread: [string, number][], half: Record<string, number> = {}): DayReport {
  const cafe: StorePart = {
    v: 1, store: "cafe", date, basis: "receipt", file: "t.xls", sheetNet: 0, posNet: 0, voucher: 0,
    sectors: { 바리스타: 0, 베이커리: 0, 키친: 0, 기타: 0 }, cups: 100, teams: 0, teamSizes: [0, 0, 0, 0, 0, 0],
    hourly: { sectors: { 바리스타: H(), 베이커리: H(), 키친: H(), 기타: H() }, cups: H(), teams: H() },
    products: bread.map(([n, q]) => [n, "베이커리", q, q * 4000]), refunds: { receipts: 0, lines: 0, unmatched: 0, amount: 0 }, kids: null,
    bakeryHalfBy: half,
  };
  return { date, cafe };
}
const hol = (d: string) => dayKind(d) === "휴일";
const lyCurve = (d: string, asHoliday: boolean) => {
  const t = (Date.parse(d) - Date.parse("2025-09-01")) / 864e5;
  return asHoliday ? 1000 - 2 * t : 400 - 0.5 * t;
};
const lyTotal = (d: string) => lyCurve(d, hol(d));
const lyFor = (D: string) => lyCurve(addDays(D, -364), hol(D));
const SHARE: [string, number][] = [["소금빵", 0.5], ["크루아상", 0.3], ["몽블랑", 0.1], ["에그타르트", 0.1]];
/** 올해 = 작년 추세의 80%, 정수 개수 · 명란소금빵은 10-20 부터 (새 빵) */
const thisYear = (d: string, k = 0.8): [string, number][] => {
  const t = lyFor(d) * k;
  const out = SHARE.map(([n, s]) => [n, Math.round(t * s)] as [string, number]);
  if (d >= "2026-10-20") out.push(["명란소금빵", 9]);
  return out;
};
const THU = "2026-11-12";
const ASOF = "2026-11-11";
/** 지난 월요일(11-09) 소금빵은 정가만 적게 팔림 · 지난 목요일(11-05) 소금빵은 할인 6개 */
const LOW_MON = 40;
const reports: DayReport[] = [
  ...dayRange("2025-08-01", "2025-12-31").map((d) => day(d, SHARE.map(([n, s]) => [n, lyTotal(d) * s]))),
  ...dayRange("2026-08-01", ASOF).map((d) => {
    const b = thisYear(d);
    if (d === "2026-11-09") return day(d, b.map(([n, q]) => [n, n === "소금빵" ? LOW_MON : q]));
    if (d === "2026-11-05") return day(d, b, { 소금빵: 6 });
    return day(d, b);
  }),
];
const board = new Board(reports);

describe("반반 규칙 — 11-12 목 발표 주간안 (11-16 ~ 22)", () => {
  const week = makeWeek(board, {}, DEFAULT_LEARNED, THU, ASOF);

  it("지난 같은 요일 = 발표 때 이미 끝난 가장 최근 같은 요일 (월 ~ 수 → 이번 주, 목 ~ 일 → 지난주)", () => {
    expect(week.map((w) => w.week.binary?.lastDay)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
  });

  it("빵마다 발표 = 반올림((지난 같은 요일 판매 + 추세) ÷ 2) → 만드는 단위", () => {
    for (const w of week) {
      const t = trendDay(board, ASOF, THU, w.date);
      const last = demandOn(board, w.week.binary!.lastDay!, w.date);
      for (const raw of t.items) {
        const it = w.week.items.find((i) => i.name === raw.name)!;
        const T = Math.round(raw.raw);
        const L = last.get(raw.name)!.demand;
        expect(it.trend).toBe(T);
        expect(it.last).toBe(L);
        expect(it.qty).toBe(snapUnit(raw.name, halfway(L, T), undefined, undefined, w.date));
      }
    }
  });

  it("지난 월요일 소금빵이 적게 팔렸으면 다음 월요일은 추세와의 가운데 (보수적으로 늘림)", () => {
    const mon = week[0].week.items.find((i) => i.name === "소금빵")!;
    expect(mon.last).toBe(LOW_MON);
    expect(mon.trend!).toBeGreaterThan(LOW_MON);
    expect(mon.qty).toBe(Math.round((LOW_MON + mon.trend!) / 2));
  });

  it("지난 목요일 할인 6개는 반(3개)만 판매로 셈", () => {
    const thu = week[3].week.items.find((i) => i.name === "소금빵")!;
    const sold = Math.round(0.8 * lyFor("2026-11-05") * 0.5);
    expect(thu.last).toBe(sold - 6 + 3);
  });

  it("하루 목표 · 빵별 더하기 · 정한 수량(에그타르트 10 · 35) · 두 계획 견주기는 없음", () => {
    for (const w of week) {
      expect(w.week.target).toBeUndefined();
      expect(w.week.mode).toBeUndefined();
      const egg = w.week.items.find((i) => i.name === "에그타르트")!;
      expect(egg.qty).toBe(halfway(egg.last!, egg.trend!));
      expect(w.week.items.some((i) => i.slow || i.tuned != null)).toBe(false);
    }
  });

  it("새 빵(판매 28일이 안 됨)은 지금처럼 판 날 실적 · 작년 추세로 어림", () => {
    for (const w of week) {
      const n = w.week.items.find((i) => i.name === "명란소금빵")!;
      expect(n.est).toBe(true);
      expect(n.qty).toBeGreaterThan(0);
    }
  });

  it("지난 같은 요일에 안 판 빵은 추세 그대로", () => {
    const b = new Board(reports.map((r) => (r.date === "2026-11-10" ? day(r.date, thisYear(r.date).filter(([n]) => n !== "크루아상")) : r)));
    const tue = makeWeek(b, {}, DEFAULT_LEARNED, THU, ASOF)[1].week;
    const cro = tue.items.find((i) => i.name === "크루아상")!;
    expect(cro.last).toBeUndefined();
    expect(cro.qty).toBe(cro.trend);
  });

  it("11-15 까지의 주(11-05 발표)는 예전 그대로 — 하루 목표가 있음", () => {
    const old = makeWeek(board, {}, DEFAULT_LEARNED, "2026-11-05", "2026-11-04");
    expect(old.every((w) => w.week.target != null && !w.week.binary)).toBe(true);
  });
});

describe("적중률 — 발표 수량 대 실제 판매 수요", () => {
  const plan = (date: string, madeOn: string, items: { name: string; qty: number; manual?: boolean; kitchen?: boolean }[]): PlanDoc => ({
    v: 2,
    date,
    week: { madeOn, asOf: addDays(madeOn, -1), kind: "평일", visitors: 0, weather: "모름", items, total: items.reduce((a, b) => a + b.qty, 0) },
  });

  it("하루 — 빵마다 |발표 − 수요| 를 더해 1 − 어긋남 ÷ 수요 (매니저 기입 0 · 키친용은 뺌)", () => {
    const b = new Board([day("2026-11-09", [["소금빵", 8], ["크루아상", 5]], { 소금빵: 2 })]);
    const p = plan("2026-11-09", "2026-11-05", [
      { name: "소금빵", qty: 10 },
      { name: "크루아상", qty: 5 },
      { name: "명란소금빵", qty: 0, manual: true },
      { name: "키친용 모닝빵", qty: 2, kitchen: true },
    ]);
    const h = hitDay(b, "2026-11-09", p)!;
    // 소금빵 수요 = 정가 6 + 할인 2 × 0.5 = 7 → 어긋남 3 · 크루아상 5 → 0
    expect(h).toMatchObject({ date: "2026-11-09", madeOn: "2026-11-05", plan: 15, demand: 12, miss: 3 });
    expect(h.rate).toBeCloseTo(0.75, 6);
    expect(h.breads).toEqual([
      { name: "소금빵", plan: 10, demand: 7, miss: 3 },
      { name: "크루아상", plan: 5, demand: 5, miss: 0 },
    ]);
  });

  it("판매 자료나 발표가 없는 날은 null", () => {
    const b = new Board([day("2026-11-09", [["소금빵", 8]])]);
    expect(hitDay(b, "2026-11-10", plan("2026-11-10", "2026-11-05", [{ name: "소금빵", qty: 10 }]))).toBeNull();
    expect(hitDay(b, "2026-11-09", null)).toBeNull();
  });

  it("목요일 발표 때 견주는 7일 = 지난주 목 ~ 일(2주 전 발표) + 이번 주 월 ~ 수(1주 전 발표)", () => {
    expect(hitWeekDays("2026-11-19")).toEqual(["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18"]);
  });

  it("한 주 묶음 — 날마다 · 합계 · 많이 어긋난 빵부터", () => {
    const days = hitWeekDays("2026-11-12");
    const b = new Board(days.map((d) => day(d, [["소금빵", 10], ["크루아상", 4]])));
    const docs = new Map(days.map((d) => [d, plan(d, weekday(d) >= 1 && weekday(d) <= 3 ? "2026-11-05" : "2026-10-29", [{ name: "소금빵", qty: 12 }, { name: "크루아상", qty: 4 }])]));
    const r = hitReport(b, "2026-11-12", (d) => docs.get(d) ?? null)!;
    expect(r.days.map((d) => d.date)).toEqual(days);
    expect(r.days.map((d) => d.madeOn)).toEqual(["2026-10-29", "2026-10-29", "2026-10-29", "2026-10-29", "2026-11-05", "2026-11-05", "2026-11-05"]);
    expect(r).toMatchObject({ plan: 112, demand: 98, miss: 14 });
    expect(r.rate).toBeCloseTo(1 - 14 / 98, 6);
    expect(r.breads[0]).toEqual({ name: "소금빵", plan: 84, demand: 70, miss: 14 });
  });
});

function weekday(d: string): number {
  return new Date(`${d}T00:00:00Z`).getUTCDay();
}
