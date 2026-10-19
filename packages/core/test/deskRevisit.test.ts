import { describe, expect, it } from "vitest";
import { parseDeskRevisit, revisitRows, revisitSummary } from "../src";
import sample from "../../../apps/view/src/data/demoRevisit.json";

/** 통합데스크가 매일 20:00 보내는 일수 모음 (astanakiz docs/REVISIT.md) — 체험판 예시 */
const raw = () => JSON.parse(JSON.stringify(sample));

describe("재방문 간격 — 통합데스크 일수 모음 (2026-10-19 사장님)", () => {
  it("모양이 맞으면 받음 — 지난 30일 요약 · 과거 · 이벤트 많은 순 7개", () => {
    const r = parseDeskRevisit(JSON.stringify(raw()))!;
    expect(r).not.toBeNull();
    expect([r.day, r.sentAt]).toEqual(["2026-11-20", "2026-11-20 20:00"]);
    expect(r.history).toEqual({ from: "2026-04-01", to: "2026-11-20", days: 220 });
    expect(r.recent.mode).toEqual({ days: 7, count: 23 });
    expect([r.recent.avg, r.recent.median, r.recent.revisits]).toEqual([11.3, 8, 96]);
    expect(r.past!.top).toHaveLength(7);
    expect(r.past!.top[0]).toEqual({ rank: 1, days: 7, count: 82 });
    expect(r.event!.top[0]).toEqual({ rank: 1, days: 6, count: 21 });
    expect([r.event!.from, r.event!.end, r.event!.started]).toEqual(["2026-10-26", "2027-02-28", true]);
  });

  it("모양이 틀리면 null (틀린 숫자를 보여 주지 않음)", () => {
    expect(parseDeskRevisit("{")).toBeNull();
    expect(parseDeskRevisit(JSON.stringify({ ...raw(), type: "astanakiz-live" }))).toBeNull();
    expect(parseDeskRevisit(JSON.stringify({ ...raw(), v: 2 }))).toBeNull();
    expect(parseDeskRevisit(JSON.stringify({ ...raw(), day: "11/20" }))).toBeNull();
    expect(parseDeskRevisit(JSON.stringify({ ...raw(), recent: null }))).toBeNull();
  });

  it("이상한 칸은 걸러냄 — 7개까지 · 음수 · 0명 · 소수 일수 · 손님 같은 글 없음", () => {
    const x = raw();
    x.past.top = [...x.past.top, { days: 40, count: 1 }, { days: 50, count: 1 }];
    x.event.top = [{ days: -3, count: 5 }, { days: 2.5, count: 4 }, { days: 9, count: 0 }, { days: 6, count: 21 }, { days: 1, count: "많이" }];
    x.event.name = "010-1234-5678";
    const r = parseDeskRevisit(x)!;
    expect(r.past!.top).toHaveLength(7);
    expect(r.event!.top).toEqual([{ rank: 1, days: 6, count: 21 }]);
    expect(JSON.stringify(r)).not.toContain("010");
  });

  it("이벤트 시작 전 · 이벤트를 안 정함 · 과거만", () => {
    const before = parseDeskRevisit({ ...raw(), event: { from: "2026-10-26", to: "2026-10-26", end: "2027-02-28", revisits: 0, people: 0, top: [], started: false } })!;
    expect(before.event!.started).toBe(false);
    const none = parseDeskRevisit({ ...raw(), event: null })!;
    expect(none.event).toBeNull();
    expect(revisitRows(none).every((x) => x.right == null)).toBe(true);
  });

  it("한 줄 요약 · 좌우 줄 (과거 · 이벤트 순위를 나란히, 짧은 쪽은 빈칸)", () => {
    const r = parseDeskRevisit(raw())!;
    expect(revisitSummary(r.recent)).toBe("가장 많은 7일 (23명) · 평균 11.3일 · 가운데 8일 · 재방문 96명");
    expect(revisitSummary({ ...r.recent, mode: null, avg: null, median: null, revisits: 0 })).toBe("아직 재방문 없음");
    const rows = revisitRows({ ...r, event: { ...r.event!, top: r.event!.top.slice(0, 3) } });
    expect(rows).toHaveLength(7);
    expect(rows[0].left).toEqual({ rank: 1, days: 7, count: 82 });
    expect(rows[2].right).toEqual({ rank: 3, days: 14, count: 12 });
    expect(rows[3].right).toBeNull();
  });
});
