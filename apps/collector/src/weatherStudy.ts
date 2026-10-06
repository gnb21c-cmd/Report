/* 날씨 대비 판매 시험 — 그날 실적이 '앞뒤 2주 같은 날 유형 평균'보다 얼마나 많았나/적었나를 날씨별로 모음
   (앞뒤 2주 평균을 기준으로 삼아 계절 · 추세 · 요일 차이는 지우고 날씨 차이만 봄)
   빵 판매 개수 · 카페 방문객 · 총 매출 세 가지. 공개 저장소라 기록에는 % 와 날 수만 (판매 · 매출 숫자 없음)
   실측 날씨(기상청 관측)로 봄 — 계획 때 쓰는 예보와는 다를 수 있음 */
import { addDays, applySettings, Board, dayKind, dayRange, NOT_BREAD, seasonOf, type DayWeather } from "@report/core";
import { readAll } from "./reports";

const env = (k: string) => process.env[k] || "";

async function main() {
  const { reports, weather, settings } = await readAll({ apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY") });
  applySettings(settings);
  const board = new Board(reports);
  const last = board.latest()!;
  const bread = (d: string) => board.products(d, d, "베이커리").reduce((a, p) => a + (NOT_BREAD.has(p.name) ? 0 : Math.max(0, p.qty)), 0);
  const has = (d: string) => !!board.report(d)?.cafe;
  const measures: [string, (d: string) => number][] = [
    ["빵", bread],
    ["방문객", (d) => board.day(d).visitors],
    ["총매출", (d) => board.day(d).total],
  ];
  type Row = { d: string; w: DayWeather; r: Record<string, number> };
  const rows: Row[] = [];
  for (const d of dayRange(board.first!, last)) {
    const w = weather[d];
    if (!has(d) || !w || w.source !== "observed") continue;
    const near = dayRange(addDays(d, -14), addDays(d, 14)).filter((x) => x !== d && x <= last && has(x) && dayKind(x) === dayKind(d));
    if (near.length < 2) continue;
    const r: Record<string, number> = {};
    let ok = true;
    for (const [k, f] of measures) {
      const a = f(d);
      const base = near.reduce((s, x) => s + f(x), 0) / near.length;
      if (!(a > 0 && base > 0)) ok = false;
      else r[k] = Math.log(a / base);
    }
    if (ok) rows.push({ d, w, r });
  }
  console.log(`날씨 대비 판매 — ${rows.length}일 (${rows[0]?.d} ~ ${rows[rows.length - 1]?.d}, 기상청 관측이 있는 날) · 기준 = 앞뒤 2주 같은 날 유형 평균`);
  console.log("값 = 기준보다 많이(+) · 적게(−) 판 비율 평균 · (날 수)");
  const show = (title: string, groups: [string, (x: Row) => boolean][]) => {
    console.log(`\n${title}`);
    for (const [name, f] of groups) {
      const xs = rows.filter(f);
      if (!xs.length) continue;
      const cell = (k: string) => {
        const m = xs.reduce((s, x) => s + x.r[k], 0) / xs.length;
        const p = Math.round((Math.exp(m) - 1) * 1000) / 10;
        return `${p > 0 ? "+" : ""}${p}%`;
      };
      console.log(`  ${name.padEnd(14)} 빵 ${cell("빵").padStart(7)} · 방문객 ${cell("방문객").padStart(7)} · 총매출 ${cell("총매출").padStart(7)} (${xs.length}일)`);
    }
  };
  const rain = (x: Row) => x.w.rainMm ?? 0;
  const tmax = (x: Row) => x.w.tempMax ?? NaN;
  show("① 날씨 종류", [
    ["맑음", (x) => x.w.key === "sunny"],
    ["구름", (x) => x.w.key === "cloudy"],
    ["비", (x) => x.w.key === "rain"],
    ["강우(30mm+)", (x) => x.w.key === "heavyrain"],
    ["눈", (x) => x.w.key === "snow"],
  ]);
  show("② 비 양 (하루)", [
    ["안 옴", (x) => rain(x) < 0.5],
    ["0.5 ~ 5mm", (x) => rain(x) >= 0.5 && rain(x) < 5],
    ["5 ~ 15mm", (x) => rain(x) >= 5 && rain(x) < 15],
    ["15 ~ 30mm", (x) => rain(x) >= 15 && rain(x) < 30],
    ["30mm 넘음", (x) => rain(x) >= 30],
  ]);
  show("③ 낮 최고기온", [
    ["5도 아래", (x) => tmax(x) < 5],
    ["5 ~ 10도", (x) => tmax(x) >= 5 && tmax(x) < 10],
    ["10 ~ 15도", (x) => tmax(x) >= 10 && tmax(x) < 15],
    ["15 ~ 20도", (x) => tmax(x) >= 15 && tmax(x) < 20],
    ["20 ~ 25도", (x) => tmax(x) >= 20 && tmax(x) < 25],
    ["25 ~ 30도", (x) => tmax(x) >= 25 && tmax(x) < 30],
    ["30 ~ 33도", (x) => tmax(x) >= 30 && tmax(x) < 33],
    ["33도 넘음", (x) => tmax(x) >= 33],
  ]);
  show("④ 비 · 기온을 날 유형별로", [
    ["평일 비", (x) => dayKind(x.d) !== "휴일" && rain(x) >= 5],
    ["평일 비 안 옴", (x) => dayKind(x.d) !== "휴일" && rain(x) < 0.5],
    ["휴일 비", (x) => dayKind(x.d) === "휴일" && rain(x) >= 5],
    ["휴일 비 안 옴", (x) => dayKind(x.d) === "휴일" && rain(x) < 0.5],
    ["평일 30도+", (x) => dayKind(x.d) !== "휴일" && tmax(x) >= 30],
    ["휴일 30도+", (x) => dayKind(x.d) === "휴일" && tmax(x) >= 30],
    ["평일 쾌적15~27", (x) => dayKind(x.d) !== "휴일" && tmax(x) >= 15 && tmax(x) <= 27 && rain(x) < 0.5],
    ["휴일 쾌적15~27", (x) => dayKind(x.d) === "휴일" && tmax(x) >= 15 && tmax(x) <= 27 && rain(x) < 0.5],
  ]);
  show("⑤ 기간 스티커별 비 오는 날", [
    ["성수기 비", (x) => seasonOf(x.d).kind === "성수기" && rain(x) >= 5],
    ["평상시 비", (x) => seasonOf(x.d).kind === "평상시" && rain(x) >= 5],
    ["비수기 비", (x) => seasonOf(x.d).kind === "비수기" && rain(x) >= 5],
  ]);
}

main().catch((e) => {
  console.log("멈춤:", (e as Error).message.slice(0, 200));
  process.exit(1);
});
