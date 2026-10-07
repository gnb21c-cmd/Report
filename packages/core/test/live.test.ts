import { describe, expect, it } from "vitest";
import {
  buildStorePart,
  checkDeskLive,
  checkLivePiece,
  liveReport,
  liveStale,
  mergeLive,
  NAVER_SLOTS,
  type DeskLive,
  type ReceiptSheet,
} from "../src";

const sheet: ReceiptSheet = {
  from: "2026-10-08",
  to: "2026-10-08",
  sheetNet: 15000,
  lines: [
    {
      pos: "01",
      receipt: "0001",
      refund: false,
      time: "10:12:00",
      name: "아메리카노",
      qty: 2,
      gross: 9000,
      discount: 0,
      net: 9000,
    },
    {
      pos: "01",
      receipt: "0002",
      refund: false,
      time: "11:40:00",
      name: "크루아상",
      qty: 1,
      gross: 6000,
      discount: 0,
      net: 6000,
    },
  ],
  sheetQty: 3,
};
const cafe = () =>
  buildStorePart({
    store: "cafe",
    date: "2026-10-08",
    file: "live",
    sheet,
    sectorOf: (n) => (n === "크루아상" ? "베이커리" : "바리스타"),
  }).part;

describe("마감 전 영업정보 — 받은 숫자 검사 (틀린 숫자는 B 에 보이지 않게)", () => {
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

  it("전화번호처럼 생긴 글이 있으면 막음 (개인정보는 키즈 POS 밖으로 안 나감)", () => {
    const p = cafe();
    p.products.push(["010-1234-5678", "바리스타", 1, 0]);
    expect(checkLivePiece(p, "cafe", "2026-10-08").some((e) => /개인정보/.test(e))).toBe(true);
  });

  const z = () => NAVER_SLOTS.map(() => 0);
  const desk = (): DeskLive => {
    const naver = z(),
      naverNew = z(),
      onsite = z();
    naver[0] = 5;
    naverNew[0] = 2;
    onsite[1] = 3;
    return { v: 1, date: "2026-10-08", naver, naverNew, onsite, eventFree: 1 };
  };
  it("통합데스크(C) 숫자 — 30분 칸 20개 · 0 이상 정수 · 신규 ≤ 네이버 · 정해진 칸만", () => {
    expect(checkDeskLive(desk(), "2026-10-08")).toEqual([]);
    const d = desk();
    d.naverNew[0] = 6;
    expect(checkDeskLive(d, "2026-10-08").length).toBeGreaterThan(0);
    expect(checkDeskLive({ ...desk(), name: "홍길동" } as any, "2026-10-08").length).toBeGreaterThan(0);
    expect(checkDeskLive({ ...desk(), naver: [1] }, "2026-10-08").length).toBeGreaterThan(0);
    expect(checkDeskLive({ ...desk(), eventFree: -1 }, "2026-10-08").length).toBeGreaterThan(0);
  });

  it("live 문서 → 그날 보고 (틀린 조각은 빼고 문제로)", () => {
    const bad = cafe();
    bad.teams += 3;
    const r = liveReport(
      {
        date: "2026-10-08",
        at: "2026-10-08T05:00:00Z",
        cafe: { p: bad, at: "x" },
        kids: undefined,
        desk: { p: desk(), at: "y" },
      },
      "2026-10-08",
    );
    expect(r.report?.cafe).toBeUndefined();
    expect(r.report?.naver?.tickets[0]).toBe(5);
    expect(r.report?.naver?.newVisitors[0]).toBe(2);
    expect(r.problems.some((x) => /카페/.test(x))).toBe(true);
    expect(r.deskOnsite).toBe(3);
  });

  it("확정이 있으면 확정이 이김 · 없으면 마감 전 조각 (어느 칸이 마감 전인지 표시)", () => {
    const live = liveReport(
      { date: "2026-10-08", at: "t", cafe: { p: cafe(), at: "x" }, desk: { p: desk(), at: "y" } },
      "2026-10-08",
    ).report!;
    const m1 = mergeLive(undefined, live);
    expect(m1.cafe).toBe(live.cafe);
    expect(m1.provisional).toEqual(["cafe", "naver"]);
    const confirmed = { date: "2026-10-08", cafe: cafe(), meta: { cafe: { by: "A", at: "z" } } };
    const m2 = mergeLive(confirmed, live);
    expect(m2.cafe).toBe(confirmed.cafe);
    expect(m2.provisional).toEqual(["naver"]);
    expect(mergeLive({ ...confirmed, naver: live.naver }, live).provisional).toBeUndefined();
  });

  it("30분 넘게 새 숫자가 없으면 '늦음' (영업시간 안)", () => {
    expect(liveStale("2026-10-08T03:00:00Z", new Date("2026-10-08T03:20:00Z"))).toBe(false);
    expect(liveStale("2026-10-08T03:00:00Z", new Date("2026-10-08T03:40:00Z"))).toBe(true);
  });
});

describe("마감 전 날의 누계 — 오늘(하루가 안 끝난 숫자)은 누계 · 작년 비교에 넣지 않음", () => {
  it("cumTo = 어제 → 당월 · 올해 누계와 작년 같은 기간이 어제까지", async () => {
    const { Board, dashboard, sampleReports } = await import("../src");
    const board = new Board(sampleReports("2026-09-25", "2026-10-08"));
    const full = dashboard(board, "2026-10-08");
    const live = dashboard(board, "2026-10-08", { cumTo: "2026-10-07" });
    expect(live.cumTo).toBe("2026-10-07");
    expect(live.month.total).toBe(full.month.total - full.day.total);
    expect(live.day.total).toBe(full.day.total);
    expect(live.lyMonth.to < full.lyMonth.to).toBe(true);
    // 1일이 오늘이면 당월 확정분은 없음
    expect(dashboard(board, "2026-10-01", { cumTo: "2026-09-30" }).month.total).toBe(0);
  });
});
