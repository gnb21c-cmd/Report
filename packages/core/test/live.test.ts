import { describe, expect, it } from "vitest";
import { buildStorePart, checkDeskLive, checkLivePiece, liveStale, NAVER_SLOTS, type DeskLive, type ReceiptSheet } from "../src";

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

  const desk = (): DeskLive => ({ v: 1, date: "2026-10-08", entries: NAVER_SLOTS.map((_, i) => (i === 0 ? 5 : i === 1 ? 3 : 0)), naver: 4, onsite: 3, eventFree: 1 });
  it("통합데스크(C) 숫자 — 시간대 합 = 네이버 + 현장 + 이벤트", () => {
    expect(checkDeskLive(desk(), "2026-10-08")).toEqual([]);
    const d = desk();
    d.onsite = 9;
    expect(checkDeskLive(d, "2026-10-08").length).toBeGreaterThan(0);
    expect(checkDeskLive({ ...desk(), name: "홍길동" } as any, "2026-10-08").length).toBeGreaterThan(0);
    expect(checkDeskLive({ ...desk(), entries: [1] }, "2026-10-08").length).toBeGreaterThan(0);
  });

  it("30분 넘게 새 숫자가 없으면 '늦음' (영업시간 안)", () => {
    expect(liveStale("2026-10-08T03:00:00Z", new Date("2026-10-08T03:20:00Z"))).toBe(false);
    expect(liveStale("2026-10-08T03:00:00Z", new Date("2026-10-08T03:40:00Z"))).toBe(true);
  });
});
