/* 키즈 요금제 검증 (2026-10-13 사장님) — 2026-04-01 교환권(3만원 선결제 · 카페에서 사용) → 입장료(평일 12,000 · 휴일 14,000 + 필요한 만큼 추가 구매)
   "성수기엔 효과, 비수기엔 사람 수가 준다 → 교환권으로 돌아가야 하나" 를 실적으로
   - 비교: 작년 같은 요일(364일 전) 대비. 바뀌기 전(2026-01 ~ 03)의 작년 대비 흐름과 바뀐 뒤(2026-04 ~)의 작년 대비 흐름의 차이 = 요금제 효과(이중 차이)
     요일 · 공휴일이 해마다 달라 평일 · 휴일을 따로 하루 평균으로 견줌. 기간(성수기 · 평상시 · 비수기)은 설정의 기간 스티커
   - 총매출은 두 방식 모두 '실제로 들어온 돈' 기준(교환권 시절 키즈 = 판 교환권 − 카페에서 쓴 교환권, 카페에서 산 것은 카페 매출) — metrics.ts
   - 키즈 입장 장수 = 네이버 + 현장 + 이벤트 무료 (POS 입장 발행 기준, 두 방식 같은 키)
   - 2025-01 평일은 2만원 선결제 상품(2월부터 3만원) → 평일의 '바뀌기 전'은 2 ~ 3월만. 휴일은 1월부터 3만원이라 1 ~ 3월
   - 1장 = 4인 기준 한 팀 (교환권 · 입장권 같음) → '1장당' 은 한 팀당
   - 네이버 예약은 10:00 ~ 19:30 30분마다 10팀(하루 200팀)까지 — 휴일엔 꽉 차서 네이버 장수가 수요보다 적게 보임. ⑤ 에서 상한 근처 날을 따로 봄
     바뀐 뒤에는 통합데스크 공회전이 적게 상한 수를 조절함 (사장님 2026-10-13)
   - 남는 돈은 원재료만 뺀 값(총매출 − 카페 매출 × 원가율). 원가율은 공개 저장소에 남기지 않고 25% · 30% 두 값으로 내어 그 사이를 읽음
   공개 저장소라 기록에는 % · 비율 · 날 수만 (매출 금액 · 손님 수 없음) */
import { addDays, applySettings, Board, currentSettings, dayKind, dayRange, kidsTickets, seasonOf, type Metrics } from "@report/core";
import { readAll } from "./reports";

const env = (k: string) => process.env[k] || "";
const pct = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%` : "—");
const share = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "—");
const CHANGE = "2026-04-01";

type V = { tickets: number; paid: number; naver: number; walkIn: number; total: number; cafe: number; kidsBox: number; other: number; visitors: number; g25: number; g30: number };
const KEYS: (keyof V)[] = ["tickets", "paid", "naver", "walkIn", "total", "cafe", "kidsBox", "other", "visitors", "g25", "g30"];

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
    const cafe = m.box.바리스타 + m.box.베이커리 + m.box.키친;
    return {
      tickets,
      paid: m.naver + m.walkIn,
      naver: m.naver,
      walkIn: m.walkIn,
      total: m.total,
      cafe,
      kidsBox: m.box.키즈입장료,
      other: m.box.기타,
      visitors: m.visitors,
      g25: m.total - cafe * 0.25,
      g30: m.total - cafe * 0.3,
    };
  };
  const type = (d: string) => (dayKind(d) === "휴일" ? "휴일" : "평일");
  const zero = (): V => ({ tickets: 0, paid: 0, naver: 0, walkIn: 0, total: 0, cafe: 0, kidsBox: 0, other: 0, visitors: 0, g25: 0, g30: 0 });
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
    ["  그중 네이버", "naver"],
    ["  그중 현장", "walkIn"],
    ["총매출", "total"],
    ["원재료 뺀 금액 (카페 원가율 25%)", "g25"],
    ["원재료 뺀 금액 (카페 원가율 30%)", "g30"],
    ["카페 매출(바리스타+베이커리+키친)", "cafe"],
    ["카페 소비 인원", "visitors"],
    ["키즈 1장(한 팀)당 총매출", ["total", "tickets"]],
    ["키즈 1장(한 팀)당 카페 매출", ["cafe", "tickets"]],
    ["키즈 1장(한 팀)당 카페 소비 인원", ["visitors", "tickets"]],
    ["현장 판매 몫(현장 ÷ 유료 장수)", ["walkIn", "paid"]],
  ];

  /* ① 바뀌기 전 · 뒤 작년 대비, 이중 차이 — 평일은 2 ~ 3월(2025-01 평일은 2만원 상품), 휴일은 1 ~ 3월 */
  const PRE = (t: "평일" | "휴일"): [string, string] => [t === "평일" ? "2026-02-01" : "2026-01-01", "2026-03-31"];
  const POST: [string, string] = [CHANGE, last];
  for (const t of ["평일", "휴일"] as const) {
    const pre = group(...PRE(t), t);
    const post = group(...POST, t);
    console.log(`\n① ${t} — 작년 같은 요일 대비 (하루 평균) · 바뀌기 전 ${t === "평일" ? "2 ~ 3월" : "1 ~ 3월"} ${pre.now.length}일 / 바뀐 뒤 4월 ~ ${post.now.length}일`);
    console.log(`   ${"".padEnd(26)} 바뀌기 전   바뀐 뒤    요금제 효과(이중 차이) [95% 범위]`);
    for (const [name, k] of MEASURES) console.log(`   ${name.padEnd(26)} ${pct(yoy(pre, k)).padStart(8)}  ${pct(yoy(post, k)).padStart(8)}   ${fmtDid(did(pre, post, k))}`);
  }

  /* ② 기간(성수기 · 평상시 · 비수기)별 — 바뀐 뒤 작년 대비, 바뀌기 전 같은 기간과 */
  console.log("\n② 기간 스티커별 작년 대비 (하루 평균, 평일 · 휴일 따로) — 바뀌기 전은 ①과 같은 달 중 그 기간");
  for (const kind of ["성수기", "평상시", "비수기"] as const) {
    for (const t of ["평일", "휴일"] as const) {
      const pick = (d: string) => seasonOf(d).kind === kind;
      const pre = group(...PRE(t), t, pick);
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
      `   ${mo}월${from >= CHANGE ? " (입장료)" : mo === 1 ? " (교환권 · 작년 평일은 2만원)" : " (교환권)"}: 평일 ${w.now.length}일 장수 ${pct(yoy(w, "tickets"))} · 총매출 ${pct(yoy(w, "total"))} · 1장당 ${pct(yoy(w, ["total", "tickets"]))} | 휴일 ${h.now.length}일 장수 ${pct(yoy(h, "tickets"))} · 총매출 ${pct(yoy(h, "total"))} · 1장당 ${pct(yoy(h, ["total", "tickets"]))}`,
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

  /* ⑤ 네이버 예약 상한 — 시간마다 10팀까지라 휴일엔 꽉 참. 상한 = 2025 휴일 네이버 장수의 상위 5% 값, 그 90% 이상이면 '상한 근처'
     상한 근처인 날은 네이버 장수가 수요가 아니라 상한이라, 작년이 꽉 찬 날과 견주면 줄어든 게 덜 보임 */
  const hol25 = dayRange("2025-01-01", "2025-12-31")
    .filter((d) => type(d) === "휴일")
    .map(val)
    .filter((v): v is V => !!v)
    .map((v) => v.naver)
    .sort((a, b) => a - b);
  const cap = hol25[Math.floor(hol25.length * 0.95)] || 0;
  const near = (v: V) => cap > 0 && v.naver >= 0.9 * cap;
  console.log(`\n⑤ 네이버 예약 상한 (2025 휴일 상위 5% 값 기준, 그 90% 이상 = 상한 근처) · 2025 휴일 ${hol25.length}일`);
  for (const [label, a, z] of [
    ["2025-01 ~ 03 (교환권)", "2025-01-01", "2025-03-31"],
    ["2026-01 ~ 03 (교환권)", "2026-01-01", "2026-03-31"],
    ["2025-04 ~ 같은 날 (교환권)", "2025-04-01", addDays(last, -364)],
    ["2026-04 ~ (입장료)", CHANGE, last],
  ] as const) {
    const hs = dayRange(a, z < last ? z : last).filter((d) => type(d) === "휴일").map((d) => ({ d, v: val(d) })).filter((x): x is { d: string; v: V } => !!x.v);
    const sat = hs.filter((x) => new Date(`${x.d}T00:00:00Z`).getUTCDay() === 6);
    const top = Math.max(0, ...hs.map((x) => x.v.naver));
    console.log(
      `   ${label}: 휴일 ${hs.length}일 중 상한 근처 ${share(hs.filter((x) => near(x.v)).length / hs.length)} · 토요일 ${sat.length}일 중 ${share(sat.filter((x) => near(x.v)).length / sat.length)} · 가장 많은 날 = 상한의 ${share(top / cap)} · 네이버 몫(유료 장수 중) ${share(hs.reduce((s, x) => s + x.v.naver, 0) / hs.reduce((s, x) => s + x.v.paid, 0))}`,
    );
  }
  // 휴일을 작년 같은 날(364일 전도 휴일)과 짝지어, 작년이 상한 근처였는지로 나눠 견줌
  const pairs = (a: string, z: string, cond: (prev: V) => boolean) => {
    const g: G = { now: [], prev: [] };
    for (const d of dayRange(a, z < last ? z : last)) {
      const l = addDays(d, -364);
      if (type(d) !== "휴일" || type(l) !== "휴일") continue;
      const v = val(d);
      const u = val(l);
      if (v && u && cond(u)) {
        g.now.push(v);
        g.prev.push(u);
      }
    }
    return g;
  };
  for (const [label, cond] of [
    ["작년이 상한 근처였던 휴일", (u: V) => near(u)],
    ["작년이 상한 아래였던 휴일", (u: V) => !near(u)],
  ] as const) {
    const pre = pairs(...PRE("휴일"), cond);
    const post = pairs(...POST, cond);
    console.log(
      `   ${label}: 바뀌기 전 ${pre.now.length}쌍 장수 ${pct(yoy(pre, "tickets"))} (네이버 ${pct(yoy(pre, "naver"))} · 현장 ${pct(yoy(pre, "walkIn"))}) · 총매출 ${pct(yoy(pre, "total"))} | 바뀐 뒤 ${post.now.length}쌍 장수 ${pct(yoy(post, "tickets"))} (네이버 ${pct(yoy(post, "naver"))} · 현장 ${pct(yoy(post, "walkIn"))}) · 총매출 ${pct(yoy(post, "total"))}`,
    );
  }

  /* ⑥ 2025 네이버 장수 맞춰 보기 — 달마다 2 ~ 12월 합계 중 몫(%) · 토요일 상한 근처 날 비율. 사장님 캡처(네이버 이용완료)에서 같은 값을 내어 견줌 */
  const mon = (m: number) => dayRange(`2025-${String(m).padStart(2, "0")}-01`, addDays(m === 12 ? "2026-01-01" : `2025-${String(m + 1).padStart(2, "0")}-01`, -1));
  const sumN = (ds: string[]) => ds.reduce((s, d) => s + (val(d)?.naver || 0), 0);
  const all = sumN(Array.from({ length: 11 }, (_, i) => mon(i + 2)).flat());
  console.log(`\n⑥ 2025 네이버 장수 달마다 몫 (2 ~ 12월 합계 = 100%) — 캡처와 견주기`);
  console.log(`   ${Array.from({ length: 11 }, (_, i) => `${i + 2}월 ${share(sumN(mon(i + 2)) / all)}`).join(" · ")}`);
  const days25 = dayRange("2025-01-01", "2025-12-31").filter((d) => val(d));
  console.log(`   자료 있는 날 ${days25.length}일 · 네이버 입력(사람 · 자동)이 있는 날 ${days25.filter((d) => board.day(d).naverInput > 0).length}일 · 나머지는 POS 발행 − 현장`);

  /* ⑦ 앞으로 1년 견주기 — 입장료를 그대로 둘 때 vs 교환권(3만원 선결제)으로 돌아갈 때
     - 칸 = 기간 스티커(성수기 · 평상시 · 비수기) × 평일/휴일. 칸마다 입장료 효과 = (1 + 바뀐 뒤 그 칸의 작년 대비) ÷ (1 + 바뀌기 전 평일/휴일 전체의 작년 대비) − 1
       바뀌기 전(1 ~ 3월)엔 평상시 날이 없고 칸마다 날이 적어, 원래 흐름은 기간과 상관없이 평일/휴일마다 같다고 봄
     - 칸마다 2025년 한 해 총매출 중 몫으로 무게를 줘 1년 효과를 냄 (아직 입장료로 겪지 않은 11 ~ 3월도 같은 기간 스티커 칸의 효과로 봄)
     - 바뀐 첫 달(4월)은 손님이 바뀐 방식에 익숙해지는 때라 뺀 것도 같이 */
  const KINDS = ["성수기", "평상시", "비수기"] as const;
  const rules = currentSettings().seasons;
  console.log(`\n⑦ 앞으로 1년 견주기 — 기간 스티커: ${rules.map((r) => `${r.kind} ${r.from}~${r.to}(${r.name})`).join(" · ") || "기본값"}`);
  const year25 = dayRange("2025-01-01", "2025-12-31");
  const cellOf = (d: string) => `${seasonOf(d).kind}${type(d)}`;
  const totalBy = new Map<string, number>();
  for (const d of year25) {
    const v = val(d);
    if (v) totalBy.set(cellOf(d), (totalBy.get(cellOf(d)) || 0) + v.total);
  }
  const yearSum = [...totalBy.values()].reduce((a, b) => a + b, 0);
  const preT = { 평일: group(...PRE("평일"), "평일"), 휴일: group(...PRE("휴일"), "휴일") };
  const OUT: [string, keyof V][] = [["장수", "tickets"], ["총매출", "total"], ["원재료 뺀 25%", "g25"], ["원재료 뺀 30%", "g30"]];
  for (const start of [CHANGE, "2026-05-01"]) {
    const cells = KINDS.flatMap((kind) =>
      (["평일", "휴일"] as const).map((t) => {
        const post = group(start, last, t, (d) => seasonOf(d).kind === kind);
        return { kind, t, post, w: (totalBy.get(`${kind}${t}`) || 0) / yearSum };
      }),
    );
    const eff = (pre: G, post: G, k: keyof V) => (1 + yoy(post, k)) / (1 + yoy(pre, k)) - 1;
    // 칸에 바뀐 뒤 날이 없으면 그 평일/휴일 전체의 바뀐 뒤로 대신
    const postAll = { 평일: group(start, last, "평일"), 휴일: group(start, last, "휴일") };
    const postOf = (c: (typeof cells)[number]) => (c.post.now.length >= 5 && c.post.prev.length >= 5 ? c.post : postAll[c.t]);
    const year = (pre: Record<"평일" | "휴일", G>, posts: G[], k: keyof V) => cells.reduce((s, c, i) => s + c.w * eff(pre[c.t], posts[i], k), 0);
    console.log(`   ${start === CHANGE ? "바뀐 뒤 전체(4월 ~)" : "4월 빼고(5월 ~)"}:`);
    for (const c of cells) {
      const p = postOf(c);
      console.log(`     ${c.kind} ${c.t}: 1년 매출 몫 ${share(c.w)} · 바뀐 뒤 ${c.post.now.length}일${p === c.post ? "" : "(적어 전체로 대신)"} · ${OUT.map(([n, k]) => `${n} ${pct(eff(preT[c.t], p, k))}`).join(" · ")}`);
    }
    const posts = cells.map(postOf);
    for (const [n, k] of OUT) {
      const point = year(preT, posts, k);
      const bs: number[] = [];
      for (let i = 0; i < 400; i++) {
        const rs = (g: G): G => ({ now: resample(g.now), prev: resample(g.prev) });
        const x = year({ 평일: rs(preT.평일), 휴일: rs(preT.휴일) }, posts.map(rs), k);
        if (Number.isFinite(x)) bs.push(x);
      }
      bs.sort((a, b) => a - b);
      console.log(`     ▶ 1년 ${n}: 입장료가 교환권보다 ${pct(point)} [95% 범위 ${pct(bs[Math.floor(bs.length * 0.025)])} ~ ${pct(bs[Math.floor(bs.length * 0.975)])}]`);
    }
  }
}

main().catch((e) => {
  console.log("멈춤:", String((e as Error).message).replace(/\d{4,}/g, "#").slice(0, 200));
  process.exit(1);
});
