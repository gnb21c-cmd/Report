/* ============================================================
   작업지시 계획 — GitHub 가 클라우드의 실적 · 날씨 · 설정으로 셈 (packages/core/src/bakery.ts)
   - 목요일 새벽(04:47 · 05:23, PLAN_MODE=week): 다음 주 월 ~ 일 주간 잠정안 → plans/{날짜}.week
     매니저 앱에는 아침 6시부터 보임(weekPlanOpen) · 목요일 18시 전에 잠정 확정. 새벽이라 수요일 실적은 아직 없어 화요일까지로 셈
   - 매일 15시: 3일 뒤 최종안 → plans/{날짜}.final (주간 잠정안이 있는 날만, 잠정 확정 수량 ±10% 안 · 매니저가 그날 18시 전에 최종 확정)
     목요일 15시에는 주간 잠정안을 다시 세지 않음(매니저가 확정하는 중에 숫자가 바뀌지 않게) — 새벽 계산이 빠졌을 때만 그때 만듦
   - 아침 09:10 자동 수집된 어제까지의 실적으로 지난 2주 빵별 결과(생산 대비 정가 판매 · 50% 할인 · 폐기)를 셈 → 보정 배수로 다시 넣음
   공개 저장소라 기록에는 날짜 · 빵 종류 수만 (수량 · 손님 수 없음)
   PLAN_TODAY=YYYY-MM-DD 로 날을 정해 시험할 수 있음 · PLAN_DRY=1 이면 쓰지 않음
   ============================================================ */
import { addDays, applySettings, asOrder, asPlan, Board, corrections, dayRange, dayResult, FINAL_LEAD, floorCopy, learnWeather, makeFinal, makeWeek, nowKst, weekday, WEEK_PLAN_WEEKDAY, type PlanDoc } from "@report/core";
import { fbLogin, readFloorKey, readOrder, readPlan, writeFloor, writePlans } from "./firebase";
import { readAll } from "./reports";

const env = (k: string) => process.env[k] || "";
const parse = (j: string | undefined) => (j ? JSON.parse(j) : null);

async function main() {
  const cfg = { apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY") };
  const { reports, weather, settings } = await readAll(cfg);
  applySettings(settings);
  const board = new Board(reports);
  const today = env("PLAN_TODAY") || nowKst().date;
  // 쓸 수 있는 실적은 어제까지 (오늘 아침 09:10 자동 수집)
  const asOf = [board.latest() || addDays(today, -1), addDays(today, -1)].sort()[0];
  const learned = learnWeather(board, weather, "2025-01-01", asOf);
  const fb = await fbLogin({ ...cfg, email: env("WEATHER_EMAIL"), password: env("WEATHER_PASSWORD") });

  // 지난 2주 결과 — 작업지시 계획이 있던 날만 (쓰기 전 날은 없음)
  const past: { date: string; rows: ReturnType<typeof dayResult> }[] = [];
  for (const d of dayRange(addDays(asOf, -13), asOf)) {
    if (!board.report(d)?.cafe) continue;
    const plan = asPlan(parse(await readPlan(fb, d)));
    if (!plan) continue;
    past.push({ date: d, rows: dayResult(board, d, plan, asOrder(parse(await readOrder(fb, d)))) });
  }
  const corr = corrections(past, asOf);
  console.log(`${today} · 실적 ${asOf} 까지 · 지난 결과 ${past.length}일 · 보정한 빵 ${Object.values(corr).filter((c) => Math.abs(c - 1) >= 0.005).length}종`);

  const out = new Map<string, PlanDoc>();
  const load = async (d: string): Promise<PlanDoc> => out.get(d) || asPlan(parse(await readPlan(fb, d))) || { v: 2, date: d };

  // 목요일 — 다음 주 주간 잠정안 (있던 최종안은 그대로). 새벽(week)에 셈, 오늘 이미 셌으면 다시 세지 않음
  const weekOnly = env("PLAN_MODE") === "week";
  if (weekday(today) === WEEK_PLAN_WEEKDAY) {
    const monday = addDays(today, 4);
    const already = (await load(monday)).week?.madeOn === today;
    if (already) console.log("주간 잠정안: 오늘 이미 셈 — 그대로 둠");
    else {
      for (const w of makeWeek(board, weather, learned, today, asOf, corr)) {
        const doc = await load(w.date);
        out.set(w.date, { ...doc, week: w.week, ...(w.outlook ? { outlook: w.outlook } : {}) });
      }
      console.log(`주간 잠정안: ${[...out.keys()][0]} ~ ${[...out.keys()].slice(-1)[0]}${weekOnly ? "" : " (새벽 계산이 빠져 지금 만듦)"}`);
    }
  } else if (weekOnly) console.log("주간 잠정안은 목요일만");

  // 매일 15시 — 3일 뒤 최종안 (주간 잠정안이 있는 날만). 새벽 주간 계산 때는 건너뜀
  const target = addDays(today, FINAL_LEAD);
  if (weekOnly) {
    await save(out);
    return;
  }
  const doc = await load(target);
  const fin = makeFinal(board, weather, learned, today, asOf, doc, asOrder(parse(await readOrder(fb, target))), corr);
  if (fin) {
    out.set(target, { ...doc, final: fin });
    console.log(`최종안: ${target} · 빵 ${fin.items.length}종`);
  } else console.log(`최종안: ${target} 은 주간 잠정안이 없어 건너뜀 (작업지시 시작 전)`);

  await save(out);

  async function save(out: Map<string, PlanDoc>) {
    if (env("PLAN_DRY") === "1") {
      console.log(`확인만 — ${out.size}일 (쓰지 않음)`);
      return;
    }
    if (!out.size) return;
    await writePlans(fb, [...out.values()].map((p) => ({ date: p.date, json: JSON.stringify(p) })));
    console.log(`계획 씀: ${out.size}일`);
    // 현장 태블릿 복사본 (수량 · 상태만, 태블릿 열쇠가 있을 때)
    const floor = await readFloorKey(fb);
    if (floor) {
      const days: { date: string; json: string }[] = [];
      for (const p of out.values()) days.push({ date: p.date, json: JSON.stringify(floorCopy(p, asOrder(parse(await readOrder(fb, p.date))))) });
      await writeFloor(fb, floor, days);
      console.log(`현장 태블릿 복사: ${days.length}일`);
    } else console.log("현장 태블릿 키 번호가 아직 없음 (매니저 앱 [태블릿 주소]에서 정함)");
  }
}

main().catch((e) => {
  console.log("멈춤:", String((e as Error).message).replace(/\d{4,}/g, "#").slice(0, 200));
  process.exit(1);
});
