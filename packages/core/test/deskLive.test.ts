import { describe, expect, it } from "vitest";
import { applySettings, deskLiveAgeMin, deskLiveSales, deskLiveSlotNow, parseDeskLive, type DeskLive } from "../src";
import sample from "../../../apps/view/src/data/demoDeskLive.json";

/** 통합데스크 체험판(10/5 13:50)에서 만든 글 — 체험판 화면과 같은 것 */
const raw = () => JSON.parse(JSON.stringify(sample));

describe("키즈 실시간 — 통합데스크 현황 글 (2026-10-16 사장님)", () => {
  it("모양이 맞으면 받음 — 네이버 · 오늘 입장 · 열쇠 · 손님(이름 · 전화)", () => {
    const l = parseDeskLive(JSON.stringify(raw()))!;
    expect(l).not.toBeNull();
    expect(l.day).toBe("2026-10-05");
    expect(l.at).toBe("2026-10-05 13:50:00");
    expect([l.naver.done, l.naver.conf, l.naver.left]).toEqual([36, 32, 132]);
    expect(l.naver.slots).toHaveLength(20);
    expect(l.people).toEqual({ naver: 36, walk: 3, total: 39 });
    expect(l.walk.service).toBe(2);
    expect(l.keys.used).toBe(Object.keys(l.keys.map).length);
    expect(l.keys.used + l.keys.free).toBe(45);
    const k1 = l.keys.map[1];
    expect(k1.c).toBe("red");
    const h = l.keys.holders[k1.h];
    expect([h.kind, h.name, h.phone, h.keys]).toEqual(["n", "장시우", "01000000001", [1]]);
    expect(h.over).toBe(15000);
    const s = l.keys.holders[l.keys.map[40].h];
    expect([s.kind, s.of]).toEqual(["s", "6번 오유나님에게 추가 서비스 지급된 열쇠"]);
  });
  it("모양이 틀리면 null (틀린 숫자를 보여 주지 않음)", () => {
    expect(parseDeskLive("{")).toBeNull();
    expect(parseDeskLive(JSON.stringify({ ...raw(), type: "astanakiz-survey" }))).toBeNull();
    expect(parseDeskLive(JSON.stringify({ ...raw(), v: 2 }))).toBeNull();
    expect(parseDeskLive(JSON.stringify({ ...raw(), at: "2026-10-04 23:59:00" }))).toBeNull();
    expect(parseDeskLive(JSON.stringify({ ...raw(), keys: { map: {} } }))).toBeNull();
  });
  it("이상한 칸은 걸러냄 — 열쇠 번호 범위 · 손님 없는 번호 · 음수 · 전화는 숫자만", () => {
    const x = raw();
    x.keys.map["99"] = { c: "in", end: "15:00", h: 0 };
    x.keys.map["44"] = { c: "red", end: "15:00", h: 999 };
    x.keys.holders[0].phone = "010-0000-0001";
    x.people.total = -5;
    const l = parseDeskLive(x)!;
    expect(l.keys.map[99]).toBeUndefined();
    expect(l.keys.map[44]).toBeUndefined();
    expect(l.keys.holders[0].phone).toBe("01000000001");
    expect(l.people.total).toBe(0);
  });
  it("입장료 매출 = 입장권 장수 × 그날 단가 + 결제한 초과요금 (받을 초과요금은 따로)", () => {
    applySettings(null);
    const l = parseDeskLive(raw())!;
    l.over.paid = 10000;
    const s = deskLiveSales(l);
    expect(s.kind).toBe("휴일"); // 2026-10-05 대체공휴일
    expect([s.tickets, s.price, s.fee, s.over, s.total]).toEqual([39, 14000, 546000, 10000, 556000]);
    expect(s.due).toBe(l.over.due);
    const weekday = parseDeskLive({ ...raw(), day: "2026-10-16", at: "2026-10-16 14:00:00" })!;
    expect(deskLiveSales(weekday).price).toBe(12000);
  });
  it("몇 분 전 — 한국 시간 기준", () => {
    const l = { at: "2026-10-16 14:05:12" } as DeskLive;
    expect(deskLiveAgeMin(l, new Date("2026-10-16T05:05:40Z"))).toBe(0);
    expect(deskLiveAgeMin(l, new Date("2026-10-16T05:09:20Z"))).toBe(4);
  });
  it("지금 칸 — 시작 5분 전부터 그 칸", () => {
    const l = parseDeskLive(raw())!;
    expect(deskLiveSlotNow(l, "13:50")).toBe("13:30");
    expect(deskLiveSlotNow(l, "13:55")).toBe("14:00");
    expect(deskLiveSlotNow(l, "08:00")).toBeNull();
  });
});
