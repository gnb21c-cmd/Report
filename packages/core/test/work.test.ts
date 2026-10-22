import { describe, expect, it } from "vitest";
import { Board, checkWorkDoc, checkWorkEvent, dayKind, dayRange, HOURS, isEventDonkatsu, parseDeskLive, WORK_AVG_DAYS, workEventOf, workSummary, type DayReport, type ProductTuple, type StorePart, type WorkDoc } from "../src";

/* 근무자 화면 (2026-10-22 사장님) — 보고 앱에서 수량만 발췌: 키친 상품별 오늘 · 1주 · 월 판매량 · [이벤트] 돈까스 평균 판매량 · 재방문 이벤트 돈까스 예정 */
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
// 9/1 ~ 10/22: 키친 — 평일 파스타 5 · 수제돈까스 4, 휴일 두 배 · 0원 서비스 줄 · 폭립 할인(마이너스)
//   10/12 부터 [이벤트] 수제돈까스 0원 (평일 3 · 휴일 6) — 재방문 이벤트 사은품
const reports = dayRange("2026-09-01", "2026-10-22").map((d) => {
  const k = dayKind(d) === "휴일" ? 2 : 1;
  const ps: ProductTuple[] = [
    ["부라타토마토파스타", "키친", 5 * k, 100000 * k],
    ["수제돈까스", "키친", 4 * k, 64000 * k],
    ["서비스 감자튀김", "키친", 2, 0],
    ["아메리카노", "바리스타", 10, 45000],
    ["소금빵", "베이커리", 20, 76000],
  ];
  if (d >= "2026-10-12") ps.push(["[이벤트] 수제돈까스", "키친", 3 * k, 0]);
  return day(d, ps);
});
const board = new Board(reports);

describe("근무자 화면 키친 — 상품별 수량 · [이벤트] 돈까스 평균 판매량 (금액 없음)", () => {
  const w = workSummary(board, "2026-10-22", "2026-10-22T05:00:00.000Z");
  it("이벤트 돈까스 이름 — '이벤트'(또는 '재방문')와 '돈까스'가 함께", () => {
    expect(isEventDonkatsu("[이벤트] 수제돈까스")).toBe(true);
    expect(isEventDonkatsu("[재방문]돈가스")).toBe(true);
    expect(isEventDonkatsu("수제돈까스")).toBe(false);
    expect(isEventDonkatsu("[이벤트]바베큐폭립")).toBe(false);
  });
  it("키친 상품만 · 0원 서비스 줄은 뺌(이벤트 돈까스는 0원이어도 넣음) · 그 달 많이 팔린 순", () => {
    expect(w.kitchen.items.map((i) => i.name)).toEqual(["부라타토마토파스타", "수제돈까스", "[이벤트] 수제돈까스"]);
  });
  it("오늘 · 1주(오늘 포함 7일) · 그 달(1일 ~ 오늘) 판매량", () => {
    const s = w.kitchen.items.find((i) => i.name === "부라타토마토파스타")!;
    const hol = dayRange("2026-10-01", "2026-10-22").filter((d) => dayKind(d) === "휴일").length;
    expect(s.today).toBe(5);
    expect(s.week).toBe(5 * 5 + 2 * 10); // 10/16 ~ 22 = 평일 5일 · 휴일 2일
    expect(s.month).toBe((22 - hol) * 5 + hol * 10);
  });
  it(`[이벤트] 돈까스 평일 · 휴일 하루 평균 판매량 — 처음 팔린 날(10/12)부터 오늘 빼고 지난 ${WORK_AVG_DAYS}일 안에서`, () => {
    expect(WORK_AVG_DAYS).toBe(28);
    expect(w.kitchen.donkatsu).toEqual({ weekday: 3, holiday: 6 });
    // 아직 안 팔렸으면 null (이벤트 전)
    const before = workSummary(board, "2026-10-12", "x");
    expect(before.kitchen.donkatsu).toEqual({ weekday: null, holiday: null });
  });
  it("자료가 없으면 빈 목록 · 평균 없음", () => {
    expect(workSummary(new Board([]), "2026-10-22", "x").kitchen).toEqual({ donkatsu: { weekday: null, holiday: null }, items: [] });
  });
  it("검사 — 모양 · 숫자 · 전화번호 같은 글 없음 · 금액 없음", () => {
    const doc: WorkDoc = { v: 1, ...w };
    expect(checkWorkDoc(doc)).toEqual([]);
    expect(JSON.stringify(doc)).not.toMatch(/100000|64000/);
    expect(checkWorkDoc({ ...doc, v: 2 } as unknown as WorkDoc).length).toBeGreaterThan(0);
    const bad = JSON.parse(JSON.stringify(doc));
    bad.kitchen.items[0].name = "010-1234-5678";
    expect(checkWorkDoc(bad).length).toBeGreaterThan(0);
  });
});

describe("재방문 이벤트 돈까스 예정 — 통합데스크 키즈 실시간(deskLive/now)의 revisitDue 를 숫자만 옮김", () => {
  const live = (revisitDue: unknown) =>
    parseDeskLive({ type: "astanakiz-live", v: 1, day: "2026-10-26", at: "2026-10-26 14:05:12", naver: { slots: [] }, people: {}, keys: { map: {}, holders: [] }, revisitDue });
  it("오늘 아직 안 온 이벤트 대상 예약 · 내일 · 2일 뒤 · 3일 뒤 (오늘 뺀 3일)", () => {
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
