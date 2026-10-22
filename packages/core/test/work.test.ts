import { describe, expect, it } from "vitest";
import { Board, checkWorkDoc, checkWorkEvent, dayKind, dayRange, HOURS, parseDeskLive, WORK_AVG_DAYS, workEventOf, workSummary, type DayReport, type ProductTuple, type StorePart, type WorkDoc } from "../src";

/* 근무자 화면 (2026-10-22 사장님) — 보고 앱에서 수량만 발췌: 섹터별 평일 · 휴일 평균 수요량 + 상품별 오늘 · 1주 · 월 판매량 · 재방문 이벤트 돈까스 예정 */
const H = () => HOURS.map(() => 0);
function day(date: string, products: ProductTuple[], cups = 0): DayReport {
  const cafe: StorePart = {
    v: 1, store: "cafe", date, basis: "receipt", file: "t.xls", sheetNet: 0, posNet: 0, voucher: 0,
    sectors: { 바리스타: 0, 베이커리: 0, 키친: 0, 기타: 0 }, cups, teams: 0, teamSizes: [0, 0, 0, 0, 0, 0],
    hourly: { sectors: { 바리스타: H(), 베이커리: H(), 키친: H(), 기타: H() }, cups: H(), teams: H() },
    products, refunds: { receipts: 0, lines: 0, unmatched: 0, amount: 0 }, kids: null,
  };
  return { date, cafe };
}
// 9/1 ~ 10/22: 평일은 아메리카노 10 · 소금빵 20 · 파스타 5, 휴일은 두 배 · 옵션('+ 샷 추가' 500원 · '연하게' 0원) · 빵 아닌 딸기잼 · 원두
const reports = dayRange("2026-09-01", "2026-10-22").map((d) => {
  const k = dayKind(d) === "휴일" ? 2 : 1;
  return day(d, [
    ["아메리카노", "바리스타", 10 * k, 45000 * k],
    ["+ 샷 추가", "바리스타", 3, 1500],
    ["연하게", "바리스타", 2, 0],
    ["[원두200g]블랙수트", "기타", 1, 18000],
    ["소금빵", "베이커리", 20 * k, 76000 * k],
    ["우유모닝빵", "베이커리", 4, 12000],
    ["딸기잼", "베이커리", 1, 1000],
    ["부라타토마토파스타", "키친", 5 * k, 100000 * k],
  ]);
});
const board = new Board(reports);

describe("근무자 화면 — 섹터별 수량 (금액 없음)", () => {
  const w = workSummary(board, "2026-10-22", "2026-10-22T05:00:00.000Z");
  it("섹터 세 개 · 바리스타는 잔(옵션 · 원두 · 0원 줄 뺌) · 베이커리 · 키친은 개 (빵 아닌 딸기잼 뺌)", () => {
    expect(Object.keys(w.sectors)).toEqual(["바리스타", "베이커리", "키친"]);
    expect(w.sectors.바리스타.unit).toBe("잔");
    expect(w.sectors.베이커리.unit).toBe("개");
    expect(w.sectors.바리스타.items.map((i) => i.name)).toEqual(["아메리카노"]);
    expect(w.sectors.베이커리.items.map((i) => i.name)).toEqual(["우유모닝빵", "소금빵"]); // 제빵 표 순서
    expect(w.sectors.키친.items.map((i) => i.name)).toEqual(["부라타토마토파스타"]);
  });
  it("오늘 · 1주(오늘 포함 7일) · 월(이번 달 1일 ~ 오늘) 판매량", () => {
    const s = w.sectors.베이커리.items.find((i) => i.name === "소금빵")!;
    // 10/22 목 = 평일 20 · 10/16 ~ 22 = 평일 5일 × 20 + 휴일 2일 × 40 · 10/1 ~ 22 (휴일 = 토 · 일 · 개천절 · 한글날)
    const hol = dayRange("2026-10-01", "2026-10-22").filter((d) => dayKind(d) === "휴일").length;
    expect(s.today).toBe(20);
    expect(s.week).toBe(5 * 20 + 2 * 40);
    expect(s.month).toBe((22 - hol) * 20 + hol * 40);
  });
  it(`평일 · 휴일 하루 평균 수요량 — 오늘 빼고 지난 ${WORK_AVG_DAYS}일, 섹터 목록의 합`, () => {
    expect(WORK_AVG_DAYS).toBe(28);
    expect(w.sectors.베이커리.avg).toEqual({ weekday: 24, holiday: 44 });
    expect(w.sectors.바리스타.avg).toEqual({ weekday: 10, holiday: 20 });
    expect(w.sectors.키친.avg).toEqual({ weekday: 5, holiday: 10 });
  });
  it("자료가 없는 날 · 문 닫은 날은 평균에서 뺌 · 판매 0 인 상품은 목록에서 뺌", () => {
    const b2 = new Board(reports.filter((r) => r.date !== "2026-10-21"));
    expect(workSummary(b2, "2026-10-22", "x").sectors.베이커리.avg.weekday).toBe(24);
    expect(workSummary(new Board([]), "2026-10-22", "x").sectors.베이커리).toEqual({ unit: "개", avg: { weekday: null, holiday: null }, items: [] });
  });
  it("검사 — 모양 · 숫자 · 전화번호 같은 글 없음", () => {
    const doc: WorkDoc = { v: 1, ...w };
    expect(checkWorkDoc(doc)).toEqual([]);
    expect(JSON.stringify(doc)).not.toMatch(/45000|76000|100000/); // 금액 없음
    expect(checkWorkDoc({ ...doc, v: 2 } as unknown as WorkDoc).length).toBeGreaterThan(0);
    const bad = JSON.parse(JSON.stringify(doc));
    bad.sectors.키친.items[0].name = "010-1234-5678";
    expect(checkWorkDoc(bad).length).toBeGreaterThan(0);
  });
});

describe("재방문 이벤트 돈까스 예정 — 통합데스크 키즈 실시간(deskLive/now)의 revisitDue 를 숫자만 옮김", () => {
  const live = (revisitDue: unknown) =>
    parseDeskLive({ type: "astanakiz-live", v: 1, day: "2026-10-26", at: "2026-10-26 14:05:12", naver: { slots: [] }, people: {}, keys: { map: {}, holders: [] }, revisitDue });
  it("오늘 아직 안 온 이벤트 대상 예약 · 내일 · 모레 · 글피 (오늘 뺀 3일)", () => {
    const d = live({ today: 3, ahead: [{ date: "2026-10-27", n: 2 }, { date: "2026-10-28", n: 5 }, { date: "2026-10-29", n: 0 }] });
    expect(workEventOf(d)).toEqual({ at: "2026-10-26 14:05", day: "2026-10-26", today: 3, ahead: [{ date: "2026-10-27", n: 2 }, { date: "2026-10-28", n: 5 }, { date: "2026-10-29", n: 0 }] });
    expect(checkWorkEvent({ v: 1, event: workEventOf(d) })).toEqual([]);
    expect(checkWorkEvent({ v: 1, event: null })).toEqual([]);
    expect(checkWorkEvent({ v: 1, event: { ...workEventOf(d)!, today: -1 } }).length).toBeGreaterThan(0);
  });
  it("통합데스크가 아직 안 보내면(옛 판) null · 이상한 값은 버림 (오늘 · 지난날 · 4일째 · 음수 · 소수)", () => {
    expect(workEventOf(live(undefined))).toBeNull();
    expect(workEventOf(null)).toBeNull();
    const d = live({ today: -1, ahead: [{ date: "2026-10-26", n: 1 }, { date: "2026-10-27", n: 2.5 }, { date: "2026-10-28", n: 4 }, { date: "2026-10-30", n: 9 }] });
    expect(workEventOf(d)).toEqual({ at: "2026-10-26 14:05", day: "2026-10-26", today: null, ahead: [{ date: "2026-10-28", n: 4 }] });
  });
});
