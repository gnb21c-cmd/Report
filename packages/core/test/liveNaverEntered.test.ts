import { describe, expect, it } from "vitest";
import { deskNaverPart, liveNaverPart, NAVER_SLOTS, parseDeskLive } from "../src";

/* 2026-11-14 사장님 — 마감 전 키즈 네이버는 '입장한 것(이용완료)'만
   오전 10시 50분인데 오후 입장예정 예약까지 키즈입장에 잡혀(67%) 시간대별 매출 오후 칸에도 금액이 있었음
   → 오후 예약은 취소될 수 있음. 시간 칸은 그 시간에 들어온 것만, 합계도 그 순간까지 입장한 것만 (입장예정은 빼고)
   다음 날 아침 확정 네이버도 이용완료만이라 같은 기준 */

const ticket = "평일 무제한 / 휴일 1시간 50분 입장권";
const slot = (t: string) => NAVER_SLOTS.indexOf(t);

describe("마감 전 네이버 — 이용완료(입장한 것)만", () => {
  it("네이버에서 직접 읽은 것: 입장예정은 세지 않음", () => {
    const done = [
      { product: ticket, time: "10:00", done: 30 },
      { product: ticket, time: "10:30", done: 12 },
    ];
    const p = liveNaverPart("2026-11-14", done);
    expect(p.tickets[slot("10:00")]).toBe(30);
    expect(p.tickets[slot("10:30")]).toBe(12);
    expect(p.tickets.reduce((a, b) => a + b, 0)).toBe(42);
    // 오후 칸은 아직 아무도 안 들어왔으니 0 (예전엔 입장예정이 들어가 오후 칸에도 숫자가 있었음)
    expect(p.tickets[slot("14:00")]).toBe(0);
  });

  it("통합데스크로 대신 받을 때도 완료만 (미입장 conf 는 빼고)", () => {
    const desk = parseDeskLive({
      type: "astanakiz-live",
      v: 1,
      day: "2026-11-14",
      at: "2026-11-14 10:50:00",
      build: "2.22",
      naver: {
        done: 40,
        conf: 60,
        left: 0,
        test: 0,
        slots: [
          { t: "10:00", done: 30, conf: 2, left: 0, cap: 40 },
          { t: "10:30", done: 10, conf: 3, left: 0, cap: 40 },
          { t: "14:00", done: 0, conf: 55, left: 0, cap: 60 },
        ],
        products: [{ name: ticket, done: 40 }],
      },
      walk: { total: 0, event: 0, service: 0 },
      people: { naver: 40, walk: 0, total: 40 },
      keys: { total: 45, map: {}, holders: [] },
    });
    const r = deskNaverPart(desk, "2026-11-14", new Date("2026-11-14T10:52:00+09:00"));
    expect(r.why).toBe("");
    expect(r.part!.tickets[slot("10:00")]).toBe(30);
    expect(r.part!.tickets[slot("10:30")]).toBe(10);
    expect(r.part!.tickets[slot("14:00")]).toBe(0);
  });
});
