/* ============================================================
   통합데스크 설문 보고 → 클라우드 (보고 앱 첫 화면 '설문조사', 2026-10-14 사장님)
   - 아스타나키즈 통합데스크(1.38~)가 매일 20:00 POS PC 데스크 폴더(%APPDATA%\아스타나키즈 입장 데스크\report-outbox\)에
     survey-날짜.json (질문 · 기간 · 대상 · 번호별 오늘 · 누적 · 제외 · 응답 수 — 손님 이름 · 전화 없음) 을 남김
   - 그 파일들을 읽어 설문마다 가장 최근 날의 누적을 settings/surveys 에 올림 (packages/core/src/survey.ts surveysFromDesk)
   - POS 메인 PC 의 마감 전 수집(live-collect.yml) 마지막 단계로 30분마다 — 바뀌었을 때만 올림, 폴더가 없으면 건너뜀
   - 실행기가 데스크와 다른 Windows 사용자로 돌 수 있어 사용자 폴더들을 다 찾아봄
   - COLLECT_DRY=1 이면 확인만
   공개 저장소라 기록에는 파일 수 · 설문 수 · 항목 수만 (설문 내용 · 응답 수 · 폴더 이름 없음)
   ============================================================ */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SURVEY_FILE_RE, SURVEY_OUTBOX, surveyList, surveysFromDesk } from "@report/core";
import { fbLogin, readSettingsJson, writeSettingsJson } from "./firebase";
import { say } from "./okpos";

const env = (k: string) => process.env[k] || "";
const DESK_DIR = "아스타나키즈 입장 데스크";
const todayKst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

/** 설문 보고 폴더 후보 — 정해 준 곳 · 이 사용자 · PC 의 다른 사용자들 */
function outboxes(): string[] {
  const out = [env("SURVEY_OUTBOX_DIR"), env("APPDATA") && join(env("APPDATA"), DESK_DIR, SURVEY_OUTBOX)].filter(Boolean);
  if (process.platform === "win32" && existsSync("C:\\Users")) {
    try {
      for (const u of readdirSync("C:\\Users")) out.push(join("C:\\Users", u, "AppData", "Roaming", DESK_DIR, SURVEY_OUTBOX));
    } catch {
      /* 못 읽는 사용자 폴더는 건너뜀 */
    }
  }
  return [...new Set(out)].filter((d) => {
    try {
      return existsSync(d) && statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
}

async function main() {
  const files: unknown[] = [];
  let bad = 0;
  for (const dir of outboxes())
    for (const name of readdirSync(dir).filter((n) => SURVEY_FILE_RE.test(n))) {
      try {
        files.push(JSON.parse(readFileSync(join(dir, name), "utf8").replace(/^\uFEFF/, "")));
      } catch {
        bad++;
      }
    }
  if (!files.length) {
    say(`통합데스크 설문 보고 파일이 아직 없음 — 건너뜀${bad ? ` (읽지 못한 파일 ${bad}개)` : ""}`);
    return;
  }
  const doc = surveysFromDesk(files);
  if (!doc) throw new Error(`설문 보고 파일 ${files.length}개가 모두 모양이 다름 (astanakiz docs/SHARE.md · Report docs/SURVEY.md)`);
  const open = surveyList(doc, todayKst()).filter((x) => x.open).length;
  say(`보고 파일 ${files.length}개${bad ? ` (읽지 못함 ${bad}개)` : ""} → 설문 ${doc.surveys.length}건 (진행 중 ${open}건) · 항목 ${doc.surveys.reduce((a, s) => a + s.options.length, 0)}개`);
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
