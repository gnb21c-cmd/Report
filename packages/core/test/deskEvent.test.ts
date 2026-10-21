import { describe, expect, it } from "vitest";
import { deskEventsFrom, parseDeskEvent, withDeskEvents, type DayReport } from "../src";

/** 통합데스크가 매일 20:00 보내는 그날 이벤트 입장 수 (astanakiz 2.1~ · docs/OPERATION.md '현장 [이벤트 입장]') */
const msg = (o: Record<string, unknown> = {}) => JSON.stringify({ type: "astanakiz-event", v: 1, day: "2026-10-21", sentAt: "2026-10-21 20:00", count: 3, names: [{ name: "한가위", n: 3 }], ...o });
const kidsDay = (date: string, eventFree: number): DayReport =>
  ({ date, kids: { kids: { issued: 10, walkIn: 3, walkInNet: 39000, eventFree, other: 0, hourly: null } } }) as unknown as DayReport;

describe("이벤트 무료입장 — 통합데스크 그날 이벤트 입장 수 (2026-10-21 사장님)", () => {
  it("모양이 맞으면 받음 · 틀리면 null", () => {
    expect(parseDeskEvent(msg())).toEqual({ day: "2026-10-21", count: 3, names: [{ name: "한가위", n: 3 }], sentAt: "2026-10-21 20:00" });
    expect(parseDeskEvent(msg({ count: 0, names: [] }))!.count).toBe(0);
    for (const bad of ["{", msg({ type: "astanakiz-survey" }), msg({ v: 2 }), msg({ day: "10/21" }), msg({ count: -1 }), msg({ count: 1.5 }), msg({ count: "3" })]) expect(parseDeskEvent(bad)).toBeNull();
  });

  it("이름 칸은 짧은 글만 — 전화번호 같은 글 · 0명 · 이상한 수는 버림", () => {
    const e = parseDeskEvent(msg({ names: [{ name: "010-1234-5678", n: 1 }, { name: "한가위", n: 0 }, { name: "", n: 2 }, { name: "추석", n: "많이" }, { name: "추석", n: 1 }] }))!;
    expect(e.names).toEqual([{ name: "이벤트", n: 2 }, { name: "추석", n: 1 }]);
    expect(JSON.stringify(e)).not.toContain("010");
  });

  it("deskStats 문서들 → 날짜별 수 (event-날짜 문서만 · 이름과 글의 날짜가 같을 때만)", () => {
    expect(
      deskEventsFrom([
        { id: "revisit", json: JSON.stringify({ type: "astanakiz-revisit" }) },
        { id: "event-2026-10-21", json: msg() },
        { id: "event-2026-10-20", json: msg({ day: "2026-10-20", count: 0, names: [] }) },
        { id: "event-2026-10-19", json: msg() }, // 이름과 날짜가 다름
        { id: "event-2026-10-18", json: "{" },
      ]),
    ).toEqual({ "2026-10-21": 3, "2026-10-20": 0 });
  });

  it("그날 이벤트 무료입장 = max(POS 0원 상품, 통합데스크) — 더하지 않음 · 키즈 칸이 있는 날만 · 원래 자료는 그대로", () => {
    const a = kidsDay("2026-10-21", 0), b = kidsDay("2026-10-20", 5), c = { date: "2026-10-19" } as DayReport;
    const out = withDeskEvents([a, b, c], { "2026-10-21": 3, "2026-10-20": 2, "2026-10-19": 4 });
    expect(out.map((r) => r.kids?.kids?.eventFree ?? null)).toEqual([3, 5, null]);
    expect(a.kids!.kids!.eventFree).toBe(0);
    expect(out[1]).toBe(b);
    expect(withDeskEvents([a], null)).toEqual([a]);
  });
});
