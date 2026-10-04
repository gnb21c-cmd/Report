import { describe, expect, it } from "vitest";
import { addDays, Board, dayRange, HOURS, sectorAnalysis, type DayReport, type DayWeather, type NaverPart, type StorePart } from "../src";

/* 시간 칸: HOURS = 10 ~ 21시 (12칸) */
const H = (f: (h: number) => number) => HOURS.map(f);

interface Day {
  bar?: number; // 바리스타 하루 (시간마다 고르게)
  bread?: number; // 정가 빵 개수 (개당 4,000원, 10~20시 고르게)
  half?: number | null; // 50% 할인 개수 (20~21시)
  kitchen?: number;
  kitchenEvent?: number; // 그중 19시 이후
  cups?: number;
  eveningOther?: number; // 20시 이후 바리스타
  kidsDay?: number; // 낮 현장 입장
  kidsNight?: number; // 18시 이후 네이버 입장
}

function report(date: string, o: Day = {}): DayReport {
  const bar = o.bar ?? 600000;
  const bread = o.bread ?? 100;
  const half = o.half === undefined ? 20 : o.half;
  const kitchen = o.kitchen ?? 300000;
  const kEvent = o.kitchenEvent ?? 30000;
  const eveningOther = o.eveningOther ?? 40000;
  const barH = H((h) => (h >= 20 ? eveningOther / 2 : (bar - eveningOther) / 10));
  const breadH = H((h) => (h < 20 ? (bread * 4000) / 10 : h === 20 ? (half ?? 0) * 2000 : 0));
  const kitH = H((h) => (h >= 19 && h < 21 ? kEvent / 2 : h >= 11 && h < 19 ? (kitchen - kEvent) / 8 : 0));
  const sectors = { 바리스타: bar, 베이커리: bread * 4000 + (half ?? 0) * 2000, 키친: kitchen, 기타: 0 };
  const cafe: StorePart = {
    v: 1,
    store: "cafe",
    date,
    basis: "receipt",
    file: "t.xls",
    sheetNet: 0,
    posNet: 0,
    voucher: 0,
    ...(half == null ? {} : { bakeryHalf: half }),
    sectors,
    cups: o.cups ?? 200,
    teams: 0,
    teamSizes: [0, 0, 0, 0, 0, 0],
    hourly: { sectors: { 바리스타: barH, 베이커리: breadH, 키친: kitH, 기타: H(() => 0) }, cups: H(() => 0), teams: H(() => 0) },
    products: [["소금빵", "베이커리", bread + (half ?? 0), sectors.베이커리]],
    refunds: { receipts: 0, lines: 0, unmatched: 0, amount: 0 },
    kids: null,
  };
  const kidsDay = o.kidsDay ?? 60;
  const kidsNight = o.kidsNight ?? 20;
  const kids: StorePart = {
    ...cafe,
    store: "kids",
    sectors: { 바리스타: 0, 베이커리: 0, 키친: 0, 기타: 0 },
    products: [],
    bakeryHalf: undefined,
    hourly: null,
    kids: { issued: kidsNight, walkIn: kidsDay, walkInNet: kidsDay * 12000, eventFree: 0, other: 0, hourly: { issued: H(() => 0), walkIn: H((h) => (h >= 10 && h < 16 ? kidsDay / 6 : 0)), eventFree: H(() => 0), other: H(() => 0) } },
  };
  // 네이버 30분 칸 10:00 ~ 19:30 — 18:00 · 18:30 칸에 저녁 입장
  const naver: NaverPart = { v: 1, date, tickets: Array.from({ length: 20 }, (_, i) => (i === 16 || i === 17 ? kidsNight / 2 : 0)), newVisitors: Array(20).fill(0) };
  return { date, cafe, kids, naver };
}

const D = "2026-10-21"; // 수요일 (앞 4주 수요일에 공휴일 없음)
function board(change: (d: string) => Day = () => ({}), from = addDays(D, -70)) {
  return new Board(dayRange(from, D).map((d) => report(d, change(d))));
}
const text = (b: Board, box: Parameters<typeof sectorAnalysis>[2], w = {}) =>
  sectorAnalysis(b, D, box, w)
    .flatMap((s) => [s.title, ...s.lines])
    .join("\n");

describe("섹터 분석 — 판단 · 이유", () => {
  it("평소와 같으면 '평소 수준'이고 이유 칸은 없음", () => {
    const t = text(board(), "바리스타");
    expect(t).toContain("평소 수준");
    expect(t).not.toContain("달라진 이유");
  });

  it("손님 수가 줄어 생긴 차이인지, 1인당 소비가 달라 생긴 차이인지 가름", () => {
    const fewer = text(board((d) => (d === D ? { bar: 450000, cups: 150 } : {})), "바리스타");
    expect(fewer).toContain("평소보다 적음");
    expect(fewer).toContain("차이의 대부분은 손님 수");
    const spend = text(board((d) => (d === D ? { bar: 800000 } : {})), "바리스타");
    expect(spend).toContain("차이의 대부분은 1인당 소비");
  });

  it("날씨 — 비 오는 날 늘었으면 날씨가 한몫, 쾌적한 날 늘었으면 날씨로는 설명 안 됨", () => {
    const W = (key: DayWeather["key"], rainMm: number, tempMax = 20): DayWeather => ({ date: D, key, label: "", icon: "", tempMax, tempMin: 10, rainMm, source: "observed" });
    const base: Record<string, DayWeather> = Object.fromEntries([1, 2, 3, 4].map((w) => [addDays(D, -7 * w), { ...W("cloudy" as DayWeather["key"], 0, 12), date: addDays(D, -7 * w) }]));
    const up = board((d) => (d === D ? { bar: 800000, cups: 260 } : {}));
    expect(text(up, "바리스타", { ...base, [D]: W("rain", 5) })).toContain("날씨가 한몫");
    expect(text(up, "바리스타", { ...base, [D]: W("sunny" as DayWeather["key"], 0, 22) })).toContain("날씨로는 설명되지 않는");
  });
});

describe("섹터 분석 — 흐름", () => {
  it("8주 동안 오르다 최근 4주 내림 → 꺾였다고 말함", () => {
    // 주 번호(마감일 = 0, 7주 전 = 7): 7~4주 전은 올라가고, 3주 전부터 내려감
    const k = (d: string) => {
      const w = Math.floor((Date.parse(D) - Date.parse(d)) / (7 * 864e5));
      const f = w >= 4 ? 1 + (7 - w) * 0.08 : 1.24 - (4 - w) * 0.08;
      return { bar: Math.round(600000 * f) };
    };
    expect(text(board(k), "바리스타")).toContain("하락으로 꺾였습니다");
  });

  it("하루만 튄 날은 '하루 반짝'", () => {
    expect(text(board((d) => (d === D ? { bar: 900000 } : {})), "바리스타")).toContain("하루 반짝");
  });
});

describe("섹터 분석 — 베이커리", () => {
  it("손님은 평소만큼인데 정가 빵이 적고 할인 · 저녁 빵이 없으면 → 일찍 매진, 놓친 판매", () => {
    const b = board((d) => (d === D ? { bread: 70, half: 0 } : {}));
    // 저녁(18~20시) 빵 매출도 없게 — 시간 칸을 직접 바꿈
    const r = b.report(D)!;
    r.cafe!.hourly!.sectors.베이커리 = H((h) => (h < 18 ? 28000 : 0));
    expect(text(new Board([...b.byDate.values()]), "베이커리")).toContain("기회를 놓친");
  });

  it("손님이 줄어 빵이 덜 팔린 날 → 빵 문제가 아니라 손님 감소", () => {
    expect(text(board((d) => (d === D ? { bread: 70, cups: 140, bar: 420000 } : {})), "베이커리")).toContain("손님이 적었던 영향");
  });

  it("할인 빵이 많고 키즈 18시 이후 입장도 많으면 → 키즈 손님이 집에 가며 산 빵", () => {
    expect(text(board((d) => (d === D ? { half: 40, kidsNight: 40 } : {})), "베이커리")).toContain("키즈 손님이 집에 가며");
  });

  it("할인 빵이 많은데 저녁 다른 소비가 적으면 → 할인 빵만 사러 온 손님", () => {
    expect(text(board((d) => (d === D ? { half: 40, eveningOther: 10000 } : {})), "베이커리")).toContain("할인 빵만 사러 온 손님");
  });

  it("할인 개수를 모르는 날은 빵 해석을 건너뜀", () => {
    expect(text(board((d) => (d === D ? { half: null } : {})), "베이커리")).toContain("빵 판매 해석은 건너뜁니다");
  });
});

describe("섹터 분석 — 키친 · 키즈", () => {
  it("키친 19시 이후 비중이 크면 할인 수요로 해석", () => {
    const t = text(board((d) => (d === D ? { kitchenEvent: 120000 } : {})), "키친");
    expect(t).toContain("19시 이후");
    expect(t).toContain("할인을 받겠다는 수요");
  });

  it("키즈 — 작년보다 유료 전환 뒤 수준(−12%)보다 더 떨어지면 이벤트 검토", () => {
    const lyFrom = addDays(addDays(D, -364), -40);
    const ly = (d: string) => d < "2026-01-01";
    // 작년 낮 100명, 올해 낮 60명 + 저녁 20명 = 80명 → 작년(100 + 20)보다 −33%
    const b = new Board([...dayRange(lyFrom, addDays(D, -300)).map((d) => report(d, { kidsDay: 100 })), ...dayRange(addDays(D, -70), D).map((d) => report(d, ly(d) ? { kidsDay: 100 } : {}))]);
    expect(text(b, "키즈입장료")).toContain("이벤트를 검토");
  });

  it("키즈 — 작년보다 약 12% 적은 수준이면 작년 흐름으로 다음 4주 전망", () => {
    const lyFrom = addDays(addDays(D, -364), -40);
    // 작년 91명(71 + 20) → 올해 80명 = 약 −12%
    const b = new Board([...dayRange(lyFrom, addDays(D, -300)).map((d) => report(d, { kidsDay: 71 })), ...dayRange(addDays(D, -70), D).map((d) => report(d))]);
    expect(text(b, "키즈입장료")).toContain("작년 흐름을 따라간다면 다음 4주");
  });

  it("키즈 — 17시대 입장이 적은 것은 구조라고 알림 · 다음 7일 비 예보는 실내 수요", () => {
    const W = (date: string): DayWeather => ({ date, key: "rain", label: "비", icon: "", tempMax: 18, tempMin: 12, rainMm: 6, source: "forecast" });
    const t = text(board(), "키즈입장료", { [addDays(D, 2)]: W(addDays(D, 2)) });
    expect(t).toContain("17시 · 17시 30분 입장이 적은 것은");
    expect(t).toContain("실내 놀이 수요가 늘 수 있습니다");
  });
});
