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
  NEW_BREAD_MANUAL_DAYS,
  parseMidTa,
  snapUnit,
  TEMP_UP,
  tempUpOf,
  trendDay,
  withTemp,
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

  it("새 빵(판매 28일이 안 됨)은 판 날 실적 · 작년 추세로 어림 — 판매가 2주 넘게 쌓인 빵 (명란소금빵 10-20 부터 · 발표 때 23일째)", () => {
    expect(NEW_BREAD_MANUAL_DAYS).toBe(14);
    for (const w of week) {
      const n = w.week.items.find((i) => i.name === "명란소금빵")!;
      expect(n.est).toBe(true);
      expect(n.qty).toBeGreaterThan(0);
    }
  });

  /* 2026-11-14 사장님 — 새 빵은 처음 판 날부터 2주 동안 매니저 기입, 판매가 2주 쌓인 뒤 발표부터 그 기록으로 어림 (클래식롤케이크 11-14 첫 판매) */
  it("처음 판 지 2주가 안 된 새 빵은 팔린 기록이 있어도 매니저 기입(0) — 2주가 쌓인 뒤 발표부터 어림", () => {
    // 롤케이크: 11-02 첫 판매 → 11-12 발표(실적 11-11 까지) 때 10일째 = 매니저 기입
    const roll = (from: string) => new Board(reports.map((r) => (r.date >= from && r.date <= ASOF ? day(r.date, [...thisYear(r.date), ["클래식롤케이크", 4]]) : r)));
    const early = makeWeek(roll("2026-11-02"), {}, DEFAULT_LEARNED, THU, ASOF);
    for (const w of early) expect(w.week.items.find((i) => i.name === "클래식롤케이크")).toMatchObject({ qty: 0, manual: true });
    // 10-29 첫 판매 → 14일째 = 어림 (판 날 같은 요일 평균 × 작년 추세 비율)
    const later = makeWeek(roll("2026-10-29"), {}, DEFAULT_LEARNED, THU, ASOF);
    for (const w of later) {
      const n = w.week.items.find((i) => i.name === "클래식롤케이크")!;
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

/* 2026-11-10 사장님 — 기온 미세 조정: 다음 주 그날 예보 최고 기온이 28도 이상(더운 날) 또는 15도 이하(추운 날)면 반반 결과 × 110%
   빵 생산량은 두 가지로만 — ① 추세 반반 ② 기온 미세 조정. 예보 = 기상청 중기 기온예보(수원, 4 ~ 10일 뒤) */
describe("기온 미세 조정 — 최고 28도 이상 · 15도 이하면 반반 결과 × 110%", () => {
  it("기준 — 최고 기온만 봄 (28 이상 더운 날 · 15 이하 추운 날)", () => {
    expect(TEMP_UP).toBe(1.1);
    expect(tempUpOf(28)).toEqual({ up: 1.1, why: "더움" });
    expect(tempUpOf(33)).toEqual({ up: 1.1, why: "더움" });
    expect(tempUpOf(27.9)).toBeNull();
    expect(tempUpOf(15)).toEqual({ up: 1.1, why: "추움" });
    expect(tempUpOf(-3)).toEqual({ up: 1.1, why: "추움" });
    expect(tempUpOf(15.1)).toBeNull();
    expect(tempUpOf(null)).toBeNull();
  });

  it("중기 기온예보 한 줄 → 날짜마다 최저 · 최고 (발표 날 + N일)", () => {
    const t = parseMidTa({ regId: "11B20601", taMin5: 10, taMax5: 16, taMin6: "8", taMax6: "15", taMin10: -1, taMax10: 7, taMin7: null, taMax7: "" }, "202611101800");
    expect(t).toEqual({
      "2026-11-15": { max: 16, min: 10, tmFc: "202611101800" },
      "2026-11-16": { max: 15, min: 8, tmFc: "202611101800" },
      "2026-11-20": { max: 7, min: -1, tmFc: "202611101800" },
    });
    expect(parseMidTa(null, "202611101800")).toEqual({});
  });

  const week = makeWeek(board, {}, DEFAULT_LEARNED, THU, ASOF, {}, undefined, undefined, {
    "2026-11-18": { max: 9, min: 0, tmFc: "202611111800" },
    "2026-11-20": { max: 16, min: 7, tmFc: "202611111800" },
    "2026-11-21": { max: 30, min: 22, tmFc: "202611111800" },
  });
  const day = (d: string) => week.find((w) => w.date === d)!.week;

  it("추운 날(최고 9도) — 반반 빵마다 반반 결과 × 110% → 반올림 → 만드는 단위", () => {
    const st = day("2026-11-18");
    expect(st.temp).toEqual({ max: 9, min: 0, tmFc: "202611111800", up: 1.1, why: "추움" });
    for (const it of st.items.filter((i) => i.bin != null)) expect(it.qty).toBe(snapUnit(it.name, Math.round(it.bin! * 1.1), undefined, undefined, "2026-11-18"));
    const salt = st.items.find((i) => i.name === "소금빵")!;
    expect(salt.bin).toBe(halfway(salt.last!, salt.trend!));
    expect(salt.qty).toBe(Math.round(salt.bin! * 1.1));
    expect(salt.qty).toBeGreaterThan(salt.bin!);
  });

  it("더운 날(최고 30도)도 × 110% · 보통 날(최고 16도)은 반반 그대로", () => {
    expect(day("2026-11-21").temp).toMatchObject({ up: 1.1, why: "더움" });
    const mild = day("2026-11-20");
    expect(mild.temp).toEqual({ max: 16, min: 7, tmFc: "202611111800", up: null });
    for (const it of mild.items.filter((i) => i.bin != null)) expect(it.qty).toBe(snapUnit(it.name, it.bin!, undefined, undefined, "2026-11-20"));
  });

  it("새 빵 어림 · 매니저 기입은 기온 조정 없음 · 합계는 다시", () => {
    const st = day("2026-11-18");
    const plain = makeWeek(board, {}, DEFAULT_LEARNED, THU, ASOF).find((w) => w.date === "2026-11-18")!.week;
    expect(st.items.find((i) => i.est)!.qty).toBe(plain.items.find((i) => i.est)!.qty);
    expect(st.total).toBe(st.items.reduce((a, b) => a + b.qty, 0));
    expect(st.total).toBeGreaterThan(plain.total);
  });

  it("그날 예보가 아직 없으면(목요일 새벽엔 일요일이 빠짐) 반반 그대로 · '기다림' → 목요일 낮에 채움", () => {
    const sun = day("2026-11-22");
    expect(sun.temp).toEqual({ max: null, min: null, up: null, pending: true });
    for (const it of sun.items.filter((i) => i.bin != null)) expect(it.qty).toBe(snapUnit(it.name, it.bin!, undefined, undefined, "2026-11-22"));
    // 목요일 아침 6시 발표로 채움 — 추운 날이면 × 110%
    const filled = withTemp(sun, "2026-11-22", { max: 5, min: -2, tmFc: "202611120600" });
    expect(filled.temp).toEqual({ max: 5, min: -2, tmFc: "202611120600", up: 1.1, why: "추움" });
    for (const it of filled.items.filter((i) => i.bin != null)) expect(it.qty).toBe(snapUnit(it.name, Math.round(it.bin! * 1.1), undefined, undefined, "2026-11-22"));
    expect(filled.total).toBe(filled.items.reduce((a, b) => a + b.qty, 0));
    // 다시 해도 쌓이지 않음 (반반 결과에서 늘 새로)
    expect(withTemp(filled, "2026-11-22", { max: 5, min: -2, tmFc: "202611120600" })).toEqual(filled);
  });
});

function weekday(d: string): number {
  return new Date(`${d}T00:00:00Z`).getUTCDay();
}
