/* 시험 (합치지 않음) — 목요일 새벽 주간안이 수요일 마감 전 카페 숫자를 제대로 읽는지: live/{LIVE_CHECK_DATE} 를 읽어 withLiveCafe
   그리고 그 날 다음 날을 목요일처럼 주간안을 셈 (쓰지 않음). 기록에는 있음/없음 · 시각 · 빵 종류 수 · % 만 */
import { addDays, applySettings, Board, learnWeather, makeWeek, withLiveCafe } from "@report/core";
import { fbLogin, readLive } from "./firebase";
import { readAll } from "./reports";

const env = (k: string) => process.env[k] || "";
async function main() {
  const d = env("LIVE_CHECK_DATE");
  const cfg = { apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY") };
  const { reports, weather, settings } = await readAll(cfg);
  applySettings(settings);
  const fb = await fbLogin({ ...cfg, email: env("WEATHER_EMAIL"), password: env("WEATHER_PASSWORD") });
  const live = await readLive(fb, d);
  console.log(`${d} 마감 전 문서: ${live ? "있음" : "없음"} · 칸: ${(["cafe", "kids", "naver"] as const).filter((k) => live?.[k]).join(", ") || "없음"}`);
  console.log(`${d} 확정 카페: ${reports.some((r) => r.date === d && r.cafe) ? "있음" : "없음"}`);
  const w = withLiveCafe(reports, live, d);
  console.log(`마감 전 카페를 씀: ${w.at ? `예 (${new Date(Date.parse(w.at) + 9 * 3600e3).toISOString().slice(11, 16)} 기준)` : "아니오"}`);
  if (!w.at) return;
  const thursday = addDays(d, 1);
  const real = new Board(reports);
  const learned = learnWeather(real, weather, "2025-01-01", addDays(d, -1));
  const a = makeWeek(real, weather, learned, thursday, addDays(d, -1));
  const b = makeWeek(new Board(w.reports), weather, learned, thursday, d);
  const diff = a.map((x, i) => Math.abs(b[i].week.total - x.week.total) / Math.max(1, x.week.total));
  console.log(`주간안 (${thursday} 목요일처럼): 빵 ${b[0].week.items.length}종 · 그 전날까지로 셀 때와 총 개수 차이 평균 ${(Math.round((diff.reduce((s, x) => s + x, 0) / diff.length) * 1000) / 10).toFixed(1)}%`);
}
main().catch((e) => {
  console.error(String((e as Error).message).replace(/\d{4,}/g, "#").slice(0, 200));
  process.exit(1);
});
