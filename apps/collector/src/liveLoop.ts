/* ============================================================
   하루 실시간 수집 (2026-10-19 사장님) — POS 메인 PC(바리스타 POS, 실행기 nice-pos)가 아침에 한 번 시작해 21:50 까지 켜져 있으면서
   자기 시계로 매시 0 · 15 · 30 · 45분(10:00 ~ 21:30) · 마지막 21:40 · 21:45 에 바로 마감 전 영업정보를 받음 (그때마다 live.ts · survey.ts 를 새로 실행)
   - GitHub 예약 실행은 20분 남짓 늦거나 자주 건너뛰어(2026-10-19 — 15분마다로 바꾼 뒤 3시간에 3번) 예약은 '시작'만 맡김
     (live-collect.yml — 09:30 · 09:45 · 10:00 부터 30분마다, 이미 돌고 있으면 건너뜀)
   - 시작했을 때 지난 칸(15분 안)을 아직 못 받았으면 바로 받음 (PC 를 다시 켰거나 비켜 줬다 돌아왔을 때 · 칸 시각 규칙 packages/core/src/live.ts liveLoopStep)
   - 칸 사이 1분마다 A [신규 다시 확인] 요청(config/naverAsk)을 보고 새 요청이면 여기서 바로 네이버 수집(naver.ts) — 실행기가 하나라 따로 시작시키면 밤까지 기다림
   - 칸 사이 1분마다 이 PC 실행기를 기다리는 다른 일(아침 네이버 다시 하기 · 손으로 시작한 수집 등)이 있는지 보고, 있으면 자기를 다시 시작시켜 두고 비켜 줌
   - 스스로 이어 가기(2026-10-27 — GitHub 예약이 몇 시간씩 늦거나 빠져 10-26 은 14:05 에야 시작, 10-27 은 아침 수집까지 안 돎, core live.ts):
     매장 포스는 밤 9시 40 ~ 50분쯤 꺼지고(일찍 · 늦게 꺼질 수도) 아침 9시 10 ~ 20분쯤 켜짐 (사장님) → 마지막 집계 21:40 · 21:45, 21:50 에 그날 끝
     (늦게 시작됐거나 포스가 꺼져 응답이 없어도 21:50 뒤에는 새로 집계하지 않음 · 다음 날 10:00 첫 집계)
     하루 수집을 시작할 때 '다음 차례' 하루 수집을 맡겨 두고 3시간마다 · 끝날 때 새로 맡김(arm — 같은 줄에서 가장 새것 하나만 기다림)
     끝나면 컴퓨터가 꺼질 때까지 붙들고 있음(hold)
     컴퓨터가 꺼지면 다음 차례가 실행기를 기다리다가 아침에 켜지면 바로 돎 → 09:27 까지 밤 대기 → 오늘 아직 안 돈 아침 수집
     (자판기 · 네컷 · 주차 / POS 확정 / 네이버)을 시작시키고 끝 → 그다음 차례가 하루 수집으로. 하루 수집으로 시작했을 때도 안 돈 아침 수집이 있으면 시작시킴
     밤 대기 · 붙들고 있는 동안에도 이 PC 를 기다리는 다른 일이 있으면 비켜 줌. 시험(LOOP_END · 확인만)일 때는 이어 가지 않음
   - 하루 수집 기록(2026-10-29 사장님 — 붙들고 있다 컴퓨터가 꺼지면 GitHub 작업 기록이 통째로 안 남음, core liveLog.ts):
     이 PC 기록 파일(LIVE_LOG_DIR/날짜.log, 줄마다 시각 · 31일)에도 남기고 붙들기 전 · 비켜 줄 때 · 작업을 시작할 때(지난 날 것)
     저장소 live-log 가지 log/날짜.log 로 올림 (글은 원래 작업 기록과 같음)
   - 근무자 화면(2026-10-22): 칸마다 키친 숫자(work.ts) · 1분마다 통합데스크의 재방문 이벤트 예정 수 → floor/{태블릿 키}/work/event (숫자만)
     이벤트 예정 수는 칸을 받는 동안(몇 분)에도 따로 1분마다 — 손님이 매시 정각 · 30분에 오므로 20 · 50분(칸 받는 중일 수 있음)에도 새 숫자
   환경: live.ts · naver.ts · survey.ts 와 같음 + GH_TOKEN(이 작업의 GitHub 열쇠 — 다른 일 보기 · 다시 시작 · 기록 올리기) · LOOP_END(끝 시각 HH:MM, 시험용)
         LIVE_LOG_DIR(이 PC 의 하루 수집 기록 폴더 — 없으면 기록 파일 · 올리기 안 함)
         LOOP_ONCE=1(한 번만 받고 끝 — 날짜를 정한 시험) · COLLECT_DRY=1(올리지 않음, 신규 다시 확인 요청은 맡지 않음)
   공개 저장소라 기록에는 시각 · 성공/실패 · 개수만
   ============================================================ */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkWorkEvent, kstMinutes, LIVE_FROM, LIVE_LOG_BRANCH, LIVE_LOOP_END, liveLogPath, logLines, logPrune, logPushDue, LIVE_MORNING_KICK, LIVE_REARM_MIN, liveArmDue, liveHoldOver, liveLoopMode, liveLoopStep, liveSlotBy, morningJobs, naverAskTodo, parseDeskLive, workEventOf, type NaverAsk, type NaverAskResult, type WorkEventDoc } from "@report/core";
import { fbLogin, readConfigJson, readDeskLive, readFloorKey, readLive, writeConfigJson, writeWork, type Fb } from "./firebase";
import { mask, say } from "./okpos";

const env = (k: string) => process.env[k] || "";
const here = dirname(fileURLToPath(import.meta.url));
const tsx = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const dry = env("COLLECT_DRY") === "1";
/** 스스로 이어 가기 — 보통 하루 수집일 때만 (시험: 끝 시각을 정했거나 확인만이면 안 함) */
const chain = !dry && !env("LOOP_END");
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const now = () => kstMinutes();
const hm = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const minutesOf = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, Math.max(0, ms)));
const fails: string[] = [];

/* ---------- 하루 수집 기록 (2026-10-29 사장님 · core liveLog.ts) ----------
   이 작업은 21:50 에 끝난 뒤 컴퓨터가 꺼질 때까지 붙들고 있어(hold), 꺼지는 순간 GitHub 작업 기록이 통째로 안 남음 (10-27 · 10-28)
   → 화면에 쓰는 글(수집 프로그램 글 포함)을 이 PC 기록 파일에도 줄마다 시각과 함께 남기고, 저장소 live-log 가지로 올림 */
const logDir = env("LIVE_LOG_DIR");
/** 기록 파일 · 올리기 — 보통 하루 수집일 때만 (확인만 · 한 번만 시험은 안 함) */
const keepLog = !!logDir && !dry && env("LOOP_ONCE") !== "1";
const clock = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(11, 19);
let logRest = "";
if (keepLog) {
  try {
    mkdirSync(logDir, { recursive: true });
    for (const w of [process.stdout, process.stderr]) {
      const orig = w.write.bind(w) as (...a: unknown[]) => boolean;
      w.write = ((chunk: unknown, ...rest: unknown[]) => {
        try {
          const r = logLines(logRest, String(chunk), clock());
          logRest = r.rest;
          if (r.text) appendFileSync(join(logDir, `${today()}.log`), r.text);
        } catch {
          // 기록 파일이 안 돼도 수집은 그대로
        }
        return orig(chunk, ...rest);
      }) as typeof w.write;
    }
  } catch {
    // 폴더를 못 만들면 기록 파일 없이
  }
}

/** 같은 문제는 한 번만 적음 (1분마다 보니까) */
const told = new Set<string>();
const once = (m: string) => {
  if (told.has(m)) return;
  told.add(m);
  say(m);
};

/** 수집 프로그램 하나를 새로 실행 — 끝나면 브라우저까지 다 닫힘. 끝 번호 0 = 성공 */
function run(script: string, extra: Record<string, string>, limitMin: number): Promise<number> {
  return new Promise((done) => {
    // 글은 이 작업 화면으로 그대로 넘김 (하루 수집 기록 파일에도 남게 — 바로 물려주면 기록을 못 봄)
    const p = spawn(process.execPath, ["--import", tsx, join(here, script)], { cwd: join(here, ".."), env: { ...process.env, ...extra }, stdio: ["ignore", "pipe", "pipe"] });
    p.stdout?.setEncoding("utf8");
    p.stderr?.setEncoding("utf8");
    p.stdout?.on("data", (d: string) => process.stdout.write(d));
    p.stderr?.on("data", (d: string) => process.stderr.write(d));
    const t = setTimeout(() => {
      say(`  ${limitMin}분 안에 안 끝나 멈춤`);
      // 브라우저까지 같이 닫히게 (Windows 는 프로그램 묶음째)
      if (process.platform === "win32" && p.pid) spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
      else p.kill();
    }, limitMin * 60e3);
    p.on("exit", (code) => {
      clearTimeout(t);
      done(code ?? 1);
    });
    p.on("error", () => {
      clearTimeout(t);
      done(1);
    });
  });
}

/* ---------- 클라우드 — 로그인은 1시간이면 풀려 50분마다 새로 ---------- */
let fb: Fb | null = null;
let fbAt = 0;
async function cloud(): Promise<Fb> {
  if (!fb || Date.now() - fbAt > 50 * 60e3) {
    fb = await fbLogin({ apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY"), email: env("WEATHER_EMAIL"), password: env("WEATHER_PASSWORD") });
    fbAt = Date.now();
  }
  return fb;
}

/* ---------- GitHub — 이 작업 열쇠(GH_TOKEN)로 ---------- */
async function gh(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${env("GITHUB_API_URL") || "https://api.github.com"}/repos/${env("GITHUB_REPOSITORY")}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env("GH_TOKEN")}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
  });
  if (!r.ok) throw new Error(`GitHub 오류 ${r.status}`);
  return r.status === 204 ? null : r.json();
}

const onPos = (job: any) => (job.labels || []).some((l: string) => String(l).toLowerCase() === "nice-pos");

/** 이 PC 실행기(nice-pos)를 기다리는 다른 일 수 — 실시간 수집 자신은 빼고.
 *  같은 실행의 앞 단계(클라우드에서 도는 '할지 보기')가 아직 안 끝났으면 건너뛸 수도 있어 아직 셈하지 않음 */
async function othersWaiting(): Promise<number> {
  let n = 0;
  const seen = new Set<number>();
  for (const status of ["queued", "in_progress"]) {
    const r = await gh(`/actions/runs?status=${status}&per_page=50`);
    for (const w of r?.workflow_runs || []) {
      if (seen.has(w.id) || String(w.id) === env("GITHUB_RUN_ID") || String(w.path || "").includes("live-collect.yml")) continue;
      seen.add(w.id);
      const jobs: any[] = (await gh(`/actions/runs/${w.id}/jobs?filter=latest&per_page=50`))?.jobs || [];
      if (jobs.some((j) => !onPos(j) && j.status !== "completed")) continue;
      n += jobs.filter((j) => j.status === "queued" && onPos(j)).length;
    }
  }
  return n;
}

/** 비켜 주기 전에 자기를 다시 시작시켜 둠 — 기다리던 일이 끝나면 이어서 돎 (같은 확인만 · 끝 시각 그대로) */
async function startAgain(): Promise<void> {
  const inputs: Record<string, string> = {};
  if (dry) inputs.dry = "true";
  if (env("LOOP_END")) inputs.end = env("LOOP_END");
  await gh(`/actions/workflows/live-collect.yml/dispatches`, { method: "POST", body: JSON.stringify({ ref: env("GITHUB_REF_NAME") || "main", inputs }) });
}

/* ---------- 하루 수집 기록 올리기 — 저장소 live-log 가지 log/날짜.log (main 과 따로 · 이 작업 열쇠로) ---------- */
const upMark = (date: string) => join(logDir, `${date}.up`);
/** 그날 기록 파일을 올림 (있으면 덮어씀) · 올린 크기를 남겨 다음에 또 올릴지 봄 */
async function pushLog(date: string): Promise<void> {
  const file = join(logDir, `${date}.log`);
  if (!keepLog || !existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  if (!text) return;
  // 가지가 없으면 main 에서 새로 (처음 한 번)
  try {
    await gh(`/git/ref/heads/${LIVE_LOG_BRANCH}`);
  } catch {
    const m = await gh(`/git/ref/heads/main`);
    await gh(`/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${LIVE_LOG_BRANCH}`, sha: m.object.sha }) });
  }
  const path = liveLogPath(date);
  let sha: string | undefined;
  try {
    sha = (await gh(`/contents/${path}?ref=${LIVE_LOG_BRANCH}`))?.sha;
  } catch {
    // 그날 처음
  }
  await gh(`/contents/${path}`, { method: "PUT", body: JSON.stringify({ message: `하루 수집 기록 ${date}`, branch: LIVE_LOG_BRANCH, content: Buffer.from(text).toString("base64"), ...(sha ? { sha } : {}) }) });
  writeFileSync(upMark(date), String(Buffer.byteLength(text)));
}
async function pushLogSafe(date: string): Promise<void> {
  if (!keepLog) return;
  try {
    await pushLog(date);
    say(`${hm(now())} 하루 수집 기록 올림 (${LIVE_LOG_BRANCH} 가지 ${liveLogPath(date)})`);
  } catch (e) {
    say(`하루 수집 기록 올리기: ${mask((e as Error).message)}`);
  }
}
/** 작업을 시작할 때 — 지난 날 중 못 올렸거나(컴퓨터가 일찍 꺼짐) 뒤에 줄이 더 붙은(밤 대기) 기록을 올리고, 31일 지난 파일은 지움 */
async function pushOld(): Promise<void> {
  if (!keepLog) return;
  try {
    const all = readdirSync(logDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.log$/.test(f)).map((f) => f.slice(0, 10));
    const old = new Set(logPrune(today(), all));
    for (const d of old) for (const f of [`${d}.log`, `${d}.up`]) if (existsSync(join(logDir, f))) unlinkSync(join(logDir, f));
    const files = all.filter((d) => !old.has(d)).map((d) => ({ date: d, size: statSync(join(logDir, `${d}.log`)).size, up: existsSync(upMark(d)) ? Number(readFileSync(upMark(d), "utf8")) : null }));
    for (const d of logPushDue(today(), files)) await pushLogSafe(d);
  } catch (e) {
    say(`지난 하루 수집 기록 보기: ${mask((e as Error).message)}`);
  }
}

/** 실패하면 30초 뒤 다시 (3번까지) — 이어 가기가 끊기면 다음 날 아침을 GitHub 예약에 맡기게 되므로 */
async function retry<T>(f: () => Promise<T>): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i >= 3) throw e;
      await sleep(30e3);
    }
  }
}

/** 아침 수집 중 오늘 아직 한 번도 안 돈 것을 시작시킴 (core morningJobs) — 시작시킨 개수 */
async function kickMorning(): Promise<number> {
  let n = 0;
  const since = encodeURIComponent(`>=${today()}T00:00:00+09:00`);
  for (const j of morningJobs(today())) {
    const r = await gh(`/actions/workflows/${j.file}/runs?created=${since}&per_page=1`);
    if ((r?.total_count || 0) > 0) continue;
    await gh(`/actions/workflows/${j.file}/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main", inputs: j.inputs }) });
    n++;
  }
  return n;
}

/** 다음 차례 하루 수집을 맡겨 둠 — 이 작업이 끝나거나 컴퓨터가 꺼지면 같은 줄에서 기다렸다가 돎 (꺼졌으면 켜질 때까지)
 *  새로 맡기면 줄에서 기다리던 앞의 것은 GitHub 이 취소함 (가장 새것 하나만) — 오래 기다린 것이 하루 한도에 걸리지 않게 3시간마다 새로 */
let armedAt: number | null = null;
async function arm(): Promise<void> {
  const first = armedAt === null;
  await retry(startAgain);
  armedAt = now();
  if (first) say(`${hm(now())} 다음 차례 하루 수집을 맡겨 둠 (이 작업이 끝나거나, 컴퓨터가 꺼졌다 켜지면 이어서 · ${LIVE_REARM_MIN / 60}시간마다 새로)`);
}

/** 밤 대기 — 다음 차례를 맡겨 두고, 아침 09:27 까지 1분마다 이 PC 를 기다리는 다른 일이 있는지 보고(있으면 비켜 줌),
 *  아침이 되면 오늘 안 돈 아침 수집을 시작시키고 끝 → 맡겨 둔 다음 차례가 하루 수집으로 */
async function nightWait(end: number): Promise<void> {
  say(`${today()} 밤 대기 시작 ${hm(now())} — 아침 ${LIVE_MORNING_KICK} 에 아침 수집 · 하루 수집 시작 (GitHub 예약이 늦거나 빠져도)`);
  try {
    await arm();
  } catch (e) {
    say(`다음 차례 맡기기: ${mask((e as Error).message)}`);
  }
  for (;;) {
    if (liveLoopMode(now(), end) === "day") {
      try {
        const n = await retry(kickMorning);
        say(`${hm(now())} 아침 수집 ${n ? `${n}개 시작시킴` : "모두 이미 돎"}`);
      } catch (e) {
        say(`아침 수집 시작: ${mask((e as Error).message)}`);
      }
      if (armedAt === null) await retry(startAgain);
      say(`${hm(now())} 하루 수집으로 넘어감`);
      return;
    }
    try {
      const n = await othersWaiting();
      if (n) {
        if (armedAt === null) await retry(startAgain);
        say(`${hm(now())} 이 PC 실행기를 기다리는 다른 일 ${n}개 — 비켜 줌 (그 일이 끝나면 다음 차례가 이어서 밤 대기)`);
        return;
      }
    } catch (e) {
      once(`기다리는 다른 일 보기: ${mask((e as Error).message)}`);
    }
    await sleep(60e3);
  }
}

/** 끝난 뒤 붙들고 있기 — 다음 차례가 이 뒤에 줄을 서 있으니 컴퓨터가 꺼질 때까지 그대로 (꺼지면 다음 차례가 아침까지 기다림)
 *  꺼지지 않은 밤이면 05:00 에, 이 PC 를 기다리는 다른 일이 있으면 바로 놓아 줌 → 다음 차례가 밤 대기로 */
async function hold(): Promise<void> {
  say(`${hm(now())} 컴퓨터가 꺼질 때까지 붙들고 있음 (다음 차례가 뒤에 줄을 서 있음)`);
  for (;;) {
    if (liveHoldOver(now())) {
      say(`${hm(now())} 컴퓨터가 꺼지지 않아 놓아 줌 — 다음 차례가 밤 대기로 이어서`);
      return;
    }
    try {
      const n = await othersWaiting();
      if (n) {
        say(`${hm(now())} 이 PC 실행기를 기다리는 다른 일 ${n}개 — 놓아 줌 (그 일이 끝나면 다음 차례가 이어서)`);
        return;
      }
    } catch (e) {
      once(`기다리는 다른 일 보기: ${mask((e as Error).message)}`);
    }
    await sleep(60e3);
  }
}

/** A [신규 다시 확인] — 새 요청이면 네이버 수집(naver.ts)을 바로. 했으면 true */
async function askCheck(): Promise<boolean> {
  if (dry) return false; // 확인만일 때는 맡지 않음 (naver-ask.yml 이 맡음)
  const f = await cloud();
  const ask = await readConfigJson<NaverAsk>(f, "naverAsk");
  const res = await readConfigJson<NaverAskResult>(f, "naverResult");
  if (!ask || !naverAskTodo(ask, res)) return false;
  say(`${hm(now())} A [신규 다시 확인] 요청 — 네이버 수집`);
  // 먼저 '하는 중'을 써 두어 naver-ask.yml 이 또 시작시키지 않게
  await writeConfigJson(f, "naverResult", { ask: ask.at, state: "run", at: new Date().toISOString() });
  const code = await run("naver.ts", { NAVER_ASK: ask.at, COLLECT_FROM: "", COLLECT_TO: "", NAVER_PROBE: "" }, 20);
  say(`  신규 다시 확인 ${code === 0 ? "끝" : "실패"}`);
  if (code !== 0) {
    fails.push(`${hm(now())} 신규 다시 확인`);
    // 시간이 넘어 멈췄으면 결과를 못 썼음 → A 가 '하는 중'에 머물지 않게
    const r = await readConfigJson<NaverAskResult>(await cloud(), "naverResult").catch(() => null);
    if (r?.ask === ask.at && r.state === "run") await writeConfigJson(await cloud(), "naverResult", { ask: ask.at, state: "fail", at: new Date().toISOString(), stopped: true }).catch(() => {});
  }
  return true;
}

/** 한 칸 받기 — 마감 전 영업정보(OKPOS 카페 · 키즈 + 네이버) → 통합데스크 설문 파일 → 근무자 화면 숫자 */
async function collect(slot: number): Promise<void> {
  say(`── ${hm(slot)} 칸 (${hm(now())} 시작)`);
  if ((await run("live.ts", { LIVE_DATE: "" }, 10)) !== 0) fails.push(`${hm(slot)} 칸`);
  if ((await run("survey.ts", {}, 3)) !== 0) fails.push(`${hm(slot)} 설문`);
  if ((await run("work.ts", {}, 3)) !== 0) fails.push(`${hm(slot)} 근무자 화면`);
}

/* ---------- 근무자 화면 — 재방문 이벤트 예정 수 (통합데스크 현황 → 숫자만, 1분마다 · 바뀌었을 때만 쓰고 10분마다는 다시) ----------
   칸 받기와 따로 1분마다 돎 (eventTimer) — 칸을 받는 데 몇 분 걸려도(15 · 45분 칸) 20 · 50분 숫자가 늦지 않게 */
let floorKey: string | null = null;
let floorAt = 0;
let eventSig = "";
let eventAt = 0;
async function eventCheck(): Promise<void> {
  if (dry) return;
  const f = await cloud();
  if (!floorKey || Date.now() - floorAt > 60 * 60e3) {
    floorKey = await readFloorKey(f);
    floorAt = Date.now();
  }
  if (!floorKey) return;
  const desk = parseDeskLive(await readDeskLive(f));
  const doc: WorkEventDoc = { v: 1, event: desk && desk.day === today() ? workEventOf(desk) : null };
  if (checkWorkEvent(doc).length) return once("근무자 화면 이벤트: 검사에 걸려 쓰지 않음");
  const sig = JSON.stringify(doc.event ? { ...doc.event, at: "" } : null);
  if (sig === eventSig && Date.now() - eventAt < 10 * 60e3) return;
  await writeWork(f, floorKey, "event", today(), JSON.stringify(doc));
  if (!eventSig) say(`${hm(now())} 근무자 화면 이벤트: ${doc.event ? "통합데스크 숫자 옮김" : "통합데스크가 아직 안 보냄"}`);
  eventSig = sig;
  eventAt = Date.now();
}
let eventBusy = false;
function eventTick(): void {
  if (eventBusy) return;
  eventBusy = true;
  eventCheck()
    .catch((e) => once(`근무자 화면 이벤트: ${mask((e as Error).message)}`))
    .finally(() => (eventBusy = false));
}

async function main() {
  // 시험 — 한 번만 (날짜를 정했을 때 · 작업 브랜치에 올렸을 때)
  if (env("LOOP_ONCE") === "1") {
    const a = await run("live.ts", {}, 10);
    const b = await run("survey.ts", {}, 3);
    const c = await run("work.ts", {}, 3);
    process.exit(a || b || c ? 1 : 0);
  }
  const end = minutesOf(env("LOOP_END") || LIVE_LOOP_END);
  if (!Number.isFinite(end)) throw new Error("끝 시각 모양이 이상함 (HH:MM)");
  // 지난 날 하루 수집 기록 중 아직 못 올린 것 (컴퓨터가 일찍 꺼졌거나 밤 대기 줄이 더 붙은 것)
  await pushOld();
  // 끝 시각 뒤 · 아침 시작 전에 시작했으면 밤 대기 (스스로 이어 가기)
  if (chain && liveLoopMode(now(), end) === "night") return nightWait(end);
  const date = today();
  say(`${date} 하루 실시간 수집 시작 ${hm(now())} — ${LIVE_FROM} 부터 15분마다(매시 0 · 15 · 30 · 45분), ${hm(end)} 에 끝${dry ? " · 확인만 (올리지 않음)" : ""}`);
  // 오늘 아침 수집이 아직 하나도 안 돈 것이 있으면 시작시킴 (밤 대기가 끊겼을 때 — PC 를 껐다 켰거나 · 예약이 늦게 시작시켰을 때)
  if (chain) {
    try {
      const n = await kickMorning();
      if (n) say(`아침 수집 ${n}개가 오늘 아직 안 돌아 시작시킴`);
    } catch (e) {
      say(`아침 수집 보기: ${mask((e as Error).message)}`);
    }
  }

  // 이미 받은 칸 — 다시 켜졌을 때 그 칸은 건너뜀
  let last: number | null = null;
  try {
    last = liveSlotBy((await readLive(await cloud(), date))?.at, date);
  } catch (e) {
    say(`클라우드 읽기: ${mask((e as Error).message)}`);
  }
  if (last !== null) say(`이미 받은 칸: ${hm(last)}`);

  eventTick();
  const eventTimer = setInterval(eventTick, 60e3);
  let runs = 0;
  let yielded = false;
  for (;;) {
    if (today() !== date) break;
    // 다음 차례를 맡겨 둠 (시작할 때 · 3시간마다) — 매장 포스가 언제 꺼져도 아침에 켜지면 바로 이어서
    if (chain && liveArmDue(now(), armedAt)) {
      try {
        await arm();
      } catch (e) {
        once(`다음 차례 맡기기: ${mask((e as Error).message)}`);
      }
    }
    const step = liveLoopStep(now(), last, end);
    if (step.act === "end") break;
    if (step.act === "run") {
      await collect(step.slot);
      last = step.slot;
      runs++;
      continue;
    }
    const left = () => (step.slot - now()) * 60e3;
    // 칸까지 1분 30초 안이면 칸 시각에 맞춰 기다리기만
    if (left() <= 90e3) {
      await sleep(left());
      continue;
    }
    try {
      if (await askCheck()) continue;
    } catch (e) {
      once(`신규 다시 확인 요청 보기: ${mask((e as Error).message)}`);
    }
    try {
      const n = await othersWaiting();
      if (n) {
        await startAgain();
        say(`${hm(now())} 이 PC 실행기를 기다리는 다른 일 ${n}개 — 비켜 줌 (다시 시작시켜 둠, 그 일이 끝나면 이어서)`);
        yielded = true;
        break;
      }
    } catch (e) {
      once(`기다리는 다른 일 보기: ${mask((e as Error).message)}`);
    }
    await sleep(Math.min(60e3, left() - 60e3));
  }
  clearInterval(eventTimer);
  say(`${yielded ? "비켜 줌" : "끝"} ${hm(now())} — 받은 칸 ${runs}개${fails.length ? ` · 실패 ${fails.length}번 (${fails.join(", ")})` : " · 실패 없음"}`);
  // 오늘 하루 수집 기록을 저장소에 올림 — 이 뒤 붙들고 있다 컴퓨터가 꺼지면 GitHub 작업 기록은 안 남으니까
  await pushLogSafe(date);
  // 끝났으면 다음 차례를 새로 맡기고 컴퓨터가 꺼질 때까지 붙들고 있음 — 내일 아침을 GitHub 예약에 맡기지 않게
  if (chain && !yielded) {
    try {
      await arm();
      say(`${hm(now())} 다음 차례를 새로 맡김 (내일 아침 컴퓨터를 켜면 이어서)`);
    } catch (e) {
      say(`다음 차례 새로 맡기기 실패: ${mask((e as Error).message)}`);
      if (armedAt === null) fails.push("다음 차례 맡기기");
    }
    if (armedAt !== null) await hold();
  }
  if (fails.length) process.exit(1);
}

main().catch((e) => {
  say(`멈춤: ${mask((e as Error).message)}`);
  process.exit(1);
});
