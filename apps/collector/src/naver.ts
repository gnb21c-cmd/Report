/* ============================================================
   네이버 예약 자동 수집 — 매일 아침 09:40 POS 메인 PC(실행기 nice-pos)에서 어제 예약현황을 읽어 A 네이버 칸(30분마다)을 채움
   - 판매입장권 = 이용완료, 신규방문자 = 완료자 목록의 '완료 1' (packages/core/src/naverAuto.ts)
   - 어제 + 지난 7일 중 네이버 칸이 빈 날 (PC가 꺼져 있던 날) · 사람이 A 에서 넣은 칸은 그대로
   - 로그인은 사람이 POS 메인 PC에서 한 번 해 둔 상태(state.json) — 없거나 풀렸으면 실패로 끝나고 다시 로그인하라고 알림
     로그인 창(naver-login.cmd)은 이 수집이 실행기 폴더에 깔아 둠
   - COLLECT_DRY=1 이면 올리지 않고, 사람이 넣은 날과 칸마다 같은지만 견줌 (NAVER_COMPARE_DAYS 일)
   공개 저장소라 기록에는 칸 수 · 같음/다름만 남김 (인원 숫자 · 이름 없음)
   ============================================================ */
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, dayRange, isNaverTicketProduct, NAVER_AUTO_BY, naverAutoWritable, naverDiff, naverPartFrom, type NaverCellRead, type NaverPart } from "@report/core";
import { fbLogin, readPiece, writePiecesOf } from "./firebase";
import { NaverBook } from "./naverBook";
import { mask, say } from "./okpos";

const env = (k: string) => process.env[k] || "";
const todayKst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 로그인 창(naver-login.cmd)을 실행기 폴더에 깔아 둠 — 같은 PC의 Node · 크롬을 그대로 씀 */
function installLoginHelper(stateDir: string) {
  if (process.platform !== "win32") return;
  mkdirSync(stateDir, { recursive: true });
  const here = dirname(fileURLToPath(import.meta.url));
  cpSync(join(here, "..", "naver-login", "login.mjs"), join(stateDir, "login.mjs"));
  const req = createRequire(createRequire(import.meta.url).resolve("playwright/package.json"));
  const core = dirname(req.resolve("playwright-core/package.json"));
  cpSync(core, join(stateDir, "node_modules", "playwright-core"), { recursive: true, dereference: true });
  const browsers = env("PLAYWRIGHT_BROWSERS_PATH");
  const cmd = ["@echo off", "chcp 65001 >nul", browsers ? `set "PLAYWRIGHT_BROWSERS_PATH=${browsers}"` : "", `"${process.execPath}" "${join(stateDir, "login.mjs")}"`, "pause", ""].filter((l) => l !== "").join("\r\n");
  writeFileSync(join(stateDir, "naver-login.cmd"), cmd);
  // 찾기 쉽게 실행기 폴더 맨 위에도 (…\_work\_tool\naver-login → 세 단계 위)
  const root = resolve(stateDir, "..", "..", "..");
  try {
    writeFileSync(join(root, "naver-login.cmd"), cmd);
  } catch {
    /* 권한이 없으면 도구 폴더 안의 것만 */
  }
}

async function main() {
  const stateDir = env("NAVER_STATE_DIR") || join(process.cwd(), ".naver");
  const statePath = join(stateDir, "state.json");
  const dry = env("COLLECT_DRY") === "1";
  const probe = env("NAVER_PROBE") === "1";
  installLoginHelper(stateDir);
  if (!existsSync(statePath)) {
    say("네이버 로그인 정보가 아직 없습니다 — POS 메인 PC에서 C:\\actions-runner\\naver-login.cmd 를 더블클릭해 한 번 로그인해 주세요");
    process.exit(1);
  }

  const fb = env("WEATHER_EMAIL")
    ? await fbLogin({ apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY"), email: env("WEATHER_EMAIL"), password: env("WEATHER_PASSWORD") })
    : null;

  // 받을 날: 정해 주면 그대로 · 아니면 어제 + 지난 7일 중 네이버 칸이 빈 날 (확인만이면 사람이 넣은 최근 며칠과 견줌)
  const today = todayKst();
  const yesterday = addDays(today, -1);
  let dates: string[];
  if (env("COLLECT_FROM")) dates = dayRange(env("COLLECT_FROM"), env("COLLECT_TO") || env("COLLECT_FROM"));
  else {
    dates = [yesterday];
    for (const d of dayRange(addDays(today, -7), addDays(today, -2))) if (fb && !(await readPiece(fb, d, "naver"))) dates.unshift(d);
    if (dry) {
      const n = Number(env("NAVER_COMPARE_DAYS") || 3);
      dates = [...new Set([...dayRange(addDays(today, -n), yesterday), ...dates])].sort();
    }
  }
  say(`날짜 ${dates.map(md).join(" · ")}${dry ? " · 확인만 (올리지 않음)" : ""}`);

  const nb = await NaverBook.open(statePath);
  const problems: string[] = [];
  const items: { date: string; part: NaverPart }[] = [];
  try {
    try {
      await nb.enter(env("NAVER_BIZ_ID"));
    } catch (e) {
      if (probe) await nb.probe("들어가기");
      throw e;
    }
    for (const date of dates) {
      try {
        await nb.gotoDate(date);
        const { cells, rows, headers } = await nb.readCells();
        if (probe) await nb.probe(md(date));
        if (!rows) throw new Error("회차 표를 못 찾음");
        const reads: NaverCellRead[] = [];
        let firstOk = 0;
        let listMismatch = 0;
        for (const c of cells) {
          let first: number | null = null;
          if (c.done > 0 && isNaverTicketProduct(c.product)) {
            try {
              const r = await nb.countFirst(c.key);
              first = r.first;
              firstOk++;
              if (r.listed !== c.done) listMismatch++;
            } catch (e) {
              say(`  ${md(date)} 완료자 목록을 못 읽은 칸 하나 (${mask((e as Error).message).split("\n")[0].slice(0, 60)})`);
            }
          } else first = 0;
          reads.push({ product: c.product, time: c.time, done: c.done, first });
        }
        const r = naverPartFrom(date, reads);
        const ticketCells = reads.filter((x) => x.done > 0 && isNaverTicketProduct(x.product)).length;
        say(
          `${md(date)}: 회차 ${rows}줄 · 상품 열 ${headers.length}개 · 이용완료 칸 ${cells.length}개(판매입장권 ${ticketCells}칸) · 완료자 목록 ${firstOk}칸 읽음${listMismatch ? ` (목록 건수와 이용완료가 다른 칸 ${listMismatch})` : ""}${r.skipped.length ? ` · 19:30 넘는 회차 ${r.skipped.length}개 뺌` : ""}${r.overlap.length ? ` · 겹침 ${r.overlap.join(",")}` : ""}${r.part.noNew ? " · 신규방문자 모름" : ""}`,
        );
        const old = fb ? await readPiece(fb, date, "naver") : null;
        if (old?.p && old.by !== NAVER_AUTO_BY) {
          const d = naverDiff(r.part, old.p as NaverPart);
          say(`  사람이 넣은 값과 견줌: 판매입장권 ${d.tickets.length ? `다름 (${d.tickets.join(",")})` : "같음"} · 신규방문자 ${(old.p as NaverPart).noNew ? "(손 입력에 없음)" : d.newVisitors.length ? `다름 (${d.newVisitors.join(",")})` : "같음"}`);
        }
        if (!naverAutoWritable(old)) {
          say(`  ${md(date)}: 사람이 A 에서 넣은 칸이라 그대로`);
          continue;
        }
        if (!r.used) throw new Error("판매입장권 상품 칸이 하나도 없음 — 상품 이름이 바뀌었는지 확인");
        items.push({ date, part: r.part });
      } catch (e) {
        problems.push(`${md(date)}: ${mask((e as Error).message).split("\n")[0].slice(0, 120)}`);
        if (probe) await nb.probe(`${md(date)} 실패`);
      }
    }
    await nb.saveState(statePath);
  } finally {
    await nb.close();
  }
  if (fb && !dry && items.length) {
    await writePiecesOf(fb, "naver", NAVER_AUTO_BY, "네이버 예약현황 자동 수집", items);
    say(`클라우드에 올림: ${items.length}일`);
  } else if (!dry) say("클라우드에 올릴 날 없음");
  if (problems.length) {
    for (const p of problems) say(`문제 — ${p}`);
    process.exit(1);
  }
}

main().catch((e) => {
  say(`멈춤: ${mask((e as Error).message).split("\n")[0].slice(0, 200)}`);
  process.exit(1);
});
