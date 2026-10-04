/* ============================================================
   나이스 NIBS(nibs.nicevan.co.kr) — 사람이 하는 순서 그대로
   로그인 → 로그인 시각 알림 [확인] → 거래조회 → 신용카드 → 통합거래조회
   → 가맹점(단말기) 고르기 → 조회기간 → 조회(돋보기) → 전체 엑셀(All) → 엑셀 비밀번호 · 사유 '정산 통계용' → 확인
   엑셀 비밀번호는 실행마다 새로 만들어 받자마자 풂 (어디에도 남기지 않음)
   공개 저장소라 기록(로그)에는 매출 숫자 · 가맹점 이름 · 회사 이름을 남기지 않음
   ============================================================ */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chromium, type Browser, type BrowserContext, type Download, type Frame, type Locator, type Page } from "playwright";
import { mask, say } from "./okpos";

export const NIBS = "https://nibs.nicevan.co.kr/";
/** 로그인 화면 — 첫 화면(websquare.html)에서 들어가면 연결이 끊기는 때가 많고, login.jsp 에서는 잘 들어가짐 */
export const NIBS_LOGIN = "https://nibs.nicevan.co.kr/websquare/login.jsp";
export const NIBS_MAIN = "https://nibs.nicevan.co.kr/websquare/index.jsp";

/** 화면 구조를 알아볼 때 글자를 보여도 되는 낱말 (가맹점 · 회사 이름이 나오지 않게 정해 둔 것만) */
const SAFE_WORDS = ["로그인", "확인", "취소", "닫기", "거래조회", "신용카드", "통합거래조회", "조회", "엑셀", "다운로드", "전체", "All", "선택", "정산 통계용", "가맹점", "합계", "비밀번호", "사유", "거래상세내역", "엑셀비밀번호", "다운로드사유선택", "주요업무", "로그아웃"];

/** 글자 · 단추(input value 포함) 이름으로 — 띄어쓰기 · 줄바꿈 무시 */
const loose = (t: string) => new RegExp(`^\\s*${t.split("").filter((c) => c.trim()).map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*")}\\s*$`);
const byName = (f: Frame, t: string) => f.getByText(loose(t)).or(f.getByRole("button", { name: loose(t) })).or(f.locator(`input[type=button][value="${t}"], input[type=submit][value="${t}"]`));

/** 사람처럼 단계 사이에 쉼 (1.5 ~ 3초) */
const pause = (min = 1500, max = 3000) => new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));

export class Nibs {
  private downloads: Download[] = [];
  failLogs = 0;
  private constructor(
    private browser: Browser,
    private ctx: BrowserContext,
    private page: Page,
  ) {}

  static async open(): Promise<Nibs> {
    const browser = await chromium.launch();
    // 보통 PC 크롬처럼 (headless 표시가 있으면 막는 곳이 있음)
    const ua = (await browser.newPage().then(async (p) => {
      const u = await p.evaluate(() => navigator.userAgent);
      await p.close();
      return u;
    })).replace(/HeadlessChrome/g, "Chrome");
    const ctx = await browser.newContext({ locale: "ko-KR", timezoneId: "Asia/Seoul", acceptDownloads: true, viewport: { width: 1600, height: 1000 }, userAgent: ua.replace(/X11; Linux x86_64/, "Windows NT 10.0; Win64; x64") });
    await ctx.addInitScript("globalThis.__name = (f) => f");
    const page = await ctx.newPage();
    const n = new Nibs(browser, ctx, page);
    const watch = (p: Page) => {
      p.on("dialog", async (d) => {
        say(`[알림창] ${mask(d.message())}`);
        await d.accept().catch(() => {});
      });
      p.on("download", (d) => n.downloads.push(d));
      p.on("requestfailed", (r) => {
        if (n.failLogs++ < 15) say(`[연결 실패] ${mask(r.url().replace(/[?;].*$/, "").replace(/^https:\/\/nibs\.nicevan\.co\.kr/, ""))} — ${r.failure()?.errorText || ""}`);
      });
      p.on("response", (r) => {
        if (r.status() >= 400 && n.failLogs++ < 15) say(`[응답 ${r.status()}] ${mask(r.url().replace(/[?;].*$/, "").replace(/^https:\/\/nibs\.nicevan\.co\.kr/, ""))}`);
      });
    };
    watch(page);
    ctx.on("page", watch);
    return n;
  }

  /** 로그아웃하고 닫음 — 세션을 남기면 다음 접속을 나이스가 막기도 함 */
  async close() {
    const out = await this.visible((f) => f.locator('[id$="btn_LogOut"]')).catch(() => null);
    if (out) {
      await out.click({ timeout: 3000 }).catch(() => {});
      await this.closeAlerts(1500).catch(() => {});
    }
    await this.browser.close();
  }

  /** 아직 들어가 있는지 (오류 화면 · 로그아웃이면 false) */
  async alive(): Promise<boolean> {
    if (this.page.url().startsWith("chrome-error")) return false;
    return !!(await this.visible((f) => f.locator('[id$="btn_LogOut"]')));
  }

  /** 열린 창(팝업 창 포함) · 틀 전부 */
  private frames(): Frame[] {
    return this.ctx.pages().flatMap((p) => (p.isClosed() ? [] : p.frames()));
  }

  /** 보이는 것 중 첫째 (모든 창 · 틀에서) */
  private async visible(make: (f: Frame) => Locator, ms = 0): Promise<Locator | null> {
    for (let t = 0; ; t += 500) {
      for (const f of this.frames()) {
        const all = make(f);
        const n = await all.count().catch(() => 0);
        for (let i = 0; i < n; i++) {
          const el = all.nth(i);
          if (await el.isVisible().catch(() => false)) return el;
        }
      }
      if (t >= ms) return null;
      await this.page.waitForTimeout(500);
    }
  }

  private async clickText(text: string, ms = 10000): Promise<boolean> {
    const el = await this.visible((f) => byName(f, text), ms);
    if (!el) return false;
    await el.click({ timeout: 5000 });
    return true;
  }

  /** 화면 구조 기록 — 아이디 · 종류 · 정해 둔 낱말만 (숫자 가림) */
  async probe(label: string) {
    say(`--- 화면 구조 (${label}) ---`);
    for (const p of this.ctx.pages()) say(`창: ${mask(p.url().replace(/\?.*$/, ""))}`);
    for (const f of this.frames()) {
      const items = (await f
        .evaluate(`(() => {
          const out = [];
          for (const el of document.querySelectorAll("input,select,button,a,[role=button],img[onclick],[class*=btn],[class*=selectbox],[id*=btn],[id*=Btn]")) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            out.push({ tag: el.tagName.toLowerCase(), id: el.id || "", cls: String(el.className || "").slice(0, 60), type: el.getAttribute("type") || "", title: el.getAttribute("title") || el.getAttribute("alt") || "", text: (el.innerText || el.value || "").trim().slice(0, 40) });
            if (out.length > 150) break;
          }
          // 메뉴 글자 (정해 둔 낱말만, 띄어쓰기 · 줄바꿈 무시)
          const safe = ${JSON.stringify(SAFE_WORDS.map((w) => w.replace(/\s/g, "")))};
          for (const el of document.querySelectorAll("li,a,span,div,p,label,td,th,button")) {
            if (el.children.length > 1) continue;
            const t = (el.innerText || "").replace(/\\s/g, "");
            if (!safe.includes(t)) continue;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            out.push({ tag: el.tagName.toLowerCase(), id: el.id || "", cls: String(el.className || "").slice(0, 60), type: "", title: "", text: t });
            if (out.length > 260) break;
          }
          // 왼쪽 파란 줄 (메뉴 아이콘) — 화면 왼쪽 90px 안
          let left = 0;
          for (const el of document.querySelectorAll("body *")) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height || r.left > 90 || r.width > 120 || r.top > 500) continue;
            const t = (el.innerText || el.value || "").replace(/\\s/g, "");
            out.push({ tag: "왼쪽 " + el.tagName.toLowerCase(), id: el.id || "", cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || "").slice(0, 60), type: el.getAttribute("type") || "", title: el.getAttribute("title") || el.getAttribute("alt") || "", text: safe.includes(t) ? t : t ? "(" + t.length + "자)" : "" });
            if (++left > 60) break;
          }
          return out;
        })()`)
        .catch(() => [])) as { tag: string; id: string; cls: string; type: string; title: string; text: string }[];
      if (!items.length) continue;
      say(`틀: ${mask(f.url().replace(/\?.*$/, ""))} · ${items.length}개`);
      const safe = (s: string) => (SAFE_WORDS.map((w) => w.replace(/\s/g, "")).includes(s.replace(/\s/g, "")) ? s.trim() : s ? `(${s.length}자)` : "");
      for (const x of items) say(`  ${x.tag}${x.type ? `[${x.type}]` : ""} #${mask(x.id)} .${mask(x.cls)}${x.title ? ` title=${safe(x.title)}` : ""}${x.text ? ` 글=${safe(x.text)}` : ""}`);
    }
  }

  /** 지금 창 주소 (물음표 뒤 · 숫자 가림) */
  private where() {
    return this.ctx
      .pages()
      .map((p) => mask(p.url().replace(/\?.*$/, "")))
      .join(" | ");
  }

  async login(id: string, pw: string) {
    const p = this.page;
    let res: Awaited<ReturnType<Page["goto"]>> = null;
    for (let i = 0; i < 3; i++) {
      res = await p.goto(NIBS_LOGIN, { waitUntil: "domcontentloaded", timeout: 40000 }).catch((e) => {
        say(`로그인 화면 열기 실패 (${i + 1}번째): ${mask(String(e.message).split("\n")[0])}`);
        return null;
      });
      if (res && res.status() < 400) break;
      await p.waitForTimeout(5000 * (i + 1));
    }
    if (!res || res.status() >= 400) throw new Error(`로그인 화면을 못 엶 (${res?.status()})`);
    let pwBox = await this.visible((f) => f.locator("input[type=password]"), 20000);
    if (!pwBox) {
      say("로그인 화면이 덜 열려 새로고침");
      await p.goto(NIBS_LOGIN, { waitUntil: "domcontentloaded", timeout: 40000 });
      pwBox = await this.visible((f) => f.locator("input[type=password]"), 25000);
    }
    if (!pwBox) throw new Error("로그인 칸(비밀번호)을 못 찾음");
    // 아이디 칸 = 비밀번호 칸 앞의 보이는 글 칸
    const idBox = await this.visible((f) => f.locator("input:not([type=password]):not([type=hidden]):not([type=checkbox]):not([type=radio])"));
    if (!idBox) throw new Error("로그인 칸(아이디)을 못 찾음");
    await pause();
    await idBox.click();
    await idBox.pressSequentially(id, { delay: 90 + Math.random() * 60 });
    await pause(600, 1200);
    await pwBox.click();
    await pwBox.pressSequentially(pw, { delay: 90 + Math.random() * 60 });
    await pause(600, 1200);
    say(`로그인 화면: ${this.where()}`);
    await pwBox.press("Enter");
    await p.waitForTimeout(3000);
    say(`Enter 뒤: ${this.where()}`);
    if (await pwBox.isVisible().catch(() => false)) {
      const btn = await this.visible((f) => f.locator("button, a, input[type=button], input[type=submit], [role=button]").filter({ hasText: /^\s*로그인\s*$/ }));
      if (btn) await btn.click();
      else await this.clickText("로그인", 2000);
    }
    // 들어가졌는지 = 로그아웃 단추 또는 왼쪽 메뉴가 보임 · 로그인 시각 알림 → [확인]
    let inside = false;
    let reopened = false;
    for (let t = 0; t < 45000; t += 1000) {
      const ok = await this.visible((f) => byName(f, "확인"));
      if (ok) {
        await ok.click({ timeout: 5000 }).catch(() => {});
        say(`알림 확인 (${t / 1000}초) → ${this.where()}`);
        await p.waitForTimeout(800);
      }
      inside = !!(await this.visible((f) => f.locator('[id*="LogOut" i], [id*="Logout" i]'))) || !!(await this.visible((f) => byName(f, "거래조회")));
      // 로그인 직후 연결이 끊겨 오류 화면이 되는 때 — 로그인은 서버에 남아 있을 수 있어 메인 화면을 한 번 직접 엶 (다시 로그인 아님)
      if (p.url().startsWith("chrome-error")) {
        if (reopened) throw new Error(`화면을 못 읽음 (${t / 1000}초)`);
        reopened = true;
        say("로그인 뒤 오류 화면 → 메인 화면을 직접 엶");
        await p.waitForTimeout(3000);
        await p.goto(NIBS_MAIN, { waitUntil: "domcontentloaded", timeout: 40000 }).catch(() => {});
        await p.waitForTimeout(3000);
        say(`→ ${this.where()}`);
        continue;
      }
      if (inside && !ok && t >= 3000) break; // 알림이 늦게 뜰 수 있어 3초는 더 봄
      // 들어가졌는데(index.jsp) 화면이 비어 있으면 — 나이스 화면 파일이 덜 온 것 → 새로고침 (로그인은 유지됨)
      if (!inside && (t === 15000 || t === 30000) && /index\.jsp/.test(p.url())) {
        const n = await p.evaluate("document.querySelectorAll('body *').length").catch(() => -1);
        say(`메인 화면이 비어 있음 (요소 ${n}개) → 새로고침`);
        await p.reload({ waitUntil: "domcontentloaded", timeout: 40000 }).catch(() => {});
        await p.waitForTimeout(3000);
      }
      await p.waitForTimeout(1000);
    }
    if (inside) {
      say("로그인 됨");
      return;
    }
    throw new Error("로그인 안 됨 — 아이디 · 비밀번호(NICE_ID · NICE_PW)를 확인해 주세요");
  }

  /** 화면 안 알림창(로그인 시각 등)의 [확인] — 떠 있는 동안 다 누름 */
  private async closeAlerts(ms: number) {
    for (let t = 0; t <= ms; t += 500) {
      let ok = await this.visible((f) => f.locator('[id*="alert_"][id$="btn_Confirm"], [id*="alert_"][id$="btn_confirm"]'));
      if (!ok) ok = await this.visible((f) => f.locator('[id*="alert_"] input[type=button]').filter({ hasText: /./ }).or(f.locator('[id*="alert_"] input[type=button][value="확인"]')));
      if (ok) {
        await ok.click({ timeout: 5000 }).catch(() => {});
        say("알림창 확인");
        await this.page.waitForTimeout(700);
        continue;
      }
      await this.page.waitForTimeout(500);
    }
  }

  /** 거래조회 → 신용카드 → 통합거래조회 */
  async openSearch() {
    // 로그인 시각 알림이 늦게 떠서 메뉴를 가림
    await this.closeAlerts(4000);
    // 새로고침 뒤에는 왼쪽 메뉴가 늦게 채워짐 → 메뉴가 보일 때까지 기다림 (30초)
    const menuItem = (f: Frame) => f.locator('[id^="mf_side_gen_topMenu_"][id$="_btn_menu"]').filter({ hasText: loose("거래조회") });
    if (!(await this.visible(menuItem, 15000))) {
      // 메뉴 자료를 못 받은 것 → 메인 화면만 새로고침 (로그인은 유지됨)
      say("왼쪽 메뉴가 비어 있음 → 메인 화면 새로고침");
      await this.page.reload({ waitUntil: "domcontentloaded", timeout: 40000 }).catch(() => {});
      await this.page.waitForTimeout(3000);
      await this.closeAlerts(3000);
      if (!(await this.visible(menuItem, 30000))) {
        const n = await this.page.evaluate("document.querySelectorAll('#mf_side_gen_topMenu li').length").catch(() => -1);
        throw new Error(`왼쪽 메뉴가 안 채워짐 (새로고침 뒤에도, 메뉴 칸 ${n}개)`);
      }
    }
    // 알림창이 몇 초 뒤에 떠서 메뉴를 가리기도 함 → 짧게 눌러 보고, 막히면 알림창 닫고 다시
    let clicked = false;
    for (let t = 0; t < 40000 && !clicked; t += 3000) {
      const menu = (await this.visible((f) => f.locator('[id^="mf_side_gen_topMenu_"][id$="_btn_menu"]').filter({ hasText: loose("거래조회") }), 3000)) || (await this.visible((f) => byName(f, "거래조회")));
      if (!menu) throw new Error("메뉴 '거래조회' 를 못 찾음");
      clicked = await menu.click({ timeout: 2000 }).then(
        () => true,
        () => false,
      );
      if (!clicked) await this.closeAlerts(1000);
    }
    if (!clicked) throw new Error("메뉴 '거래조회' 가 눌리지 않음 (알림창에 가림)");
    say("거래조회 누름");
    await pause();
    await this.page.waitForTimeout(800);
    if (!(await this.visible((f) => byName(f, "통합거래조회"), 2000))) {
      if (!(await this.clickText("신용카드"))) throw new Error("메뉴 '신용카드' 를 못 찾음");
      await this.page.waitForTimeout(800);
    }
    if (!(await this.clickText("통합거래조회"))) throw new Error("메뉴 '통합거래조회' 를 못 찾음");
    if (!(await this.visible((f) => byName(f, "거래상세내역"), 30000))) throw new Error("통합거래조회 화면이 안 열림");
    await this.page.waitForTimeout(1500);
    say("통합거래조회 열림");
  }

  /** 통합거래조회 화면 안 요소 (탭 번호가 바뀌어도 끝 아이디로) */
  private async el(suffix: string, ms = 5000): Promise<Locator> {
    const el = await this.visible((f) => f.locator(`[id$="_body_${suffix}"]`), ms);
    if (!el) throw new Error(`화면에서 '${suffix}' 를 못 찾음`);
    return el;
  }

  /** 가맹점(단말기 번호) 고르기 — 검색해서 고르는 칸: 번호를 치고 목록에서 고름 */
  async pickTerminal(cat: string) {
    await pause();
    await this.closeAlerts(500);
    const re = new RegExp(`\\[\\s*${cat}\\s*\\]`);
    // 평소엔 글자('선택')만 보이고, 누르면 입력칸이 나옴
    let box = await this.visible((f) => f.locator('[id$="_body_sbx_CatIdS_input"]'), 500);
    if (!box) {
      await (await this.el("sbx_CatIdS")).click({ timeout: 5000 });
      await this.page.waitForTimeout(700);
      box = await this.el("sbx_CatIdS_input");
    }
    await box.click({ timeout: 5000 });
    await box.press("Control+A");
    await box.pressSequentially(cat, { delay: 60 });
    await this.page.waitForTimeout(1200);
    // 목록에서 그 번호 줄 (입력칸 자신은 빼고)
    let item: Locator | null = null;
    for (const f of this.frames()) {
      const all = f.getByText(re);
      const n = await all.count().catch(() => 0);
      for (let i = 0; i < n && !item; i++) {
        const x = all.nth(i);
        if ((await x.evaluate((e: any) => e.tagName).catch(() => "")) === "INPUT") continue;
        if (await x.isVisible().catch(() => false)) item = x;
      }
      if (item) break;
    }
    if (item) await item.click({ timeout: 5000 });
    else {
      await box.press("ArrowDown");
      await box.press("Enter");
    }
    await this.page.waitForTimeout(800);
    const label = await this.visible((f) => f.locator('[id$="_body_sbx_CatIdS_label"]'));
    const v = (await box.inputValue().catch(() => "")) + " " + (label ? await label.innerText().catch(() => "") : "");
    if (!v.includes(cat)) throw new Error(`가맹점이 골라지지 않음 (${item ? "목록 누름" : "목록 없음"})`);
  }

  /** 조회기간 (YYYY-MM-DD 두 칸) */
  async setDates(from: string, to: string) {
    await pause();
    const boxes = [await this.el("wfm_day_ibx_frDay"), await this.el("wfm_day_ibx_toDay")];
    const put = async (el: Locator, d: string) => {
      await el.click({ timeout: 5000 });
      await el.press("Control+A");
      await el.pressSequentially(d.replace(/-/g, ""), { delay: 40 });
      await el.press("Tab");
      await this.page.waitForTimeout(300);
      if ((await el.inputValue()).replace(/-/g, "") !== d.replace(/-/g, "")) {
        await el.fill(d);
        await el.press("Tab");
      }
      const v = (await el.inputValue()).replace(/-/g, "");
      if (v !== d.replace(/-/g, "")) throw new Error("조회기간이 들어가지 않음");
    };
    await put(boxes[0], from);
    await put(boxes[1], to);
  }

  /** 조회(돋보기) → 위 '거래집계내역' 합계 줄의 총건수 (모르면 null) */
  async search(): Promise<number | null> {
    await pause();
    await (await this.el("btn_Search")).click({ timeout: 5000 });
    await this.page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await this.page.waitForTimeout(2500);
    await this.closeAlerts(1000);
    // 합계 줄 → 첫 숫자 = 총건수
    const sum = await this.visible((f) => f.getByText("합계", { exact: true }));
    if (!sum) return null;
    const row = (await sum.evaluate((el: any) => (el.closest("tr") || el.parentElement)?.innerText || "").catch(() => "")) as string;
    const nums = row.replace(/합계/, "").match(/-?[\d,]+/g);
    return nums ? Number(nums[0].replace(/,/g, "")) : null;
  }

  /** 따로 뜬 엑셀 다운로드 창 — 오류 화면이면 닫고 단추를 한 번 더 누름 */
  private async popupWindow(): Promise<Page | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      for (let t = 0; t < 20000; t += 500) {
        const w = this.ctx.pages().find((p) => p !== this.page && !p.isClosed() && /popup\.html|chrome-error/.test(p.url()));
        if (w && w.url().startsWith("chrome-error")) {
          say("다운로드 창이 오류 화면 → 닫고 한 번 더");
          await w.close().catch(() => {});
          break;
        }
        if (w && (await w.locator("#mf_ibx_password").isVisible().catch(() => false))) return w;
        await this.page.waitForTimeout(500);
      }
      if (attempt === 0) {
        await pause();
        await (await this.el("btnPexl2")).click({ timeout: 5000 });
      }
    }
    return null;
  }

  /** 전체 엑셀(All) → 비밀번호 · 사유 '정산 통계용' → 받은 파일과 그 비밀번호 */
  async excelAll(): Promise<{ buf: Uint8Array; password: string }> {
    const password = randomBytes(6).toString("hex"); // 영문 · 숫자 12자
    const before = this.downloads.length;
    for (const p of this.ctx.pages()) if (p !== this.page && !p.isClosed()) await p.close().catch(() => {});
    await pause();
    await (await this.el("btnPexl2")).click({ timeout: 5000 });
    // 전체 엑셀 다운로드 창 = 따로 뜨는 창 popup.html (#mf_ibx_password · #mf_sbx_reasonS · #mf_btn_selectData)
    const win = await this.popupWindow();
    if (!win) throw new Error("엑셀 다운로드 창이 안 뜸");
    await pause(800, 1500);
    const pw = win.locator("#mf_ibx_password");
    await pw.click({ timeout: 5000 });
    await pw.pressSequentially(password, { delay: 80 });
    await pause(600, 1200);
    // 다운로드 사유 — 정산 통계용
    const reason = win.locator("#mf_sbx_reasonS");
    await reason.click({ timeout: 5000 });
    await win.waitForTimeout(700);
    const item = win.getByText("정산 통계용", { exact: true });
    let picked = false;
    for (let i = (await item.count()) - 1; i >= 0 && !picked; i--)
      if (await item.nth(i).isVisible().catch(() => false)) {
        await item.nth(i).click({ timeout: 5000 });
        picked = true;
      }
    if (!picked) {
      await reason.press("ArrowDown").catch(() => {});
      await reason.press("Enter").catch(() => {});
    }
    await win.waitForTimeout(500);
    if (!/정산/.test(await win.locator("#mf_sbx_reasonS_label").innerText().catch(() => ""))) throw new Error("사유 '정산 통계용' 이 골라지지 않음");
    await pause(600, 1200);
    await win.locator("#mf_btn_selectData").click({ timeout: 5000 });
    for (let t = 0; t < 90000 && this.downloads.length === before; t += 500) await this.page.waitForTimeout(500);
    const d = this.downloads[this.downloads.length - 1];
    if (this.downloads.length === before || !d) throw new Error("엑셀 파일이 90초 안에 안 옴");
    const path = await d.path();
    if (!path) throw new Error("엑셀 파일을 못 받음");
    // 따로 뜬 다운로드 창이 남아 있으면 닫음
    for (const p of this.ctx.pages()) if (p !== this.page && !p.isClosed()) await p.close().catch(() => {});
    return { buf: new Uint8Array(await readFile(path)), password };
  }
}
