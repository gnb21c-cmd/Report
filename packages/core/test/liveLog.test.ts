import { describe, expect, it } from "vitest";
import { LIVE_LOG_BRANCH, LIVE_LOG_KEEP_DAYS, liveLogPath, logLines, logPrune, logPushDue } from "../src";

describe("하루 수집 기록 (2026-10-29 사장님 — 밤에 컴퓨터가 꺼질 때까지 붙들고 있어 GitHub 작업 기록이 통째로 안 남던 것)", () => {
  it("받은 글 → 줄마다 시각을 붙여 · 덜 끝난 줄은 다음 글까지 기다림", () => {
    const a = logLines("", "── 20:00 칸 (20:00 시작)\n  카페: 판매 줄 1", "20:00:03");
    expect(a).toEqual({ text: "20:00:03 ── 20:00 칸 (20:00 시작)\n", rest: "  카페: 판매 줄 1" });
    const b = logLines(a.rest, "2개 · 검사 통과\r\n\n네이버", "20:00:41");
    expect(b).toEqual({ text: "20:00:41   카페: 판매 줄 12개 · 검사 통과\n20:00:41 \n", rest: "네이버" });
    expect(logLines("", "", "20:01:00")).toEqual({ text: "", rest: "" });
  });
  it("올릴 날: 오늘 전 날 중 파일이 있고 올린 크기와 다른 것 (오늘은 붙들기 전 · 비켜 줄 때 따로) · 오래된 순", () => {
    const due = logPushDue("2026-10-29", [
      { date: "2026-10-28", size: 5200, up: 3100 }, // 21:50 에 올린 뒤 밤 대기 줄이 더 붙음
      { date: "2026-10-27", size: 4000, up: null }, // 컴퓨터가 일찍 꺼져 못 올림
      { date: "2026-10-26", size: 900, up: 900 }, // 다 올림
      { date: "2026-10-29", size: 100, up: null }, // 오늘
      { date: "2026-10-25", size: 0, up: null }, // 빈 파일
    ]);
    expect(due).toEqual(["2026-10-27", "2026-10-28"]);
  });
  it("이 PC 의 기록 파일은 31일만 둠 · 저장소 자리 · 가지 이름", () => {
    expect(LIVE_LOG_KEEP_DAYS).toBe(31);
    expect(logPrune("2026-10-29", ["2026-09-27", "2026-09-28", "2026-09-29", "2026-10-28", "엉뚱"])).toEqual(["2026-09-27", "2026-09-28"]);
    expect(liveLogPath("2026-10-29")).toBe("log/2026-10-29.log");
    expect(LIVE_LOG_BRANCH).toBe("live-log");
  });
});
