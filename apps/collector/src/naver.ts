/* ============================================================
   네이버 예약 자동 수집 — 매일 아침 09:15 POS 메인 PC(실행기 nice-pos)에서 어제 예약현황을 읽어 A 네이버 칸(30분마다)을 채움
   - 판매입장권 = 이용완료, 신규방문자 = 어제 완료자 목록에 나온 줄 수가 그 손님의 '완료 N' 과 같은 손님 (packages/core/src/naverAuto.ts)
     '완료 N' 은 손님 아이디를 따라가는 누적 이용완료 예약 건수라, 다음 날 아침에 본 어제만 신규방문자가 맞음 — 더 지난 날은 신규방문자 '모름'(판매입장권만)
   - 어제 + 지난 7일 중 네이버 칸이 빈 날 (PC가 꺼져 있던 날) · 사람이 A 에서 넣은 칸은 그대로
   - 로그인은 사람이 POS 메인 PC에서 한 번 해 둔 상태(state.json) — 없거나 풀렸으면 실패로 끝나고 다시 로그인하라고 알림
     로그인 창(naver-login.cmd)은 이 수집이 실행기 폴더에 깔아 둠
   - 문 연 뒤(10시대 다시 하기 · A [신규 다시 확인])에 읽으면 오늘 이용완료 목록도 같이 읽어, 어제 손님이 오늘 또 왔으면 그 줄 수만큼 '완료 N' 에서 빼고 견줌
   - NAVER_ASK = A [신규 다시 확인] 요청 시각 → 끝나면 결과(어제 판매입장권 · 신규 · 어제오늘 같은 손님의 줄 수와 '완료 N', 이름 없이)를 config/naverResult 에 씀
   - COLLECT_DRY=1 이면 올리지 않고, 사람이 넣은 날과 칸마다 같은지만 견줌 (NAVER_COMPARE_DAYS 일)
   공개 저장소라 기록에는 칸 수 · 같음/다름만 남김 (인원 숫자 · 이름 없음)
   ============================================================ */
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, dayRange, isNaverTicketProduct, NAVER_SLOTS, naverTime, NAVER_AUTO_BY, naverAutoWritable, naverDiff, naverNewVisitors, naverPartFrom, naverRepeaters, type NaverCellRead, type NaverPart, type NaverVisit } from "@report/core";
import { fbLogin, readPiece, writeConfigJson, writePiecesOf } from "./firebase";
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

let fbRef: Awaited<ReturnType<typeof fbLogin>> | null = null;

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

  const fb = (fbRef = env("WEATHER_EMAIL")
    ? await fbLogin({ apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY"), email: env("WEATHER_EMAIL"), password: env("WEATHER_PASSWORD") })
    : null);

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
  // A [신규 다시 확인] 결과 (어제만)
  let summary: { date: string; tickets: number; newPeople: number | null; todayCells: number; todayFail: number; repeaters: ReturnType<typeof naverRepeaters> } | null = null;
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
        const visits: (NaverVisit & { hasName?: boolean; hasTel?: boolean })[] = [];
        let listOk = 0;
        let listFail = 0;
        // '완료 N' 은 그 손님의 지금까지 누적 이용완료 예약 건수 — 다음 날 아침에 본 어제만 신규방문자가 맞음 (그 전 날짜는 '모름')
        // 어제는 이용완료가 있는 칸을 상품 가리지 않고 모두 열어 봄 (다른 상품 예약도 그 손님의 '완료 N' 에 들어가니까)
        // 예약이 1건뿐인 칸은 누르면 목록 대신 그 예약 상세가 열림 → 같은 상품의 다른 칸 목록 주소로 알아 둔 상품번호로 목록 주소를 바로 엶
        //   그래서 한 번 돌고, 못 읽은 칸은 끝에 한 번 더
        const failed = new Set<number>();
        const tryCell = async (c: (typeof cells)[number], last: boolean) => {
          try {
            for (const x of await nb.readList(c.key, c.product, naverTime(c.time) || "")) visits.push({ ...x, time: c.time, product: c.product });
            listOk++;
            failed.delete(c.key);
          } catch (e) {
            failed.add(c.key);
            if (last) say(`  ${md(date)} 완료자 목록을 못 읽은 칸 하나 (${mask((e as Error).message).split("\n")[0].slice(0, 60)})`);
          }
        };
        if (date === yesterday) {
          for (const c of cells) if (c.done > 0) await tryCell(c, false);
          for (const c of cells) if (failed.has(c.key)) await tryCell(c, true);
        }
        listFail = failed.size;
        // 오늘 이미 이용완료가 있으면(문 연 뒤 다시 읽을 때) 오늘 목록도 읽음 — 어제 손님이 오늘 또 왔으면 '완료 N' 에 오늘 줄이 들어 있어서
        const later: NaverVisit[] = [];
        let todayCells = 0;
        let todayFail = 0;
        if (date === yesterday) {
          await nb.gotoDate(today);
          const t = await nb.readCells();
          const done = t.cells.filter((c) => c.done > 0);
          todayCells = done.length;
          const bad = new Set<number>();
          for (const pass of [0, 1])
            for (const c of done) {
              if (pass && !bad.has(c.key)) continue;
              try {
                for (const x of await nb.readList(c.key, c.product, naverTime(c.time) || "")) later.push({ ...x, time: c.time, product: c.product });
                bad.delete(c.key);
              } catch {
                bad.add(c.key);
              }
            }
          todayFail = bad.size;
          if (todayCells) say(`  오늘 이용완료 칸 ${todayCells}개 · 목록 ${todayCells - todayFail}칸 읽음 (어제 손님이 오늘 또 왔는지 보려고)`);
          // 오늘 목록을 다 못 읽으면 어제 신규를 믿을 수 없음 → 모름 · 다시 하기
          if (todayFail) for (const c of cells) if (c.done > 0 && isNaverTicketProduct(c.product)) failed.add(c.key);
        }
        for (const c of cells) {
          const first: number | null = date !== yesterday || (failed.has(c.key) && isNaverTicketProduct(c.product)) ? null : 0;
          reads.push({ product: c.product, time: c.time, done: c.done, first });
        }
        const r = naverPartFrom(date, reads, date === yesterday ? visits : undefined, later);
        const nv = date === yesterday ? naverNewVisitors(visits, later) : null;
        if (date === yesterday) {
          const rep = naverRepeaters(visits, later);
          if (later.length) say(`  어제 · 오늘 모두 온 손님 ${rep.length ? `${rep.length}명 (그중 어제 신규 ${rep.filter((x) => x.isNew).length}명)` : "없음"}`);
          summary = { date, tickets: r.part.tickets.reduce((a, b) => a + b, 0), newPeople: r.part.noNew ? null : r.part.newVisitors.reduce((a, b) => a + b, 0), todayCells, todayFail, repeaters: rep };
        }
        const ticketCells = reads.filter((x) => x.done > 0 && isNaverTicketProduct(x.product)).length;
        say(
          `${md(date)}: 회차 ${rows}줄 · 상품 열 ${headers.length}개 · 이용완료 칸 ${cells.length}개(판매입장권 ${ticketCells}칸)${date === yesterday ? ` · 완료자 목록 ${listOk}칸 읽음${listFail ? ` · 못 읽음 ${listFail}칸` : ""}${nv ? (nv.unknown ? ` · 손님을 못 알아본 줄 ${nv.unknown}개('완료 1' 로만 셈)` : " · 손님 모두 알아봄") : ""}` : ""}${r.skipped.length ? ` · 19:30 넘는 회차 ${r.skipped.length}개 뺌` : ""}${r.overlap.length ? ` · 겹침 ${r.overlap.join(",")}` : ""}${r.part.noNew ? " · 신규방문자 모름" : ""}`,
        );
        const old = fb ? await readPiece(fb, date, "naver") : null;
        if (old?.p && old.by !== NAVER_AUTO_BY) {
          const d = naverDiff(r.part, old.p as NaverPart);
          say(`  사람이 넣은 값과 견줌: 판매입장권 ${d.tickets.length ? `다름 (${d.tickets.join(",")})` : "같음"} · 신규방문자 ${(old.p as NaverPart).noNew ? "(손 입력에 없음)" : r.part.noNew ? "(자동 쪽 모름)" : d.newVisitors.length ? `다름 (${d.newVisitors.join(",")})` : "같음"}`);
        }
        if (date === yesterday && listOk && !visits.length) say("  진단 — 완료자 목록은 열렸는데 줄을 하나도 못 읽음");
        if (dry && date === yesterday && visits.length) {
          // 확인만: 신규방문자가 왜 다른지 — 예전 방식('완료 1' 줄 수)과 손 입력 비교 · 이름/전화 읽힘 · 묶인 손님의 '완료 N' 이 서로 같은지 (숫자 없이)
          const all = (f: (v: (typeof visits)[number]) => boolean | undefined) => (visits.every(f) ? "모두" : visits.some(f) ? "일부" : "없음");
          const groups = new Map<string, Set<number>>();
          for (const v of visits) if (v.who) groups.set(v.who, (groups.get(v.who) || new Set()).add(v.n));
          const odd = [...groups.values()].filter((s) => s.size > 1).length;
          const many = [...groups.keys()].filter((w) => new Set(visits.filter((v) => v.who === w).map((v) => v.id)).size > 1).length;
          say(`  진단 — 이름 읽힘 ${all((v) => v.hasName)} · 전화 뒷자리 ${all((v) => v.hasTel)} · 예약번호 ${all((v) => !/^y/.test(v.id))} · 여러 줄로 묶인 손님 ${many ? "있음" : "없음"} · 묶였는데 '완료 N' 이 서로 다른 손님 ${odd}`);
          if (old?.p && old.by !== NAVER_AUTO_BY && !(old.p as NaverPart).noNew) {
            const oldWay = naverPartFrom(date, reads.map((c) => ({ ...c, first: 0 })), undefined).part;
            for (const v of visits) {
              const i = isNaverTicketProduct(v.product) && v.n === 1 ? NAVER_SLOTS.indexOf(naverTime(v.time) || "") : -1;
              if (i >= 0) oldWay.newVisitors[i]++;
            }
            const d = naverDiff(oldWay, old.p as NaverPart);
            say(`  예전 방식('완료 1' 줄 수)으로 세면 손 입력과: ${d.newVisitors.length ? `다름 (${d.newVisitors.join(",")})` : "같음"}`);
            // 새 방식이 손 입력보다 많은(+) · 적은(-) 칸 — 바뀐 셈법 때문이면 + 만 나와야 함
            const hand = (old.p as NaverPart).newVisitors;
            const dir = NAVER_SLOTS.map((t, i) => (r.part.newVisitors[i] > (hand[i] || 0) ? `${t}+` : r.part.newVisitors[i] < (hand[i] || 0) ? `${t}-` : "")).filter(Boolean);
            say(`  새 방식 - 손 입력: ${dir.length ? dir.join(",") : "모두 같음"}`);
          }
        }
        // 어제 신규방문자를 다 못 읽었으면 판매입장권은 올리되 실패로 끝냄 → 10분 뒤 · 10시대 다시 하기가 돎
        // (어제 온 손님이 다음 날 아침에 또 오는 일은 없어서 문 연 뒤에 다시 읽어도 '완료 N' 이 그대로)
        if (date === yesterday && r.part.noNew) problems.push(`${md(date)}: 신규방문자를 다 못 읽음 (완료자 목록 ${listFail}칸) — 다시 하기에서 읽음`);
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
  if (fb && env("NAVER_ASK")) {
    await writeConfigJson(fb, "naverResult", { ask: env("NAVER_ASK"), state: problems.length ? "fail" : "done", at: new Date().toISOString(), dry, ...(summary || {}), problems: problems.length });
    say("A [신규 다시 확인] 결과를 씀");
  }
  if (problems.length) {
    for (const p of problems) say(`문제 — ${p}`);
    process.exit(1);
  }
}

main().catch(async (e) => {
  say(`멈춤: ${mask((e as Error).message).split("\n")[0].slice(0, 200)}`);
  // A [신규 다시 확인] 이었으면 멈췄다고 알림 (A 가 '하는 중'에 머물지 않게)
  if (fbRef && env("NAVER_ASK")) await writeConfigJson(fbRef, "naverResult", { ask: env("NAVER_ASK"), state: "fail", at: new Date().toISOString(), stopped: true }).catch(() => {});
  process.exit(1);
});
