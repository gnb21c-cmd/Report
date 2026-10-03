import { describe, expect, it } from "vitest";
import { applyExtra, Board, extraTotal, extraUpdates, mergeExtra, parseNiceSheet } from "../src";

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
