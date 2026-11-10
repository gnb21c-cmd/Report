import { describe, expect, it } from "vitest";
import { DESK_RENTAL_PREFIX, parseDeskRental, rentalLabel } from "../src";

/** 통합데스크 [대관]이 보내는 글 — 예시 이름은 지어낸 것 */
const doc = (o: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "astanakiz-rental", v: 1, day: "2026-11-10", sentAt: "2026-11-10 10:05", list: [{ name: "햇살어린이집", paidOn: "2026-10-16", amount: 200000, people: 18, time: "10:00", memo: "오전 단체" }], ...o });

describe("키즈대관 — 통합데스크 [대관] 기록 (2026-11-10 사장님)", () => {
  it("모양이 맞으면 받음 — 이용일 · 단체 이름 · 입금일 · 금액 · 인원 · 시각 · 메모", () => {
    const r = parseDeskRental(doc())!;
    expect(r.day).toBe("2026-11-10");
    expect(r.sentAt).toBe("2026-11-10 10:05");
    expect(r.list).toEqual([{ name: "햇살어린이집", paidOn: "2026-10-16", amount: 200000, people: 18, time: "10:00", memo: "오전 단체" }]);
    expect(DESK_RENTAL_PREFIX + r.day).toBe("rental-2026-11-10");
  });

  it("다른 글 · 깨진 글 · 날짜가 틀린 글은 받지 않음", () => {
    expect(parseDeskRental(null)).toBeNull();
    expect(parseDeskRental("{깨짐")).toBeNull();
    expect(parseDeskRental(doc({ type: "astanakiz-event" }))).toBeNull();
    expect(parseDeskRental(doc({ v: 2 }))).toBeNull();
    expect(parseDeskRental(doc({ day: "11/10" }))).toBeNull();
    expect(parseDeskRental(doc({ list: "없음" }))).toBeNull();
  });

  it("대관이 취소되면 빈 목록 = 0건", () => {
    expect(parseDeskRental(doc({ list: [] }))!.list).toEqual([]);
  });

  it("이상한 줄은 빼고 이상한 칸은 비움 — 이름이 없거나 전화번호 같으면 그 줄을 뺌", () => {
    const r = parseDeskRental(
      doc({
        list: [
          { name: "", paidOn: "2026-10-16" },
          { name: "010-1234-5678" },
          { name: "  달빛유치원  ", paidOn: "10/16", amount: -5, people: 1.5, time: "25:00", memo: "연락 010-1234-5678" },
        ],
      }),
    )!;
    expect(r.list).toEqual([{ name: "달빛유치원", paidOn: null, amount: null, people: null, time: null, memo: "" }]);
  });

  it("보여 줄 글 — 단체 이름 (입금 월/일), 해가 다르면 연도까지, 입금일이 없으면 그렇게", () => {
    const base = { amount: null, people: null, time: null, memo: "" };
    expect(rentalLabel({ ...base, name: "햇살어린이집", paidOn: "2026-10-16" }, "2026-11-10")).toBe("햇살어린이집 (입금 10/16)");
    expect(rentalLabel({ ...base, name: "햇살어린이집", paidOn: "2025-12-20" }, "2026-01-05")).toBe("햇살어린이집 (입금 25/12/20)");
    expect(rentalLabel({ ...base, name: "햇살어린이집", paidOn: null }, "2026-11-10")).toBe("햇살어린이집 (입금일 안 적음)");
  });
});
