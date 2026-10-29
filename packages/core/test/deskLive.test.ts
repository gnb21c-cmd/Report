import { describe, expect, it } from "vitest";
import { applySettings, deskLiveAgeMin, deskLiveSales, deskLiveSlotNow, kidsOverPaid, parseDeskLive, type DayReport, type DeskLive } from "../src";
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
    // 초과요금 결제는 통합데스크 숫자(over.paid)가 아니라 POS '퇴장시간 … 지연' 결제로 (2026-10-25 — 데스크는 POS 결제 없이도 4건 25,000원을 보냄)
    const s = deskLiveSales(l);
    expect(s.kind).toBe("휴일"); // 2026-10-05 대체공휴일
    expect([s.tickets, s.price, s.fee, s.over, s.overCount, s.total]).toEqual([39, 14000, 546000, null, null, 546000]);
    expect(s.due).toBe(l.over.due);
    const p = deskLiveSales(l, { count: 2, amount: 25000 });
    expect([p.over, p.overCount, p.total]).toEqual([25000, 2, 571000]);
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

describe("초과요금 결제 — POS 기준 (2026-10-25 사장님: 10월 지연 결제는 10-24 세 건뿐인데 데스크는 날마다 4건 25,000원)", () => {
  const kids = (products: [string, string, number, number][]): DayReport =>
    ({ date: "2026-10-24", kids: { products } } as unknown as DayReport);
  it("키즈 POS 의 '퇴장시간 + ○○분 지연' 상품만 — 건수 · 금액", () => {
    const r = kids([
      ["[휴일] 1시간 50분 입장권", "현장결제", 16, 224000],
      ["퇴장시간 + 40~49분 지연", "기타", 1, 20000],
      ["퇴장시간 + 30~39분 지연", "기타", 1, 15000],
      ["퇴장시간 + 10~19분 지연", "기타", 1, 5000],
      ["초코우유", "기타", 3, 6000],
    ]);
    expect(kidsOverPaid(r)).toEqual({ count: 3, amount: 40000 });
  });
  it("지연 상품이 없으면 0건 · 키즈 POS 자료가 없으면 null (모름)", () => {
    expect(kidsOverPaid(kids([["[휴일] 1시간 50분 입장권", "현장결제", 9, 126000]]))).toEqual({ count: 0, amount: 0 });
    expect(kidsOverPaid({ date: "2026-10-25" } as DayReport)).toBeNull();
    expect(kidsOverPaid(undefined)).toBeNull();
  });
});

describe("키즈 실시간 네 칸 (2026-10-27 사장님): 네이버 · 현장입장 · 재방문성공 · 이벤트", () => {
  it("이벤트 입장 수 · 재방문 성공(오늘 · 누적 · 날마다) — 옛 판은 0 · null", () => {
    const l = parseDeskLive(JSON.stringify({ ...raw(), walk: { tickets: 2, extra: 0, service: 0, event: 3 }, revisit: { from: "2026-10-26", today: 2, total: 43, days: { "2026-10-27": 2 } } }))!;
    expect(l.walk.event).toBe(3);
    expect(l.revisit).toEqual({ from: "2026-10-26", today: 2, total: 43, days: { "2026-10-27": 2 } });
    const old = raw();
    delete old.revisit;
    delete old.walk.event;
    const o = parseDeskLive(JSON.stringify(old))!;
    expect([o.walk.event, o.revisit]).toEqual([0, null]);
  });
});

describe("재방문성공을 누르면 — 오늘 재방문 손님 이름 · 며칠 만에 왔는지 (2026-10-29 사장님)", () => {
  const withWho = (who: unknown) => parseDeskLive(JSON.stringify({ ...raw(), revisit: { from: "2026-10-26", today: 2, total: 2, days: {}, who } }))!;
  it("이름 · 앞 방문 날 · 며칠 만에 · 시각 — 최근 손님이 위", () => {
    const day = raw().day as string;
    const l = withWho([
      { name: "김하늘", prev: "2026-09-20", gap: 15, at: "11:05" },
      { name: "박바다", prev: "2026-09-28", at: "14:30" },
    ]);
    expect(l.revisit!.who).toEqual([
      // 며칠 만에가 없으면 앞 방문 날로 셈 (현황 글의 날 − 앞 방문 날)
      { name: "박바다", prev: "2026-09-28", gap: Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse("2026-09-28T00:00:00Z")) / 864e5), at: "14:30" },
      { name: "김하늘", prev: "2026-09-20", gap: 15, at: "11:05" },
    ]);
  });
  it("이상한 줄은 뺌 — 이름이 없거나 전화번호처럼 숫자가 많음 · 날 · 며칠 · 시각이 이상하면 그 칸만 비움", () => {
    const l = withWho([
      { name: "", gap: 3 },
      { name: "010-1234-5678", gap: 3 },
      { name: "이구름", prev: "어제", gap: -2, at: "25:99" },
      "아무거나",
    ]);
    expect(l.revisit!.who).toEqual([{ name: "이구름", prev: null, gap: null, at: null }]);
  });
  it("통합데스크가 아직 안 보내면(옛 판) 없음 · 너무 많으면 100명까지", () => {
    expect(parseDeskLive(JSON.stringify({ ...raw(), revisit: { from: "2026-10-26", today: 0, total: 0, days: {} } }))!.revisit!.who).toBeUndefined();
    const many = Array.from({ length: 150 }, (_, i) => ({ name: `손님${String.fromCharCode(44032 + i)}`, gap: 10 }));
    expect(withWho(many).revisit!.who).toHaveLength(100);
  });
});
