/* ============================================================
   시험 조회 — OKPOS 점주 웹(nice.okpos.co.kr)의 화면 구조만 알아봄 (자동 수집을 만들기 전 1단계)
   - 로그인 → 매출관리 → 매출현황 → 영수증별매출상세현황 까지 가면서 칸 이름 · 버튼 글자 · 주소 모양만 기록
   - 이 저장소는 공개라 GitHub 기록(로그)을 누구나 볼 수 있음 → 매출 숫자 · 입력값 · 화면 사진은 절대 남기지 않음
     주소의 긴 숫자(매장코드 등)와 물음표 뒤 값은 가림
   필요한 값: Secrets OKPOS_ID · OKPOS_PW (없으면 로그인 화면만 봄)
   ============================================================ */
import { chromium, type Frame, type Page } from "playwright";

const LOGIN = process.env.OKPOS_URL || "https://nice.okpos.co.kr/login/login_form.jsp";
const MENU = ["매출관리", "매출현황", "영수증별매출상세현황"];

/** 공개 기록에 남겨도 되는 모양으로 — 숫자 4자리 이상 · 물음표 뒤 값 가림 */
const mask = (s: string) =>
  s
    .replace(/([?&][^=&#]+)=[^&#]*/g, "$1=…")
    .replace(/\d{4,}/g, "#")
    .slice(0, 160);
const say = (...xs: unknown[]) => console.log(...xs);

async function dumpFrame(f: Frame, depth: number) {
  const pad = "  ".repeat(depth);
  let info: { inputs: string[]; buttons: string[]; links: string[]; selects: string[] };
  try {
    info = await f.evaluate(() => {
      const vis = (e: Element) => {
        const r = (e as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const t = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim().slice(0, 40);
      const inputs = [...document.querySelectorAll("input, textarea")]
        .map((e) => {
          const i = e as HTMLInputElement;
          return `${i.tagName.toLowerCase()}[type=${i.type}${i.name ? ` name=${i.name}` : ""}${i.id ? ` id=${i.id}` : ""}${i.readOnly ? " readonly" : ""}${vis(i) ? "" : " 숨김"}]${i.placeholder ? ` "${t(i.placeholder)}"` : ""}${i.type === "button" || i.type === "submit" || i.type === "image" ? ` "${t(i.value || i.alt)}"` : ""}`;
        });
      const buttons = [...document.querySelectorAll("button, [onclick], img[alt]")]
        .filter(vis)
        .map((e) => `${e.tagName.toLowerCase()}${(e as HTMLElement).id ? `#${(e as HTMLElement).id}` : ""} "${t((e as HTMLElement).innerText || e.getAttribute("alt") || e.getAttribute("title"))}" ${e.getAttribute("onclick") ? `onclick=${t(e.getAttribute("onclick"))}` : ""}`)
        .filter((s) => !/""\s*$/.test(s))
        .slice(0, 60);
      const links = [...document.querySelectorAll("a")]
        .filter(vis)
        .map((a) => `"${t(a.innerText)}" → ${t(a.getAttribute("href"))}${a.getAttribute("onclick") ? ` onclick=${t(a.getAttribute("onclick"))}` : ""}`)
        .filter((s) => !s.startsWith('""'))
        .slice(0, 80);
      const selects = [...document.querySelectorAll("select")].map((s) => `select[name=${s.name || s.id}] 보기 ${s.options.length}개`);
      // 화면 글 자체는 남기지 않음 (매출 숫자가 있을 수 있음)
      return { inputs, buttons, links, selects };
    });
  } catch (e) {
    say(`${pad}(이 틀은 읽지 못함: ${mask((e as Error).message)})`);
    return;
  }
  say(`${pad}▶ 틀 ${f.name() || "(이름 없음)"} — ${mask(f.url())}`);
  for (const k of ["inputs", "selects", "buttons", "links"] as const) {
    if (!info[k].length) continue;
    say(`${pad}  [${k}]`);
    for (const x of info[k]) say(`${pad}    ${mask(x)}`);
  }
  for (const c of f.childFrames()) await dumpFrame(c, depth + 1);
}

async function dump(page: Page, title: string) {
  say(`\n===== ${title} =====`);
  say(`창 제목: ${mask(await page.title())}`);
  await dumpFrame(page.mainFrame(), 0);
}

/** 모든 틀에서 글자가 딱 맞는 메뉴를 찾아 누름 */
async function clickText(page: Page, text: string): Promise<boolean> {
  for (const f of page.frames()) {
    const loc = f.getByText(text, { exact: true });
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      if (await el.isVisible().catch(() => false)) {
        say(`→ '${text}' 누름 (틀 ${f.name() || mask(f.url())})`);
        await el.click({ timeout: 5000 }).catch((e) => say(`  누르기 실패: ${mask(e.message)}`));
        await page.waitForTimeout(2500);
        return true;
      }
    }
  }
  say(`→ '${text}' 를 못 찾음`);
  return false;
}

async function main() {
  const id = process.env.OKPOS_ID || "";
  const pw = process.env.OKPOS_PW || "";
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: "ko-KR", timezoneId: "Asia/Seoul", acceptDownloads: true });
  // tsx(esbuild)가 함수 이름 도우미 __name 을 끼워 넣음 → 화면 안에서도 있게
  await ctx.addInitScript("globalThis.__name = (f) => f");
  const page = await ctx.newPage();
  page.on("dialog", async (d) => {
    say(`[알림창] ${mask(d.message())}`);
    await d.accept().catch(() => {});
  });
  page.on("popup", async (p) => {
    await p.waitForLoadState("domcontentloaded").catch(() => {});
    say(`[새 창] ${mask(p.url())} — ${mask(await p.title().catch(() => ""))}`);
  });
  // 오가는 주소 모양 (문서 · 데이터 요청만)
  const seen = new Set<string>();
  page.on("request", (r) => {
    if (!["document", "xhr", "fetch"].includes(r.resourceType())) return;
    const u = new URL(r.url());
    const key = `${r.method()} ${u.host}${u.pathname}${[...u.searchParams.keys()].length ? ` ?${[...u.searchParams.keys()].join("&")}` : ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    say(`[요청] ${mask(key)}${r.method() === "POST" ? ` 보냄칸: ${mask(Object.keys(Object.fromEntries(new URLSearchParams(r.postData() || ""))).join(","))}` : ""}`);
  });

  const res = await page.goto(LOGIN, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => {
    say(`로그인 화면을 못 엶: ${mask(e.message)}`);
    return null;
  });
  if (!res) return browser.close();
  say(`로그인 화면 응답 ${res.status()}`);
  await page.waitForTimeout(2000);
  await dump(page, "1. 로그인 화면");
  const html = await page.content();
  if (/captcha|자동입력|보안문자|recaptcha/i.test(html)) say("※ 자동입력방지(보안문자) 흔적 있음");
  if (/인증번호|OTP|휴대폰\s*인증/i.test(html)) say("※ 휴대폰 · OTP 인증 흔적 있음");

  if (!id || !pw) {
    say("\nOKPOS_ID · OKPOS_PW 가 없어 로그인 화면만 보고 끝냅니다.");
    return browser.close();
  }

  // 로그인 — 아이디 칸 user_id · 비밀번호 칸 user_pwd, 로그인 그림(doSubmit) 누름
  if (!(await page.locator("#user_pwd").count())) {
    say("비밀번호 칸(user_pwd)을 못 찾음");
    return browser.close();
  }
  await page.fill("#user_id", id);
  await page.fill("#user_pwd", pw);
  say("→ 아이디 · 비밀번호 넣고 로그인 누름");
  const go = page.locator("img[onclick*='doSubmit']").first();
  if (await go.count()) await go.click();
  else await page.press("#user_pwd", "Enter");
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await dump(page, "2. 로그인 뒤");

  for (const [i, m] of MENU.entries()) {
    await clickText(page, m);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    if (i === MENU.length - 1) await dump(page, `3. ${m} 화면`);
  }

  // 매장선택 — 누르면 뜨는 창 · 층의 구조 (매장 이름 개수만)
  const before = page.frames().length;
  const pop = page.waitForEvent("popup", { timeout: 6000 }).catch(() => null);
  const clicked = (await clickText(page, "매장선택")) || false;
  const p2 = await pop;
  if (p2) {
    await p2.waitForLoadState("domcontentloaded").catch(() => {});
    await p2.waitForTimeout(1500);
    await dump(p2, "4. 매장선택 새 창");
  } else if (clicked) {
    say(`틀 수 ${before} → ${page.frames().length}`);
    await dump(page, "4. 매장선택 누른 뒤");
  }
  await browser.close();
}

main().catch((e) => {
  console.log("멈춤:", mask((e as Error).message));
  process.exit(1);
});
