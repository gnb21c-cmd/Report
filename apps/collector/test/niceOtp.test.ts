/* 나이스 2차 인증 (2026-11-25 ~) — 인증번호 꺼내기 규칙 · 가짜 나이스 화면으로 로그인 순서 (진짜 계정 · 번호 없음) */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { mailBoxFromEnv, niceCodeOf, NICE_OTP_SENDER, pickNiceCode, waitNiceCode, type OtpMail } from "../src/niceMail";
import { Nibs, NiceLoginRefused, NIBS_LOGIN, NIBS_MAIN } from "../src/nibs";

const T0 = new Date("2026-11-26T00:10:00Z");
const mail = (sec: number, code: string, from = NICE_OTP_SENDER): OtpMail => ({
  at: new Date(T0.getTime() + sec * 1000),
  from,
  text: `<div>[나이스정보통신] 1234567890 님의 인증번호는 [${code}] 입니다</div>`,
});

describe("인증번호 꺼내기", () => {
  it("메일 글에서 번호 — HTML · 글 · 다른 모양", () => {
    expect(niceCodeOf("<p>[나이스정보통신] 1234567890 님의 인증번호는 [522732] 입니다</p>")).toBe("522732");
    expect(niceCodeOf("인증번호는 [ 054313 ]을(를) 입력해주세요")).toBe("054313");
    expect(niceCodeOf("NIBS 인증번호 : 477388")).toBe("477388");
    expect(niceCodeOf("안내 메일입니다 1234567890")).toBeNull();
  });
  it("[전송]을 누른 뒤 온 나이스 메일 중 가장 새것 — 예전 번호 · 다른 보낸 사람은 안 씀", () => {
    const mails = [mail(-600, "111111"), mail(-30, "222222"), mail(20, "333333"), mail(40, "999999", "someone@example.com")];
    expect(pickNiceCode(mails, T0)).toBe("333333"); // 10분 전 · 다른 사람 메일은 뺌, 30초 전(시계 차이 여유 안)보다 20초 뒤가 새것
    expect(pickNiceCode([mail(-600, "111111")], T0)).toBeNull();
    // 9:10 (보고 시스템) · 9:40 (그룹웨어 서버) 처럼 따로 요청하면 각자 자기 뒤의 번호
    const day = [mail(5, "100001"), mail(1805, "100002")];
    expect(pickNiceCode(day, T0)).toBe("100002"); // 9:10 실행이 늦게 볼 일은 없지만, 본다면 가장 새것
    expect(pickNiceCode(day, new Date(T0.getTime() + 1800_000))).toBe("100002");
    expect(pickNiceCode([mail(5, "100001")], new Date(T0.getTime() + 1800_000))).toBeNull();
  });
  it("메일이 올 때까지 기다림 · 시간이 지나면 오류 · 메일함 로그인이 안 되면 바로 오류", async () => {
    let n = 0;
    const read = async () => (++n < 3 ? [] : [mail(4, "654321")]);
    const sleep = async () => {};
    expect(await waitNiceCode(read, T0, { sleep })).toBe("654321");
    expect(n).toBe(3);
    await expect(waitNiceCode(async () => [], T0, { sleep, timeoutMs: 9000, everyMs: 3000 })).rejects.toThrow(/9초 안에 오지 않음/);
    let tries = 0;
    await expect(
      waitNiceCode(
        async () => {
          tries++;
          throw new Error("인증번호 메일함에 들어가지 못함 — 아이디 · 비밀번호(또는 메일 프로그램 접속 허용)를 확인해 주세요");
        },
        T0,
        { sleep },
      ),
    ).rejects.toThrow(/들어가지 못함/);
    expect(tries).toBe(1);
  });
  it("메일함 값 — 셋 다 있어야 · 포트 기본 993", () => {
    expect(mailBoxFromEnv({})).toBeNull();
    expect(mailBoxFromEnv({ NICE_MAIL_HOST: "imap.example.com", NICE_MAIL_USER: "tax", NICE_MAIL_PW: "" })).toBeNull();
    expect(mailBoxFromEnv({ NICE_MAIL_HOST: " imap.example.com ", NICE_MAIL_USER: "tax@example.com", NICE_MAIL_PW: "x" })).toEqual({ host: "imap.example.com", port: 993, user: "tax@example.com", pass: "x" });
  });
});

/* ---------------- 가짜 나이스 화면 (2026-11-26 사장님이 보내 준 화면의 글 그대로) ---------------- */
const LOGIN_HTML = `<!doctype html><meta charset="utf-8"><body>
<div id="loginBox"><input id="uid" type="text"><input id="upw" type="password"><button id="go">로그인</button></div>
<div id="otp" class="w2window" style="display:none;position:fixed;top:100px;left:100px;width:400px;background:#fff">
  <div class="w2window_header">인증번호 확인</div>
  <span id="tabTalk">알림톡으로 인증번호 받기</span> <span id="tabMail">이메일로 인증번호 받기</span>
  <input id="code" type="text" placeholder="인증번호를 입력해주세요.">
  <input type="button" id="send" value="인증번호 전송">
  <input type="button" id="ok" value="인증번호 확인">
</div>
<div id="msg"></div>
<script>
  let tab = "talk"; window.sent = [];
  const pw = document.getElementById("upw");
  const enter = () => { if (pw.value === "bad") { document.getElementById("msg").innerHTML = '<div class="alert">로그인 정보를 확인하세요.<button>확인</button></div>'; return; } document.getElementById("otp").style.display = "block"; };
  pw.addEventListener("keydown", (e) => { if (e.key === "Enter") enter(); });
  document.getElementById("go").onclick = enter;
  document.getElementById("tabMail").onclick = () => (tab = "mail");
  document.getElementById("tabTalk").onclick = () => (tab = "talk");
  document.getElementById("send").onclick = () => { window.sent.push(tab); fetch("/sent?tab=" + tab); };
  document.getElementById("ok").onclick = async () => {
    const r = await fetch("/check?code=" + document.getElementById("code").value);
    if ((await r.text()) === "ok") location.href = "${NIBS_MAIN}";
    else document.getElementById("msg").innerHTML = '<div class="alert">인증번호가 일치하지 않습니다.</div>';
  };
</script></body>`;
const MAIN_HTML = `<!doctype html><meta charset="utf-8"><body><a id="btn_LogOut">로그아웃</a><span>거래조회</span>
<div class="alert" id="alert_last">마지막 로그인 시간 안내<input type="button" id="alert_last_btn_Confirm" value="확인" onclick="this.parentNode.remove()"></div></body>`;

const CHROME = ["/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", chromium.executablePath()].find((p) => p && existsSync(p));
describe.skipIf(!CHROME)("가짜 나이스 화면 — 2차 인증 순서 (진짜 크롬)", () => {
  async function run(pw: string, otp?: (sentAt: Date) => Promise<string>, codeNow = "482913") {
    const orig = chromium.launch.bind(chromium);
    (chromium as any).launch = (o: any = {}) => orig({ ...o, executablePath: CHROME });
    const nb = await Nibs.open();
    (chromium as any).launch = orig;
    const log: string[] = [];
    const ctx = (nb as any).ctx;
    await ctx.route(/nibs\.nicevan\.co\.kr/, async (route: any) => {
      const u = new URL(route.request().url());
      if (u.pathname === new URL(NIBS_LOGIN).pathname) return route.fulfill({ contentType: "text/html", body: LOGIN_HTML });
      if (u.pathname === new URL(NIBS_MAIN).pathname) return route.fulfill({ contentType: "text/html", body: MAIN_HTML });
      if (u.pathname === "/sent") log.push("전송:" + u.searchParams.get("tab"));
      if (u.pathname === "/check") return route.fulfill({ body: u.searchParams.get("code") === codeNow ? "ok" : "no" });
      return route.fulfill({ body: "" });
    });
    try {
      await nb.login("tester01", pw, otp);
      return { ok: true, log };
    } finally {
      await nb.close();
    }
  }
  it("이메일로 받기 → 전송 → 메일함 번호 → 확인 → 들어가짐 (번호를 받은 시각은 전송 뒤)", async () => {
    let asked: Date | null = null;
    const before = new Date();
    const r = await run("good", async (sentAt) => ((asked = sentAt), "482913"));
    expect(r.ok).toBe(true);
    expect(r.log).toEqual(["전송:mail"]);
    expect(asked!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  }, 90_000);
  it("첫 메일이 안 오면 한 번 더 전송 · 메일함이 없으면 거절 표시 없이 보통 오류 · 비밀번호 틀림은 거절", async () => {
    let n = 0;
    const r = await run("good", async () => {
      if (++n === 1) throw new Error("인증번호 메일이 150초 안에 오지 않음");
      return "482913";
    });
    expect(r.log).toEqual(["전송:mail", "전송:mail"]);
    const noBox = await run("good").catch((e) => e);
    expect(noBox).toBeInstanceOf(Error);
    expect(noBox).not.toBeInstanceOf(NiceLoginRefused);
    expect(String(noBox.message)).toMatch(/메일함/);
    const bad = await run("bad", async () => "482913").catch((e) => e);
    expect(bad).toBeInstanceOf(NiceLoginRefused);
  }, 180_000);
  it("번호가 틀리면 한 번 더 · 두 번 다 틀리면 멈춤", async () => {
    let n = 0;
    const r = await run("good", async () => (++n === 1 ? "000000" : "482913"));
    expect(r.log).toEqual(["전송:mail", "전송:mail"]);
    const wrong = await run("good", async () => "000000").catch((e) => e);
    expect(String(wrong.message)).toMatch(/2차 인증이 끝나지 않음/);
  }, 180_000);
});
