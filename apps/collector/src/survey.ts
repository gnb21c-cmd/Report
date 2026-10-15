/* ============================================================
   통합데스크 설문 보고 → 클라우드 (보고 앱 첫 화면 '설문조사', 2026-10-14 사장님)
   - 아스타나키즈 통합데스크(1.38~)가 매일 20:00 POS PC 데스크 폴더(%APPDATA%\아스타나키즈 입장 데스크\report-outbox\)에
     survey-날짜.json (질문 · 기간 · 대상 · 번호별 오늘 · 누적 · 제외 · 응답 수 — 손님 이름 · 전화 없음) 을 남김
   - 그 파일들을 읽어 설문마다 가장 최근 날의 누적을 settings/surveys 에 올림 (packages/core/src/survey.ts surveysFromDesk)
   - POS 메인 PC 의 마감 전 수집(live-collect.yml) 마지막 단계로 30분마다 — 바뀌었을 때만 올림, 폴더가 없으면 건너뜀
   - 실행기는 서비스 계정(NETWORK SERVICE)이라 데스크 Windows 계정의 폴더에 못 들어감 → 실행기 폴더에 survey-share.cmd 를 깔아 두고
     못 들어가면 그것을 한 번 더블클릭하라고 알림 (surveyShare.ts) — 사용자 폴더들을 다 찾아봄
   - COLLECT_DRY=1 이면 확인만
   공개 저장소라 기록에는 파일 수 · 설문 수 · 항목 수 · 폴더 수만 (설문 내용 · 응답 수 · 폴더 이름 없음)
   ============================================================ */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SURVEY_FILE_RE, surveyList, surveysFromDesk } from "@report/core";
import { fbLogin, readSettingsJson, writeSettingsJson } from "./firebase";
import { say } from "./okpos";
import { noFileHint, probeDir, scanOutboxes, SHARE_CMD, SHARE_PS1, shareCmd, shareScript } from "./surveyShare";

const env = (k: string) => process.env[k] || "";
const todayKst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

/** 사람이 쓰지 않는 Windows 기본 폴더 (바로가기 · 공용 — 들어가지 못함으로 잘못 세지 않게) */
const SYSTEM_PROFILES = new Set(["all users", "default", "default user", "public", "desktop.ini"]);

/** 사용자 Roaming 폴더 후보 — 이 실행기 · PC 의 다른 사용자들 */
function roamings(): string[] {
  const out = [env("APPDATA")];
  if (process.platform === "win32" && existsSync("C:\\Users")) {
    try {
      for (const u of readdirSync("C:\\Users")) if (!SYSTEM_PROFILES.has(u.toLowerCase())) out.push(join("C:\\Users", u, "AppData", "Roaming"));
    } catch {
      /* 사용자 목록을 못 읽으면 이 실행기 것만 */
    }
  }
  return out;
}

/** 연결 도우미(survey-share.cmd · .ps1)를 실행기 폴더 맨 위에 (…\_work\_tool → 두 단계 위, naver-login.cmd 옆) — 못 쓰면 도구 폴더에. 깐 폴더를 돌려줌 */
function installShareHelper(): string | undefined {
  if (process.platform !== "win32" || !env("RUNNER_TOOL_CACHE")) return undefined;
  const put = (dir: string) => {
    mkdirSync(dir, { recursive: true });
    const write = (name: string, body: string) => {
      const f = join(dir, name);
      if (!existsSync(f) || readFileSync(f, "utf8") !== body) writeFileSync(f, body, "utf8");
    };
    write(SHARE_PS1, "\uFEFF" + shareScript());
    write(SHARE_CMD, shareCmd());
  };
  for (const dir of [resolve(env("RUNNER_TOOL_CACHE"), "..", ".."), join(env("RUNNER_TOOL_CACHE"), "survey")])
    try {
      put(dir);
      return dir;
    } catch {
      /* 못 쓰면 다음 곳 · 못 깔아도 수집은 그대로 */
    }
  return undefined;
}

async function main() {
  const helperDir = installShareHelper();
  const scan = scanOutboxes([env("SURVEY_OUTBOX_DIR")], roamings(), (d) => probeDir(() => statSync(d)), join);
  const files: unknown[] = [];
  let bad = 0;
  for (const dir of scan.found) {
    let names: string[];
    try {
      names = readdirSync(dir).filter((n) => SURVEY_FILE_RE.test(n));
    } catch {
      scan.denied++;
      continue;
    }
    for (const name of names) {
      try {
        files.push(JSON.parse(readFileSync(join(dir, name), "utf8").replace(/^\uFEFF/, "")));
      } catch {
        bad++;
      }
    }
  }
  if (!files.length) {
    const hint = noFileHint(scan, bad, helperDir);
    say(hint.text);
    // 실행 기록 맨 위 요약에도 보이게 (실패로 끝내지는 않음 — 마감 전 수집은 그대로)
    if (hint.warn) console.log(`::warning title=설문조사::${hint.text}`);
    return;
  }
  const doc = surveysFromDesk(files);
  if (!doc) throw new Error(`설문 보고 파일 ${files.length}개가 모두 모양이 다름 (astanakiz docs/SHARE.md · Report docs/SURVEY.md)`);
  const open = surveyList(doc, todayKst()).filter((x) => x.open).length;
  say(`보고 폴더 ${scan.found.length}곳 · 보고 파일 ${files.length}개${bad ? ` (읽지 못함 ${bad}개)` : ""} → 설문 ${doc.surveys.length}건 (진행 중 ${open}건) · 항목 ${doc.surveys.reduce((a, s) => a + s.options.length, 0)}개`);
  if (env("COLLECT_DRY") === "1") return say("확인만 (올리지 않음)");
  const fb = await fbLogin({ apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY"), email: env("WEATHER_EMAIL"), password: env("WEATHER_PASSWORD") });
  const json = JSON.stringify(doc);
  if ((await readSettingsJson(fb, "surveys")) === json) return say("클라우드와 같음 — 올리지 않음");
  await writeSettingsJson(fb, "surveys", json);
  say("클라우드에 올림");
}

main().catch((e) => {
  say(`멈춤: ${String((e as Error).message).slice(0, 200)}`);
  process.exit(1);
});
