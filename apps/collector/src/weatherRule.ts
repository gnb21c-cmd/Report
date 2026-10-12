/* 날씨 규칙 시험 (2026-10-12 사장님 제안) — "비 · 눈 · 흐림 예보일은 빵 10% 더, 많은 비 · 눈은 빼고 · 오후 적은 비 · 눈이 특히"
   1단계: 지난 날의 실제 날씨(기상청 수원 관측)로 — 예보가 맞았다면의 최선. 예보 기준 재확인은 2단계(예보 기록이 쌓인 뒤)
   - 날 나누기(하루 관측): 많은 눈(새로 쌓인 눈 3cm 이상) · 적은 눈 · 많은 비(10mm 넘음) · 적은 비(0.5 ~ 10mm) · 흐림(비 없음, 평균 운량 6 이상) · 맑음
   - 시간별 관측이 받아지면: 오후(13 ~ 19시) 적은 비 · 눈 / 오전만 비 · 눈
   - 기준선 A = 날씨를 뺀 지금 예측(3일 전 15시 최종 = 4일 전 실적까지) · B = 앞뒤 2주 같은 날 유형 평균 → 둘이 같은 방향이어야 믿음
   - 칸마다 평균 차이 · 95% 범위 · 2025 / 2026 · 평일 / 휴일, 빵 · 카페 방문객 · 키즈 입장
   - 규칙 견주기(빵): 날씨 배수 없음 / 지금 빵 날씨 배수 / 사장님 규칙(+10%) / 오후 적은 비 · 눈만 +10% / 2025 로 배운 칸별 값(2026 에 시험)
   - 통과 기준(미리 정함): ① 그 칸 날들의 빵 오차가 줄어듦 ② 평균 +5% 이상 · 95% 범위 아래끝 > 0 ③ 2025 · 2026 같은 방향 ④ 10일 이상(적으면 보류)
   공개 저장소라 기록에는 % · 날 수만 (판매 개수 · 손님 수 · 매출 · 기상청 키 없음) */
import { addDays, applySettings, Board, breadPlan, breadWeatherFactor, dayKind, dayRange, forecastVisitors, kidsTickets, learnWeather, NOT_BREAD, type Learned } from "@report/core";
import { readAll } from "./reports";

const env = (k: string) => process.env[k] || "";
const BASE = "https://apis.data.go.kr/1360000";
const STN = "119";
const SNOW_MANY_CM = 3;
const RAIN_MANY_MM = 10;
const RAIN_MIN_MM = 0.5;
const CLOUDY_TCA = 6;
const PM = [13, 19];
const AM = [10, 12];

const num = (v: unknown) => {
  const x = typeof v === "string" ? (v.trim() === "" ? NaN : Number(v)) : typeof v === "number" ? v : NaN;
  return Number.isFinite(x) ? x : null;
};
const key = () => {
  const k = env("KMA_SERVICE_KEY").trim();
  return /%[0-9A-Fa-f]{2}/.test(k) ? decodeURIComponent(k) : k;
};

/** 기상청 한 서비스 — 쪽을 넘기며 다 받음. 오류는 코드만 (키 · 주소는 기록에 안 남김) */
async function kma(path: string, params: Record<string, string>): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page <= 30; page++) {
    const qs = new URLSearchParams({ serviceKey: key(), dataType: "JSON", numOfRows: "999", pageNo: String(page), ...params });
    let text = "";
    for (let a = 0; a < 3; a++) {
      try {
        const res = await fetch(`${BASE}/${path}?${qs}`);
        text = await res.text();
        if (res.ok) break;
        text = `HTTP ${res.status}`;
      } catch {
        text = "연결 실패";
      }
      await new Promise((r) => setTimeout(r, 1500 * (a + 1)));
    }
    if (!text.trim().startsWith("{")) {
      const m = /<returnReasonCode>(\d+)</.exec(text) || /<resultCode>(\d+)</.exec(text);
      throw new Error(`기상청 오류 ${m ? m[1] : text.slice(0, 20).replace(/[^\w가-힣 ]/g, "")}`);
    }
    const j = JSON.parse(text);
    const head = j?.response?.header || {};
    if (head.resultCode === "03") break;
    if (head.resultCode !== "00") throw new Error(`기상청 오류 ${head.resultCode}`);
    const body = j.response.body || {};
    const raw = body.items?.item || [];
    const items = Array.isArray(raw) ? raw : [raw];
    out.push(...items);
    if (out.length >= Number(body.totalCount || 0) || items.length < 999) break;
  }
  return out;
}

function chunks(from: string, to: string, size: number): [string, string][] {
  const out: [string, string][] = [];
  for (let a = from; a <= to; a = addDays(a, size)) {
    const z = addDays(a, size - 1);
    out.push([a, z < to ? z : to]);
  }
  return out;
}
const ymd = (d: string) => d.replace(/-/g, "");

type Daily = { rain: number; snowCm: number; snow: boolean; tca: number | null };
type Hourly = { amRain: number; pmRain: number; amSnow: boolean; pmSnow: boolean; dayRain: number };

const pct = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%` : "—");
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const ci = (xs: number[]): [number, number] => {
  if (xs.length < 2) return [NaN, NaN];
  const m = mean(xs);
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
  const h = (1.96 * sd) / Math.sqrt(xs.length);
  return [m - h, m + h];
};

async function main() {
  const { reports, weather, settings } = await readAll({ apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY") });
  applySettings(settings);
  const board = new Board(reports);
  const last = board.latest()!;
  const from = "2025-01-01";
  console.log(`자료 ${board.first} ~ ${last}`);

  /* 기상청 하루 관측 — 강수량 · 새로 쌓인 눈 · 평균 운량 */
  const daily = new Map<string, Daily>();
  try {
    for (const [a, z] of chunks(from, last, 120)) {
      for (const it of await kma("AsosDalyInfoService/getWthrDataList", { dataCd: "ASOS", dateCd: "DAY", startDt: ymd(a), endDt: ymd(z), stnIds: STN })) {
        const d = String(it.tm).slice(0, 10);
        const snowCm = Math.max(num(it.ddMefs) ?? 0, num(it.ddMes) ?? 0);
        daily.set(d, { rain: num(it.sumRn) ?? 0, snowCm, snow: snowCm > 0 || String(it.iscs || "").includes("눈"), tca: num(it.avgTca) });
      }
    }
    console.log(`기상청 하루 관측: ${daily.size}일`);
  } catch (e) {
    console.log(`기상청 하루 관측을 못 받음 (${(e as Error).message}) — 멈춤`);
    process.exit(1);
  }

  /* 기상청 시간별 관측 — 오전(10 ~ 12시) · 오후(13 ~ 19시) 비 · 눈. 못 받으면(활용신청 전) 오후 칸은 건너뜀 */
  const hourly = new Map<string, Hourly>();
  try {
    for (const [a, z] of chunks(from, last, 30)) {
      for (const it of await kma("AsosHourlyInfoService/getWthrDataList", { dataCd: "ASOS", dateCd: "HR", startDt: ymd(a), startHh: "00", endDt: ymd(z), endHh: "23", stnIds: STN })) {
        const tm = String(it.tm);
        const d = tm.slice(0, 10);
        const h = Number(tm.slice(11, 13));
        const rn = num(it.rn) ?? 0;
        const snow = (num(it.dsnw) ?? 0) > 0 || (num(it.hr3Fhsc) ?? 0) > 0;
        const x = hourly.get(d) || { amRain: 0, pmRain: 0, amSnow: false, pmSnow: false, dayRain: 0 };
        if (h >= AM[0] && h <= AM[1]) {
          x.amRain += rn;
          x.amSnow ||= snow;
        }
        if (h >= PM[0] && h <= PM[1]) {
          x.pmRain += rn;
          x.pmSnow ||= snow;
        }
        if (h >= 10 && h <= 21) x.dayRain += rn;
        hourly.set(d, x);
      }
    }
    console.log(`기상청 시간별 관측: ${hourly.size}일`);
  } catch (e) {
    console.log(`기상청 시간별 관측을 못 받음 (${(e as Error).message}) — 오후 칸은 건너뜀. 오류 20 · 30 이면 공공데이터포털에서 '지상(종관, ASOS) 시간자료 조회서비스' 활용신청 필요`);
  }

  /* 날 나누기 */
  const cat = (d: string): string | null => {
    const w = daily.get(d);
    if (!w) return null;
    if (w.snow) return w.snowCm >= SNOW_MANY_CM ? "많은 눈" : "적은 눈";
    if (w.rain > RAIN_MANY_MM) return "많은 비";
    if (w.rain >= RAIN_MIN_MM) return "적은 비";
    if (w.tca != null && w.tca >= CLOUDY_TCA) return "흐림";
    return "맑음";
  };
  /** 오후(13 ~ 19시)에 비 · 눈 + 하루로는 많지 않음 */
  const pmLight = (d: string) => {
    const h = hourly.get(d);
    const c = cat(d);
    if (!h || !c) return null;
    return (h.pmRain >= RAIN_MIN_MM || h.pmSnow) && (c === "적은 비" || c === "적은 눈");
  };
  const amOnly = (d: string) => {
    const h = hourly.get(d);
    if (!h) return null;
    return (h.amRain >= RAIN_MIN_MM || h.amSnow) && !(h.pmRain >= RAIN_MIN_MM || h.pmSnow);
  };

  /* 기준선 */
  const learned: Learned = learnWeather(board, weather, "2025-01-01", last);
  const has = (d: string) => !!board.report(d)?.cafe;
  const bread = (d: string) => (has(d) ? board.products(d, d, "베이커리").reduce((a, p) => a + (NOT_BREAD.has(p.name) ? 0 : Math.max(0, p.qty)), 0) : null);
  const vis = (d: string) => (has(d) ? board.day(d).visitors : null);
  const kids = (d: string) => (board.report(d)?.kids ? kidsTickets(board.day(d)) : null);
  const near = (d: string, f: (x: string) => number | null) => {
    const xs = dayRange(addDays(d, -14), addDays(d, 14))
      .filter((x) => x !== d && x <= last && dayKind(x) === dayKind(d))
      .map(f)
      .filter((v): v is number => v != null && v > 0);
    return xs.length >= 2 ? mean(xs) : null;
  };
  type Row = { d: string; c: string; pm: boolean | null; am: boolean | null; y: string; hol: boolean; A: { bread: number | null; vis: number | null }; B: { bread: number | null; vis: number | null; kids: number | null }; act: { bread: number; vis: number; kids: number | null } };
  const rows: Row[] = [];
  for (const d of dayRange(from, last)) {
    const c = cat(d);
    const b = bread(d);
    const v = vis(d);
    if (!c || !b || !v || b <= 0 || v <= 0) continue;
    const a = addDays(d, -4);
    const ab = d >= "2025-02-01" ? breadPlan(board, {}, a, d, learned).total : null;
    const av = d >= "2025-02-01" ? forecastVisitors(board, {}, a, d, learned).value : null;
    rows.push({
      d,
      c,
      pm: pmLight(d),
      am: amOnly(d),
      y: d.slice(0, 4),
      hol: dayKind(d) === "휴일",
      A: { bread: ab && ab > 0 ? b / ab - 1 : null, vis: av && av > 0 ? v / av - 1 : null },
      B: { bread: ((n) => (n ? b / n - 1 : null))(near(d, bread)), vis: ((n) => (n ? v / n - 1 : null))(near(d, vis)), kids: ((k, n) => (k != null && n ? k / n - 1 : null))(kids(d), near(d, kids)) },
      act: { bread: b, vis: v, kids: kids(d) },
    });
  }
  console.log(`시험한 날: ${rows.length}일 (2025 ${rows.filter((r) => r.y === "2025").length} · 2026 ${rows.filter((r) => r.y === "2026").length})`);

  /* 칸별 평균 차이 */
  const CATS = ["맑음", "흐림", "적은 비", "많은 비", "적은 눈", "많은 눈"];
  const groups: [string, (r: Row) => boolean][] = [
    ...CATS.map((c) => [c, (r: Row) => r.c === c] as [string, (r: Row) => boolean]),
    ["오후 적은 비 · 눈", (r) => r.pm === true],
    ["오전만 비 · 눈", (r) => r.am === true],
  ];
  const line = (xs: number[]) => {
    const [lo, hi] = ci(xs);
    return `${pct(mean(xs))} [${pct(lo)} ~ ${pct(hi)}] ${xs.length}일`;
  };
  const vals = (rs: Row[], f: (r: Row) => number | null) => rs.map(f).filter((x): x is number => x != null && Number.isFinite(x));
  for (const [title, f] of [
    ["빵 — 기준 A (날씨 뺀 지금 예측 대비)", (r: Row) => r.A.bread],
    ["빵 — 기준 B (앞뒤 2주 같은 날 유형 평균 대비)", (r: Row) => r.B.bread],
    ["카페 방문객 — 기준 A", (r: Row) => r.A.vis],
    ["카페 방문객 — 기준 B", (r: Row) => r.B.vis],
    ["키즈 입장 — 기준 B", (r: Row) => r.B.kids],
  ] as [string, (r: Row) => number | null][]) {
    console.log(`\n${title} · 평균 [95% 범위] 날 수`);
    for (const [g, sel] of groups) {
      const rs = rows.filter(sel);
      if (!rs.length) continue;
      const y = (yy: string) => pct(mean(vals(rs.filter((r) => r.y === yy), f)));
      const k = (hol: boolean) => pct(mean(vals(rs.filter((r) => r.hol === hol), f)));
      console.log(`  ${g.padEnd(12)} ${line(vals(rs, f))} | 2025 ${y("2025")} · 2026 ${y("2026")} | 평일 ${k(false)} · 휴일 ${k(true)}`);
    }
  }

  /* 규칙 견주기 — 빵, 기준 A 예측에 배수를 곱했을 때 오차 */
  const evalRows = rows.filter((r) => r.A.bread != null);
  const pred0 = (r: Row) => r.act.bread / (1 + r.A.bread!);
  const learnedBy = (yy: string) => {
    const m = new Map<string, number>();
    for (const c of CATS) {
      const xs = vals(evalRows.filter((r) => r.y === yy && r.c === c), (r) => r.A.bread);
      if (xs.length >= 10) m.set(c, 1 + Math.max(-0.15, Math.min(0.15, mean(xs))));
    }
    return m;
  };
  const by2025 = learnedBy("2025");
  const rules: [string, (r: Row) => number][] = [
    ["날씨 배수 없음", () => 1],
    ["지금 빵 날씨 배수", (r) => breadWeatherFactor(weather[r.d])],
    ["사장님 규칙 (흐림 · 적은 비 · 적은 눈 +10%)", (r) => (["흐림", "적은 비", "적은 눈"].includes(r.c) ? 1.1 : 1)],
    ["오후 적은 비 · 눈만 +10%", (r) => (r.pm ? 1.1 : 1)],
    ["2025 로 배운 칸별 값 (±15% 안)", (r) => by2025.get(r.c) ?? 1],
  ];
  const score = (rs: Row[], f: (r: Row) => number) => {
    const e = rs.map((r) => {
      const p = pred0(r) * f(r);
      return { ape: Math.abs(p - r.act.bread) / r.act.bread, short: r.act.bread > p * 1.1, over: p > r.act.bread * 1.1 };
    });
    return `오차 ${(mean(e.map((x) => x.ape)) * 100).toFixed(1)}% · 모자란 날 ${e.filter((x) => x.short).length} · 남은 날 ${e.filter((x) => x.over).length}`;
  };
  console.log(`\n규칙 견주기 — 빵 (기준 A 예측 × 배수, 절대 오차 평균 · 10% 넘게 모자란/남은 날 수)`);
  for (const [yy, rs] of [["2025 ~ 2026 전체", evalRows], ["2026 만 (2025 로 배운 값의 시험)", evalRows.filter((r) => r.y === "2026")]] as [string, Row[]][]) {
    console.log(`  [${yy}] ${rs.length}일`);
    for (const [name, f] of rules) {
      const hit = rs.filter((r) => f(r) !== 1);
      console.log(`    ${name.padEnd(30)} 전체 ${score(rs, f)} | 적용한 날 ${hit.length}일: ${hit.length ? score(hit, f) + " (적용 전 " + score(hit, () => 1) + ")" : "—"}`);
    }
  }

  /* 통과 기준 */
  console.log("\n통과 기준 (+10% 를 넣을지) — ① 그 칸 빵 오차 줄어듦 ② 평균 +5% 이상 · 95% 범위 아래끝 > 0 ③ 2025 · 2026 같은 방향(둘 다 +) ④ 10일 이상");
  for (const [g, sel] of groups) {
    const rs = evalRows.filter(sel);
    const xs = vals(rs, (r) => r.A.bread);
    if (!xs.length) continue;
    const before = mean(rs.map((r) => Math.abs(pred0(r) - r.act.bread) / r.act.bread));
    const after = mean(rs.map((r) => Math.abs(pred0(r) * 1.1 - r.act.bread) / r.act.bread));
    const [lo] = ci(xs);
    const y25 = mean(vals(rs.filter((r) => r.y === "2025"), (r) => r.A.bread));
    const y26 = mean(vals(rs.filter((r) => r.y === "2026"), (r) => r.A.bread));
    const c1 = after < before;
    const c2 = mean(xs) >= 0.05 && lo > 0;
    const c3 = y25 > 0 && y26 > 0;
    const c4 = xs.length >= 10;
    const verdict = !c4 ? "보류 (날 수 부족)" : c1 && c2 && c3 ? "통과" : "불통과";
    console.log(`  ${g.padEnd(12)} ① ${c1 ? "O" : "X"} (${(before * 100).toFixed(1)}% → ${(after * 100).toFixed(1)}%) ② ${c2 ? "O" : "X"} ③ ${c3 ? "O" : "X"} ④ ${c4 ? "O" : "X"} (${xs.length}일) → ${verdict}`);
  }
}

main().catch((e) => {
  console.log("멈춤:", String((e as Error).message).replace(/\d{4,}/g, "#").slice(0, 200));
  process.exit(1);
});
