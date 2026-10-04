/* 작업지시 예측 시험 — 클라우드의 지난 자료로 "그날 사흘 전(이틀 전 16시 확정, 자료는 사흘 전까지)에 예측했다면 몇 % 틀렸을까"
   공개 저장소라 기록에는 오차 % · 날씨 배수만 남김 (방문객 수 · 매출 · 빵 개수 없음)
   BT_FROM ~ BT_TO (없으면 2026-04-01 ~ 마지막 자료일) · 날씨 배수는 그 전 자료로 배움 */
import { addDays, applySettings, backtest, Board, dayKind, dayRange, DEFAULT_LEARNED, learnWeather, WEATHER_CLASSES, type Learned } from "@report/core";
import { readAll } from "./reports";

const env = (k: string) => process.env[k] || "";

async function main() {
  const { reports, weather, settings } = await readAll({ apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY") });
  applySettings(settings);
  const board = new Board(reports);
  const last = board.latest()!;
  const from = env("BT_FROM") || "2026-04-01";
  const to = env("BT_TO") || last;
  console.log(`자료 ${reports.length}일 (${board.first} ~ ${last}) · 날씨 ${Object.keys(weather).length}일 · 시험 ${from} ~ ${to}`);

  const learned = learnWeather(board, weather, "2025-01-01", addDays(from, -1));
  console.log("\n날씨 칸별 손님 배수 (배운 값 · 배운 날 수)");
  for (const c of WEATHER_CLASSES) console.log(`  ${c}: ${learned.weather[c].toFixed(3)} (${learned.weatherDays[c]}일)`);
  console.log(`기간 배수: ${Object.entries(learned.season).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(" · ")}`);

  const show = (title: string, l: Learned, w = weather) => {
    const r = backtest(board, w, from, to, 3, l);
    console.log(`${title.padEnd(22)} 방문객 오차 ${r.all.visitors}% (평일 ${r.평일.visitors} · 금 ${r.금요일.visitors} · 휴일 ${r.휴일.visitors}) · 빵 총 개수 오차 ${r.all.bread}% (평일 ${r.평일.bread} · 금 ${r.금요일.bread} · 휴일 ${r.휴일.bread}) · ${r.all.days}일`);
    return r;
  };
  console.log("\n방법별 평균 오차 (절대 %, 작을수록 좋음)");
  for (const lambda of [0, 0.25, 0.5, 0.75, 1]) show(`되돌림 λ=${lambda}`, { ...learned, lambda });
  show("날씨 안 씀 (λ=0.5)", { ...DEFAULT_LEARNED, weather: Object.fromEntries(WEATHER_CLASSES.map((c) => [c, 1])) as any }, {});
  show("날씨 사장님 규칙만", { ...DEFAULT_LEARNED });

  // 견줄 단순한 방법: 지난주 같은 요일 그대로 · 최근 4주 같은 날 유형 평균
  const naive = (pick: (d: string) => string[]) => {
    const errs: number[] = [];
    for (const d of dayRange(from, to)) {
      const a = board.report(d)?.cafe ? board.day(d).visitors : 0;
      if (!a) continue;
      const xs = pick(d).filter((x) => board.report(x)?.cafe).map((x) => board.day(x).visitors);
      if (!xs.length) continue;
      const p = xs.reduce((s, v) => s + v, 0) / xs.length;
      errs.push(Math.abs(p - a) / a);
    }
    return Math.round((errs.reduce((s, v) => s + v, 0) / errs.length) * 1000) / 10;
  };
  console.log(`\n견줌: 지난주 같은 요일 그대로 ${naive((d) => [addDays(d, -7)])}% · 최근 4주 같은 날 유형 평균 ${naive((d) => dayRange(addDays(d, -29), addDays(d, -2)).filter((x) => dayKind(x) === dayKind(d)))}%`);

  // 달마다 (λ=0.5)
  const r = backtest(board, weather, from, to, 3, learned);
  const months = [...new Set(r.rows.map((x) => x.date.slice(0, 7)))];
  console.log("\n달마다 (λ=0.5, 배운 날씨)");
  for (const m of months) {
    const xs = r.rows.filter((x) => x.date.startsWith(m) && x.visitors > 0);
    const e = (a: "visitors" | "bread", b: "predicted" | "breadPredicted") => Math.round((xs.filter((x) => x[a] > 0).reduce((s, x) => s + Math.abs(x[b] - x[a]) / x[a], 0) / Math.max(1, xs.filter((x) => x[a] > 0).length)) * 1000) / 10;
    const bias = Math.round((xs.reduce((s, x) => s + (x.predicted - x.visitors) / x.visitors, 0) / Math.max(1, xs.length)) * 1000) / 10;
    console.log(`  ${m}: 방문객 ${e("visitors", "predicted")}% (치우침 ${bias > 0 ? "+" : ""}${bias}%) · 빵 ${e("bread", "breadPredicted")}% · ${xs.length}일`);
  }
}

main().catch((e) => {
  console.log("멈춤:", (e as Error).message.slice(0, 200));
  process.exit(1);
});
