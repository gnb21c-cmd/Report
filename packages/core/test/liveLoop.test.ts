import { describe, expect, it } from "vitest";
import { kstMinutes, LIVE_EVERY_MIN, LIVE_LOOP_END, liveLoopStep, liveSlotBy, liveSlots, naverAskTodo, NAVER_ASK_MAX_H } from "../src";

const m = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const END = m(LIVE_LOOP_END);

describe("하루 실시간 수집 시간표 — 10:00 ~ 22:45, 15분마다 매시 0 · 15 · 30 · 45분 (2026-10-19 사장님)", () => {
  it("받을 칸 52개 · 첫 칸 10:00 · 마지막 22:45 · 끝 22:50", () => {
    const s = liveSlots();
    expect(LIVE_EVERY_MIN).toBe(15);
    expect(s.length).toBe(52);
    expect(s[0]).toBe(m("10:00"));
    expect(s[s.length - 1]).toBe(m("22:45"));
    expect(s.every((x) => x % 15 === 0)).toBe(true);
    expect(LIVE_LOOP_END).toBe("22:50");
  });

  it("아침에 일찍 켜지면 10:00 까지 기다렸다가 10:00 에 바로 받음", () => {
    expect(liveLoopStep(m("09:40"), null, END)).toEqual({ act: "wait", slot: m("10:00") });
    expect(liveLoopStep(m("10:00"), null, END)).toEqual({ act: "run", slot: m("10:00") });
    expect(liveLoopStep(m("10:00") + 0.01, null, END)).toEqual({ act: "run", slot: m("10:00") });
  });

  it("받은 뒤에는 다음 칸(15분 뒤)까지 기다림 — 늦게 끝났으면 바로", () => {
    expect(liveLoopStep(m("10:01") + 0.5, m("10:00"), END)).toEqual({ act: "wait", slot: m("10:15") });
    expect(liveLoopStep(m("10:15"), m("10:00"), END)).toEqual({ act: "run", slot: m("10:15") });
    // 네이버 다시 확인을 하느라 10:17 에 돌아옴 → 10:15 칸을 바로
    expect(liveLoopStep(m("10:17"), m("10:00"), END)).toEqual({ act: "run", slot: m("10:15") });
  });

  it("다시 켜졌을 때(PC 를 다시 켬 · 비켜 줬다 돌아옴) 지난 칸을 못 받았으면 바로 — 받은 칸이면 다음 칸까지", () => {
    expect(liveLoopStep(m("18:40"), m("18:15"), END)).toEqual({ act: "run", slot: m("18:30") });
    expect(liveLoopStep(m("18:40"), m("18:30"), END)).toEqual({ act: "wait", slot: m("18:45") });
    // 여러 칸을 놓쳤으면 가장 최근 칸 하나만 (지난 칸을 몰아서 받지 않음)
    expect(liveLoopStep(m("18:50"), m("18:00"), END)).toEqual({ act: "run", slot: m("18:45") });
  });

  it("마지막 22:45 칸을 받으면 끝 · 22:50 이 지나면 끝", () => {
    expect(liveLoopStep(m("22:46"), m("22:30"), END)).toEqual({ act: "run", slot: m("22:45") });
    expect(liveLoopStep(m("22:47"), m("22:45"), END)).toEqual({ act: "end" });
    expect(liveLoopStep(m("22:50"), m("22:30"), END)).toEqual({ act: "end" });
    expect(liveLoopStep(m("23:30"), null, END)).toEqual({ act: "end" });
  });

  it("끝 시각을 앞당기면(시험) 그 전 칸까지만", () => {
    expect(liveLoopStep(m("18:50"), m("18:45"), m("19:00"))).toEqual({ act: "end" });
    expect(liveLoopStep(m("18:50"), m("18:45"), m("19:01"))).toEqual({ act: "wait", slot: m("19:00") });
  });
});

describe("이미 받은 칸 — 클라우드 live 문서의 받은 시각(at)으로", () => {
  it("한국 시간 · 분(소수)", () => {
    expect(kstMinutes(new Date("2026-10-19T10:15:30+09:00"))).toBe(m("10:15") + 0.5);
  });
  it("받은 시각이 들어 있는 칸 (예전 방식처럼 늦게 받았어도 그 칸)", () => {
    expect(liveSlotBy("2026-10-19T01:01:30.000Z", "2026-10-19")).toBe(m("10:00"));
    expect(liveSlotBy("2026-10-19T09:47:10.000Z", "2026-10-19")).toBe(m("18:45"));
    expect(liveSlotBy("2026-10-19T01:23:00.000Z", "2026-10-19")).toBe(m("10:15"));
  });
  it("다른 날 · 10:00 전 · 없음 → 받은 칸 없음", () => {
    expect(liveSlotBy("2026-10-18T13:47:00.000Z", "2026-10-19")).toBe(null);
    expect(liveSlotBy("2026-10-19T00:59:00.000Z", "2026-10-19")).toBe(null);
    expect(liveSlotBy(undefined, "2026-10-19")).toBe(null);
    expect(liveSlotBy("이상한 값", "2026-10-19")).toBe(null);
  });
});

describe("A [신규 다시 확인] — 아직 맡지 않은 요청인지 (실시간 수집 · naver-ask.yml 같은 판단)", () => {
  const now = Date.parse("2026-10-19T03:00:00.000Z");
  const ask = { at: "2026-10-19T02:58:00.000Z", by: "매니저" };
  it("요청이 없으면 아님", () => {
    expect(naverAskTodo(null, null, now)).toBe(false);
    expect(naverAskTodo({ at: "", by: "" }, null, now)).toBe(false);
  });
  it("결과가 없거나 다른(지난) 요청 것이면 맡음", () => {
    expect(naverAskTodo(ask, null, now)).toBe(true);
    expect(naverAskTodo(ask, { ask: "2026-10-18T02:00:00.000Z", state: "done", at: "2026-10-18T02:05:00.000Z" }, now)).toBe(true);
  });
  it("이미 맡은 요청(하는 중 · 끝)이면 아님", () => {
    expect(naverAskTodo(ask, { ask: ask.at, state: "run", at: "2026-10-19T02:59:00.000Z" }, now)).toBe(false);
    expect(naverAskTodo(ask, { ask: ask.at, state: "done", at: "2026-10-19T03:02:00.000Z" }, now)).toBe(false);
  });
  it("6시간 넘은 요청은 건너뜀", () => {
    expect(NAVER_ASK_MAX_H).toBe(6);
    expect(naverAskTodo({ at: "2026-10-18T20:59:00.000Z", by: "매니저" }, null, now)).toBe(false);
    expect(naverAskTodo({ at: "2026-10-18T21:01:00.000Z", by: "매니저" }, null, now)).toBe(true);
  });
});

describe("스스로 이어 가기 (2026-10-27) — GitHub 예약이 몇 시간씩 늦거나 빠져도 POS 메인 PC 가 다음 날 아침 수집 · 하루 수집을 시작", async () => {
  const { LIVE_MORNING_KICK, liveLoopMode, morningJobs } = await import("../src");
  it("끝 시각 뒤 · 아침 09:27 전은 밤 대기, 그 사이는 하루 수집", () => {
    expect(LIVE_MORNING_KICK).toBe("09:27");
    expect(liveLoopMode(m("22:50"), END)).toBe("night");
    expect(liveLoopMode(m("23:59"), END)).toBe("night");
    expect(liveLoopMode(m("00:00"), END)).toBe("night");
    expect(liveLoopMode(m("09:26"), END)).toBe("night");
    expect(liveLoopMode(m("09:27"), END)).toBe("day");
    expect(liveLoopMode(m("14:05"), END)).toBe("day");
    expect(liveLoopMode(m("22:49"), END)).toBe("day");
  });

  it("아침에 시작시킬 일 — 오늘 아직 한 번도 안 돈 것만 (자판기 · 네컷 · 주차 / POS 확정은 어제 날짜 / 네이버)", () => {
    expect(morningJobs("2026-10-27")).toEqual([
      { file: "extra-collect.yml", inputs: {} },
      { file: "pos-collect.yml", inputs: { date: "2026-10-26" } },
      { file: "naver-collect.yml", inputs: {} },
    ]);
    expect(morningJobs("2026-11-01")[1].inputs).toEqual({ date: "2026-10-31" });
  });
});
