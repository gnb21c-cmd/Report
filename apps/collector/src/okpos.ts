/* ============================================================
   OKPOS 점주 웹(nice.okpos.co.kr) — 사람이 하는 순서 그대로
   로그인 → 매출관리 → 매출현황 → 영수증별매출상세현황 → 매장 고르기 → 조회일자 → 조회 → 엑셀
   DB 에 손대지 않고 점주 계정으로 볼 수 있는 화면만 읽음
   공개 저장소라 실행 기록(로그)에는 매출 숫자 · 매장 이름 · 회사 이름을 남기지 않음
   ============================================================ */
import { readFile } from "node:fs/promises";
import { chromium, type Browser, type Frame, type Page } from "playwright";
import * as XLSX from "xlsx";

export const LOGIN = "https://nice.okpos.co.kr/login/login_form.jsp";
const MENU = ["매출관리", "매출현황", "영수증별매출상세현황"];
export type Store = "cafe" | "kids";

/** 공개 기록에 남겨도 되는 모양으로 — 숫자 4자리 이상 · 물음표 뒤 값 가림 */
export const mask = (s: string) =>
  String(s)
    .replace(/([?&][^=&#]+)=[^&#]*/g, "$1=…")
    .replace(/\d{4,}/g, "#")
    .slice(0, 200);
export const say = (...xs: unknown[]) => console.log(...xs);

/** 엑셀 → 행 × 칸 (입력 화면 excel.ts 와 같게) */
export function readRows(buf: Uint8Array): unknown[][] {
  const book = XLSX.read(buf, { type: "array", cellDates: false, cellNF: false, cellText: false });
  const ws = book.Sheets[book.SheetNames[0]];
  return ws ? XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "", blankrows: false }) : [];
}

/** 조건이 맞을 때까지 기다림 (화면 안 식) */
async function until(f: Frame, expr: string, ms: number): Promise<boolean> {
  for (let t = 0; t < ms; t += 500) {
    if (await f.evaluate(expr).catch(() => false)) return true;
    await f.page().waitForTimeout(500);
  }
  return false;
}

export class Okpos {
  private constructor(
    private browser: Browser,
    private page: Page,
  ) {}

  static async open(): Promise<Okpos> {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ locale: "ko-KR", timezoneId: "Asia/Seoul", acceptDownloads: true });
    // tsx(esbuild)가 함수 이름 도우미 __name 을 끼워 넣음 → 화면 안에서도 있게
    await ctx.addInitScript("globalThis.__name = (f) => f");
    const page = await ctx.newPage();
    page.on("dialog", async (d) => {
      say(`[알림창] ${mask(d.message())}`);
      await d.accept().catch(() => {});
    });
    // 공지 팝업 창은 바로 닫음
    page.on("popup", (p) => void p.close().catch(() => {}));
    return new Okpos(browser, page);
  }

  close() {
    return this.browser.close();
  }

  async login(id: string, pw: string) {
    const p = this.page;
    const res = await p.goto(LOGIN, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!res || res.status() >= 400) throw new Error(`로그인 화면을 못 엶 (${res?.status()})`);
    await p.waitForSelector("#user_pwd", { timeout: 15000 });
    await p.fill("#user_id", id);
    await p.fill("#user_pwd", pw);
    const go = p.locator("img[onclick*='doSubmit']").first();
    if (await go.count()) await go.click();
    else await p.press("#user_pwd", "Enter");
    await p.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    if (!(await p.locator("text=매출관리").count()) && !p.frames().some((f) => f.url().includes("top_frame"))) {
      await p.waitForTimeout(3000);
      if (p.url().includes("login_form")) throw new Error("로그인 안 됨 — 아이디 · 비밀번호(OKPOS_ID · OKPOS_PW)를 확인해 주세요");
    }
    say("로그인 됨");
  }

  /** 영수증별매출상세현황 화면 (틀 MainFrm) */
  async openReceipts(): Promise<Frame> {
    for (const m of MENU) {
      let ok = false;
      for (const f of this.page.frames()) {
        const el = f.getByText(m, { exact: true }).first();
        if (await el.isVisible().catch(() => false)) {
          await el.click({ timeout: 5000 });
          ok = true;
          break;
        }
      }
      if (!ok) throw new Error(`메뉴 '${m}' 를 못 찾음`);
      await this.page.waitForTimeout(1500);
    }
    const mf = this.page.frame({ name: "MainFrm" });
    if (!mf || !(await until(mf, `!!document.getElementById("ss_SHOP_NM") && typeof doAction === "function"`, 20000))) throw new Error("영수증별매출상세현황 화면이 안 열림");
    say("영수증별매출상세현황 열림");
    return mf;
  }

  /** 매장 고르기 — 키즈: 이름에 '키즈', 카페: 이름에 '카페'(키즈 아님) */
  async pickShop(mf: Frame, store: Store) {
    await mf.click("#ss_SHOP_NM");
    let pf: Frame | undefined;
    for (let t = 0; t < 15000 && !pf; t += 500) {
      await this.page.waitForTimeout(500);
      pf = this.page.frames().find((f) => f.url().includes("shop_group_type_tree.jsp"));
    }
    if (!pf || !(await until(pf, `typeof mySheet1 !== "undefined" && mySheet1.LastRow() > 0`, 20000))) throw new Error("매장선택 창이 안 열림");
    const grid = (await pf.evaluate(`(() => {
      const s = mySheet1; const out = [];
      for (let r = 0; r <= s.LastRow(); r++) { const row = []; for (let c = 0; c <= s.LastCol(); c++) row.push(String(s.GetCellText(r, c))); out.push(row); }
      return out;
    })()`)) as string[][];
    const head = grid[0];
    const cName = head.indexOf("매장명");
    const cCode = head.indexOf("매장코드");
    if (cName < 0 || cCode < 0) throw new Error("매장선택 표 모양이 다름");
    const shops = grid.map((r, i) => ({ i, name: r[cName] || "", code: r[cCode] || "" })).filter((x) => x.i > 0 && x.code);
    const pick = shops.filter((x) => (store === "kids" ? /키즈/.test(x.name) : /카페/.test(x.name) && !/키즈/.test(x.name)));
    if (pick.length !== 1) {
      const kinds = shops.map((x) => [/키즈/.test(x.name) && "키즈", /카페/.test(x.name) && "카페", /아스타나/.test(x.name) && "아스타나"].filter(Boolean).join("+") || "그 밖").join(" / ");
      throw new Error(`${store} 매장을 하나로 못 고름 (${pick.length}곳 · 매장 이름 모양: ${kinds})`);
    }
    const row = pick[0].i;
    const how = await pf.evaluate(`(() => {
      mySheet1.SelectCell(${row}, ${cName});
      if (typeof mySheet1_OnDblClick === "function") { mySheet1_OnDblClick(${row}, ${cName}); return "OnDblClick"; }
      if (typeof mySheet1_OnClick === "function") { mySheet1_OnClick(${row}, ${cName}); return "OnClick"; }
      return "";
    })()`);
    if (!(await until(mf, `!!document.getElementById("ss_SHOP_CD").value`, 4000))) {
      // 화면 함수로 안 되면 사람처럼 그 칸을 두 번 누름
      await pf.getByText(pick[0].name, { exact: true }).first().dblclick({ timeout: 5000 }).catch(() => {});
    }
    if (!(await until(mf, `!!document.getElementById("ss_SHOP_CD").value`, 6000))) throw new Error(`${store} 매장이 선택되지 않음 (${how || "누름 함수 없음"})`);
    await until(mf, `document.getElementById("ss_POS_NO") && document.getElementById("ss_POS_NO").options.length > 0`, 8000);
    say(`${store} 매장 고름 (${how || "두 번 누름"})`);
  }

  /** 그 날짜 조회 → 엑셀 받기 */
  async download(mf: Frame, date: string): Promise<{ buf: Uint8Array; rows: number; name: string }> {
    await mf.evaluate(`document.getElementById("date1").value = ${JSON.stringify(date)}`);
    await mf.evaluate(`window.__searched = false; (function () { var old = window.mySheet1_OnSearchEnd; window.mySheet1_OnSearchEnd = function () { window.__searched = true; if (old) return old.apply(this, arguments); }; })(); fnSearch();`);
    const done = await until(mf, `window.__searched === true`, 60000);
    const rows = Number(await mf.evaluate("mySheet1.RowCount()"));
    if (!done && !(rows > 0)) throw new Error("조회가 60초 안에 안 끝남");
    const dl = this.page.waitForEvent("download", { timeout: 90000 });
    await mf.evaluate(`doAction("excel", 1)`);
    const d = await dl;
    const path = await d.path();
    if (!path) throw new Error("엑셀 파일을 못 받음");
    return { buf: new Uint8Array(await readFile(path)), rows, name: d.suggestedFilename() };
  }
}
