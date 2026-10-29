import { describe, expect, it } from "vitest";
import { checkLiveNaver, DESK_NAVER_MAX_MIN, deskNaverPart, NAVER_SLOTS, parseDeskLive, type NaverPart } from "../src";

/* 마감 전 네이버를 통합데스크 키즈 실시간 현황으로 (2026-10-19 사장님 — 네이버를 직접 못 읽거나 오래 걸리면) */
const desk = (naver: Record<string, unknown> = {}, top: Record<string, unknown> = {}) =>
  parseDeskLive({
    type: "astanakiz-live",
    v: 1,
    day: "2026-10-19",
    at: "2026-10-19 19:18:48",
    build: "1.50",
    naver: {
      done: 5,
      conf: 2,
      left: 0,
      test: 0,
      slots: [
        { t: "10:00", done: 2, conf: 0, left: 8, cap: 10 },
        { t: "19:00", done: 3, conf: 2, left: 5, cap: 10 },
      ],
      products: [
        { name: "평일 무제한 / 휴일 1시간 50분 입장권", done: 4 },
        { name: "야간자유 입장권", done: 1 },
      ],
      ...naver,
    },
    people: { naver: 5, walk: 1, total: 6 },
    keys: { total: 45, map: {}, holders: [] },
    ...top,
  });
const now = new Date("2026-10-19T19:20:00+09:00");
const part = (tickets: Record<string, number>): NaverPart => ({ v: 1, date: "2026-10-19", tickets: NAVER_SLOTS.map((t) => tickets[t] || 0), newVisitors: NAVER_SLOTS.map(() => 0), noNew: true });

describe("통합데스크 현황 → 마감 전 네이버 칸", () => {
  it("시간 칸마다 이용완료 + 확정(입장예정) — 보고 앱이 네이버에서 직접 읽은 것과 같은 모양 · 신규는 모름", () => {
    const r = deskNaverPart(desk(), "2026-10-19", now);
    expect(r.why).toBe("");
    expect(r.part).toEqual(part({ "10:00": 2, "19:00": 5 }));
    expect(checkLiveNaver(r.part!, "2026-10-19")).toEqual([]);
  });

  it("19:30 뒤 칸(통합데스크 2.12 ~ 20:00 예약)은 19:30 칸에 더함 — 예전엔 '보고 칸에 없는 시각'으로 통째로 안 씀 (2026-10-29 사장님)", () => {
    const r = deskNaverPart(desk({ slots: [{ t: "19:00", done: 3, conf: 2, left: 5, cap: 10 }, { t: "20:00", done: 0, conf: 1, left: 0, cap: 1 }] }), "2026-10-19", now);
    expect(r.why).toBe("");
    expect(r.part).toEqual(part({ "19:00": 5, "19:30": 1 }));
  });

  it("현황이 없거나 모양이 틀리면 안 씀", () => {
    expect(deskNaverPart(null, "2026-10-19", now).part).toBe(null);
  });

  it("오늘 현황이 아니면 안 씀", () => {
    const r = deskNaverPart(desk({}, { day: "2026-10-18", at: "2026-10-18 22:10:00" }), "2026-10-19", now);
    expect(r.part).toBe(null);
    expect(r.why).toMatch(/오늘/);
  });

  it(`통합데스크 소식이 ${DESK_NAVER_MAX_MIN}분 넘게 없으면 안 씀 (키즈 POS 꺼짐 등)`, () => {
    expect(DESK_NAVER_MAX_MIN).toBe(10);
    expect(deskNaverPart(desk(), "2026-10-19", new Date("2026-10-19T19:28:00+09:00")).part).not.toBe(null);
    const r = deskNaverPart(desk(), "2026-10-19", new Date("2026-10-19T19:31:00+09:00"));
    expect(r.part).toBe(null);
    expect(r.why).toMatch(/12분/);
  });

  it("보고 기준(입장권 상품 — 평일무제한 · 야간자유)이 아닌 상품이 섞이면 안 씀", () => {
    expect(deskNaverPart(desk({ products: [{ name: "단체 입장권", done: 4 }] }), "2026-10-19", now).part).toBe(null);
    expect(deskNaverPart(desk({ products: [{ name: "~26.3.31 평일 무제한 입장권", done: 4 }] }), "2026-10-19", now).part).toBe(null);
    // 아직 이용완료가 없는 아침(상품 목록이 빔)은 됨
    expect(deskNaverPart(desk({ products: [] }), "2026-10-19", now).part).not.toBe(null);
  });

  it("10:00 전 · 19:30 뒤는 끝 칸에 더함 (2026-10-29) — 30분 칸이 아닌 시각(12:15)에 장수가 있으면 안 씀 · 0 이면 됨", () => {
    expect(deskNaverPart(desk({ slots: [{ t: "09:30", done: 1, conf: 0, left: 0, cap: 10 }] }), "2026-10-19", now).part).toEqual(part({ "10:00": 1 }));
    expect(deskNaverPart(desk({ slots: [{ t: "12:15", done: 1, conf: 0, left: 0, cap: 10 }] }), "2026-10-19", now).part).toBe(null);
    expect(deskNaverPart(desk({ slots: [{ t: "12:15", done: 0, conf: 0, left: 10, cap: 10 }, { t: "10:00", done: 2, conf: 0, left: 8, cap: 10 }] }), "2026-10-19", now).part).toEqual(part({ "10:00": 2 }));
  });

  it("먼저 받은 네이버(직접 읽은 것)보다 합이 작으면 덮지 않음 — 통합데스크가 아직 다시 안 읽은 옛 숫자일 수 있어서", () => {
    expect(deskNaverPart(desk(), "2026-10-19", now, part({ "10:00": 2, "19:00": 6 })).part).toBe(null);
    expect(deskNaverPart(desk(), "2026-10-19", now, part({ "10:00": 2, "19:00": 5 })).part).not.toBe(null);
    expect(deskNaverPart(desk(), "2026-10-19", now, part({ "10:00": 2 })).part).not.toBe(null);
  });
});
