/* 키즈 요금제 검증 (2026-10-13 사장님) — 2026-04-01 교환권(3만원 선결제 · 카페에서 사용) → 입장료(평일 12,000 · 휴일 14,000 + 필요한 만큼 추가 구매)
   "성수기엔 효과, 비수기엔 사람 수가 준다 → 교환권으로 돌아가야 하나" 를 실적으로
   - 비교: 작년 같은 요일(364일 전) 대비. 바뀌기 전(2026-01 ~ 03)의 작년 대비 흐름과 바뀐 뒤(2026-04 ~)의 작년 대비 흐름의 차이 = 요금제 효과(이중 차이)
     요일 · 공휴일이 해마다 달라 평일 · 휴일을 따로 하루 평균으로 견줌. 기간(성수기 · 평상시 · 비수기)은 설정의 기간 스티커
   - 총매출은 두 방식 모두 '실제로 들어온 돈' 기준(교환권 시절 키즈 = 판 교환권 − 카페에서 쓴 교환권, 카페에서 산 것은 카페 매출) — metrics.ts
   - 키즈 입장 장수 = 네이버 + 현장 + 이벤트 무료 (POS 입장 발행 기준, 두 방식 같은 키)
   공개 저장소라 기록에는 % · 비율 · 날 수만 (매출 금액 · 손님 수 없음) */
import { addDays, applySettings, Board, dayKind, dayRange, kidsTickets, seasonOf, type Metrics } from "@report/core";
import { readAll } from "./reports";

const env = (k: string) => process.env[k] || "";
const pct = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%` : "—");
const share = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "—");
const CHANGE = "2026-04-01";

type V = { tickets: number; paid: number; walkIn: number; total: number; cafe: number; kidsBox: number; other: number; visitors: number; teams: number };
const KEYS: (keyof V)[] = ["tickets", "paid", "walkIn", "total", "cafe", "kidsBox", "other", "visitors", "teams"];

async function main() {
  const { reports, settings } = await readAll({ apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY") });
  applySettings(settings);
  const board = new Board(reports);
  const last = board.latest()!;
  console.log(`자료 ${board.first} ~ ${last} · 요금제 바뀐 날 ${CHANGE}`);

  const val = (d: string): V | null => {
    const r = board.report(d);
    if (!r?.cafe || !r?.kids) return null;
    const m: Metrics = board.day(d);
    const tickets = kidsTickets(m);
    if (tickets <= 0) return null; // 문 닫은 날
    return {
      tickets,
      paid: m.naver + m.walkIn,
      walkIn: m.walkIn,
      total: m.total,
      cafe: m.box.바리스타 + m.box.베이커리 + m.box.키친,
      kidsBox: m.box.키즈입장료,
      other: m.box.기타,
      visitors: m.visitors,
      teams: m.teams,
    };
  };
  const type = (d: string) => (dayKind(d) === "휴일" ? "휴일" : "평일");
  const zero = (): V => ({ tickets: 0, paid: 0, walkIn: 0, total: 0, cafe: 0, kidsBox: 0, other: 0, visitors: 0, teams: 0 });
  const add = (a: V, b: V) => {
    for (const k of KEYS) a[k] += b[k];
  };

  /** 그룹: 올해 날들(조건에 맞는) vs 그 날들 364일 전 중 같은 평일/휴일인 날들 — 하루 평균끼리 */
  type G = { now: V[]; prev: V[] };
  const group = (from: string, to: string, t: "평일" | "휴일", pick: (d: string) => boolean = () => true): G => {
    const now: V[] = [];
    const prev: V[] = [];
    for (const d of dayRange(from, to < last ? to : last)) {
      if (!pick(d)) continue;
      if (type(d) === t) {
        const v = val(d);
        if (v) now.push(v);
      }
      const l = addDays(d, -364);
      if (type(l) === t) {
        const v = val(l);
        if (v) prev.push(v);
      }
    }
    return { now, prev };
  };
  const sumV = (xs: V[]) => {
    const s = zero();
    xs.forEach((x) => add(s, x));
    return s;
  };
  /** 작년 대비 — 하루 평균(k) 또는 비율(a/b) */
  const yoy = (g: G, k: keyof V | [keyof V, keyof V]) => {
    if (!g.now.length || !g.prev.length) return NaN;
    const a = sumV(g.now);
    const b = sumV(g.prev);
    if (Array.isArray(k)) return a[k[0]] / a[k[1]] / (b[k[0]] / b[k[1]]) - 1;
    return a[k] / g.now.length / (b[k] / g.prev.length) - 1;
  };
  // 다시 뽑기(부트스트랩)로 95% 범위 — 같은 결과가 나오게 고정 난수
  let seed = 20261013;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const resample = <T,>(xs: T[]) => xs.map(() => xs[Math.floor(rnd() * xs.length)]);
  const did = (pre: G, post: G, k: keyof V | [keyof V, keyof V]) => {
    const point = (1 + yoy(post, k)) / (1 + yoy(pre, k)) - 1;
    const bs: number[] = [];
    for (let i = 0; i < 400; i++) {
      const x = (1 + yoy({ now: resample(post.now), prev: resample(post.prev) }, k)) / (1 + yoy({ now: resample(pre.now), prev: resample(pre.prev) }, k)) - 1;
      if (Number.isFinite(x)) bs.push(x);
    }
    bs.sort((a, b) => a - b);
    return { point, lo: bs[Math.floor(bs.length * 0.025)], hi: bs[Math.floor(bs.length * 0.975)] };
  };
  const fmtDid = (x: { point: number; lo: number; hi: number }) => `${pct(x.point)} [${pct(x.lo)} ~ ${pct(x.hi)}]`;

  const MEASURES: [string, keyof V | [keyof V, keyof V]][] = [
    ["키즈 입장 장수", "tickets"],
    ["총매출", "total"],
    ["카페 매출(바리스타+베이커리+키친)", "cafe"],
    ["카페 소비 인원", "visitors"],
    ["카페 영수증 묶음(팀)", "teams"],
    ["키즈 1장당 총매출", ["total", "tickets"]],
    ["키즈 1장당 카페 매출", ["cafe", "tickets"]],
    ["키즈 1장당 카페 소비 인원", ["visitors", "tickets"]],
    ["현장 판매 몫(현장 ÷ 유료 장수)", ["walkIn", "paid"]],
  ];

  /* ① 바뀌기 전 · 뒤 작년 대비, 이중 차이 */
  const PRE: [string, string] = ["2026-01-01", "2026-03-31"];
  const POST: [string, string] = [CHANGE, last];
  for (const t of ["평일", "휴일"] as const) {
    const pre = group(...PRE, t);
    const post = group(...POST, t);
    console.log(`\n① ${t} — 작년 같은 요일 대비 (하루 평균) · 바뀌기 전 1 ~ 3월 ${pre.now.length}일 / 바뀐 뒤 4월 ~ ${post.now.length}일`);
    console.log(`   ${"".padEnd(26)} 바뀌기 전   바뀐 뒤    요금제 효과(이중 차이) [95% 범위]`);
    for (const [name, k] of MEASURES) console.log(`   ${name.padEnd(26)} ${pct(yoy(pre, k)).padStart(8)}  ${pct(yoy(post, k)).padStart(8)}   ${fmtDid(did(pre, post, k))}`);
  }

  /* ② 기간(성수기 · 평상시 · 비수기)별 — 바뀐 뒤 작년 대비, 바뀌기 전 같은 기간과 */
  console.log("\n② 기간 스티커별 작년 대비 (하루 평균, 평일 · 휴일 따로) — 바뀌기 전은 1 ~ 3월 중 그 기간");
  for (const kind of ["성수기", "평상시", "비수기"] as const) {
    for (const t of ["평일", "휴일"] as const) {
      const pick = (d: string) => seasonOf(d).kind === kind;
      const pre = group(...PRE, t, pick);
      const post = group(...POST, t, pick);
      const line = (g: G, k: keyof V | [keyof V, keyof V]) => pct(yoy(g, k));
      console.log(
        `   ${kind} ${t}: 바뀌기 전 ${pre.now.length}일 장수 ${line(pre, "tickets")} · 총매출 ${line(pre, "total")} | 바뀐 뒤 ${post.now.length}일 장수 ${line(post, "tickets")} · 총매출 ${line(post, "total")} · 1장당 총매출 ${line(post, ["total", "tickets"])} · 1장당 카페 ${line(post, ["cafe", "tickets"])}`,
      );
    }
  }

  /* ③ 달마다 */
  console.log("\n③ 달마다 작년 대비 (평일 · 휴일 하루 평균)");
  for (let mo = 1; mo <= 10; mo++) {
    const from = `2026-${String(mo).padStart(2, "0")}-01`;
    const to = addDays(mo === 12 ? "2027-01-01" : `2026-${String(mo + 1).padStart(2, "0")}-01`, -1);
    if (from > last) break;
    const w = group(from, to, "평일");
    const h = group(from, to, "휴일");
    console.log(
      `   ${mo}월${from >= CHANGE ? " (입장료)" : " (교환권)"}: 평일 ${w.now.length}일 장수 ${pct(yoy(w, "tickets"))} · 총매출 ${pct(yoy(w, "total"))} · 1장당 ${pct(yoy(w, ["total", "tickets"]))} | 휴일 ${h.now.length}일 장수 ${pct(yoy(h, "tickets"))} · 총매출 ${pct(yoy(h, "total"))} · 1장당 ${pct(yoy(h, ["total", "tickets"]))}`,
    );
  }

  /* ④ 교환권 시절 사실 — 판 교환권 중 카페에서 쓰지 않은 몫(낙전), 카페 매출 중 교환권으로 낸 몫 */
  console.log("\n④ 돈의 흐름 (비율)");
  for (const [label, a, z] of [
    ["2025-04 ~ 09 (교환권)", "2025-04-01", "2025-09-30"],
    ["2026-01 ~ 03 (교환권)", "2026-01-01", "2026-03-31"],
    ["2026-04 ~ (입장료)", CHANGE, last],
  ] as const) {
    let fee = 0;
    let coupon = 0;
    let cafe = 0;
    let total = 0;
    let kidsBox = 0;
    let n = 0;
    for (const d of dayRange(a, z < last ? z : last)) {
      if (!val(d)) continue;
      const m = board.day(d);
      fee += m.fee.naver + m.fee.walkIn;
      coupon += m.kidsCoupon;
      cafe += m.box.바리스타 + m.box.베이커리 + m.box.키친;
      total += m.total;
      kidsBox += m.box.키즈입장료;
      n++;
    }
    console.log(
      `   ${label} ${n}일: 키즈 몫(총매출 중) ${share(kidsBox / total)} · 카페 몫 ${share(cafe / total)} · ${a < CHANGE ? `판 교환권 중 카페에서 쓴 몫 ${share(coupon / fee)} (안 쓴 몫 ${share(1 - coupon / fee)}) · 카페 매출 중 교환권으로 낸 몫 ${share(coupon / cafe)}` : `입장료 중 사은권으로 빠진 몫 ${share(coupon / fee)}`}`,
    );
  }
}

main().catch((e) => {
  console.log("멈춤:", String((e as Error).message).replace(/\d{4,}/g, "#").slice(0, 200));
  process.exit(1);
});
