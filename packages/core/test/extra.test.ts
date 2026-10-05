import { describe, expect, it } from "vitest";
import { applyExtra, autoExtraKinds, Board, niceRange, EXTRA_AUTO_BY, extraTotal, extraUpdates, mergeExtra, parseNiceSheet } from "../src";

/** 나이스 '통합거래조회' 모양 (위 카드사별 합계 · 아래 건별) */
function sheet(lines: (string | number)[][], summary: number): unknown[][] {
  const H = ["번호", "CAT_ID", "확장번호", "상호", "구분", "거래일자", "거래시간", "금액", "나이스 일련번호", "HW식별번호"];
  return [
    ["통합거래조회"],
    ["거래기간 : 거래일시 - 20260701 00:00:00 ~ 20260702 23:59:59"],
    ["번호", "카드사명", "총건수", "매출건수", "매출금액"],
    [" ", "합계", "1", "1", summary.toLocaleString("en-US")],
    [],
    H,
    ...lines.map((l, i) => [String(i + 1), ...l]),
  ];
}

describe("POS 밖 매출 — 나이스 통합거래조회 (자판기 · 인생네컷 · 주차)", () => {
  const rows = sheet(
    [
      ["3974466", "001", "알파비전(주)(자판기)", "승인", "2026-07-01", "10:00:00", 2500, "a1", "SM-P100NI-V41001"],
      ["3974466", "001", "알파비전(주)(자판기)", "취소", "2026-07-01", "10:01:00", 2500, "a2", "SM-P100NI-V41001"],
      ["3974466", "001", "알파비전(주)(자판기)", "승인", "2026-07-01", "11:00:00", 1500, "a3", "SM-P100NI-V41001"],
      // 7/1 하루 카페 POS 가 같은 번호 — 카페 매출에 이미 있으므로 뺌
      ["3974466", "001", "알파비전(주)", "승인", "2026-07-01", "12:00:00", 26200, "a4", "TS-NC-RA00012601"],
      ["3974466", "001", "알파비전(주)(자판기)", "승인거절", "2026-07-01", "12:30:00", 2000, "a5", "SM-P100NI-V41001"],
      ["3974963", "001", "알파비전(주)(사진1)", "승인", "2026-07-01", "13:00:00", 4000, "b1", "NR"],
      ["3974964", "001", "알파비전(주)(사진2)", "승인", "2026-07-02", "13:00:00", 5000, "c1", "NR"],
      ["3974965", "001", "알파비전(주)(주차)", "승인", "2026-07-02", "01:00:00", 2000, "d1", "TDR"],
    ],
    2500 - 2500 + 1500 + 26200 + 4000 + 5000 + 2000,
  );
  it("승인 − 취소, 승인거절 · 카페 POS 결제는 뺌, 합계 줄과 맞음", () => {
    const s = parseNiceSheet(rows)!;
    expect(s.sum).toBe(s.summary);
    expect(s.cafePos).toBe(26200);
    expect(s.days.get("2026-07-01")).toEqual({ v: 1, date: "2026-07-01", vending: 1500, photo: 4000, parking: 0 });
    expect(s.days.get("2026-07-02")).toEqual({ v: 1, date: "2026-07-02", vending: 0, photo: 5000, parking: 2000 });
  });
  it("같은 파일을 두 번 넣어도 한 번만", () => {
    const s = parseNiceSheet(rows)!;
    const m = mergeExtra([s, s]);
    expect(extraTotal(m.get("2026-07-01"))).toBe(5500);
  });
  it("단말기별 파일 — 그 종류 · 그 기간만 바꾸고 다른 종류는 그대로 (건 없는 날은 0)", () => {
    const park = parseNiceSheet(
      sheet([["3974965", "001", "알파비전(주)(주차)", "승인", "2026-07-02", "01:00:00", 2000, "p1", "TDR"]], 2000),
    )!;
    expect(park.from).toBe("2026-07-01");
    expect(park.to).toBe("2026-07-02");
    expect(park.kinds).toEqual(["parking"]);
    const ups = extraUpdates([park]);
    expect(ups.map((u) => u.date)).toEqual(["2026-07-01", "2026-07-02"]);
    const old = { v: 1 as const, date: "2026-07-01", vending: 9000, photo: 8000, parking: 7000 };
    expect(applyExtra(old, ups[0])).toEqual({ v: 1, date: "2026-07-01", vending: 9000, photo: 8000, parking: 0 });
    expect(applyExtra(undefined, ups[1])).toEqual({ v: 1, date: "2026-07-02", vending: 0, photo: 0, parking: 2000 });
    // 누가 언제 올렸는지 — 바꾼 칸만
    const withMeta = applyExtra({ ...old, files: { vending: { by: "가", at: "t0" } } }, ups[0], { by: "나", at: "t1", file: "주차.xlsx" });
    expect(withMeta.files).toEqual({ vending: { by: "가", at: "t0" }, parking: { by: "나", at: "t1", file: "주차.xlsx" } });
  });
  it("모양이 다르면 null", () => {
    expect(parseNiceSheet([["아무거나"], ["1", "2"]])).toBeNull();
  });
  it("보고서 — 기타 매출과 총매출에 더함", () => {
    const date = "2026-07-02";
    const extra = { v: 1 as const, date, vending: 10000, photo: 5000, parking: 2000 };
    const m = new Board([{ date, extra }]).day(date);
    expect(m.extra).toEqual({ vending: 10000, photo: 5000, parking: 2000 });
    expect(m.box.기타).toBe(17000);
    expect(m.total).toBe(17000);
    const r = new Board([{ date, extra }, { date: "2026-07-03", extra: { ...extra, date: "2026-07-03" } }]).range("2026-07-01", "2026-07-31");
    expect(r.extra.vending).toBe(20000);
    expect(r.box.기타).toBe(34000);
  });
});

describe("자동 수집 — 사람이 올린 칸은 덮지 않음", () => {
  const all = ["vending", "photo", "parking"] as const;
  const base = { v: 1 as const, date: "2026-10-03", vending: 100, photo: 200, parking: 300 };
  const at = "2026-10-03T13:10:00Z";
  it("문서가 없으면 다 바꿈", () => {
    expect(autoExtraKinds(null, [...all])).toEqual([...all]);
  });
  it("칸마다 기록이 없던 옛 문서는 사람이 올린 것 → 안 바꿈", () => {
    expect(autoExtraKinds(base, [...all])).toEqual([]);
  });
  it("사람이 올린 칸만 남기고, 자동이 올렸거나 비어 있는 칸은 바꿈", () => {
    const old = { ...base, files: { vending: { by: "송", at }, photo: { by: EXTRA_AUTO_BY, at } } };
    expect(autoExtraKinds(old, [...all])).toEqual(["photo", "parking"]);
  });
  it("바꾼 칸에는 자동 수집 기록이 붙고, 나중에 사람이 올리면 사람 것이 이김", () => {
    const auto = applyExtra(null, { date: base.date, part: base, kinds: [...all] }, { by: EXTRA_AUTO_BY, at });
    expect(autoExtraKinds(auto, [...all])).toEqual([...all]);
    const human = applyExtra(auto, { date: base.date, part: { ...base, parking: 999 }, kinds: ["parking"] }, { by: "송", at });
    expect(autoExtraKinds(human, [...all])).toEqual(["vending", "photo"]);
    expect(human.parking).toBe(999);
  });
});

describe("나이스 자동 수집 — 받을 기간 (아침 09:10 · 예전 저녁 방식)", () => {
  it("저녁: 어제 ~ 오늘", () => {
    expect(niceRange("2026-10-05", 21, "evening")).toEqual({ from: "2026-10-04", to: "2026-10-05" });
    expect(niceRange("2026-10-05", 22, "evening")).toEqual({ from: "2026-10-04", to: "2026-10-05" }); // GitHub 예약이 늦게 시작
  });
  it("저녁 예약이 PC가 꺼져 있어 다음 날 켜질 때 돌면 → 건너뜀 (아침 09:30 이 받음)", () => {
    expect(niceRange("2026-10-06", 8, "evening")).toEqual({ skip: true });
    expect(niceRange("2026-10-06", 20, "evening")).toEqual({ skip: true });
  });
  it("아침: 지난 7일 ~ 어제 (꺼져 있던 날 · 밤늦은 결제까지 채움, 사람이 올린 칸은 그대로)", () => {
    expect(niceRange("2026-10-06", 9, "morning")).toEqual({ from: "2026-09-29", to: "2026-10-05" });
  });
  it("손으로 돌릴 때(그 밖): 어제 ~ 오늘", () => {
    expect(niceRange("2026-10-06", 15, "manual")).toEqual({ from: "2026-10-05", to: "2026-10-06" });
  });
  it("나이스로 바뀌기 전(2026-07-01 전)은 받지 않음", () => {
    expect(niceRange("2026-07-03", 9, "morning")).toEqual({ from: "2026-07-01", to: "2026-07-02" });
  });
});
