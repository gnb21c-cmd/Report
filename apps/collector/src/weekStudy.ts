/* 1주 단위 빵 수량 시험 (2026-10-12 사장님 제안) — 클라우드 지난 자료로
   ① 작년 대비 비율(올해 ÷ 작년 같은 요일 364일 전)이 달마다 · 주마다 얼마나 고른가 — 빵 · 카페 방문객 · 총매출 · 키즈 입장
   ② 다음 주 빵 총 개수: 지금 방식(날마다 예측의 합) vs 작년 같은 주 × 최근 2 · 4 · 8주 비율 vs 최근 2주 평균
   ③ 그 주 총 개수를 요일 몫(올해 최근 4주 같은 요일 · 공휴일은 공휴일)으로 나눴을 때 하루 오차 — 주 총 개수를 미리 정확히 알았다면(최선)도 함께
   ④ 손님이 같은 주 다른 날로 옮겨 가는가 — 한가한 날(예측보다 10% 넘게 적음) · 붐빈 날 뒤 사흘의 예측 대비, 이웃한 날 오차의 상관, 주 합 오차 ÷ 하루 오차들의 합
   ⑤ 비 온 날(5mm 넘음)과 그다음 날의 예측 대비
   주 = 월 ~ 일. 계획은 목요일 새벽(수요일까지 실적)에 다음 주를 세므로 수요일까지 자료로 셈
   공개 저장소라 기록에는 % · 상관 · 날 수 · 주 수만 (판매 개수 · 손님 수 · 매출 없음) */
import { addDays, applySettings, Board, breadPlan, dayKind, dayRange, forecastVisitors, kidsTickets, learnWeather, NOT_BREAD, stepGroup, weekday, type Learned } from "@report/core";
import { readAll } from "./reports";

const env = (k: string) => process.env[k] || "";
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const ape = (pred: number, act: number) => Math.abs(pred - act) / act;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const corr = (xs: number[], ys: number[]) => {
  const mx = mean(xs);
  const my = mean(ys);
  let a = 0;
  let b = 0;
  let c = 0;
  for (let i = 0; i < xs.length; i++) {
    a += (xs[i] - mx) * (ys[i] - my);
    b += (xs[i] - mx) ** 2;
    c += (ys[i] - my) ** 2;
  }
  return b && c ? a / Math.sqrt(b * c) : NaN;
};

async function main() {
  const { reports, weather, settings } = await readAll({ apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY") });
  applySettings(settings);
  const board = new Board(reports);
  const last = board.latest()!;
  const has = (d: string) => !!board.report(d)?.cafe;
  const bread = (d: string) => (has(d) ? board.products(d, d, "베이커리").reduce((a, p) => a + (NOT_BREAD.has(p.name) ? 0 : Math.max(0, p.qty)), 0) : null);
  const measures: [string, (d: string) => number | null][] = [
    ["빵", bread],
    ["카페 방문객", (d) => (has(d) ? board.day(d).visitors : null)],
    ["총매출", (d) => (has(d) ? board.day(d).total : null)],
    ["키즈 입장", (d) => (board.report(d)?.kids ? kidsTickets(board.day(d)) : null)],
  ];
  console.log(`자료 ${board.first} ~ ${last}`);

  /* ① 작년 대비 비율 */
  const yoy = (f: (d: string) => number | null, days: string[]) => {
    let a = 0;
    let b = 0;
    let n = 0;
    for (const d of days) {
      const x = f(d);
      const y = f(addDays(d, -364));
      if (x == null || y == null || !(x > 0) || !(y > 0)) continue;
      a += x;
      b += y;
      n++;
    }
    return n >= 5 && b > 0 ? a / b - 1 : null;
  };
  console.log("\n① 작년 대비 (같은 요일 364일 전) — 달마다");
  for (const [name, f] of measures) {
    const row: string[] = [];
    for (let m = 1; m <= 10; m++) {
      const from = `2026-${String(m).padStart(2, "0")}-01`;
      const to = addDays(m === 12 ? "2027-01-01" : `2026-${String(m + 1).padStart(2, "0")}-01`, -1);
      const r = yoy(f, dayRange(from, to < last ? to : last));
      if (r != null) row.push(`${m}월 ${pct(r)}`);
    }
    console.log(`  ${name}: ${row.join(" · ")}`);
  }

  // 시험할 주: 월요일 2026-02-02 ~ 마지막 온전한 주
  const mondays: string[] = [];
  for (let d = "2026-02-02"; addDays(d, 6) <= last; d = addDays(d, 7)) mondays.push(d);
  console.log(`\n시험한 주: ${mondays.length}주 (${mondays[0]} ~ ${mondays[mondays.length - 1]} 주)`);

  // 주마다 작년 대비 비율이 다음 주를 얼마나 맞히나
  console.log("\n① -2 주마다 작년 대비 비율 — 앞 2 · 4 · 8주 비율로 다음 주 비율을 맞힌 오차 (%p, 작을수록 고름)");
  for (const [name, f] of measures.slice(0, 2)) {
    const errs: Record<number, number[]> = { 14: [], 28: [], 56: [] };
    for (const mon of mondays) {
      const asOf = addDays(mon, -5);
      const act = yoy(f, dayRange(mon, addDays(mon, 6)));
      if (act == null) continue;
      for (const n of [14, 28, 56]) {
        const r = yoy(f, dayRange(addDays(asOf, -(n - 1)), asOf));
        if (r != null) errs[n].push(Math.abs(r - act));
      }
    }
    console.log(`  ${name}: 앞 2주 ${(mean(errs[14]) * 100).toFixed(1)}%p · 4주 ${(mean(errs[28]) * 100).toFixed(1)}%p · 8주 ${(mean(errs[56]) * 100).toFixed(1)}%p (${errs[28].length}주)`);
  }

  /* ② 다음 주 빵 총 개수 */
  const learned: Learned = learnWeather(board, weather, "2025-01-01", addDays(mondays[0], -6));
  const sum = (ds: string[], f: (d: string) => number | null) => {
    let s = 0;
    for (const d of ds) {
      const v = f(d);
      if (v == null) return null;
      s += v;
    }
    return s;
  };
  const ratio = (asOf: string, n: number) => {
    const r = yoy(bread, dayRange(addDays(asOf, -(n - 1)), asOf));
    return r == null ? null : 1 + r;
  };
  // 요일 몫 — 올해 asOf 까지 최근 4주에서 같은 묶음(요일 · 공휴일)의 하루 평균. 공휴일 표본이 없으면 일요일 평균
  const shares = (asOf: string, days: string[]) => {
    const recent = dayRange(addDays(asOf, -27), asOf).filter((d) => (bread(d) || 0) > 0);
    const byGroup = (g: string) => mean(recent.filter((d) => stepGroup(d) === g).map((d) => bread(d)!));
    const all = mean(recent.map((d) => bread(d)!));
    const w = days.map((d) => {
      const v = byGroup(stepGroup(d));
      if (Number.isFinite(v)) return v;
      const sun = byGroup("일");
      return stepGroup(d) === "공휴일" && Number.isFinite(sun) ? sun : all;
    });
    const t = w.reduce((a, b) => a + b, 0);
    return w.map((x) => x / t);
  };
  type M = { week: number[]; day: number[] };
  const res: Record<string, M> = {};
  const add = (k: string, w: number | null, d: number[]) => {
    const m = (res[k] ||= { week: [], day: [] });
    if (w != null) m.week.push(w);
    m.day.push(...d);
  };
  // ④ 용: 날마다 지금 방식(3일 전 15시 최종 = 4일 전 실적까지) 대비 오차
  const resid: { d: string; bread: number; vis: number }[] = [];
  let weeks = 0;
  for (const mon of mondays) {
    const days = dayRange(mon, addDays(mon, 6));
    const actual = days.map((d) => bread(d));
    if (actual.some((v) => v == null || v <= 0)) continue; // 문 닫은 날이 낀 주는 뺌
    const act = actual as number[];
    const T = act.reduce((a, b) => a + b, 0);
    const ly = sum(days.map((d) => addDays(d, -364)), bread);
    if (ly == null || ly <= 0) continue;
    weeks++;
    const asOf = addDays(mon, -5);
    const sh = shares(asOf, days);
    const dayErr = (pred: number[]) => pred.map((p, i) => ape(p, act[i]));
    // 지금 방식 (날씨 없이 — 목요일엔 다음 주 날씨를 모름)
    const now = days.map((d) => breadPlan(board, {}, asOf, d, learned).total);
    add("지금 방식 (날마다 예측)", ape(now.reduce((a, b) => a + b, 0), T), dayErr(now));
    for (const n of [14, 28, 56]) {
      const r = ratio(asOf, n);
      if (r == null) continue;
      const W = ly * r;
      add(`작년 같은 주 × 앞 ${n / 7}주 비율`, ape(W, T), dayErr(sh.map((s) => s * W)));
    }
    const r2 = sum(dayRange(addDays(asOf, -13), asOf), bread);
    if (r2 != null) {
      const W = r2 / 2;
      add("최근 2주 평균", ape(W, T), dayErr(sh.map((s) => s * W)));
    }
    const r4 = ratio(asOf, 28);
    if (r4 != null && r2 != null) {
      const W = 0.5 * ly * r4 + 0.5 * (r2 / 2);
      add("반반 (작년×4주 비율 · 최근 2주)", ape(W, T), dayErr(sh.map((s) => s * W)));
    }
    add("주 총 개수를 미리 알았다면 (최선)", 0, dayErr(sh.map((s) => s * T)));
    // ④ 날마다 오차 (그날 4일 전 실적까지로 센 지금 방식)
    for (const d of days) {
      const p = breadPlan(board, {}, addDays(d, -4), d, learned).total;
      const v = forecastVisitors(board, {}, addDays(d, -4), d, learned).value;
      const vis = board.day(d).visitors;
      if (p > 0 && v > 0 && vis > 0) resid.push({ d, bread: bread(d)! / p - 1, vis: vis / v - 1 });
    }
  }
  console.log(`\n② · ③ 다음 주 빵 총 개수 · 하루 오차 (목요일 새벽에 셈, 절대 % 평균 · 작을수록 좋음) — ${weeks}주`);
  for (const [k, m] of Object.entries(res)) console.log(`  ${k.padEnd(30)} 주 총 개수 ${m.week.length ? (mean(m.week) * 100).toFixed(1) + "%" : "—"} · 하루 ${(mean(m.day) * 100).toFixed(1)}%`);

  /* ④ 다른 날로 옮겨 가는가 */
  console.log("\n④ 손님이 같은 주 다른 날로 옮겨 가는가 (그날 4일 전 예측 대비)");
  const byDate = new Map(resid.map((r) => [r.d, r]));
  for (const key of ["vis", "bread"] as const) {
    const label = key === "vis" ? "카페 방문객" : "빵";
    const a: number[] = [];
    const b: number[] = [];
    for (const r of resid) {
      const n = byDate.get(addDays(r.d, 1));
      if (n && weekday(r.d) !== 0) {
        a.push(r[key]);
        b.push(n[key]);
      }
    }
    const next3 = (cond: (x: number) => boolean) => {
      const xs: number[] = [];
      for (const r of resid) {
        if (!cond(r[key])) continue;
        for (let k = 1; k <= 3; k++) {
          const n = byDate.get(addDays(r.d, k));
          if (n) xs.push(n[key]);
        }
      }
      return xs;
    };
    const slow = next3((x) => x < -0.1);
    const busy = next3((x) => x > 0.1);
    const all = resid.map((r) => r[key]);
    console.log(`  ${label}: 전체 평균 ${pct(mean(all))} · 한가한 날(−10% 넘게) 뒤 사흘 ${pct(mean(slow))} (${slow.length}칸) · 붐빈 날(+10% 넘게) 뒤 사흘 ${pct(mean(busy))} (${busy.length}칸) · 이웃한 날 오차 상관 ${corr(a, b).toFixed(2)}`);
    // 주 합 오차의 분산 ÷ 하루 오차 분산의 합 — 1 보다 작으면 같은 주 안에서 서로 메움(옮겨 감), 크면 주 전체가 함께 오르내림
    const wk = new Map<string, number[]>();
    for (const r of resid) {
      const m = addDays(r.d, -((weekday(r.d) + 6) % 7));
      (wk.get(m) || wk.set(m, []).get(m)!).push(r[key]);
    }
    const full = [...wk.values()].filter((x) => x.length === 7);
    const sums = full.map((x) => x.reduce((s, v) => s + v, 0));
    const varOf = (xs: number[]) => mean(xs.map((x) => (x - mean(xs)) ** 2));
    const dayVar = varOf(full.flat()) * 7;
    console.log(`    주 합 흔들림 ÷ 하루 흔들림 합 = ${(varOf(sums) / dayVar).toFixed(2)} (${full.length}주 · 1 = 날마다 따로, 1 보다 작음 = 같은 주 안에서 메움, 큼 = 주 전체가 함께)`);
  }

  /* ⑤ 비 온 날 */
  console.log("\n⑤ 비 온 날(5mm 넘음, 관측) · 그다음 날 (그날 4일 전 예측 대비)");
  for (const key of ["vis", "bread"] as const) {
    const rain = resid.filter((r) => weather[r.d]?.source === "observed" && (weather[r.d]?.rainMm ?? 0) >= 5);
    const next = rain.map((r) => byDate.get(addDays(r.d, 1))).filter((x): x is NonNullable<typeof x> => !!x && !((weather[x.d]?.rainMm ?? 0) >= 5));
    console.log(`  ${key === "vis" ? "카페 방문객" : "빵"}: 비 온 날 ${pct(mean(rain.map((r) => r[key])))} (${rain.length}일) · 그다음 날(비 안 옴) ${pct(mean(next.map((r) => r[key])))} (${next.length}일)`);
  }
  console.log(`\n(참고) 날마다 오차를 본 날: ${["평일", "금요일", "휴일"].map((k) => `${k} ${resid.filter((r) => dayKind(r.d) === k).length}일`).join(" · ")}`);
}

main().catch((e) => {
  console.log("멈춤:", String((e as Error).message).replace(/\d{4,}/g, "#").slice(0, 200));
  process.exit(1);
});
