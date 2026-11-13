import { describe, expect, it } from "vitest";
import { Board, emptySalesPart, partCheck, type DayReport, type StorePart } from "../src";

/* 2026-11-13 사장님 — 11-11(수) 키즈존 포스 판매가 하나도 없던 날: 오케이포스가 '엑셀 출력할 자료가 없습니다'만 띄움
   → 수집이 실패로 끝나고 보고 앱에 '아스타나키즈 엑셀이 아직 입력되지 않았습니다' 경고가 떴음
   이제는 오케이포스가 그날 영수증 0건이라고 답하면 '판매 없음' 칸(none)을 올림 — 경고 대신 '키즈 포스 판매 없음', 현장 판매 0
   (키즈 포스가 매출을 늦게 보낼 수 있어 다음 이틀 아침 수집 때 다시 확인) */

const H = () => Array.from({ length: 12 }, () => 0);
const cafe = (date: string): StorePart => ({
  v: 1, store: "cafe", date, basis: "receipt", file: "t.xls", sheetNet: 0, posNet: 0, voucher: 0,
  sectors: { 바리스타: 100000, 베이커리: 0, 키친: 0, 기타: 0 }, cups: 10, teams: 5, teamSizes: [0, 5, 0, 0, 0, 0],
  hourly: { sectors: { 바리스타: H(), 베이커리: H(), 키친: H(), 기타: H() }, cups: H(), teams: H() },
  products: [], refunds: { receipts: 0, lines: 0, unmatched: 0, amount: 0 }, kids: null,
});

describe("키즈 포스 판매 없음 (오케이포스 영수증 0건)", () => {
  const p = emptySalesPart("kids", "2026-11-11", "OKPOS 자동 2026-11-11 키즈.xls", () => "기타").part;

  it("빈 키즈 칸 — 판매 없음 표시 · 매출 0 · 현장 0 · 검산 통과", () => {
    expect(p.none).toBe(true);
    expect(p).toMatchObject({ store: "kids", date: "2026-11-11", basis: "receipt", posNet: 0, sheetNet: 0, products: [] });
    expect(p.kids).toMatchObject({ walkIn: 0, issued: 0, eventFree: 0, walkInNet: 0, other: 0 });
    expect(partCheck(p).ok).toBe(true);
  });

  it("보고 앱 — 키즈 칸이 있는 날로 셈(경고 없음) · 판매 없음 날 수 · 키즈입장은 네이버 몫만", () => {
    const withNaver: DayReport = { date: "2026-11-11", cafe: cafe("2026-11-11"), kids: p, naver: { v: 1, date: "2026-11-11", tickets: [10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], newVisitors: [] } as any };
    const m = new Board([withNaver]).day("2026-11-11");
    expect(m.has.kids).toBe(1);
    expect(m.kidsNone).toBe(1);
    expect(m.walkIn).toBe(0);
    expect(m.fee.walkIn).toBe(0);
    expect(m.box.키즈입장료).toBe(m.fee.naver);
    // 판매가 있던 보통 날은 0
    const other = new Board([{ date: "2026-11-10", cafe: cafe("2026-11-10") }]).day("2026-11-10");
    expect(other.kidsNone ?? 0).toBe(0);
  });
});
