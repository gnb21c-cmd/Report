/* 작업지시 예측 시험 — 클라우드의 지난 자료로 "그날 나흘 전 자료로(3일 전 15시 최종 확정) 예측했다면 몇 % 틀렸을까"
   공개 저장소라 기록에는 오차 % · 날씨 배수만 남김 (방문객 수 · 매출 · 빵 개수 없음)
   BT_FROM ~ BT_TO (없으면 2026-04-01 ~ 마지막 자료일) · 날씨 배수는 그 전 자료로 배움 */
import { addDays, applySettings, backtest, cleanSettings, Board, dayKind, dayRange, DEFAULT_LEARNED, learnWeather, WEATHER_CLASSES, type Learned } from "@report/core";
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
    const r = backtest(board, w, from, to, 4, l);
    console.log(`${title.padEnd(22)} 방문객 오차 ${r.all.visitors}% (평일 ${r.평일.visitors} · 금 ${r.금요일.visitors} · 휴일 ${r.휴일.visitors}) · 빵 총 개수 오차 ${r.all.bread}% (평일 ${r.평일.bread} · 금 ${r.금요일.bread} · 휴일 ${r.휴일.bread}) · ${r.all.days}일`);
    return r;
  };
  // 빵 총 개수 비율 (A ⚙ 설정) — 10% 단위 모든 조합, 날씨 배수 씀/안 씀, 앞 7일(목요일 주간) · 앞 4일(3일 전 최종)
  // 순위는 7~9월 앞 7일 기준, 4~6월은 확인용
  const grid: { w: string; wx: string; a7: number; a4: number; b7: number; b4: number }[] = [];
  for (let ly = 0; ly <= 100; ly += 10)
    for (let rc = 0; ly + rc <= 100; rc += 10) {
      const w = { ly, recent: rc, lyNext: 100 - ly - rc };
      applySettings(cleanSettings({ ...(settings || {}), bakeryWeights: w }));
      const b2 = new Board(reports);
      for (const [wx, wm] of [["날씨 씀", weather], ["날씨 안 씀", {}]] as const) {
        const e = (a: string, z: string, lead: number) => backtest(b2, wm, a, z, lead, learned).all.bread ?? 99;
        grid.push({ w: `${w.ly}·${w.recent}·${w.lyNext}`, wx, a7: e("2026-07-01", "2026-09-30", 7), a4: e("2026-07-01", "2026-09-30", 4), b7: e("2026-04-01", "2026-06-30", 7), b4: e("2026-04-01", "2026-06-30", 4) });
      }
    }
  applySettings(settings);
  const line = (g: (typeof grid)[number]) => `  ${g.w.padEnd(10)} ${g.wx.padEnd(6)} 7~9월 앞7일 ${g.a7}% · 앞4일 ${g.a4}% | 4~6월 앞7일 ${g.b7}% · 앞4일 ${g.b4}%`;
  console.log("\n빵 총 개수 비율 (작년 무렵 · 최근 · 작년 다음 주) — 7~9월 앞 7일 오차가 작은 순 10개");
  for (const g of [...grid].sort((x, y) => x.a7 - y.a7).slice(0, 10)) console.log(line(g));
  console.log("두 기간 평균이 작은 순 5개");
  for (const g of [...grid].sort((x, y) => x.a7 + x.b7 + x.a4 + x.b4 - (y.a7 + y.b7 + y.a4 + y.b4)).slice(0, 5)) console.log(line(g));
  for (const k of ["60·10·30", "50·30·20"]) for (const g of grid.filter((x) => x.w === k)) console.log(line(g));

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
  const r = backtest(board, weather, from, to, 4, learned);
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
