/* ============================================================
   네이버 스마트플레이스 예약 관리(partner.booking.naver.com) — 사람이 하는 순서 그대로
   예약 → 예약현황 → 일간 · 전체 → 날짜를 어제로 → 회차 칸마다 '이용완료 N' 읽기
   → 그 칸을 누르면 오른쪽에 나오는 완료자 목록(1줄 = 예약 1건)에서 줄마다 '완료 N' · 손님 표시 읽기 → 닫기
   로그인은 POS 메인 PC에서 사람이 한 번 해 둔 상태(state.json)를 씀 (naver-login/login.mjs)
   같은 손님인지 맞춰 보려고 이름 · 전화 뒷자리를 읽지만 바로 알아볼 수 없는 값으로 바꾸고 원래 글은 버림 — 저장 · 기록하지 않음
   공개 저장소라 기록에는 칸 수 · 같음/다름만 남김 (인원 숫자 · 상품 이름 · 사업장 번호 없음)
   ============================================================ */
import { createHash, randomBytes } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { NaverCellRead } from "@report/core";
import { mask, say } from "./okpos";

export const NAVER_PARTNER = "https://partner.booking.naver.com/";
const pause = (min = 800, max = 1600) => new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
const DATE_RE = "(\\d{4})\\.\\s*(\\d{1,2})\\.\\s*(\\d{1,2})\\.";

export class NaverBook {
  /** 손님 표시를 만들 때 섞는 값 — 실행마다 새로, 어디에도 남기지 않음 */
  private salt = randomBytes(16).toString("hex");
  private biz = "";
  private date = "";
  private told = false;
  private toldLost = false;
  private toldMiss = false;
  /** 상품 이름 → 완료자 목록 주소 (상품번호 · 이용완료 조건) */
  private listQuery = new Map<string, { base: string; item: string; status: string }>();
  private constructor(
    private browser: Browser,
    private ctx: BrowserContext,
    readonly page: Page,
  ) {}

  static async open(statePath: string): Promise<NaverBook> {
    const browser = await chromium.launch();
    const ua = (await browser.newPage().then(async (p) => {
      const u = await p.evaluate(() => navigator.userAgent);
      await p.close();
      return u;
    })).replace(/HeadlessChrome/g, "Chrome");
    const ctx = await browser.newContext({ locale: "ko-KR", timezoneId: "Asia/Seoul", viewport: { width: 1600, height: 1000 }, userAgent: ua, storageState: statePath });
    await ctx.addInitScript("globalThis.__name = (f) => f");
    const page = await ctx.newPage();
    page.on("dialog", async (d) => {
      say(`[알림창] ${mask(d.message()).slice(0, 80)}`);
      await d.accept().catch(() => {});
    });
    return new NaverBook(browser, ctx, page);
  }

  close() {
    return this.browser.close();
  }

  /** 쓸 때마다 새로 받은 로그인 상태를 다시 저장 (오래 유지되게) */
  async saveState(statePath: string) {
    await this.ctx.storageState({ path: statePath }).catch(() => {});
  }

  /** 로그인되어 있는지 + 사업장 번호 (주어지지 않으면 첫 화면 주소에서 찾음) */
  async enter(biz: string): Promise<string> {
    const p = this.page;
    await p.goto(biz ? `${NAVER_PARTNER}bizes/${biz}/booking-calendar-view` : NAVER_PARTNER, { waitUntil: "domcontentloaded", timeout: 45000 });
    await p.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    if (/nid\.naver\.com/.test(p.url())) throw new Error("네이버 로그인이 풀렸습니다 — POS 메인 PC의 naver-login.cmd 를 더블클릭해 다시 로그인해 주세요");
    if (!biz) {
      // 주소에 없으면 (스마트플레이스 첫 화면으로 가는 경우) 화면 안 링크에서 예약 관리 사업장 번호를 찾음
      const find = async () =>
        (p.url().match(/\/bizes\/(\d+)/) || [])[1] ||
        ((await p.evaluate(`(() => { const s = [...document.querySelectorAll("a[href]")].map((a) => a.href).join(" ") + " " + document.documentElement.innerHTML; const m = s.match(/booking\\.naver\\.com\\/bizes\\/(\\d+)/) || s.match(/\\/bizes\\/(\\d+)/); return m ? m[1] : ""; })()`).catch(() => "")) as string);
      let found = "";
      for (let t = 0; t < 20 && !(found = await find()); t++) await p.waitForTimeout(1000);
      const m = found ? [found, found] : null;
      if (!m) throw new Error("사업장 번호를 못 찾음 — GitHub Secrets 에 NAVER_BIZ_ID 를 넣어 주세요");
      biz = m[1];
      await p.goto(`${NAVER_PARTNER}bizes/${biz}/booking-calendar-view`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await p.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    }
    if (/nid\.naver\.com/.test(p.url())) throw new Error("네이버 로그인이 풀렸습니다 — POS 메인 PC의 naver-login.cmd 를 더블클릭해 다시 로그인해 주세요");
    say("네이버 예약현황 열림");
    this.biz = biz;
    return biz;
  }

  /** 지금 화면의 날짜 (YYYY-MM-DD, 모르면 null) */
  private async shownDate(): Promise<string | null> {
    const t = (await this.page.evaluate(`(() => {
      const re = new RegExp(${JSON.stringify(DATE_RE)});
      for (const el of document.querySelectorAll("body *")) {
        if (el.children.length) continue;
        const s = (el.innerText || "").trim();
        if (re.test(s) && s.length < 30) return s;
      }
      return "";
    })()`)) as string;
    const m = t.match(new RegExp(DATE_RE));
    return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
  }

  /** '일간' · '전체' 로 두고 날짜를 date 로 — 날짜 글 옆의 < · > 단추를 누름 */
  async gotoDate(date: string) {
    const p = this.page;
    this.date = date;
    await p.getByText("전체", { exact: true }).first().click({ timeout: 5000 }).catch(() => {});
    for (let i = 0; i < 40; i++) {
      const now = await this.shownDate();
      if (!now) throw new Error("예약현황 날짜 글을 못 찾음");
      if (now === date) {
        await p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        await p.waitForTimeout(1500);
        return;
      }
      const dir = date < now ? "prev" : "next";
      // 날짜 글과 같은 줄, 왼쪽(이전) · 오른쪽(다음)에서 가장 가까운 누를 수 있는 것
      const ok = await p.evaluate(`(() => {
        const re = new RegExp(${JSON.stringify(DATE_RE)});
        let d = null;
        for (const el of document.querySelectorAll("body *")) { if (!el.children.length && re.test((el.innerText || "").trim())) { d = el; break; } }
        if (!d) return false;
        const r = d.getBoundingClientRect(); const cy = r.top + r.height / 2;
        let best = null, bestDx = 1e9;
        for (const b of document.querySelectorAll("button, a, [role=button]")) {
          const q = b.getBoundingClientRect();
          if (!q.width || Math.abs(q.top + q.height / 2 - cy) > 20) continue;
          const dx = ${dir === "prev" ? "r.left - q.right" : "q.left - r.right"};
          if (dx >= -2 && dx < bestDx) { best = b; bestDx = dx; }
        }
        if (!best) return false;
        best.click(); return true;
      })()`);
      if (!ok) throw new Error(`예약현황 날짜 ${dir === "prev" ? "이전" : "다음"} 단추를 못 찾음`);
      await pause(700, 1200);
    }
    throw new Error("예약현황 날짜를 맞추지 못함");
  }

  /** 회차 칸마다 (상품 · 시각 · 이용완료) — 칸 위치로 상품 열과 시각을 찾음. 누를 칸에는 표시(data-nv)를 붙임 */
  async readCells(): Promise<{ cells: (Omit<NaverCellRead, "first"> & { key: number })[]; rows: number; headers: string[] }> {
    const r = (await this.page.evaluate(`(() => {
      const leaf = (el) => !el.children.length || [...el.children].every((c) => !(c.innerText || "").trim());
      const box = (el) => el.getBoundingClientRect();
      const txt = (el) => (el.innerText || "").trim();
      const els = [...document.querySelectorAll("body *")].filter((el) => box(el).width > 0);
      const rowLabels = els.filter((el) => leaf(el) && /^\\d+회차$/.test(txt(el)));
      if (!rowLabels.length) return { cells: [], rows: 0, headers: [] };
      const timeEls = els.filter((el) => leaf(el) && /^(오전|오후)?\\s*\\d{1,2}:\\d{2}$/.test(txt(el)));
      // 표 윗변 = 첫 회차 이름 · 첫 시각 글 중 더 위
      const gridTop = Math.min(...rowLabels.map((el) => box(el).top), ...timeEls.map((el) => box(el).top));
      const gridLeft = Math.max(...rowLabels.map((el) => box(el).right));
      // 상품 머리줄 = 첫 회차 바로 위 띠의 글
      const heads = els.filter((el) => { const b = box(el); const t = txt(el); return leaf(el) && t.length > 1 && b.bottom <= gridTop + 2 && b.top >= gridTop - 90 && b.left >= gridLeft - 2 && !/^(전체|신청|확정|예약가능|완료\\/노쇼|잔여예약|잔여|이용완료|완료|일간|주간|월간)$/.test(t) && !/^(오전|오후)?\\s*\\d{1,2}:\\d{2}$/.test(t) && !/^\\d+$/.test(t); })
        .map((el) => ({ el, b: box(el), t: (el.getAttribute("title") || txt(el)).replace(/\\s+/g, " ") }));
      // '오전' · '오후' 가 옆 글로 따로 있으면 붙여서
      const times = timeEls.map((el) => { const pt = el.parentElement ? txt(el.parentElement) : ""; return { b: box(el), t: /(오전|오후)/.test(txt(el)) || !/(오전|오후)/.test(pt) || pt.length > 15 ? txt(el) : pt }; });
      // '이용완료' 를 품은 가장 작은 칸 ('이용완료' 만 · '이용완료 7' · '이용완료7' 모두)
      // 칸이 좁으면 '완료', 넓으면 '이용완료' 로 보임 — 표 안(첫 회차 아래 · 회차 이름 오른쪽)에서만 (칸 줄은 단추일 수 있음)
      const doneRe = /^(이용)?완료\\s*\\d*$/;
      const dones = els.filter((el) => { const b = box(el); return b.top >= gridTop - 2 && b.left >= gridLeft - 2 && doneRe.test(txt(el)) && ![...el.children].some((c) => /완료/.test(txt(c))) && !el.closest("[role=tab], [role=tablist]"); });
      const cells = [];
      dones.forEach((el, i) => {
        const b = box(el); const cx = b.left + b.width / 2;
        const h = heads.find((x) => x.b.left - 2 <= cx && cx <= x.b.right + 2) || heads.reduce((a, x) => (!a || Math.abs((x.b.left + x.b.right) / 2 - cx) < Math.abs((a.b.left + a.b.right) / 2 - cx) ? x : a), null);
        const col = h ? h.b : b;
        const tm = times.filter((x) => x.b.top < b.top && x.b.left >= col.left - 40 && x.b.left <= col.right + 2).sort((a, z) => z.b.top - a.b.top)[0];
        // 숫자 = 이용완료 글을 품은 줄(부모)의 숫자
        let p = el.parentElement, n = null;
        const own = txt(el).match(/\\d+/);
        if (own) n = Number(own[0]);
        for (let k = 0; k < 3 && p && n == null; k++, p = p.parentElement) { const m = txt(p).replace(/(이용)?완료/, "").match(/\\d+/); if (m) n = Number(m[0]); }
        el.setAttribute("data-nv", String(i));
        cells.push({ key: i, product: h ? h.t : "", time: tm ? tm.t : "", done: n == null ? 0 : n });
      });
      return { cells, rows: rowLabels.length, headers: heads.map((x) => x.t) };
    })()`)) as { cells: (Omit<NaverCellRead, "first"> & { key: number })[]; rows: number; headers: string[] };
    return r;
  }

  /** 이용완료 칸을 눌러 오른쪽 완료자 목록을 읽음 — 줄(예약 1건)마다 손님 표시 · '완료 N' · 예약번호
   *  손님 표시는 이름 · 전화 뒷자리를 이번 실행에서만 쓰는 무작위 값과 섞어 바꾼 것 (원래 글은 바로 버림) */
  async readList(key: number, product = "", hm = ""): Promise<{ who: string; n: number; id: string; hasName: boolean; hasTel: boolean }[]> {
    const p = this.page;
    await this.closePanel();
    // 앞 칸을 누른 뒤 화면이 새로 그려지면 칸 표시(data-nv)가 사라짐 → 표가 없으면 되돌아가고, 표시를 다시 붙임
    let cell = p.locator(`[data-nv="${key}"]`).first();
    if (!(await cell.count())) {
      if (!this.toldLost) {
        this.toldLost = true;
        say(`  칸 표시가 사라짐 — ${mask(p.url().replace(/\?.*$/, ""))} · 회차 ${await this.gridRows()} · '완료 N' ${await this.panelCount()}`);
      }
      if (!(await this.gridRows())) {
        await p.goBack({ timeout: 15000 }).catch(() => {});
        await p.waitForTimeout(1500);
      }
      if (!(await this.gridRows())) {
        await this.enter(this.biz);
        await this.gotoDate(this.date);
      } else {
        // 목록 주소로 바로 연 뒤엔 표가 다른 날일 수 있어 날짜를 다시 맞춤
        await this.closePanel();
        await this.gotoDate(this.date);
      }
      await this.readCells();
      cell = p.locator(`[data-nv="${key}"]`).first();
      if (!(await cell.count())) throw new Error("칸을 다시 못 찾음");
    }
    await this.pressCell(key);
    // 예약이 1건뿐인 칸 → 그 예약 상세가 열림. 같은 상품의 목록 주소(상품번호 · 이용완료 조건)를 알면 시각만 바꿔 목록을 바로 엶
    if (!(await this.panelCount()) && /\/bookings\/\d+/.test(p.url())) {
      // 같은 상품 번호를 모르면 (그 상품이 모두 1건 칸) 상품번호 없이 그 시각 이용완료 목록 — 두 상품은 시간이 겹치지 않음
      const q = this.listQuery.get(product) || [...this.listQuery.values()].map((x) => ({ ...x, item: "" }))[0];
      if (!q || !hm) throw new Error("예약 1건 칸 — 목록 주소를 아직 모름");
      const u = new URL(q.base);
      if (q.item) u.searchParams.set("bizItemId", q.item);
      u.searchParams.set("date", `${this.date}T${hm}:00+09:00`);
      u.searchParams.set("status", q.status);
      await p.goto(u.toString(), { waitUntil: "domcontentloaded", timeout: 30000 });
      for (let t = 0; t < 20 && !(await this.panelCount()); t++) await p.waitForTimeout(500);
      if (!(await this.panelCount())) throw new Error(`예약 1건 칸 — 목록 주소로도 안 열림${q.item ? "" : " (상품번호 없이)"}`);
      if (!q.item) say("  예약 1건 칸 — 상품번호 없이 그 시각 목록으로 엶");
    }
    if (!(await this.panelCount())) {
      // 목록이 안 열렸으면 (다른 화면으로 넘어감 등) 화면 모양을 한 번 기록하고, 예약현황으로 다시 들어가 한 번 더
      if (!this.toldMiss) {
        this.toldMiss = true;
        say(`  목록이 안 열린 칸 — ${mask(p.url().replace(/\?.*$/, ""))} · 오른쪽 글 모양: ${mask(await this.rightShapes())}`);
        say(`  '완료' 앞뒤 글 모양: ${mask(await this.aroundDone())}`);
      }
      await this.closePanel();
      await this.enter(this.biz);
      await this.gotoDate(this.date);
      await this.readCells();
      await this.pressCell(key);
    }
    // 목록 주소의 상품번호 · 이용완료 조건을 상품별로 알아 둠 (1건 칸에 씀)
    if (await this.panelCount()) {
      try {
        const u = new URL(p.url());
        const item = u.searchParams.get("bizItemId");
        const status = u.searchParams.get("status");
        if (item && status && product) this.listQuery.set(product, { base: `${u.origin}${u.pathname}`, item, status });
      } catch {
        /* 주소 모양이 다르면 건너뜀 */
      }
    }
    if (!this.told) {
      // 처음 한 번만: 누른 뒤 화면이 어떻게 됐는지 (주소 모양 · 표 · 목록 글 수)
      this.told = true;
      say(`  칸 누른 뒤 — ${mask(p.url().replace(/\?.*$/, ""))} · 회차 ${await this.gridRows()} · '완료 N' ${await this.panelCount()}`);
    }
    if (!(await this.panelCount())) throw new Error("완료자 목록이 안 열림");
    await p.waitForTimeout(800);
    const seen = new Map<string, { who: string; n: number; id: string; hasName: boolean; hasTel: boolean }>();
    for (let round = 0; round < 30; round++) {
      // 완료자 카드: '완료 N' 줄 (탭 · 단추 안은 뺌) → 카드(예약번호를 품은 곳) 안에서 바로 위 글 = 이름, 전화번호 뒷 4자리
      const got = (await p.evaluate(`(() => {
        const txt = (el) => (el.innerText || "").trim();
        const leaf = (el) => !el.children.length;
        const out = [];
        for (const el of document.querySelectorAll("body *")) {
          if (!leaf(el)) continue;
          const m = txt(el).match(/^완료\\s*(\\d+)(?:\\s*[,·]\\s*(?:취소|노쇼)\\s*\\d+)*$/);
          if (!m || el.closest("[role=tab], [role=tablist]")) continue;
          const r = el.getBoundingClientRect();
          if (!r.width || r.left < window.innerWidth * 0.45) continue;
          // 카드 = 예약번호가 딱 하나 든 가장 작은 위 칸 (둘 이상이면 목록 전체라 멈춤)
          let card = el.parentElement, id = "";
          for (let k = 0; k < 8 && card; k++, card = card.parentElement) {
            const ns = [...txt(card).matchAll(/예약번호\\s*(\\d{6,})/g)];
            if (ns.length > 1) { card = null; break; }
            if (ns.length === 1) { id = ns[0][1]; break; }
          }
          // 카드 줄이 단추 · 링크여도 됨 — 다만 예약번호가 없는 단추(목록 위 '완료 N' 탭)는 뺌
          if (!id && el.closest("button, a")) continue;
          if (!card) card = el.parentElement && el.parentElement.parentElement;
          let name = "", tel = "";
          if (card) {
            const leaves = [...card.querySelectorAll("*")].filter((x) => leaf(x) && txt(x));
            const at = leaves.indexOf(el);
            for (let i = at - 1; i >= 0; i--) { const t = txt(leaves[i]); if (t.length <= 20 && !/\\d/.test(t) && !/^(완료|노쇼|확정|취소|신청|이용완료|예약번호)/.test(t)) { name = t; break; } }
            const ph = txt(card).match(/01\\d[-\\s.]?[\\d*]{3,4}[-\\s.]?(\\d{4})/);
            if (ph) tel = ph[1];
          }
          out.push({ id: id || "y" + Math.round(r.top + window.scrollY), n: Number(m[1]), raw: name || tel ? name + "|" + tel : "", hasName: !!name, hasTel: !!tel });
        }
        // 목록을 아래로 (스크롤 되는 칸)
        let sc = null;
        for (const el of document.querySelectorAll("body *")) { const r = el.getBoundingClientRect(); if (r.left > window.innerWidth * 0.45 && el.scrollHeight > el.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) { if (!sc || el.scrollHeight > sc.scrollHeight) sc = el; } }
        let more = false;
        if (sc) { const before = sc.scrollTop; sc.scrollTop = before + sc.clientHeight * 0.8; more = sc.scrollTop > before; }
        return { out, more };
      })()`)) as { out: { id: string; n: number; raw: string; hasName: boolean; hasTel: boolean }[]; more: boolean };
      for (const x of got.out) seen.set(x.id, { id: x.id, n: x.n, hasName: x.hasName, hasTel: x.hasTel, who: x.raw ? createHash("sha256").update(this.salt + x.raw).digest("hex").slice(0, 16) : "" });
      if (!got.more) break;
      await p.waitForTimeout(500);
    }
    await this.closePanel();
    return [...seen.values()];
  }

  /** 칸 누르기 — 보통 누르기, 안 되면(무언가 가림) 화면 안에서 직접. 오른쪽에 '완료 N' 이 나올 때까지 기다림 */
  private async pressCell(key: number) {
    const p = this.page;
    const cell = p.locator(`[data-nv="${key}"]`).first();
    if (!(await cell.count())) throw new Error("칸을 다시 못 찾음");
    await cell.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await cell.click({ timeout: 4000 }).catch(() => cell.evaluate((el) => ((el.closest("button") || el) as HTMLElement).click(), undefined, { timeout: 3000 }));
    for (let t = 0; t < 16 && !(await this.panelCount()); t++) await p.waitForTimeout(500);
  }

  /** 화면 오른쪽 절반의 짧은 글 모양 — 숫자가 든 글 · 정해 둔 낱말만, 숫자는 9 로 (이름 · 전화 · 금액 없음) */
  private rightShapes(): Promise<string> {
    return this.page.evaluate(`(() => {
      const KEY = /완료|방문|이용|회차|예약|확정|취소|노쇼|상태|횟수/;
      const f = {};
      for (const el of document.querySelectorAll("body *")) {
        if (el.children.length) continue;
        const t = (el.innerText || "").trim();
        const r = el.getBoundingClientRect();
        if (!t || t.length > 14 || !r.width || r.left < window.innerWidth * 0.45) continue;
        if (!/\\d/.test(t) && !KEY.test(t)) continue;
        if (/\\d/.test(t) && !KEY.test(t) && !/^[\\d\\s:./~-]+$/.test(t)) continue;
        const k = t.replace(/\\d/g, "9").replace(/\\s+/g, " ");
        f[k] = (f[k] || 0) + 1;
      }
      return Object.entries(f).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => k + "×" + n).join(" | ") || "없음";
    })()`) as Promise<string>;
  }

  /** 오른쪽 '완료' 글마다 앞 3 · 뒤 3 글 모양 — 숫자만인 글 · 정해 둔 낱말만 그대로(숫자는 9), 나머지는 '글' (이름 · 전화 없음) */
  private aroundDone(): Promise<string> {
    return this.page.evaluate(`(() => {
      const KEY = /^(완료|이용완료|방문|회|건|번|노쇼|취소|확정|신청|예약번호|예약자|이용일시|예약상태|결제상태|방문횟수|이용횟수|총|누적)$/;
      const leaves = [...document.querySelectorAll("body *")].filter((el) => !el.children.length && (el.innerText || "").trim() && el.getBoundingClientRect().width && el.getBoundingClientRect().left >= window.innerWidth * 0.45);
      const shape = (el) => { const t = (el.innerText || "").trim().replace(/\\s+/g, " "); if (/^[\\d\\s,.:()회건번]+$/.test(t) || KEY.test(t)) return t.replace(/\\d/g, "9"); if (/^(완료|노쇼|취소)\\s*\\d+$/.test(t)) return t.replace(/\\d/g, "9"); return "글"; };
      const out = [];
      leaves.forEach((el, i) => { if (/완료/.test((el.innerText || "").trim())) out.push(leaves.slice(Math.max(0, i - 3), i + 4).map(shape).join(" ")); });
      return out.slice(0, 4).join(" / ") || "없음";
    })()`) as Promise<string>;
  }

  /** 보이는 'N회차' 글 수 (예약현황 표가 있나) */
  private gridRows(): Promise<number> {
    return this.page.evaluate(`[...document.querySelectorAll("body *")].filter((el) => !el.children.length && /^\\d+회차$/.test((el.innerText || "").trim()) && el.getBoundingClientRect().width > 0).length`) as Promise<number>;
  }

  /** 오른쪽에 보이는 '완료 N' 글 수 (목록이 열려 있나) */
  private panelCount(): Promise<number> {
    return this.page.evaluate(`[...document.querySelectorAll("body *")].filter((el) => !el.children.length && /^완료\\s*\\d+(?:\\s*[,·]\\s*(?:취소|노쇼)\\s*\\d+)*$/.test((el.innerText || "").trim()) && el.getBoundingClientRect().left > window.innerWidth * 0.45 && el.getBoundingClientRect().width > 0).length`) as Promise<number>;
  }

  /** 완료자 목록 닫기 — Esc · 닫기 단추 · 목록 오른쪽 위의 작은 단추 차례로, 닫힐 때까지 */
  private async closePanel() {
    const p = this.page;
    for (let t = 0; t < 4 && (await this.panelCount()); t++) {
      if (t === 0) await p.keyboard.press("Escape").catch(() => {});
      else if (t === 1) {
        const b = p.locator('[aria-label*="닫기"], [title*="닫기"], button:has-text("닫기")').last();
        if (await b.isVisible().catch(() => false)) await b.click({ timeout: 2000 }).catch(() => {});
      } else
        await p.evaluate(`(() => {
          // 오른쪽 목록 맨 위쪽 가장 오른쪽의 단추 (X)
          const bs = [...document.querySelectorAll("button, [role=button]")].map((b) => [b, b.getBoundingClientRect()]).filter(([, r]) => r.width > 0 && r.width < 60 && r.left > window.innerWidth * 0.45 && r.top < 200);
          bs.sort((a, z) => z[1].right - a[1].right || a[1].top - z[1].top);
          if (bs[0]) bs[0][0].click();
        })()`);
      await p.waitForTimeout(700);
    }
  }

  /** 시험: 회차 칸 안 글 모양 — '이용완료' 를 품은 칸의 윗 칸 글을 정해 둔 낱말만 그대로, 숫자는 9, 나머지는 '글' (상품 이름 · 인원 없음)
   *  tab 을 주면 그 상태 단추('확정' 등)를 누른 뒤의 모양 */
  async probeCells(tab = "") {
    const p = this.page;
    if (tab) {
      await p.getByText(tab, { exact: true }).first().click({ timeout: 5000 }).catch(() => {});
      await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await p.waitForTimeout(1500);
    }
    const out = (await p.evaluate(`(() => {
      const KEY = /^(이용완료|완료|확정|신청|취소|노쇼|잔여예약|잔여|예약|예약가능|대기|입금대기|명|건|매|장)$/;
      const txt = (el) => (el.innerText || "").trim();
      const shape = (el) => [...el.querySelectorAll("*")].filter((x) => !x.children.length && txt(x)).map((x) => { const t = txt(x).replace(/\s+/g, " "); if (/^[\d\s,./()]+$/.test(t)) return t.replace(/\d+/g, "9"); const w = t.replace(/\d+/g, "").trim(); return KEY.test(w) ? t.replace(/\d+/g, "9") : /\d/.test(t) ? "글9" : "글"; }).join(" ");
      const labels = [...document.querySelectorAll("body *")].filter((el) => !el.children.length && /^(이용)?완료\s*\d*$|^확정\s*\d*$|^신청\s*\d*$/.test(txt(el)) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().top > 150);
      const res = [];
      for (const el of labels.slice(0, 6)) {
        let c = el;
        for (let k = 0; k < 4 && c.parentElement && txt(c.parentElement).length < 80; k++) c = c.parentElement;
        res.push(shape(c));
      }
      const c = (re) => [...document.querySelectorAll("body *")].filter((el) => !el.children.length && re.test(txt(el)) && el.getBoundingClientRect().width > 0).length;
      return "칸 글: " + (res.join(" / ") || "없음") + " · 확정 글 " + c(/^확정\s*\d*$/) + " · 이용완료 글 " + c(/^(이용)?완료\s*\d*$/) + " · 신청 글 " + c(/^신청\s*\d*$/);
    })()`)) as string;
    say(`  칸 모양${tab ? ` ('${tab}' 누른 뒤)` : ""} — ${mask(out)}`);
    if (tab) await p.getByText("전체", { exact: true }).first().click({ timeout: 5000 }).catch(() => {});
  }

  /** 화면 구조 기록 — 개수 · 정해 둔 낱말만 (이름 · 숫자 없음) */
  async probe(label: string) {
    const p = this.page;
    say(`--- 화면 구조 (${label}) · ${mask(p.url().replace(/\?.*$/, ""))} ---`);
    const info = (await p.evaluate(`(() => {
      const txt = (el) => (el.innerText || "").trim();
      const leafs = [...document.querySelectorAll("body *")].filter((el) => !el.children.length && el.getBoundingClientRect().width > 0);
      const c = (re) => leafs.filter((el) => re.test(txt(el))).length;
      // '이용완료' · '잔여예약' 을 품은 가장 작은 칸의 글 모양 (숫자는 9 로, 앞 3가지만)
      const shape = (w) => [...new Set([...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().width > 0 && txt(el).includes(w) && ![...el.children].some((ch) => txt(ch).includes(w))).map((el) => txt(el).replace(/\\d/g, "9").replace(/\\s+/g, " ").slice(0, 30)))].slice(0, 3).join(" | ");
      // 숫자가 든 짧은 글의 모양 많은 순 10가지 (숫자는 9 로) — 칸 안 글이 어떻게 생겼는지
      const freq = {};
      for (const el of leafs) { const t = txt(el); if (t.length <= 12 && /\\d/.test(t)) { const k = t.replace(/\\d/g, "9").replace(/\\s+/g, " "); freq[k] = (freq[k] || 0) + 1; } }
      window.__cells = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => k + "×" + n).join(" | ");
      window.__shape = "이용완료: " + (shape("이용완료") || "없음") + " / 잔여예약: " + (shape("잔여예약") || "없음") + " / 확정: " + (shape("확정") || "없음") + " / 신청: " + (shape("신청") || "없음") + " / 취소: " + (shape("취소") || "없음");
      return { rows: c(/^\\d+회차$/), times: c(/^(오전|오후)?\\s*\\d{1,2}:\\d{2}$/), done: c(/^(이용)?완료$/), remain: c(/^잔여예약$/), date: c(/\\d{4}\\.\\s*\\d{1,2}\\.\\s*\\d{1,2}\\./), all: c(/^전체$/), panelDone: c(/^완료\\s*\\d+(?:\\s*[,·]\\s*(?:취소|노쇼)\\s*\\d+)*$/), buttons: document.querySelectorAll("button").length };
    })()`)) as Record<string, number>;
    say(`  글 모양 — ${mask(String(await p.evaluate("window.__shape").catch(() => "")))}`);
    say(`  숫자 든 글 — ${mask(String(await p.evaluate("window.__cells").catch(() => "")))}`);
    say(`  회차 ${info.rows} · 시각 ${info.times} · 이용완료 ${info.done} · 잔여예약 ${info.remain} · 날짜 글 ${info.date} · '전체' ${info.all} · '완료 N' ${info.panelDone} · 단추 ${info.buttons}`);
  }
}
