import { describe, expect, it } from "vitest";
import { parseDeskRevisit, REVISIT_MONTH_MIN_DAYS, revisitByDays, revisitRows, revisitStats, revisitSummary } from "../src";
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

  it("보여 줄 때는 빨리 온 순(일수 짧은 순) — 많은 7개는 그대로 고르고 순서만 (2026-10-21 사장님) · 가장 많은 것(1위) 표시는 남김", () => {
    const top = [
      { rank: 1, days: 7, count: 18 }, { rank: 2, days: 14, count: 14 }, { rank: 3, days: 6, count: 13 }, { rank: 4, days: 12, count: 12 },
      { rank: 5, days: 1, count: 9 }, { rank: 6, days: 9, count: 9 }, { rank: 7, days: 2, count: 8 },
    ];
    const by = revisitByDays(top);
    expect(by.map((t) => t.days)).toEqual([1, 2, 6, 7, 9, 12, 14]);
    expect(by.find((t) => t.days === 7)!.rank).toBe(1);
    expect(top[0].days).toBe(7); // 받은 목록은 그대로
    expect(revisitByDays([])).toEqual([]);
  });
});

/* 아래 칸 — 월 평균 재방문 수 · 재방문자 비율 (2026-10-23 사장님 — 왼쪽 과거 4월 ~ 10월 · 오른쪽 이벤트 11월 ~ 5월) */
describe("재방문 간격 아래 칸 — 월 평균 재방문 수 · 재방문자 비율", () => {
  it("그 기간에 온 손님 수(visitors)를 받음 — 옛 판(칸 없음) · 이상한 값 · 재방문한 손님보다 적으면 null (틀린 비율을 보여 주지 않음)", () => {
    const r = parseDeskRevisit(raw())!;
    expect([r.past!.visitors, r.event!.visitors]).toEqual([1640, 412]);
    const x = raw();
    delete x.past.visitors;
    x.event.visitors = 30; // 재방문한 손님(58명)보다 적음
    const y = parseDeskRevisit(x)!;
    expect([y.past!.visitors, y.event!.visitors]).toEqual([null, null]);
    const z = raw();
    z.past.visitors = 1640.5;
    expect(parseDeskRevisit(z)!.past!.visitors).toBeNull();
  });

  it("월 평균 = 재방문 수 ÷ (모인 일수 ÷ 30.44) · 재방문자 비율 = 다시 온 손님 ÷ 그 기간에 온 손님 (소수 한 자리 %)", () => {
    const r = parseDeskRevisit(raw())!;
    // 과거 4/1 ~ 10/25 = 208일 → 512 ÷ 6.83달 ≈ 75번 · 301 ÷ 1640 = 18.4%
    expect(revisitStats(r.past!, r.history)).toEqual({ from: "2026-04-01", to: "2026-10-25", days: 208, revisits: 512, perMonth: 75, rate: 18.4 });
  });

  it("통합데스크가 지난 방문 기록을 아직 다 안 읽었으면 읽은 날부터만 셈 (기간 표시도 그 날부터)", () => {
    const x = raw();
    x.history = { from: "2026-09-12", to: "2026-10-23", days: 42 };
    x.past.to = "2026-10-23";
    x.past.revisits = 190;
    const r = parseDeskRevisit(x)!;
    const s = revisitStats(r.past!, r.history);
    expect([s.from, s.to, s.days, s.perMonth]).toEqual(["2026-09-12", "2026-10-23", 42, 138]);
  });

  it(`${REVISIT_MONTH_MIN_DAYS}일이 안 모였으면 월 평균을 내지 않음 (부풀린 숫자 대신 지금까지 수와 일수)`, () => {
    expect(REVISIT_MONTH_MIN_DAYS).toBe(30);
    const r = parseDeskRevisit(raw())!;
    // 이벤트 10/26 ~ 11/20 = 26일
    expect(revisitStats(r.event!, r.history)).toEqual({ from: "2026-10-26", to: "2026-11-20", days: 26, revisits: 74, perMonth: null, rate: 14.1 });
  });

  it("그 기간에 온 손님 수가 없으면(옛 판) 비율은 null · 방문 기록이 기간 뒤에 시작하면 0일", () => {
    const x = raw();
    delete x.past.visitors;
    const r = parseDeskRevisit(x)!;
    expect(revisitStats(r.past!, r.history).rate).toBeNull();
    const s = revisitStats(r.past!, { from: "2026-11-01", to: "2026-11-20", days: 20 });
    expect([s.days, s.perMonth]).toEqual([0, null]);
  });
});
