/* 예측 비교 시험용 하루 표 — 클라우드 실적을 읽어 실행기 임시 폴더(OUT)에만 씀 (저장소 · 기록 · 올리기 없음)
   날마다: 빵 판매 개수 · 날 유형 · 휴일 · 명절 · 기간 스티커 · 기상청 관측 날씨
   그리고 지금 방식(30 · 30 · 40 + 빵용 날씨)으로 그날 7일 앞(날씨 모름) · 4일 앞(날씨 앎)에 낸 예측
   → apps/forecast-ml/compare.py 가 기계학습 방식과 견줌 */
import { writeFileSync } from "node:fs";
import { addDays, applySettings, Board, breadPlan, dayKind, dayRange, holidayName, NOT_BREAD, seasonOf, weekday } from "@report/core";
import { readAll } from "./reports";

const env = (k: string) => process.env[k] || "";

async function main() {
  const { reports, weather, settings } = await readAll({ apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY") });
  applySettings(settings);
  const board = new Board(reports);
  const last = board.latest()!;
  const rows: Record<string, unknown>[] = [];
  for (const d of dayRange(board.first!, last)) {
    const r = board.report(d);
    const bread = r?.cafe ? board.products(d, d, "베이커리").reduce((a, p) => a + (NOT_BREAD.has(p.name) ? 0 : Math.max(0, p.qty)), 0) : null;
    const w = weather[d];
    const h = holidayName(d);
    const pred = (lead: number, wx: boolean) => (bread && d >= "2026-01-01" ? breadPlan(board, wx ? weather : {}, addDays(d, -lead), d).total : null);
    rows.push({
      date: d,
      bread: bread || null,
      kind: dayKind(d),
      wd: weekday(d),
      holiday: h ? 1 : 0,
      lunar: h && /설|추석/.test(h) ? 1 : 0,
      season: seasonOf(d).kind,
      tmax: w?.tempMax ?? null,
      rain: w?.rainMm ?? null,
      snow: w?.key === "snow" ? 1 : 0,
      blend7: pred(7, false),
      blend4: pred(4, true),
    });
  }
  writeFileSync(env("OUT") || "daily.json", JSON.stringify(rows));
  console.log(`하루 표 ${rows.length}일 (${rows[0].date} ~ ${last}) — 실행기 임시 폴더에만`);
}

main().catch((e) => {
  console.log("멈춤:", (e as Error).message.slice(0, 200));
  process.exit(1);
});
