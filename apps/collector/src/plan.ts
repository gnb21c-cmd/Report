/* ============================================================
   작업지시 계획 — 매일 16시(한국 시간) GitHub 가 클라우드의 실적 · 날씨 · 설정으로
   내일(확정안) · 모레(잠정 ±5%) · 글피(잠정 ±10%) 빵별 수량을 세어 plans/{날짜} 에 씀 (packages/core/src/bakery.ts makePlans)
   매니저(D)는 내일 계획을 보고 18시 전에 확정 → orders/{날짜}, 현장 태블릿(D-1)이 확정 수량을 보여 줌
   공개 저장소라 기록에는 날짜 · 빵 종류 수만 (수량 · 손님 수 없음)
   ============================================================ */
import { addDays, applySettings, Board, learnWeather, makePlans, nowKst, type PlanDoc } from "@report/core";
import { fbLogin, readPlan, writePlans } from "./firebase";
import { readAll } from "./reports";

const env = (k: string) => process.env[k] || "";

async function main() {
  const cfg = { apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY") };
  const { reports, weather, settings } = await readAll(cfg);
  applySettings(settings);
  const board = new Board(reports);
  const today = env("PLAN_TODAY") || nowKst().date;
  // 쓸 수 있는 실적은 어제까지 (어제 밤 22:10 자동 수집)
  const asOf = [board.latest() || addDays(today, -1), addDays(today, -1)].sort()[0];
  const learned = learnWeather(board, weather, "2025-01-01", asOf);
  const fb = await fbLogin({ ...cfg, email: env("WEATHER_EMAIL"), password: env("WEATHER_PASSWORD") });
  const prev = new Map<string, PlanDoc>();
  for (const k of [1, 2, 3]) {
    const d = addDays(today, k);
    const j = await readPlan(fb, d);
    if (j) prev.set(d, JSON.parse(j));
  }
  const plans = makePlans(board, weather, learned, today, asOf, (d) => prev.get(d));
  if (env("PLAN_DRY") === "1") {
    for (const p of plans) console.log(`${p.date} (${p.stage}일 앞) · 빵 ${p.items.length}종 — 확인만`);
    return;
  }
  await writePlans(fb, plans.map((p) => ({ date: p.date, json: JSON.stringify(p) })));
  console.log(`계획 씀 (${today} 16시 · 실적 ${asOf} 까지): ${plans.map((p) => `${p.date} 빵 ${p.items.length}종`).join(" · ")}`);
}

main().catch((e) => {
  console.log("멈춤:", String((e as Error).message).replace(/\d{4,}/g, "#").slice(0, 200));
  process.exit(1);
});
