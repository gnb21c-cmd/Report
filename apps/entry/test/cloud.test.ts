import { beforeEach, describe, expect, it, vi } from "vitest";
import { login, readDay, reportOf, writePieces } from "../src/cloud";

const cfg = { apiKey: "k", projectId: "astana-report" };
const store: Record<string, string> = {};
(globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v), removeItem: (k: string) => delete store[k] };

function fakeFetch(handler: (url: string, init: any) => [number, any]) {
  const calls: { url: string; init: any }[] = [];
  (globalThis as any).fetch = vi.fn(async (url: string, init: any = {}) => {
    calls.push({ url, init });
    const [status, body] = handler(url, init);
    return { ok: status < 400, status, json: async () => body } as any;
  });
  return calls;
}

describe("A → 클라우드", () => {
  beforeEach(() => Object.keys(store).forEach((k) => delete store[k]));

  it("로그인: 출입증 → senders 문서에서 매장 열쇠", async () => {
    const calls = fakeFetch((url) => {
      if (url.includes("signInWithPassword")) return [200, { idToken: "T", refreshToken: "R", expiresIn: "3600", email: "Kim@Astana.report" }];
      if (url.includes("/senders/")) return [200, { fields: { board: { stringValue: "BOARDKEY" } } }];
      return [404, {}];
    });
    expect(await login(cfg, "Kim@Astana.report", "pw")).toBe("kim@astana.report");
    expect(calls[1].url).toContain("/senders/kim%40astana.report");
    expect(calls[1].init.headers.Authorization).toBe("Bearer T");
    expect(JSON.parse(store["entry.session"])).toMatchObject({ board: "BOARDKEY", refresh: "R" });
  });

  it("senders 명단에 없으면 알아듣게", async () => {
    fakeFetch((url) => (url.includes("signIn") ? [200, { idToken: "T", refreshToken: "R", expiresIn: "3600", email: "x@y" }] : [404, {}]));
    await expect(login(cfg, "x@y", "pw")).rejects.toThrow(/senders/);
  });

  it("보낸 칸만 바꾸기 (updateMask) · 같은 날 조각은 한 문서로", async () => {
    store["entry.session"] = JSON.stringify({ email: "kim@a", refresh: "R", board: "BK" });
    const calls = fakeFetch((url) => (url.includes("securetoken") ? [200, { id_token: "T2", expires_in: "3600" }] : [200, {}]));
    await writePieces(cfg, "김", [
      { kind: "naver", date: "2026-10-01", part: { v: 1, date: "2026-10-01", tickets: [], newVisitors: [] } as any },
      { kind: "cafe", date: "2026-10-01", part: { date: "2026-10-01" } as any, file: "a.xls" },
    ]);
    const body = JSON.parse(calls[calls.length - 1].init.body);
    expect(body.writes).toHaveLength(1);
    expect(body.writes[0].update.name).toBe("projects/astana-report/databases/(default)/documents/boards/BK/reports/2026-10-01");
    expect(body.writes[0].updateMask.fieldPaths.sort()).toEqual(["at", "cafe", "date", "naver"]);
    expect(JSON.parse(body.writes[0].update.fields.cafe.stringValue)).toMatchObject({ by: "김", file: "a.xls" });
  });

  it("문서 → 그날 보고 (B 와 같은 모양)", async () => {
    const r = reportOf("2026-10-01", { cafe: JSON.stringify({ p: { store: "cafe" }, by: "김", at: "t", file: "a.xls" }), naver: "깨짐" });
    expect(r).toMatchObject({ date: "2026-10-01", cafe: { store: "cafe" }, meta: { cafe: { by: "김", file: "a.xls" } } });
    expect(r!.naver).toBeUndefined();
    store["entry.session"] = JSON.stringify({ email: "kim@a", refresh: "R", board: "BK" });
    fakeFetch((url) => (url.includes("securetoken") ? [200, { id_token: "T", expires_in: "3600" }] : [404, {}]));
    expect(await readDay(cfg, "2026-10-09")).toEqual({ report: null, weather: null });
  });
});
