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

describe("보고 앱 — 통합데스크 설문 보고함 (키즈 POS 가 바로 씀, 2026-10-15)", () => {
  const desk = (day: string, total: number) =>
    JSON.stringify({
      type: "astanakiz-survey",
      v: 1,
      day,
      sentAt: `${day} 20:00`,
      question: "아스타나키즈를 어떻게 알게 되었나요",
      period: { from: "2026-10-15", to: "2026-10-31" },
      targets: { naverNew: true, walkin: false, all: false },
      options: [
        { no: 1, label: "네이버 검색", today: 1, total },
        { no: 2, label: "인스타그램", today: 0, total: 2 },
      ],
      excluded: { today: 0, total: 1 },
      answered: { today: 1, total: total + 2 },
    });
  const fake = (inbox: { name: string; json: string }[] | "error", legacy: unknown | null) =>
    vi.fn(async (url: string) => {
      if (url.includes("/settings/surveys")) return legacy ? ({ ok: true, json: async () => ({ fields: { json: { stringValue: JSON.stringify(legacy) } } }) } as any) : ({ ok: false, status: 404, json: async () => ({}) } as any);
      if (url.includes("/surveyInbox?")) {
        if (inbox === "error") throw new Error("인터넷 없음");
        return { ok: true, json: async () => (inbox.length ? { documents: inbox.map((d) => ({ name: d.name, fields: { json: { stringValue: d.json }, at: { stringValue: "x" } } })) } : {}) } as any;
      }
      return { ok: false, status: 404, json: async () => ({}) } as any;
    });

  it("보고함 문서(설문마다 하나)를 읽어 설문 묶음으로 · 예전 settings/surveys 가 없어도", async () => {
    vi.stubGlobal("fetch", fake([{ name: "p/surveyInbox/2026-10-15", json: desk("2026-10-16", 5) }, { name: "p/surveyInbox/2000-01-01", json: "{깨짐" }], null));
    const doc = await firebaseSource({ apiKey: "k", projectId: "p" }, "board").surveys();
    expect(doc?.surveys).toHaveLength(1);
    expect(doc?.surveys[0].asOf).toBe("2026-10-16");
    expect(doc?.surveys[0].options.map((o) => [o.label, o.n])).toEqual([["네이버 검색", 5], ["인스타그램", 2]]);
    vi.unstubAllGlobals();
  });

  it("보고함과 예전 길이 같은 설문이면 늦은 날 것 · 보고함이 비었거나 못 읽으면 예전 것 · 둘 다 없으면 null", async () => {
    const src = () => firebaseSource({ apiKey: "k", projectId: "p" }, "board");
    const oldDoc = { v: 1, at: "2026-10-15 20:00", surveys: [{ id: "desk-2026-10-15-x", title: "예전", from: "2026-10-15", to: null, asOf: "2026-10-15", options: [{ no: 1, label: "가", n: 1 }] }] };
    vi.stubGlobal("fetch", fake([], oldDoc));
    expect((await src().surveys())?.surveys.map((x) => x.title)).toEqual(["예전"]);
    vi.stubGlobal("fetch", fake("error", oldDoc));
    expect((await src().surveys())?.surveys.map((x) => x.title)).toEqual(["예전"]);
    vi.stubGlobal("fetch", fake([], null));
    expect(await src().surveys()).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("보고 앱 — 통합데스크 이벤트 입장 수 (deskStats/event-날짜 · 2026-10-21)", () => {
  const ev = (day: string, count: number) => JSON.stringify({ type: "astanakiz-event", v: 1, day, sentAt: `${day} 20:00`, count, names: [{ name: "한가위", n: count }] });
  const doc = (id: string, json: string) => ({ name: `projects/p/databases/(default)/documents/boards/board/deskStats/${id}`, fields: { json: { stringValue: json }, at: { stringValue: "x" } } });

  it("deskStats 문서를 끝까지(쪽마다) 읽어 날짜 → 수 · revisit 은 빼고 · 그날 하나만 읽기 (없으면 null)", async () => {
    const pages: Record<string, any> = {
      "": { documents: [doc("event-2026-10-20", ev("2026-10-20", 2)), doc("revisit", JSON.stringify({ type: "astanakiz-revisit" }))], nextPageToken: "T2" },
      T2: { documents: [doc("event-2026-10-21", ev("2026-10-21", 5)), doc("event-2026-10-19", "{깨짐")] },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (/deskStats\?/.test(url)) return { ok: true, json: async () => pages[new URL(url).searchParams.get("pageToken") || ""] } as any;
        if (url.includes("deskStats/event-2026-10-21?")) return { ok: true, status: 200, json: async () => doc("event-2026-10-21", ev("2026-10-21", 6)) } as any;
        return { ok: false, status: 404, json: async () => ({}) } as any;
      }),
    );
    const src = firebaseSource({ apiKey: "k", projectId: "p" }, "board");
    expect(await src.deskEvents()).toEqual({ counts: { "2026-10-20": 2, "2026-10-21": 5 }, revisit: null });
    expect(await src.deskEventDay("2026-10-21")).toBe(6);
    expect(await src.deskEventDay("2026-10-22")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("재방문 성공 (2026-10-27 사장님): 가장 최근 이벤트 글의 revisit 을 같이 — 그때(asOf) 붙임", async () => {
    const rv = (day: string, today: number, total: number) => JSON.stringify({ type: "astanakiz-event", v: 1, day, sentAt: `${day} 20:00`, count: 1, names: [], revisit: { from: "2026-10-26", today, total, days: { "2026-10-26": total - today, [day]: today } } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (/deskStats\?/.test(url) ? ({ ok: true, json: async () => ({ documents: [doc("event-2026-10-27", rv("2026-10-27", 2, 43)), doc("event-2026-10-26", rv("2026-10-26", 41, 41))] }) } as any) : ({ ok: false, status: 404, json: async () => ({}) } as any))),
    );
    const got = await firebaseSource({ apiKey: "k", projectId: "p" }, "board").deskEvents();
    expect(got.counts).toEqual({ "2026-10-27": 1, "2026-10-26": 1 });
    expect(got.revisit).toEqual({ from: "2026-10-26", today: 2, total: 43, days: { "2026-10-26": 41, "2026-10-27": 2 }, asOf: "2026-10-27 20:00" });
    vi.unstubAllGlobals();
  });
});
