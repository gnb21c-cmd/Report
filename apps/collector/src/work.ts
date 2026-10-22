/* ============================================================
   근무자 화면 숫자 → 클라우드 floor/{태블릿 키}/work/now (2026-10-22 사장님, 화면 apps/bakery …/w/<키>/ · 규칙 core work.ts)
   - 바리스타 POS 하루 수집(liveLoop.ts)이 15분 칸마다 마감 전 수집 뒤에 실행
   - 이번 달 1일(또는 28일 전) ~ 오늘 보고 + 오늘 마감 전 카페 숫자 → 키친 상품별 오늘 · 1주 · 그 달 판매량 · [이벤트] 돈까스 평일 · 휴일 평균 판매량
   - 수량만 (매출 금액 · 손님 정보 없음) · 검사(checkWorkDoc)에 걸리면 쓰지 않음 · 태블릿 키가 아직 없으면 건너뜀
   - COLLECT_DRY=1 이면 쓰지 않음 · 공개 저장소라 기록에는 상품 종류 수만
   ============================================================ */
import { addDays, applySettings, Board, checkWorkDoc, withLiveCafe, workSummary, WORK_AVG_DAYS, type WorkDoc } from "@report/core";
import { fbLogin, readFloorKey, readLive, writeWork } from "./firebase";
import { readRange } from "./reports";
import { mask, say } from "./okpos";

const env = (k: string) => process.env[k] || "";

async function main() {
  const dry = env("COLLECT_DRY") === "1";
  const cfg = { apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY") };
  const fb = await fbLogin({ ...cfg, email: env("WEATHER_EMAIL"), password: env("WEATHER_PASSWORD") });
  const floor = await readFloorKey(fb);
  if (!floor) return say("근무자 화면: 태블릿 키 번호가 아직 없어 건너뜀 (매니저 앱 [태블릿 주소])");
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const monthFrom = `${today.slice(0, 8)}01`;
  const avgFrom = addDays(today, -WORK_AVG_DAYS);
  const { reports, settings } = await readRange(cfg, monthFrom < avgFrom ? monthFrom : avgFrom, today);
  applySettings(settings);
  const w = withLiveCafe(reports, await readLive(fb, today), today);
  const doc: WorkDoc = { v: 1, ...workSummary(new Board(w.reports), today, new Date().toISOString()) };
  const bad = checkWorkDoc(doc);
  if (bad.length) throw new Error(`검사에 걸려 쓰지 않음 (${bad.length})`);
  if (!dry) await writeWork(fb, floor, "now", today, JSON.stringify(doc));
  say(`근무자 화면: 키친 ${doc.kitchen.items.length}종 · 이벤트 돈까스 평균 ${doc.kitchen.donkatsu.weekday == null && doc.kitchen.donkatsu.holiday == null ? "아직 없음" : "있음"} · 오늘 카페 ${w.at ? "마감 전 숫자" : "없음"} · ${dry ? "확인만" : "씀"}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    say(`근무자 화면 멈춤: ${mask((e as Error).message)}`);
    process.exit(1);
  },
);
