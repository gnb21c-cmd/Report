import { describe, expect, it } from "vitest";
import {
  kidsKind,
  latestBatches,
  posStatus,
  reportDate,
  salesOf,
  SalesIndex,
  sameDayYearsAgo,
  teamOf,
  type DayBatch,
  type SaleLine,
} from "../src";

const line = (name: string, net: number, qty = 1, extra: Partial<SaleLine> = {}): SaleLine => ({
  code: extra.code ?? name,
  name,
  cat1: extra.cat1 ?? "",
  cat2: "",
  cat3: "",
  qty,
  gross: extra.gross ?? net,
  discount: extra.discount ?? 0,
  net,
});
const batch = (pos: "cafe" | "kids", date: string, rows: SaleLine[], sentAt = `${date}T13:00:00Z`): DayBatch => ({ pos, date, rows, sentAt });
const index = (batches: DayBatch[]) =>
  new SalesIndex(
    salesOf(batches),
    latestBatches(batches).map((b) => ({ pos: b.pos, date: b.date })),
  );

describe("묶음 정리", () => {
  it("같은 POS·날짜는 늦게 보낸 것만 (두 번 더하지 않음)", () => {
    const b = [
      batch("cafe", "2026-10-01", [line("아메리카노", 5000)], "2026-10-01T12:00:00Z"),
      batch("cafe", "2026-10-01", [line("아메리카노", 10000, 2)], "2026-10-01T13:00:00Z"),
      batch("kids", "2026-10-01", [line("자유입장권", 15000)]),
    ];
    const idx = index(b);
    expect(idx.day("2026-10-01").reduce((t, x) => t + x.net, 0)).toBe(25000);
    expect(latestBatches(b)).toHaveLength(2);
  });

  it("상품명 공백 정리 — VAN 변경으로 코드가 달라도 이름이 같으면 한 상품", () => {
    const b = [
      batch("cafe", "2026-06-30", [line("야간자유입장권　　[7시 입장]", 10000, 1, { code: "000164" })]),
      batch("cafe", "2026-07-01", [line(" 야간자유입장권 [7시 입장] ", 10000, 1, { code: "000779" })]),
    ];
    const rows = index(b).products("2026-06-01", "2026-07-31");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "야간자유입장권 [7시 입장]", qty: 2, net: 20000, codes: ["000164", "000779"] });
  });

  it("기준일은 받은 자료 중 가장 늦은 날, POS 별 마지막 송부", () => {
    const b = [batch("cafe", "2026-10-01", []), batch("kids", "2026-09-30", [])];
    expect(reportDate(b)).toBe("2026-10-01");
    expect(posStatus(b).map((s) => [s.pos, s.lastDate])).toEqual([
      ["cafe", "2026-10-01"],
      ["kids", "2026-09-30"],
    ]);
  });
});

describe("팀 · 키즈 구분", () => {
  it("대분류가 있으면 그대로, 없으면 상품명으로, 키즈 POS 는 모두 키즈", () => {
    expect(teamOf("cafe", { cat1: "바리스타", name: "무엇이든" })).toBe("바리스타");
    expect(teamOf("cafe", { cat1: "", name: "소금빵" })).toBe("베이커리");
    expect(teamOf("cafe", { cat1: "", name: "트러플 크림파스타" })).toBe("키친");
    expect(teamOf("cafe", { cat1: "쿠폰", name: "종이쿠폰" })).toBe("기타");
    expect(teamOf("kids", { cat1: "", name: "아메리카노" })).toBe("키즈");
  });

  it("키즈: 0원 입장 발행 · 현장 결제 · 이벤트 무료 · 추가 인원 (2026-10-01 · 09-27 실제 상품명)", () => {
    expect(kidsKind({ name: "[평일] 무제한 이용", gross: 0, net: 0 })).toBe("입장발행");
    expect(kidsKind({ name: "야간자유입장권", gross: 0, net: 0 })).toBe("입장발행");
    expect(kidsKind({ name: "3시 20분 퇴장 [1시30분 입장]", gross: 0, net: 0 })).toBe("입장발행");
    expect(kidsKind({ name: "[평일] 1시간 50분 입장권", gross: 48000, net: 48000 })).toBe("현장결제");
    expect(kidsKind({ name: "[휴일] 1시간 50분 입장권", gross: 70000, net: 70000 })).toBe("현장결제");
    expect(kidsKind({ name: "[평일] 한가위 무제한 쿠폰", gross: 0, net: 0, cat1: "서비스.쿠폰" })).toBe("이벤트무료");
    expect(kidsKind({ name: "인원추가 [평일만]", gross: 3000, net: 3000 })).toBe("추가인원");
    expect(kidsKind({ name: "키즈 주스", gross: 3000, net: 3000 })).toBe("기타");
  });

});

describe("날짜", () => {
  it("윤년 2월 29일의 작년 같은 날은 28일", () => {
    expect(sameDayYearsAgo("2028-02-29")).toBe("2027-02-28");
  });
});

describe("좁은 칸 금액", () => {
  it("만 · 억 단위", async () => {
    const { wonMan } = await import("../src");
    expect([wonMan(901600), wonMan(3500000), wonMan(12345678), wonMan(125000000), wonMan(9000), wonMan(0)]).toEqual(["90.2만", "350만", "1235만", "1.25억", "9,000원", "0원"]);
  });
});

describe("기간 스티커 · 기온", () => {
  it("성수기 · 비수기 · 평상시 (해를 넘기는 기간 포함)", async () => {
    const { seasonOf, temp } = await import("../src");
    expect(seasonOf("2026-08-01").kind).toBe("성수기");
    expect(seasonOf("2026-01-15")).toMatchObject({ kind: "성수기", name: "겨울방학" });
    expect(seasonOf("2026-12-30").kind).toBe("성수기");
    expect(seasonOf("2026-03-10")).toMatchObject({ kind: "비수기", emoji: "🍃" });
    expect(seasonOf("2026-10-01")).toMatchObject({ kind: "평상시", emoji: "🙂" });
    expect([temp(22.25), temp(-3), temp(null)]).toEqual(["22.3°", "-3°", "—"]);
  });
});
