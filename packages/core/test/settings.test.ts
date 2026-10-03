import { afterEach, describe, expect, it } from "vitest";
import { applySettings, Board, cleanSettings, DEFAULT_SETTINGS, holidayName, isOffDay, kidsPrice, seasonOf } from "../src";

afterEach(() => applySettings(null));

describe("보고 설정 — 기간 스티커 · 휴일 더하기/빼기", () => {
  it("기본: 여름방학 성수기 · 11월 비수기 · 그 밖은 평상시 · 대체공휴일은 자동", () => {
    expect(seasonOf("2026-08-01").kind).toBe("성수기");
    expect(seasonOf("2026-11-10").kind).toBe("비수기");
    expect(seasonOf("2026-10-02").kind).toBe("평상시");
    expect(holidayName("2026-10-05")).toBe("개천절 대체 휴일");
  });
  it("기간을 바꾸면 스티커가 바뀜 (위에서부터 먼저)", () => {
    applySettings({ ...DEFAULT_SETTINGS, seasons: [{ kind: "성수기", from: "10-01", to: "10-09", name: "추석 연휴" }, ...DEFAULT_SETTINGS.seasons] });
    expect(seasonOf("2026-10-02")).toMatchObject({ kind: "성수기", name: "추석 연휴" });
    expect(seasonOf("2026-10-10").kind).toBe("평상시");
  });
  it("임시공휴일 더하기 → 휴일 단가 · 빼기 → 평일", () => {
    expect(isOffDay("2026-10-07")).toBe(false);
    applySettings({ ...DEFAULT_SETTINGS, holidaysAdd: { "2026-10-07": "임시공휴일" }, holidaysOff: ["2026-10-05"] });
    expect(holidayName("2026-10-07")).toBe("임시공휴일");
    expect(kidsPrice("2026-10-07").kind).toBe("휴일");
    expect(isOffDay("2026-10-05")).toBe(false);
  });
  it("모양이 틀린 값은 버림 · 비면 기본 기간", () => {
    const s = cleanSettings({ seasons: [{ kind: "성수기", from: "7-1", to: "08-01", name: "x" }, { kind: "비수기", from: "03-02", to: "03-31", name: "개학" }], holidaysAdd: { bad: "x", "2026-12-24": "" }, holidaysOff: ["2026-10-05", "2026-10-05"] });
    expect(s.seasons.length).toBe(1);
    expect(s.holidaysAdd).toEqual({ "2026-12-24": "휴일" });
    expect(s.holidaysOff).toEqual(["2026-10-05"]);
    expect(cleanSettings(null).seasons.length).toBe(DEFAULT_SETTINGS.seasons.length);
  });
  it("Board 는 설정을 넣은 뒤 새로 만들면 새 휴일로 계산", () => {
    applySettings({ ...DEFAULT_SETTINGS, holidaysAdd: { "2026-10-07": "임시공휴일" } });
    const b = new Board([]);
    expect(b.range("2026-10-07", "2026-10-07").total).toBe(0);
  });
});
