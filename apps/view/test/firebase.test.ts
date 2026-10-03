import { describe, expect, it, vi } from "vitest";
import { firebaseSource } from "../src/data/firebase";

/** Firestore runQuery 흉내 — at 순 (같으면 문서 이름 순), where at > x, startAt (at, 이름) 다음, limit */
function fakeFirestore(docs: { name: string; at: string; date: string }[]) {
  const sorted = [...docs].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.name < b.name ? -1 : 1));
  return vi.fn(async (_url: string, init: any) => {
    const q = JSON.parse(init.body).structuredQuery;
    let xs = sorted;
    const after = q.where?.fieldFilter?.value?.timestampValue;
    if (after) xs = xs.filter((d) => d.at > after);
    if (q.startAt) {
      const [at, ref] = q.startAt.values.map((v: any) => v.timestampValue ?? v.referenceValue);
      xs = xs.filter((d) => d.at > at || (d.at === at && d.name > ref));
    }
    xs = xs.slice(0, q.limit);
    const body = xs.map((d) => ({ document: { name: d.name, fields: { date: { stringValue: d.date }, at: { timestampValue: d.at }, extra: { stringValue: JSON.stringify({ p: { v: 1, date: d.date, vending: 1000, photo: 0, parking: 0 } }) } } } }));
    return { ok: true, json: async () => body } as any;
  });
}

describe("보고 앱 — 클라우드에서 받기 (같은 시각에 한꺼번에 넣은 문서)", () => {
  it("300개씩 끊어 받아도 같은 시각 문서를 건너뛰지 않음", async () => {
    const docs = [];
    // 앞에 따로 올린 문서 50개 + ④ 로 한꺼번에 넣은 546개 (같은 시각) + 94개 (같은 시각)
    for (let i = 0; i < 50; i++) docs.push({ name: `p/reports/2024-${String(i).padStart(3, "0")}`, at: `2026-10-01T00:00:${String(i).padStart(2, "0")}Z`, date: `2024-01-${String((i % 28) + 1).padStart(2, "0")}` });
    for (let i = 0; i < 546; i++) docs.push({ name: `p/reports/k${String(i).padStart(4, "0")}`, at: "2026-10-03T13:00:00Z", date: `2025-01-01` });
    for (let i = 0; i < 94; i++) docs.push({ name: `p/reports/n${String(i).padStart(4, "0")}`, at: "2026-10-03T13:05:00Z", date: `2026-07-01` });
    const fetchMock = fakeFirestore(docs);
    vi.stubGlobal("fetch", fetchMock);
    const src = firebaseSource({ apiKey: "k", projectId: "p" }, "board");
    const got = await src.reports(null);
    expect(got.reports.length).toBe(690);
    expect(got.reports.every((r) => r.extra?.vending === 1000)).toBe(true);
    expect(got.last).toBe("2026-10-03T13:05:00Z");
    // 다음에 열 때는 그 뒤 것만
    const again = await src.reports(got.last);
    expect(again.reports.length).toBe(0);
    vi.unstubAllGlobals();
  });
});
