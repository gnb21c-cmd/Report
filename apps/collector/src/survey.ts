/* ============================================================
   통합데스크 설문 집계 → 클라우드 (보고 앱 첫 화면 '설문조사', 2026-10-14 사장님)
   - 아스타나키즈 통합데스크가 매일 20시에 POS PC 데스크 폴더(%APPDATA%\아스타나키즈 입장 데스크\)에 남기는
     survey-state.json (항목별 응답 수만 — 손님 이름 · 전화 없음, 모양은 docs/SURVEY.md) 을 읽어 settings/surveys 에 올림
   - POS 메인 PC 의 마감 전 수집(live-collect.yml) 마지막 단계로 30분마다 — 바뀌었을 때만 올림, 파일이 없으면 건너뜀
   - 실행기가 데스크와 다른 Windows 사용자로 돌 수 있어 사용자 폴더들을 찾아 가장 최근 파일을 씀
   - COLLECT_DRY=1 이면 확인만
   공개 저장소라 기록에는 설문 수 · 항목 수만 (설문 내용 · 응답 수 · 폴더 이름 없음)
   ============================================================ */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { cleanSurveys, SURVEY_FILE, surveyList } from "@report/core";
import { fbLogin, readSettingsJson, writeSettingsJson } from "./firebase";
import { say } from "./okpos";

const env = (k: string) => process.env[k] || "";
const DESK_DIR = "아스타나키즈 입장 데스크";
const todayKst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

/** 설문 파일 후보 — 정해 준 곳 · 이 사용자 · PC 의 다른 사용자들 */
function candidates(): string[] {
  const out = [env("SURVEY_FILE_PATH"), env("APPDATA") && join(env("APPDATA"), DESK_DIR, SURVEY_FILE)].filter(Boolean);
  const users = process.platform === "win32" ? "C:\\Users" : "";
  if (users && existsSync(users)) {
    try {
      for (const u of readdirSync(users)) out.push(join(users, u, "AppData", "Roaming", DESK_DIR, SURVEY_FILE));
    } catch {
      /* 못 읽는 사용자 폴더는 건너뜀 */
    }
  }
  return [...new Set(out)];
}

async function main() {
  const found = candidates()
    .filter((p) => {
      try {
        return existsSync(p) && statSync(p).isFile();
      } catch {
        return false;
      }
    })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!found.length) {
    say("통합데스크 설문 파일이 아직 없음 — 건너뜀");
    return;
  }
  const doc = cleanSurveys(JSON.parse(readFileSync(found[0], "utf8").replace(/^\uFEFF/, "")));
  if (!doc) throw new Error("설문 파일 모양이 다름 (docs/SURVEY.md)");
  const open = surveyList(doc, todayKst()).filter((x) => x.open).length;
  say(`설문 ${doc.surveys.length}건 (진행 중 ${open}건) · 항목 ${doc.surveys.reduce((a, s) => a + s.options.length, 0)}개`);
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
