import { describe, expect, it } from "vitest";
import { isNaverTicketProduct, NAVER_AUTO_BY, NAVER_SLOTS, naverAutoWritable, naverDiff, naverPartFrom, naverTime } from "../src";

const slot = (t: string) => NAVER_SLOTS.indexOf(t);

describe("네이버 예약 자동 수집 — 읽은 칸 → A 네이버 칸", () => {
  it("판매입장권은 평일 무제한 · 야간자유 입장 두 상품만", () => {
    expect(isNaverTicketProduct("평일 무제한 / 휴일 1시간 50분 입장권")).toBe(true);
    expect(isNaverTicketProduct("야간자유 입장권")).toBe(true);
    expect(isNaverTicketProduct("[평일] 단체 입장")).toBe(false);
    expect(isNaverTicketProduct("열쇠분실[미반납]")).toBe(false);
    expect(isNaverTicketProduct("10시 매진 시 추가 입장")).toBe(false);
    expect(isNaverTicketProduct("~26.3.31 1h 평일 무제한")).toBe(false); // 지난 상품
  });

  it("시각 글 → HH:MM (오전 · 오후 · 낮 12시)", () => {
    expect(naverTime("오전10:00")).toBe("10:00");
    expect(naverTime("오후6:30")).toBe("18:30");
    expect(naverTime("오후 12:30")).toBe("12:30");
    expect(naverTime("19:00")).toBe("19:00");
    expect(naverTime("회차")).toBeNull();
  });

  it("이용완료 = 판매입장권, '완료 1' = 신규방문자 — 30분 칸에 넣고 다른 상품 · 19:30 넘는 회차는 뺌", () => {
    const r = naverPartFrom("2026-10-04", [
      { product: "평일 무제한 / 휴일 1시간 50분 입장권", time: "오전10:00", done: 5, first: 2 },
      { product: "평일 무제한 / 휴일 1시간 50분 입장권", time: "오전10:30", done: 7, first: 1 },
      { product: "야간자유 입장권", time: "오후6:00", done: 8, first: 3 },
      { product: "야간자유 입장권", time: "오후6:30", done: 2, first: 0 },
      { product: "열쇠분실[미반납]", time: "오후10:00", done: 1, first: 1 },
      { product: "평일 무제한 / 휴일 1시간 50분 입장권", time: "오후8:00", done: 1, first: 0 },
    ]);
    expect(r.part.tickets[slot("10:00")]).toBe(5);
    expect(r.part.tickets[slot("10:30")]).toBe(7);
    expect(r.part.tickets[slot("18:00")]).toBe(8);
    expect(r.part.tickets[slot("18:30")]).toBe(2);
    expect(r.part.tickets.reduce((a, b) => a + b, 0)).toBe(22);
    expect(r.part.newVisitors.reduce((a, b) => a + b, 0)).toBe(6);
    expect(r.part.noNew).toBeUndefined();
    expect(r.skipped).toEqual(["20:00"]);
    expect(r.overlap).toEqual([]);
  });

  it("같은 시각에 두 상품이 있으면 더하고 '겹침'으로 알림", () => {
    const r = naverPartFrom("2026-10-04", [
      { product: "평일 무제한", time: "오후6:00", done: 2, first: 1 },
      { product: "야간자유 입장권", time: "오후6:00", done: 3, first: 0 },
    ]);
    expect(r.part.tickets[slot("18:00")]).toBe(5);
    expect(r.overlap).toEqual(["18:00"]);
  });

  it("완료자 목록을 못 읽은 칸이 있으면 신규방문자는 '모름'(noNew)", () => {
    const r = naverPartFrom("2026-10-04", [{ product: "평일 무제한", time: "오전11:00", done: 4, first: null }]);
    expect(r.part.noNew).toBe(true);
  });

  it("사람이 A 에서 넣은 네이버 칸은 덮지 않음", () => {
    expect(naverAutoWritable(null)).toBe(true);
    expect(naverAutoWritable({ by: NAVER_AUTO_BY })).toBe(true);
    expect(naverAutoWritable({ by: "송" })).toBe(false);
  });

  it("손으로 넣은 값과 견주기 — 다른 칸의 시각만", () => {
    const a = naverPartFrom("d", [{ product: "평일 무제한", time: "오전10:00", done: 5, first: 2 }]).part;
    const b = naverPartFrom("d", [{ product: "평일 무제한", time: "오전10:00", done: 4, first: 2 }]).part;
    expect(naverDiff(a, b)).toEqual({ tickets: ["10:00"], newVisitors: [] });
    expect(naverDiff(a, a)).toEqual({ tickets: [], newVisitors: [] });
  });
});
