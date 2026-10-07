import { describe, expect, it } from "vitest";
import { checkDeskLive, deskFromState, NAVER_SLOTS, type DeskState } from "../src";

const at = (hm: string) => NAVER_SLOTS.indexOf(hm);
// 아스타나키즈 통합데스크(C) desk-state/YYYY-MM-DD.json 모양 (astanakiz docs/SHARE.md 3장)
const state: DeskState = {
  v: 2,
  b: [
    { no: "1", name: "가", phone: "01011112222", slot: 600, qty: 2, status: "완료", prevDone: 0 },
    { no: "2", name: "나", phone: "01033334444", slot: 840, qty: 1, status: "완료", prevDone: 5 },
    // 연속예약 — 같은 손님 두 건, 둘 다 prevDone 0 → 신규 1명 (처음 칸에)
    { no: "3", name: "다", phone: "01055556666", slot: 870, qty: 1, status: "완료", prevDone: 0 },
    { no: "4", name: "다", phone: "01055556666", slot: 990, qty: 1, status: "완료", prevDone: 0 },
    // 아직 입장 전 · 시험 기록(x)은 빼고
    { no: "5", name: "라", phone: "01077778888", slot: 900, qty: 3, status: "대기", prevDone: 0 },
    { no: "6", name: "마", phone: "01099990000", slot: 900, qty: 1, status: "완료", prevDone: 0 },
    // 19:30 뒤 · 10:00 앞 예약도 숫자를 잃지 않게 끝 칸으로
    { no: "7", name: "바", phone: "01012121212", slot: 1200, qty: 1, status: "완료", prevDone: 2 },
  ],
  w: [
    { id: "w1", phone: "01000000000", qty: 2, slot: 750 },
    { id: "w2", phone: "", qty: 1, slot: 570 },
  ],
  x: ["6"],
};

describe("통합데스크(C) 하루 기록 → B 마감 전 숫자 (이름 · 전화는 밖으로 안 나감)", () => {
  const r = deskFromState(state, "2026-10-08");
  it("네이버 입장 = 이용완료 장수 − 시험 기록(x), 30분 칸별", () => {
    expect(r.desk.naver[at("10:00")]).toBe(2);
    expect(r.desk.naver[at("14:00")]).toBe(1);
    expect(r.desk.naver[at("14:30")]).toBe(1);
    expect(r.desk.naver[at("16:30")]).toBe(1);
    expect(r.desk.naver[at("19:30")]).toBe(1);
    expect(r.desk.naver.reduce((a, b) => a + b, 0)).toBe(6);
  });
  it("신규 = 네이버 '완료 n' 이 이번이 처음인 손님, 연속예약은 1명 · 처음 칸", () => {
    expect(r.desk.naverNew[at("10:00")]).toBe(1);
    expect(r.desk.naverNew[at("14:30")]).toBe(1);
    expect(r.desk.naverNew[at("16:30")]).toBe(0);
    expect(r.desk.naverNew.reduce((a, b) => a + b, 0)).toBe(2);
  });
  it("현장 구매 장수 (10:00 앞은 첫 칸)", () => {
    expect(r.desk.onsite[at("12:30")]).toBe(2);
    expect(r.desk.onsite[at("10:00")]).toBe(1);
  });
  it("영업 칸 밖 예약 수를 알려 줌 · 검사 통과 · 이름 · 전화 없음", () => {
    expect(r.outside).toBe(2);
    expect(checkDeskLive(r.desk, "2026-10-08")).toEqual([]);
    const text = JSON.stringify(r.desk);
    expect(text).not.toMatch(/010|가|나|다/);
  });
});
