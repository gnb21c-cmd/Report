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

/** 화면 구조를 알아볼 때 글자를 보여도 되는 낱말 (가맹점 · 회사 이름이 나오지 않게 정해 둔 것만) */
const SAFE_WORDS = ["로그인", "확인", "취소", "닫기", "거래조회", "신용카드", "통합거래조회", "조회", "엑셀", "다운로드", "전체", "All", "선택", "정산 통계용", "가맹점", "합계", "비밀번호", "사유", "거래상세내역", "엑셀비밀번호", "다운로드사유선택", "주요업무", "로그아웃"];

/** 글자 · 단추(input value 포함) 이름으로 — 띄어쓰기 · 줄바꿈 무시 */
const loose = (t: string) => new RegExp(`^\\s*${t.split("").filter((c) => c.trim()).map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*")}\\s*$`);
const byName = (f: Frame, t: string) => f.getByText(loose(t)).or(f.getByRole("button", { name: loose(t) })).or(f.locator(`input[type=button][value="${t}"], input[type=submit][value="${t}"]`));

export class Nibs {
  private downloads: Download[] = [];
  private constructor(
    private browser: Browser,
    private ctx: BrowserContext,
    private page: Page,
  ) {}

  static async open(): Promise<Nibs> {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ locale: "ko-KR", timezoneId: "Asia/Seoul", acceptDownloads: true, viewport: { width: 1600, height: 1000 } });
    await ctx.addInitScript("globalThis.__name = (f) => f");
    const page = await ctx.newPage();
    const n = new Nibs(browser, ctx, page);
    const watch = (p: Page) => {
      p.on("dialog", async (d) => {
        say(`[알림창] ${mask(d.message())}`);
        await d.accept().catch(() => {});
      });
      p.on("download", (d) => n.downloads.push(d));
    };
    watch(page);
    ctx.on("page", watch);
    return n;
  }

  close() {
    return this.browser.close();
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
    const res = await p.goto(NIBS, { waitUntil: "domcontentloaded", timeout: 40000 });
    if (!res || res.status() >= 400) throw new Error(`로그인 화면을 못 엶 (${res?.status()})`);
    let pwBox = await this.visible((f) => f.locator("input[type=password]"), 20000);
    if (!pwBox) {
      say("로그인 화면이 덜 열려 새로고침");
      await p.goto(NIBS, { waitUntil: "domcontentloaded", timeout: 40000 });
      pwBox = await this.visible((f) => f.locator("input[type=password]"), 25000);
    }
    if (!pwBox) throw new Error("로그인 칸(비밀번호)을 못 찾음");
    // 아이디 칸 = 비밀번호 칸 앞의 보이는 글 칸
    const idBox = await this.visible((f) => f.locator("input:not([type=password]):not([type=hidden]):not([type=checkbox]):not([type=radio])"));
    if (!idBox) throw new Error("로그인 칸(아이디)을 못 찾음");
    await idBox.fill(id);
    await pwBox.fill(pw);
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
    for (let t = 0; t < 25000; t += 1000) {
      const ok = await this.visible((f) => byName(f, "확인"));
      if (ok) {
        await ok.click({ timeout: 5000 }).catch(() => {});
        say(`알림 확인 (${t / 1000}초) → ${this.where()}`);
        await p.waitForTimeout(800);
      }
      inside = !!(await this.visible((f) => f.locator('[id*="LogOut" i], [id*="Logout" i]'))) || !!(await this.visible((f) => byName(f, "거래조회")));
      if (p.url().startsWith("chrome-error")) throw new Error(`화면을 못 읽음 (${t / 1000}초)`);
      if (inside && !ok && t >= 3000) break; // 알림이 늦게 뜰 수 있어 3초는 더 봄
      await p.waitForTimeout(1000);
    }
    if (inside) {
      say("로그인 됨");
      return;
    }
    throw new Error("로그인 안 됨 — 아이디 · 비밀번호(NICE_ID · NICE_PW)를 확인해 주세요");
  }

  /** 거래조회 → 신용카드 → 통합거래조회 */
  async openSearch() {
    // 로그인 알림이 늦게 뜨는 때
    const late = await this.visible((f) => byName(f, "확인"), 1500);
    if (late) await late.click({ timeout: 3000 }).catch(() => {});
    if (!(await this.clickText("거래조회", 10000))) {
      const side = await this.visible((f) => f.locator('[id$="btn_sideIcon"], [id$="btn_aside"]'));
      if (side) {
        await side.click({ timeout: 5000 }).catch(() => {});
        say("옆 메뉴 펼침");
        await this.page.waitForTimeout(1500);
      }
      if (!(await this.clickText("거래조회", 5000))) throw new Error("메뉴 '거래조회' 를 못 찾음");
    }
    say("거래조회 누름");
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

  /** 가맹점(단말기 번호) 고르기 */
  async pickTerminal(cat: string) {
    const re = new RegExp(`\\[\\s*${cat}\\s*\\]`);
    // 1) 보통 고르기 칸(select)
    const sel = await this.visible((f) => f.locator("select").filter({ has: f.locator("option", { hasText: re }) }));
    if (sel) {
      const label = (await sel.locator("option", { hasText: re }).first().textContent()) || "";
      await sel.selectOption({ label: label.trim() }).catch(async () => sel.selectOption({ label }));
    } else {
      // 2) 화면 고르기 칸 — 지금 보이는 값('선택' 또는 '[ 번호 ] …')을 누르고 목록에서 고름
      const box = (await this.visible((f) => f.getByText(/^\s*\[\s*\d+\s*\]/))) || (await this.visible((f) => f.getByText("선택", { exact: true })));
      if (!box) throw new Error("가맹점 고르기 칸을 못 찾음");
      await box.click({ timeout: 5000 });
      await this.page.waitForTimeout(600);
      let item: Locator | null = null;
      for (const f of this.frames()) {
        const all = f.getByText(re);
        const n = await all.count().catch(() => 0);
        // 목록 쪽(마지막에 보이는 것)
        for (let i = n - 1; i >= 0 && !item; i--) if (await all.nth(i).isVisible().catch(() => false)) item = all.nth(i);
        if (item) break;
      }
      if (!item) throw new Error("가맹점 목록에 그 단말기가 없음");
      await item.click({ timeout: 5000 });
    }
    await this.page.waitForTimeout(800);
    // 골라졌는지 — 고르기 칸 값에 번호가 보여야 함
    const shown = await this.visible((f) => f.locator("select").filter({ has: f.locator("option", { hasText: re }) }));
    const ok = shown ? re.test((await shown.evaluate((s: any) => s.options[s.selectedIndex]?.text || "")) as string) : !!(await this.visible((f) => f.getByText(re)));
    if (!ok) throw new Error("가맹점이 골라지지 않음");
  }

  /** 조회기간 (YYYY-MM-DD 두 칸) */
  async setDates(from: string, to: string) {
    let boxes: Locator[] = [];
    for (const f of this.frames()) {
      const all = f.locator("input");
      const n = await all.count().catch(() => 0);
      const got: Locator[] = [];
      for (let i = 0; i < n && got.length < 2; i++) {
        const el = all.nth(i);
        if (!(await el.isVisible().catch(() => false))) continue;
        if (/^\d{4}-?\d{2}-?\d{2}$/.test(await el.inputValue().catch(() => ""))) got.push(el);
      }
      if (got.length === 2) {
        boxes = got;
        break;
      }
    }
    if (boxes.length !== 2) throw new Error("조회기간 칸을 못 찾음");
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
    const tries: [string, (f: Frame) => Locator][] = [
      ["title", (f) => f.locator('[title="조회"]')],
      ["alt", (f) => f.locator('[alt="조회"]')],
      ["이름", (f) => f.getByRole("button", { name: "조회", exact: true })],
      ["아이디", (f) => f.locator('[id*="btnSearch" i], [id*="btn_search" i], [id*="btnSch" i], [id*="btn_sch" i]')],
      ["글", (f) => byName(f, "조회")],
      ["모양", (f) => f.locator('[class*="btn_search" i], [class*="btnSearch" i], [class*="btn_sch" i], [class*="search" i]').filter({ hasNotText: /./ })],
    ];
    let how = "";
    for (const [name, make] of tries) {
      const el = await this.visible(make);
      if (el) {
        await el.click({ timeout: 5000 });
        how = name;
        break;
      }
    }
    if (!how) throw new Error("조회 단추를 못 찾음");
    await this.page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await this.page.waitForTimeout(2500);
    // 합계 줄 → 첫 숫자 = 총건수
    const sum = await this.visible((f) => f.getByText("합계", { exact: true }));
    if (!sum) return null;
    const row = (await sum.evaluate((el: any) => (el.closest("tr") || el.parentElement)?.innerText || "").catch(() => "")) as string;
    const nums = row.replace(/합계/, "").match(/-?[\d,]+/g);
    return nums ? Number(nums[0].replace(/,/g, "")) : null;
  }

  /** 전체 엑셀(All) → 비밀번호 · 사유 '정산 통계용' → 받은 파일과 그 비밀번호 */
  async excelAll(): Promise<{ buf: Uint8Array; password: string }> {
    const password = randomBytes(6).toString("hex"); // 영문 · 숫자 12자
    const before = this.downloads.length;
    const tries: ((f: Frame) => Locator)[] = [
      (f) => f.locator('[title*="All"], [alt*="All"]'),
      (f) => f.locator('[title*="전체"][title*="엑셀"], [alt*="전체"][alt*="엑셀"]'),
      (f) => f.locator('[id*="excelAll" i], [id*="ExcelAll" i], [id*="xlsAll" i], [id*="allExcel" i]'),
      (f) => f.getByText("All", { exact: true }),
    ];
    let btn: Locator | null = null;
    for (const make of tries) if ((btn = await this.visible(make))) break;
    if (!btn) throw new Error("전체 엑셀(All) 단추를 못 찾음");
    await btn.click({ timeout: 5000 });
    // 전체 엑셀 다운로드 창 (따로 뜨는 창 또는 화면 안 창) — 그 틀 안에서만 찾음
    let win: Frame | null = null;
    for (let t = 0; t < 20000 && !win; t += 500) {
      for (const fr of this.frames().reverse())
        if (await fr.getByText(/엑셀\s*비밀번호/).first().isVisible().catch(() => false)) {
          win = fr;
          break;
        }
      if (!win) await this.page.waitForTimeout(500);
    }
    if (!win) throw new Error("엑셀 다운로드 창이 안 뜸");
    const first = async (l: Locator) => {
      const n = await l.count().catch(() => 0);
      for (let i = 0; i < n; i++) if (await l.nth(i).isVisible().catch(() => false)) return l.nth(i);
      return null;
    };
    // 비밀번호 칸 — 창 안의 보이는 글 칸 중 마지막 (화면 안 창이면 뒤쪽 화면의 칸도 같은 틀에 있음)
    const pwAll = win.locator("input[type=password]");
    let pw = await first(pwAll);
    if (!pw) {
      const all = win.locator("input:not([type=hidden]):not([type=checkbox]):not([type=radio])");
      for (let i = (await all.count()) - 1; i >= 0 && !pw; i--) if (await all.nth(i).isVisible().catch(() => false)) pw = all.nth(i);
    }
    if (!pw) throw new Error("엑셀 비밀번호 칸을 못 찾음");
    await pw.fill(password);
    // 다운로드 사유 — 정산 통계용
    const reason = await first(win.locator("select").filter({ has: win.locator("option", { hasText: "정산 통계용" }) }));
    if (reason) await reason.selectOption({ label: "정산 통계용" });
    else {
      const all = win.getByText("선택", { exact: true });
      let box: Locator | null = null;
      for (let i = (await all.count()) - 1; i >= 0 && !box; i--) if (await all.nth(i).isVisible().catch(() => false)) box = all.nth(i);
      if (!box) throw new Error("다운로드 사유 칸을 못 찾음");
      await box.click({ timeout: 5000 });
      await this.page.waitForTimeout(500);
      const item = await first(win.getByText("정산 통계용", { exact: true }));
      if (!item) throw new Error("사유 '정산 통계용' 을 못 고름");
      await item.click({ timeout: 5000 });
    }
    // 확인 — 다운로드 창의 [확인] (마지막에 보이는 것)
    const oks = byName(win, "확인");
    let ok: Locator | null = null;
    for (let i = (await oks.count()) - 1; i >= 0 && !ok; i--) if (await oks.nth(i).isVisible().catch(() => false)) ok = oks.nth(i);
    if (!ok) throw new Error("다운로드 창 [확인] 을 못 찾음");
    await ok.click({ timeout: 5000 });
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
