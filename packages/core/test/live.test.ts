import { describe, expect, it } from "vitest";
import { Board, buildStorePart, checkLivePiece, dashboard, dayStage, liveReport, liveStale, mergeLive, sampleReports, type ReceiptSheet } from "../src";

const sheet: ReceiptSheet = {
  from: "2026-10-08",
  to: "2026-10-08",
  sheetNet: 15000,
  lines: [
    { pos: "01", receipt: "0001", refund: false, time: "10:12:00", name: "아메리카노", qty: 2, gross: 9000, discount: 0, net: 9000 },
    { pos: "01", receipt: "0002", refund: false, time: "11:40:00", name: "크루아상", qty: 1, gross: 6000, discount: 0, net: 6000 },
  ],
  sheetQty: 3,
};
const cafe = () => buildStorePart({ store: "cafe", date: "2026-10-08", file: "live", sheet, sectorOf: (n) => (n === "크루아상" ? "베이커리" : "바리스타") }).part;

describe("오늘 마감 전 영업정보 — 받은 숫자 검사 (틀린 숫자는 B 에 보이지 않게)", () => {
  it("확정 보고와 같은 계산(buildStorePart)으로 만든 조각은 통과", () => {
    expect(checkLivePiece(cafe(), "cafe", "2026-10-08")).toEqual([]);
  });
  it("날짜 · 매장이 다르면 막음", () => {
    expect(checkLivePiece(cafe(), "cafe", "2026-10-07").length).toBeGreaterThan(0);
    expect(checkLivePiece(cafe(), "kids", "2026-10-08").length).toBeGreaterThan(0);
  });
  it("팀 수 · 잔 수가 안 맞거나 숫자가 아니면 막음", () => {
    const p = cafe();
    p.teams += 1;
    expect(checkLivePiece(p, "cafe", "2026-10-08").length).toBeGreaterThan(0);
    const q = cafe();
    (q as any).posNet = "많이";
    expect(checkLivePiece(q, "cafe", "2026-10-08").length).toBeGreaterThan(0);
  });
  it("전화번호처럼 생긴 글이 있으면 막음", () => {
    const p = cafe();
    p.products.push(["010-1234-5678", "바리스타", 1, 0]);
    expect(checkLivePiece(p, "cafe", "2026-10-08").some((e) => /개인정보/.test(e))).toBe(true);
  });
  it("live 문서 → 그날 보고 (틀린 조각은 빼고 문제로)", () => {
    const bad = cafe();
    bad.teams += 3;
    const r = liveReport({ date: "2026-10-08", at: "2026-10-08T05:00:00Z", cafe: { p: bad, at: "x" }, kids: undefined }, "2026-10-08");
    expect(r.report).toBeNull();
    expect(r.problems.some((x) => /카페/.test(x))).toBe(true);
    const ok = liveReport({ date: "2026-10-08", at: "2026-10-08T05:00:00Z", cafe: { p: cafe(), at: "x" } }, "2026-10-08");
    expect(ok.report?.cafe?.posNet).toBe(15000);
    expect(ok.at).toBe("2026-10-08T05:00:00Z");
  });
  it("확정이 있으면 확정이 이김 · 없으면 마감 전 조각 (어느 칸이 마감 전인지 표시)", () => {
    const live = liveReport({ date: "2026-10-08", at: "t", cafe: { p: cafe(), at: "x" } }, "2026-10-08").report!;
    const m1 = mergeLive(undefined, live);
    expect(m1.cafe).toBe(live.cafe);
    expect(m1.provisional).toEqual(["cafe"]);
    const confirmed = { date: "2026-10-08", cafe: cafe(), meta: { cafe: { by: "A", at: "z" } } };
    const m2 = mergeLive(confirmed, live);
    expect(m2.cafe).toBe(confirmed.cafe);
    expect(m2.provisional).toBeUndefined();
  });
  it("날짜 단계 — 어제까지 확정 · 오늘 마감 전 · 앞날", () => {
    expect(dayStage("2026-10-07", "2026-10-08")).toBe("closed");
    expect(dayStage("2026-10-08", "2026-10-08")).toBe("live");
    expect(dayStage("2026-10-09", "2026-10-08")).toBe("future");
  });
});

describe("늦음 표시 — 매시 15분 · 45분에 받으니 70분 넘게 새 숫자가 없으면 (받는 시간 안에서만)", () => {
  const kst = (hm: string) => new Date(`2026-10-08T${hm}:00+09:00`);
  const at = (hm: string) => kst(hm).toISOString();
  it("70분 안이면 늦지 않음 · 넘으면 늦음", () => {
    expect(liveStale(at("13:15"), kst("14:20"))).toBe(false);
    expect(liveStale(at("13:15"), kst("14:30"))).toBe(true);
  });
  it("아침 첫 수집(10:15) 전후 · 마지막(22:45) 뒤 밤에는 늦음 표시 없음", () => {
    expect(liveStale(null, kst("09:50"))).toBe(false);
    expect(liveStale(null, kst("10:40"))).toBe(false);
    expect(liveStale(null, kst("11:30"))).toBe(true);
    expect(liveStale(at("22:45"), kst("23:59"))).toBe(false);
  });
});

describe("마감 전 날의 누계 — 오늘(하루가 안 끝난 숫자)은 누계 · 작년 비교에 넣지 않음", () => {
  it("cumTo = 어제 → 당월 · 올해 누계와 작년 같은 기간이 어제까지", () => {
    const board = new Board(sampleReports("2026-09-25", "2026-10-08"));
    const full = dashboard(board, "2026-10-08");
    const live = dashboard(board, "2026-10-08", { cumTo: "2026-10-07" });
    expect(live.cumTo).toBe("2026-10-07");
    expect(live.month.total).toBe(full.month.total - full.day.total);
    expect(live.day.total).toBe(full.day.total);
    expect(live.lyMonth.to < full.lyMonth.to).toBe(true);
    // 1일이 오늘이면 당월 확정분은 없음
    expect(dashboard(board, "2026-10-01", { cumTo: "2026-09-30" }).month.total).toBe(0);
    // 옵션이 없으면 예전과 같음
    expect(full.cumTo).toBe("2026-10-08");
  });
});
