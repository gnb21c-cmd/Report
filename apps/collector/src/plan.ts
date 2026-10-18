/* ============================================================
   작업지시 계획 — GitHub 가 클라우드의 실적 · 날씨 · 설정으로 셈 (packages/core/src/bakery.ts)
   - 목요일 새벽(00:47 ~ 05:17 여러 번, PLAN_MODE=week): 다음 주 월 ~ 일 주간 잠정안 → plans/{날짜}.week
     매니저 앱에는 아침 6시부터 보임(weekPlanOpen) · 목요일 18시 전에 잠정 확정
     수요일 확정 실적은 아직 없어(09:12 수집) 수요일 밤 마지막 마감 전 카페 숫자(live/{수요일}, withLiveCafe)로 셈 — 없으면 화요일까지
   - 매일 15시: 3일 뒤 최종안 → plans/{날짜}.final (주간 잠정안이 있는 날만, 잠정 확정 수량 ±10% 안 · 매니저가 그날 18시 전에 최종 확정)
     그날 기상청 예보가 비(비 · 강우)인 주말은 예정 수량 × 토 125% · 일 120% (2026-10-18 사장님, 10-26 계획부터, core bakery.ts rainUpOf)
     목요일 15시에는 주간 잠정안을 다시 세지 않음(매니저가 확정하는 중에 숫자가 바뀌지 않게) — 새벽 계산이 빠졌을 때만 그때 만듦
   - 같은 요일 결과로 ±1 (2026-10-12 사장님 규칙, core bakery.ts nextSteps): 날짜마다 앞선 같은 요일(평일에 낀 공휴일은 공휴일끼리) 계획의 칸 +
     그날 결과(매진 목표 20:40 — 그 전에 다 팔림 +1 · 그 뒤 다 팔림 그대로 · 폐기 −1, 2026-10-16 · 10-26 계획부터, 그 전은 할인 없이 매진 +1 · 할인 있으며 매진 그대로)를 손님 예측 위에 더함. 최종안(3일 전)에는 7일 전 결과가 늘 들어옴
   공개 저장소라 기록에는 날짜 · 빵 종류 수만 (수량 · 손님 수 없음)
   - 규칙이 바뀌었을 때(2026-10-16 매진 목표 20:40) 이미 센 주간 잠정안에 같은 요일 칸만 다시: PLAN_RESTEP=1 · PLAN_TODAY = 그 주간안을 센 목요일
     예측(base) · 매니저 잠정 확정 · 있던 최종안은 그대로 (최종안은 3일 전에 잠정 확정 ±10% 안에서 새 칸을 씀)
   PLAN_TODAY=YYYY-MM-DD 로 날을 정해 시험할 수 있음 · PLAN_DRY=1 이면 쓰지 않음
   ============================================================ */
import { addDays, applySettings, asOrder, asPlan, Board, FINAL_LEAD, floorCopy, withLiveCafe, learnWeather, makeFinal, makeWeek, nextSteps, nowKst, restep, sameGroupBefore, weekDates, weekday, WEEK_PLAN_WEEKDAY, type OrderDoc, type PlanDoc } from "@report/core";
import { fbLogin, readFloorKey, readLive, readOrder, readPlan, writeFloor, writePlans } from "./firebase";
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

  console.log(`${today} · 실적 ${asOf} 까지`);

  // 같은 요일 결과로 ±1 — 그 날보다 앞선 같은 요일 중 계획이 있는 가장 가까운 날(문 닫은 날 · 작업지시 전은 건너뜀)의 칸 + 그날 결과
  const prevDocs = new Map<string, { plan: PlanDoc | null; order: OrderDoc | null }>();
  const docsOf = async (d: string) => {
    let x = prevDocs.get(d);
    if (!x) {
      const plan = asPlan(parse(await readPlan(fb, d)));
      x = { plan, order: plan ? asOrder(parse(await readOrder(fb, d))) : null };
      prevDocs.set(d, x);
    }
    return x;
  };
  const stepsFor = async (date: string, b: Board, a: string): Promise<Record<string, number>> => {
    for (const p of sameGroupBefore(date, 8)) {
      const x = await docsOf(p);
      if (!x.plan?.final && !x.plan?.week) continue;
      const st = nextSteps(b, a, { date: p, ...x });
      const v = Object.values(st);
      console.log(`같은 요일 ±1: ${date} ← ${p}${p <= a && b.report(p)?.cafe ? "" : " (그날 실적 전 · 칸만 이어 감)"} · 올림 ${v.filter((k) => k > 0).length}종 · 내림 ${v.filter((k) => k < 0).length}종`);
      return st;
    }
    console.log(`같은 요일 ±1: ${date} — 앞선 같은 요일 계획이 없어 예측 그대로`);
    return {};
  };

  const out = new Map<string, PlanDoc>();
  const load = async (d: string): Promise<PlanDoc> => out.get(d) || asPlan(parse(await readPlan(fb, d))) || { v: 2, date: d };

  // 규칙이 바뀌었을 때 — 이미 센 주간 잠정안에 같은 요일 칸만 다시 (그 주간안을 셀 때 쓴 실적 날까지로)
  if (env("PLAN_RESTEP") === "1") {
    if (weekday(today) !== WEEK_PLAN_WEEKDAY) throw new Error("칸 다시(PLAN_RESTEP)는 주간안을 센 목요일 날짜로 (PLAN_TODAY)");
    for (const d of weekDates(today)) {
      const doc = await load(d);
      if (!doc.week) {
        console.log(`칸 다시: ${d} — 주간 잠정안이 없어 건너뜀`);
        continue;
      }
      const week = restep(doc.week, await stepsFor(d, board, doc.week.asOf));
      const changed = week.items.filter((it, i) => it.qty !== doc.week!.items[i].qty);
      console.log(`칸 다시: ${d} · 바뀐 빵 ${changed.length}종 (늘림 ${changed.filter((it) => it.qty > doc.week!.items.find((x) => x.name === it.name)!.qty).length}종)`);
      if (changed.length) out.set(d, { ...doc, week });
    }
    await save(out);
    return;
  }

  // 목요일 — 다음 주 주간 잠정안 (있던 최종안은 그대로). 새벽(week)에 셈, 오늘 이미 셌으면 다시 세지 않음
  const weekOnly = env("PLAN_MODE") === "week";
  if (weekday(today) === WEEK_PLAN_WEEKDAY) {
    const monday = addDays(today, 4);
    const already = (await load(monday)).week?.madeOn === today;
    if (already) console.log("주간 잠정안: 오늘 이미 셈 — 그대로 둠");
    else {
      // 수요일(어제) 확정 카페가 아직 없으면(새벽 — 확정 수집은 09:12) 밤 마지막 마감 전 카페 숫자로 셈 (withLiveCafe, 클라우드 live/{어제})
      // 없거나 검사에 걸리면 화요일까지로. 날씨 배움 · 보정 배수는 확정 자료로
      const yesterday = addDays(today, -1);
      let wBoard = board;
      let wAsOf = asOf;
      if (!board.report(yesterday)?.cafe) {
        const w = withLiveCafe(reports, await readLive(fb, yesterday), yesterday);
        if (w.at) {
          wBoard = new Board(w.reports);
          wAsOf = yesterday;
          console.log(`어제 카페: 마감 전 숫자(${new Date(Date.parse(w.at) + 9 * 3600e3).toISOString().slice(11, 16)} 기준)로 셈`);
        } else console.log("어제 카페: 마감 전 숫자가 없어 그 전날까지로 셈");
      }
      const steps: Record<string, Record<string, number>> = {};
      for (const d of weekDates(today)) steps[d] = await stepsFor(d, wBoard, wAsOf);
      for (const w of makeWeek(wBoard, weather, learned, today, wAsOf, steps)) {
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
  const fin = doc.week ? makeFinal(board, weather, learned, today, asOf, doc, asOrder(parse(await readOrder(fb, target))), await stepsFor(target, board, asOf)) : null;
  if (fin) {
    out.set(target, { ...doc, final: fin });
    console.log(`최종안: ${target} · 빵 ${fin.items.length}종${fin.rainUp ? ` · 비 예보 주말 — 예정 수량 × ${Math.round(fin.rainUp * 100)}%` : ""}`);
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
