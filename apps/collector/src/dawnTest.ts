/* 시험 (합치지 않음) — 목요일 주간 잠정안을 '화요일까지' · '화요일 + 수요일 추정(지난 두 수요일 평균)' · '수요일까지(실제)' 로 셀 때 오차 비교
   지난 목요일마다 다음 주 월 ~ 일 계획을 두 가지로 세고 실제 판매와 견줌. 공개 저장소라 기록에는 오차 % · 주 수만 */
import { addDays, applySettings, Board, dayRange, estimateDay, learnWeather, makeWeek, NOT_BREAD, sampleUntilYesterday, weekday, type DayReport } from "@report/core";
import { readAll } from "./reports";

const env = (k: string) => process.env[k] || "";
const pct = (x: number) => `${(Math.round(x * 1000) / 10).toFixed(1)}%`;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

async function main() {
  // 클라우드 값이 없으면(내 컴퓨터 확인용) 체험판 가짜 자료로 돌려 봄
  const { reports, weather, settings } = env("REPORT_BOARD_KEY")
    ? await readAll({ apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY") })
    : { reports: sampleUntilYesterday("2026-10-08"), weather: {}, settings: null };
  applySettings(settings);
  const board = new Board(reports);
  const last = board.latest()!;
  const has = (d: string) => !!board.report(d)?.cafe && board.products(d, d, "베이커리").length > 0;
  const actual = (d: string) => new Map(board.products(d, d, "베이커리").filter((p) => !NOT_BREAD.has(p.name)).map((p) => [p.name, p.qty]));

  const thursdays = dayRange(addDays(board.first!, 371), addDays(last, -10)).filter((d) => weekday(d) === 4 && has(addDays(d, -1)) && has(addDays(d, -2)));
  const res: Record<string, { tot: number[]; item: number[]; out10: number[]; byLead: number[][] }> = {};
  const diff: number[] = [];
  for (const T of thursdays) {
    const plans: Record<string, ReturnType<typeof makeWeek>> = {};
    // 화요일까지 + 수요일은 지난주 · 지지난주 수요일 평균으로 채움 (날씨 배움은 실제 자료인 화요일까지로)
    const W = addDays(T, -1);
    const est = estimateDay(board, W);
    const estBoard = est ? new Board(reports.map((r): DayReport => (r.date === W ? { ...r, cafe: est.cafe, meta: { ...r.meta, ...est.meta } } : r))) : board;
    for (const [k, asOf, bd, learnTo] of [
      ["화요일까지", addDays(T, -2), board, addDays(T, -2)],
      ["화요일 + 수요일 추정", est ? W : addDays(T, -2), estBoard, addDays(T, -2)],
      ["수요일까지 (실제)", W, board, W],
    ] as const) {
      const learned = learnWeather(board, weather, "2025-01-01", learnTo);
      plans[k] = makeWeek(bd, weather, learned, T, asOf);
      const r = (res[k] ||= { tot: [], item: [], out10: [], byLead: [[], [], [], [], [], [], []] });
      plans[k].forEach((w, i) => {
        if (!has(w.date)) return;
        const act = actual(w.date);
        const aTot = [...act.values()].reduce((a, b) => a + b, 0);
        if (aTot <= 0) return;
        const pred = new Map(w.week.items.map((x) => [x.name, x.qty]));
        const names = new Set([...act.keys(), ...pred.keys()]);
        let abs = 0;
        for (const n of names) abs += Math.abs((pred.get(n) || 0) - (act.get(n) || 0));
        const e = Math.abs(w.week.total - aTot) / aTot;
        r.tot.push(e);
        r.item.push(abs / aTot);
        r.out10.push(w.week.total > 0 && Math.abs(aTot - w.week.total) / w.week.total > 0.1 ? 1 : 0);
        r.byLead[i].push(e);
      });
    }
    plans["화요일까지"].forEach((w, i) => {
      const b = plans["화요일 + 수요일 추정"][i].week.total;
      if (w.week.total > 0) diff.push(Math.abs(b - w.week.total) / w.week.total);
    });
  }
  console.log(`자료 ${board.first} ~ ${last} · 시험한 목요일 ${thursdays.length}주 (${thursdays[0]} ~ ${thursdays[thursdays.length - 1]})`);
  console.log("다음 주 월 ~ 일 주간 잠정안 오차 (실제 판매와 견줌, 작을수록 좋음 · 보정 배수 없이 같은 조건)");
  for (const [k, r] of Object.entries(res)) {
    const lead = ["월", "화", "수", "목", "금", "토", "일"].map((d, i) => `${d} ${pct(avg(r.byLead[i]))}`).join(" · ");
    console.log(`  ${k}: 빵 총 개수 ${pct(avg(r.tot))} · 빵별 ${pct(avg(r.item))} · 실제가 계획 ±10% 밖인 날 ${pct(avg(r.out10))} · ${r.tot.length}일`);
    console.log(`    요일별 총 개수 오차: ${lead}`);
  }
  console.log(`화요일까지 ↔ 수요일 추정 계획의 빵 총 개수 차이: 평균 ${pct(avg(diff))} · 가장 큰 날 ${pct(Math.max(...diff))}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
