/* ============================================================
   네이버 스마트플레이스 예약 관리(partner.booking.naver.com) — 사람이 하는 순서 그대로
   예약 → 예약현황 → 일간 · 전체 → 날짜를 어제로 → 회차 칸마다 '이용완료 N' 읽기
   → 그 칸을 누르면 오른쪽에 나오는 완료자 목록에서 '완료 1'(처음 온 손님) 세기 → 닫기
   로그인은 POS 메인 PC에서 사람이 한 번 해 둔 상태(state.json)를 씀 (naver-login/login.mjs)
   이름 · 전화번호는 읽지 않음 — '완료 N' 숫자와 (같은 사람 두 번 세지 않으려고) 예약번호만 메모리에서 씀
   공개 저장소라 기록에는 칸 수 · 같음/다름만 남김 (인원 숫자 · 상품 이름 · 사업장 번호 없음)
   ============================================================ */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { NaverCellRead } from "@report/core";
import { mask, say } from "./okpos";

export const NAVER_PARTNER = "https://partner.booking.naver.com/";
const pause = (min = 800, max = 1600) => new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
const DATE_RE = "(\\d{4})\\.\\s*(\\d{1,2})\\.\\s*(\\d{1,2})\\.";

export class NaverBook {
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
      for (let t = 0; t < 20 && !/\/bizes\/\d+/.test(p.url()); t++) await p.waitForTimeout(1000);
      const m = p.url().match(/\/bizes\/(\d+)/);
      if (!m) throw new Error("사업장 번호를 못 찾음 — GitHub Secrets 에 NAVER_BIZ_ID 를 넣어 주세요");
      biz = m[1];
      await p.goto(`${NAVER_PARTNER}bizes/${biz}/booking-calendar-view`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await p.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    }
    if (/nid\.naver\.com/.test(p.url())) throw new Error("네이버 로그인이 풀렸습니다 — POS 메인 PC의 naver-login.cmd 를 더블클릭해 다시 로그인해 주세요");
    say("네이버 예약현황 열림");
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
      const heads = els.filter((el) => { const b = box(el); const t = txt(el); return leaf(el) && t.length > 1 && b.bottom <= gridTop + 2 && b.top >= gridTop - 90 && b.left >= gridLeft - 2 && !/^(전체|신청|확정|예약가능|완료\\/노쇼|잔여예약|이용완료|일간|주간|월간)$/.test(t) && !/^(오전|오후)?\\s*\\d{1,2}:\\d{2}$/.test(t) && !/^\\d+$/.test(t); })
        .map((el) => ({ el, b: box(el), t: (el.getAttribute("title") || txt(el)).replace(/\\s+/g, " ") }));
      const times = timeEls.map((el) => ({ b: box(el), t: txt(el) }));
      const dones = els.filter((el) => leaf(el) && txt(el) === "이용완료");
      const cells = [];
      dones.forEach((el, i) => {
        const b = box(el); const cx = b.left + b.width / 2;
        const h = heads.find((x) => x.b.left - 2 <= cx && cx <= x.b.right + 2) || heads.reduce((a, x) => (!a || Math.abs((x.b.left + x.b.right) / 2 - cx) < Math.abs((a.b.left + a.b.right) / 2 - cx) ? x : a), null);
        const col = h ? h.b : b;
        const tm = times.filter((x) => x.b.top < b.top && x.b.left >= col.left - 40 && x.b.left <= col.right + 2).sort((a, z) => z.b.top - a.b.top)[0];
        // 숫자 = 이용완료 글을 품은 줄(부모)의 숫자
        let p = el.parentElement, n = null;
        for (let k = 0; k < 3 && p && n == null; k++, p = p.parentElement) { const m = txt(p).replace("이용완료", "").match(/\\d+/); if (m) n = Number(m[0]); }
        el.setAttribute("data-nv", String(i));
        cells.push({ key: i, product: h ? h.t : "", time: tm ? tm.t : "", done: n == null ? 0 : n });
      });
      return { cells, rows: rowLabels.length, headers: heads.map((x) => x.t) };
    })()`)) as { cells: (Omit<NaverCellRead, "first"> & { key: number })[]; rows: number; headers: string[] };
    return r;
  }

  /** 이용완료 칸을 눌러 오른쪽 완료자 목록에서 '완료 1' 수를 셈 — 목록 건수도 돌려줌 (이용완료 수와 견주려고) */
  async countFirst(key: number): Promise<{ first: number; listed: number }> {
    const p = this.page;
    const cell = p.locator(`[data-nv="${key}"]`).first();
    await cell.scrollIntoViewIfNeeded().catch(() => {});
    await cell.click({ timeout: 5000 });
    await p.waitForTimeout(1500);
    const seen = new Map<string, number>();
    for (let round = 0; round < 30; round++) {
      // 완료자 카드: '완료 N' 줄 (탭 · 단추 안은 뺌) → 카드 안의 예약번호를 같은 사람 표시로만 씀
      const got = (await p.evaluate(`(() => {
        const txt = (el) => (el.innerText || "").trim();
        const out = [];
        for (const el of document.querySelectorAll("body *")) {
          if (el.children.length) continue;
          const m = txt(el).match(/^완료\\s*(\\d+)$/);
          if (!m || el.closest("button, a, [role=tab], [role=tablist]")) continue;
          const r = el.getBoundingClientRect();
          if (!r.width || r.left < window.innerWidth * 0.45) continue;
          let card = el.parentElement, key = "";
          for (let k = 0; k < 6 && card; k++, card = card.parentElement) { const n = txt(card).match(/예약번호\\s*(\\d{6,})/); if (n) { key = n[1]; break; } }
          out.push([key || "y" + Math.round(r.top + window.scrollY), Number(m[1])]);
        }
        // 목록을 아래로 (스크롤 되는 칸)
        let sc = null;
        for (const el of document.querySelectorAll("body *")) { const r = el.getBoundingClientRect(); if (r.left > window.innerWidth * 0.45 && el.scrollHeight > el.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) { if (!sc || el.scrollHeight > sc.scrollHeight) sc = el; } }
        let more = false;
        if (sc) { const before = sc.scrollTop; sc.scrollTop = before + sc.clientHeight * 0.8; more = sc.scrollTop > before; }
        return { out, more };
      })()`)) as { out: [string, number][]; more: boolean };
      for (const [k, n] of got.out) seen.set(k, n);
      if (!got.more) break;
      await p.waitForTimeout(500);
    }
    // 닫기
    await p.keyboard.press("Escape").catch(() => {});
    await p.waitForTimeout(400);
    const closeBtn = p.locator('[aria-label*="닫기"], button:has-text("닫기")').last();
    if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click({ timeout: 3000 }).catch(() => {});
    await p.waitForTimeout(500);
    const vals = [...seen.values()];
    return { first: vals.filter((n) => n === 1).length, listed: vals.length };
  }

  /** 화면 구조 기록 — 개수 · 정해 둔 낱말만 (이름 · 숫자 없음) */
  async probe(label: string) {
    const p = this.page;
    say(`--- 화면 구조 (${label}) · ${mask(p.url().replace(/\?.*$/, ""))} ---`);
    const info = (await p.evaluate(`(() => {
      const txt = (el) => (el.innerText || "").trim();
      const leafs = [...document.querySelectorAll("body *")].filter((el) => !el.children.length && el.getBoundingClientRect().width > 0);
      const c = (re) => leafs.filter((el) => re.test(txt(el))).length;
      return { rows: c(/^\\d+회차$/), times: c(/^(오전|오후)?\\s*\\d{1,2}:\\d{2}$/), done: c(/^이용완료$/), remain: c(/^잔여예약$/), date: c(/\\d{4}\\.\\s*\\d{1,2}\\.\\s*\\d{1,2}\\./), all: c(/^전체$/), panelDone: c(/^완료\\s*\\d+$/), buttons: document.querySelectorAll("button").length };
    })()`)) as Record<string, number>;
    say(`  회차 ${info.rows} · 시각 ${info.times} · 이용완료 ${info.done} · 잔여예약 ${info.remain} · 날짜 글 ${info.date} · '전체' ${info.all} · '완료 N' ${info.panelDone} · 단추 ${info.buttons}`);
  }
}
