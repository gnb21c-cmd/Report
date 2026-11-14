import { describe, expect, it } from "vitest";
import {
  addDays,
  describe as desc,
  kaplanMeier,
  logRank,
  mannWhitney,
  parseRevisitStudy,
  parseVisitHistory,
  personalOE,
  revisitStudy,
  STUDY_DEADLINE,
  STUDY_TYPE,
  type Obs,
} from "../src";

/* 2026-11-14 사장님 — 키즈 돈까스 재방문 이벤트 분석 (지어낸 방문 기록 — 손님 해시도 지어낸 것)
   이벤트 10-26 부터 · 방문 뒤 20일(그날 포함) 안에 다시 오면 돈까스 = 다음 방문까지 19일 안 */

const END = "2026-11-14";
/** 손님 i — 평소 간격 30일(60%) · 10일(40%), effect 면 이벤트 때 30일 손님은 12일 · 10일 손님은 8일 만에 다시 옴 */
function history(effect: boolean) {
  const days: Record<string, { src: string; k: string[]; c: Record<string, [number, number, string]> }> = {};
  for (let i = 0; i < 240; i++) {
    const h = `h${String(i).padStart(6, "0")}`;
    const slow = i % 5 < 3;
    const gapPre = slow ? 30 : 10;
    const gapEv = effect ? (slow ? 12 : 8) : gapPre;
    let d = addDays("2026-06-01", i % 30);
    let first = true;
    while (d <= END) {
      const e = (days[d] ??= { src: "naver", k: [], c: {} });
      e.k.push(h);
      // 첫 방문 날 카드 '완료 n' = 앞 이용(짝수 손님 0 = 신규, 홀수 3 = 기존) + 그날 1
      if (first) e.c[h] = [i % 2 ? 4 : 1, 1, d];
      first = false;
      d = addDays(d, d < "2026-10-26" ? gapPre : gapEv);
    }
  }
  return { v: 1, days };
}

describe("방문 기록 읽기", () => {
  it("손님별 방문 · 기간 · 신규/기존 (카드 '완료 n' − 그 뒤 이용 = 첫 방문 앞 이용)", () => {
    const d = parseVisitHistory(JSON.stringify(history(false)))!;
    expect(d.from).toBe("2026-06-01");
    expect(d.to).toBe(END);
    expect(d.visits.size).toBe(240);
    expect(d.kind.get("h000000")).toBe("new");
    expect(d.kind.get("h000001")).toBe("old");
  });

  it("모양이 틀리면 null · 이상한 해시는 버림", () => {
    expect(parseVisitHistory(null)).toBeNull();
    expect(parseVisitHistory("{깨짐")).toBeNull();
    expect(parseVisitHistory({ v: 2, days: {} })).toBeNull();
    const d = parseVisitHistory({ v: 1, days: { "2026-11-01": { k: ["abcdef1234", "이름 홍길동", 5] } } })!;
    expect([...d.visits.keys()]).toEqual(["abcdef1234"]);
    expect(d.kind.get("abcdef1234")).toBe("unknown");
  });
});

describe("통계 도구", () => {
  it("Kaplan–Meier — 다시 안 온 손님(중도절단)도 빼지 않고 셈", () => {
    // 4명: 2일 · 5일에 다시 옴, 3일 · 7일까지 지켜봤는데 아직 안 옴
    const o: Obs[] = [
      { t: 2, event: true, s: "a" },
      { t: 3, event: false, s: "a" },
      { t: 5, event: true, s: "a" },
      { t: 7, event: false, s: "a" },
    ];
    const km = kaplanMeier(o, 7);
    expect(km.F[1]).toBeCloseTo(0.25, 6); // 2일: 4명 중 1
    expect(km.F[4]).toBeCloseTo(1 - 0.75 * 0.5, 6); // 5일: 남은 2명 중 1
    expect(km.atRisk[4]).toBe(2);
  });

  it("로그순위 · 위험비 — 빨리 다시 오는 무리가 > 1 · 같으면 1 근처", () => {
    const fast: Obs[] = Array.from({ length: 50 }, (_, i) => ({ t: 3 + (i % 5), event: true, s: "x" }));
    const slow: Obs[] = Array.from({ length: 50 }, (_, i) => ({ t: 10 + (i % 8), event: i % 3 > 0, s: "x" }));
    const lr = logRank(fast, slow, 19);
    expect(lr.hr).toBeGreaterThan(1);
    expect(lr.p).toBeLessThan(0.01);
    expect(
      logRank(
        fast,
        fast.map((o) => ({ ...o })),
        19,
      ).hr,
    ).toBeCloseTo(1, 6);
  });

  it("평균 · 표준편차 · 분산 · 가운데 값 · 왜도 (오른쪽 꼬리면 양수)", () => {
    const d = desc([7, 7, 7, 14, 14, 21, 28, 60, 90]);
    expect(d.n).toBe(9);
    expect(d.median).toBe(14);
    expect(d.mean).toBeCloseTo(27.6, 1);
    expect(Math.abs(d.variance - d.sd * d.sd)).toBeLessThan(2); // 둘 다 소수 한 자리로 반올림
    expect(d.skew).toBeGreaterThan(1);
  });

  it("맨–휘트니 — 확실히 다르면 p 작음 · 같으면 1", () => {
    expect(mannWhitney([1, 2, 3, 4, 5, 6], [10, 11, 12, 13, 14, 15]).p).toBeLessThan(0.01);
    expect(mannWhitney([1, 2, 3], [1, 2, 3]).p).toBe(1);
  });
});

describe("한데 모은 분석 — 효과가 있을 때 · 없을 때", () => {
  const on = revisitStudy(parseVisitHistory(history(true))!, "2026-11-14T12:00:00Z");
  const off = revisitStudy(parseVisitHistory(history(false))!, "2026-11-14T12:00:00Z");

  it("요약에는 손님 해시가 없음 · 저장 모양 검사 통과", () => {
    const s = JSON.stringify(on);
    expect(s).not.toMatch(/h0000/);
    expect(on.type).toBe(STUDY_TYPE);
    expect(parseRevisitStudy(s)).not.toBeNull();
    expect(on.event).toEqual({ from: "2026-10-26", deadline: STUDY_DEADLINE });
    expect(on.data).toMatchObject({ customers: 240, kinds: { new: 120, old: 120, unknown: 0 } });
    expect(on.cohorts.map((c) => c.key)).toEqual(["event", "near", "autumn", "all"]);
  });

  it("효과가 있으면 — 14일 안 재방문 비율이 오르고 위험비 > 1 · 같은 손님 평소보다 많이", () => {
    const ev = on.cohorts[0],
      near = on.cohorts[1];
    expect(ev.at[14].p).toBeGreaterThan(near.at[14].p);
    const c = on.compare.find((x) => x.base === "autumn")!;
    expect(c.hr).toBeGreaterThan(1);
    expect(c.p).toBeLessThan(0.05);
    expect(c.diff[14].d).toBeGreaterThan(0);
    expect(on.paired.h14!.ratio).toBeGreaterThan(1.3);
    expect(on.paired.h14!.p).toBeLessThan(0.05);
  });

  it("효과가 없으면 — 같은 손님 평소와 비슷 (관측 ÷ 기대 ≈ 1)", () => {
    expect(off.paired.h14!.ratio).toBeGreaterThan(0.8);
    expect(off.paired.h14!.ratio).toBeLessThan(1.2);
    // 평소 7일 안에 다시 온 적이 아무도 없으면 기대가 0 이라 견줄 수 없음 → null (화면에 "견줄 수 없음")
    expect(personalOE(parseVisitHistory(history(false))!, 7)).toBeNull();
  });

  it("간격 — 이벤트 기간은 짧은 간격만 보여 평균이 저절로 짧음 → 같은 길이 직전 기간과 견주면 차이 없음", () => {
    expect(off.gaps.event.mean).toBeLessThan(off.gaps.pre.mean);
    expect(off.gaps.pre.n).toBeGreaterThan(0);
    // 효과가 없으면 같은 길이 기간끼리는 평균도 같고 순위 견줌도 차이 없음
    expect(off.gaps.near.n).toBeGreaterThan(0);
    expect(off.gaps.near.mean).toBeCloseTo(off.gaps.event.mean, 0);
    expect(off.gaps.mw.p).toBeGreaterThan(0.05);
    // 효과가 있으면 이벤트 간격이 짧고 순위 견줌도 차이
    expect(on.gaps.event.mean).toBeLessThan(on.gaps.near.mean);
    expect(on.gaps.mw.p).toBeLessThan(0.05);
  });
});
