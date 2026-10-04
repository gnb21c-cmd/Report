/* ============================================================
   섹터 분석 — 도표 설명이 아니라 '왜 달랐고 앞으로 어떻게 될지'를 자료로 따짐 (바리스타 · 베이커리 · 키친 · 키즈입장)
   ① 판단: 마감일이 지난 4주 같은 요일 · 작년 같은 날과 얼마나 달랐나
   ② 이유: 손님 수와 1인당 소비 중 무엇이 달랐나 · 날씨 · 기간(성수기 · 비수기) · 그 주에 휴일이 많아 소비가 나뉘었나
   ③ 흐름: 8주 주간 합계로 상승 · 하락 추세인지, 꺾였는지, 하루 반짝인지 · 작년 같은 4주와 견줌
   ④ 섹터 해석 (사장님 운영 규칙)
      - 베이커리: 20:25 뒤 50% 할인 개수 — 많으면 빵이 남음 · 적으면 일찍 매진(놓친 판매) 또는 손님 없음
                  다른 소비(방문 인원)와 견줘 '손님은 있었는데 빵이 안 팔림'과 '손님이 없었음'을 가름
                  키즈 18시 무제한 입장이 많은 날의 할인 판매 = 키즈 손님이 나가며 산 빵, 저녁 다른 소비 없이 할인만 = 할인을 노린 손님
      - 키친: 20:30 주문 마감, 19시부터 할인 이벤트 → 19시 뒤 주문은 할인을 노린 수요 (식사 시간은 17~19시)
      - 키즈: 평일 무제한 · 주말 1시간 50분(성수기는 평일도), 18시 예약부터 모두 무제한 → 17시대 입장이 적은 것은 구조
              유료 전환 뒤 작년보다 약 12% 적은 것이 확인된 수준 → 그보다 더 떨어지면 이벤트 검토, 비슷하면 작년 흐름으로 전망
              바깥 활동이 어려운 날씨(비 · 더위 · 추위)가 실내 놀이 수요를 만듦 (맑고 쾌적한 날은 나들이와 경쟁)
   숫자로 확인되는 것만 말하고, 추측은 '~로 볼 수 있습니다'로 구분해 씀
   ============================================================ */
import { addDays, dayRange, lyDay, weekday, weekdayLabel } from "./dates";
import { weatherClass, type WeatherClass } from "./forecast";
import { forecastNext, hourDay, slope, type HourDay } from "./hourly";
import { HOURS } from "./part";
import { wonMan } from "./format";
import { holidayName, isOffDay, NOT_BREAD } from "./rules";
import { seasonOf, type WeatherMap } from "./weather";
import type { Board, BoxKey, Metrics } from "./metrics";

/** 이만큼 넘게 달라야 '달랐다'고 봄 */
export const GAP = 0.07;
/** 주당 이만큼 넘게 변해야 추세로 봄 */
export const TREND_STEP = 0.03;
/** 키즈 유료 전환(2026-04) 뒤 작년보다 적은 것이 확인된 수준 (4~8월 검증) */
export const KIDS_YOY_BASE = -0.12;
/** 확인된 수준보다 이만큼 더 떨어지면 이벤트 검토를 권함 */
export const KIDS_YOY_ALERT = 0.05;
/** 키친 할인 이벤트 시작 · 키즈 무제한 입장 시작 (시) */
export const KITCHEN_EVENT_HOUR = 19;
export const KIDS_UNLIMITED_HOUR = 18;

export interface AnalysisSection {
  title: string;
  lines: string[];
}

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const pct = (r: number) => {
  const n = Math.round(r * 100);
  return `${n > 0 ? "+" : ""}${n}%`;
};
const ratio = (now: number, base: number) => (base > 0 ? now / base - 1 : null);
const hoursSum = (xs: number[], from: number, to: number) => xs.reduce((s, x, i) => (HOURS[i] >= from && HOURS[i] < to ? s + x : s), 0);

/** 바깥 활동이 어려워 실내 수요가 생기는 날씨 · 나들이와 경쟁하는 날씨 */
const INDOOR: WeatherClass[] = ["약한비", "중간비", "더움", "추움"];
const HARD: WeatherClass[] = ["폭우", "눈"];
function weatherWord(c: WeatherClass): { word: string; tilt: 1 | 0 | -1 } {
  if (INDOOR.includes(c)) return { word: `${c} — 바깥 활동이 어려워 실내 수요가 생기는 날씨`, tilt: 1 };
  if (HARD.includes(c)) return { word: `${c} — 오는 길 자체가 어려운 날씨`, tilt: -1 };
  if (c === "쾌적") return { word: "쾌적 — 나들이하기 좋아 실내 놀이 · 카페와 경쟁하는 날씨", tilt: -1 };
  return { word: c === "모름" ? "날씨 자료 없음" : "보통 날씨", tilt: 0 };
}

/** 그 섹터 자료가 있는 날인지 */
function hasData(board: Board, d: string, box: BoxKey): boolean {
  const r = board.report(d);
  if (!r) return false;
  return box === "키즈입장료" ? !!(r.kids || r.naver) : !!r.cafe;
}
/** 키즈 입장 인원 (네이버 + 현장) */
const entries = (m: Metrics) => m.naver + m.walkIn;
/** 판단에 쓰는 값 — 키즈는 사람 수(유료 전환 전후를 견줄 수 있게), 나머지는 매출 */
const measure = (board: Board, d: string, box: BoxKey) => (box === "키즈입장료" ? entries(board.day(d)) : board.day(d).box[box]);
const unitText = (box: BoxKey, v: number) => (box === "키즈입장료" ? `${Math.round(v).toLocaleString("ko-KR")}명` : wonMan(Math.round(v)));

/** 7일 합 (date 포함 앞 7일) — 자료가 6일 넘게 있을 때만 */
function week(board: Board, end: string, box: BoxKey): number | null {
  const ds = dayRange(addDays(end, -6), end).filter((d) => hasData(board, d, box));
  if (ds.length < 6) return null;
  return (ds.reduce((s, d) => s + measure(board, d, box), 0) / ds.length) * 7;
}
/** 7일 안 공휴일 수 (토 · 일 빼고) */
const holidaysIn = (end: string) => dayRange(addDays(end, -6), end).filter((d) => weekday(d) !== 0 && weekday(d) !== 6 && holidayName(d)).length;

/** 섹터 분석 — 기타는 대상 아님 */
export function sectorAnalysis(board: Board, date: string, box: BoxKey, weather: WeatherMap = {}): AnalysisSection[] {
  if (box === "기타") return [];
  if (!hasData(board, date, box)) return [{ title: "판단", lines: ["마감일 자료가 없습니다."] }];
  const out: AnalysisSection[] = [];
  const wd = weekdayLabel(date);
  const now = measure(board, date, box);
  const base = [1, 2, 3, 4].map((w) => addDays(date, -7 * w)).filter((d) => hasData(board, d, box));
  const baseAvg = mean(base.map((d) => measure(board, d, box)));
  const gap = base.length ? ratio(now, baseAvg) : null;
  const ly = lyDay(date);
  const lyGap = hasData(board, ly, box) ? ratio(now, measure(board, ly, box)) : null;

  /* ① 판단 */
  const judge: string[] = [];
  if (gap == null) judge.push(`지난 4주 같은 ${wd}요일 자료가 없어 견줄 수 없습니다.`);
  else {
    const word = Math.abs(gap) < GAP ? "평소 수준" : gap > 0 ? "평소보다 많음" : "평소보다 적음";
    judge.push(`${word} — 마감일 ${unitText(box, now)}, 지난 ${base.length}주 같은 ${wd}요일 평균 ${unitText(box, baseAvg)} (${pct(gap)})${lyGap != null ? ` · 작년 같은 주 ${wd}요일(${md(ly)})보다 ${pct(lyGap)}` : ""}.`);
    const hol = holidayName(date);
    const odd = base.filter((d) => isOffDay(d) !== isOffDay(date));
    const weekend = weekday(date) === 0 || weekday(date) === 6;
    if (hol && !weekend) judge.push(`마감일은 공휴일(${hol})이라 평소 ${wd}요일과 손님 모양이 다릅니다 — 지난 휴일과 견주는 것이 더 맞습니다.`);
    else if (odd.length) judge.push(`비교한 날 중 ${odd.map(md).join("·")}은 휴일 여부가 달라 평균이 흔들릴 수 있습니다.`);
  }
  out.push({ title: "판단", lines: judge });

  /* ② 이유 — 차이가 있을 때만 */
  if (gap != null && Math.abs(gap) >= GAP) {
    const why: string[] = [];
    // 손님 수 vs 1인당
    if (box !== "키즈입장료") {
      const vNow = board.day(date).visitors;
      const vBase = mean(base.map((d) => board.day(d).visitors));
      const vGap = ratio(vNow, vBase);
      const perNow = vNow > 0 ? now / vNow : 0;
      const perBase = mean(base.filter((d) => board.day(d).visitors > 0).map((d) => measure(board, d, box) / board.day(d).visitors));
      const pGap = ratio(perNow, perBase);
      if (vGap != null && pGap != null) {
        const main = Math.abs(vGap) >= Math.abs(pGap) ? "손님 수" : "1인당 소비";
        why.push(`방문 인원 ${Math.round(vNow)}명(${pct(vGap)}), 1인당 ${Math.round(perNow).toLocaleString("ko-KR")}원(${pct(pGap)}) — 차이의 대부분은 ${main}에서 왔습니다.`);
      }
    } else {
      const m = board.day(date);
      const nBase = mean(base.map((d) => board.day(d).naver));
      const wBase = mean(base.map((d) => board.day(d).walkIn));
      why.push(`네이버 예약 ${m.naver}명(평균 ${Math.round(nBase)}명) · 현장 ${m.walkIn}명(평균 ${Math.round(wBase)}명) — ${Math.abs(m.naver - nBase) >= Math.abs(m.walkIn - wBase) ? "미리 예약한 손님" : "현장에서 온 손님"} 쪽 차이가 큽니다.`);
    }
    // 날씨
    const c = weatherClass(weather[date]);
    if (c !== "모름") {
      const w = weatherWord(c);
      const baseCls = base.map((d) => weatherClass(weather[d])).filter((x) => x !== "모름");
      const sameTilt = baseCls.filter((x) => weatherWord(x).tilt === w.tilt).length;
      const fits = w.tilt !== 0 && Math.sign(gap) === w.tilt;
      const against = w.tilt !== 0 && Math.sign(gap) === -w.tilt;
      why.push(
        `날씨: ${w.word}${baseCls.length ? ` (비교한 ${baseCls.length}일 중 같은 성격 ${sameTilt}일)` : ""}. ${
          fits && sameTilt < baseCls.length ? "차이의 방향과 맞아 날씨가 한몫한 것으로 볼 수 있습니다." : against ? "날씨로는 설명되지 않는 방향이라 다른 원인을 봐야 합니다." : "날씨 차이는 크지 않습니다."
        }`,
      );
    }
    // 기간 (성수기 · 비수기)
    const s = seasonOf(date);
    const baseSeason = base.map((d) => seasonOf(d).kind);
    const diffSeason = baseSeason.filter((k) => k !== s.kind).length;
    if (diffSeason) why.push(`기간: 마감일은 ${s.kind}${s.name ? `(${s.name})` : ""}인데 비교한 날 중 ${diffSeason}일은 다른 기간이었습니다 — 기간이 바뀐 영향이 섞여 있습니다.`);
    // 휴일이 많은 주 — 소비가 여러 날로 나뉘었나
    const hNow = holidaysIn(date);
    const hBase = mean(base.map(holidaysIn));
    const wNow = week(board, date, box);
    const wBase = base.map((d) => week(board, d, box)).filter((x): x is number => x != null);
    if (hNow > hBase && wNow != null && wBase.length) {
      const wg = ratio(wNow, mean(wBase))!;
      const spread = gap < 0 && wg > -GAP;
      why.push(`이번 7일에는 공휴일이 ${hNow}일 있었습니다 (평소 ${Math.round(hBase * 10) / 10}일). 7일 합은 평소보다 ${pct(wg)} — ${spread ? "주 전체로는 줄지 않아, 손님이 쉬는 날이 많아지며 소비를 여러 날로 나눈 것으로 볼 수 있습니다." : gap > 0 ? "휴일이 이어지며 이날로 손님이 모인 것으로 볼 수 있습니다." : "주 전체도 줄어 소비를 나눈 것만으로는 설명되지 않습니다."}`);
    }
    if (why.length) out.push({ title: "달라진 이유 (자료로 확인되는 것)", lines: why });
  }

  /* ③ 흐름 — 8주 주간 합계 */
  const flow: string[] = [];
  const weeks = [7, 6, 5, 4, 3, 2, 1, 0].map((w) => ({ w, v: week(board, addDays(date, -7 * w), box) }));
  const pts = weeks.filter((x): x is { w: number; v: number } => x.v != null).map((x) => [-x.w, x.v] as [number, number]);
  if (pts.length >= 6) {
    const rate = (ps: [number, number][]) => (ps.length >= 3 ? (slope(ps) || 0) / mean(ps.map((p) => p[1])) : null);
    const older = rate(pts.filter((p) => p[0] <= -4));
    const recent = rate(pts.filter((p) => p[0] >= -3));
    const all = rate(pts)!;
    const dir = (r: number | null) => (r == null ? 0 : r >= TREND_STEP ? 1 : r <= -TREND_STEP ? -1 : 0);
    const o = dir(older);
    const r = dir(recent);
    const per = (x: number | null) => `주당 ${pct(x ?? 0)}`;
    let text: string;
    if (o === r && r !== 0) text = `${r > 0 ? "상승" : "하락"} 추세가 8주째 이어지고 있습니다 (${per(all)}).`;
    else if (o !== r && r !== 0) text = `최근 4주 들어 ${r > 0 ? "상승" : "하락"}으로 꺾였습니다 — 그 전 4주 ${o === 0 ? "보합" : o > 0 ? "상승" : "하락"}(${per(older)}) → 최근 4주 ${per(recent)}.`;
    else if (o !== 0 && r === 0) text = `그 전 4주의 ${o > 0 ? "상승" : "하락"}(${per(older)})이 최근 4주에는 멈췄습니다 (${per(recent)}).`;
    else text = `8주 동안 큰 흐름 없이 보합입니다 (${per(all)}).`;
    flow.push(`7일 합 기준: ${text}`);
    if (gap != null && Math.abs(gap) >= GAP) flow.push(r !== 0 && Math.sign(gap) === r ? "마감일의 차이는 이 흐름과 같은 방향입니다." : `마감일의 차이는 주간 흐름과 맞지 않아 ${gap > 0 ? "하루 반짝" : "하루 부진"}으로 보는 것이 맞습니다 — 추세 변화로 보기는 이릅니다.`);
  } else flow.push("주간 흐름을 보려면 8주 중 6주 넘게 자료가 있어야 합니다.");
  // 작년 같은 4주와
  const yoy = yoy4(board, date, box);
  if (yoy) flow.push(`최근 4주 합은 작년 같은 4주보다 ${pct(yoy.r)}${box === "키즈입장료" ? " (입장 인원)" : ""}.`);
  out.push({ title: "흐름", lines: flow });

  /* ④ 섹터 해석 */
  const own = box === "베이커리" ? bakery(board, date, base) : box === "키친" ? kitchen(board, date, base) : box === "키즈입장료" ? kids(board, date, base, weather, yoy) : [];
  if (own.length) out.push({ title: "운영 관점 해석", lines: own });

  /* ⑤ 다음 주 */
  const f = forecastNext(board, date, box);
  if (f) out.push({ title: "다음 주 같은 요일", lines: [`${box === "키즈입장료" ? "입장료 " : ""}예상 ${wonMan(f.value)} (${wonMan(f.low)}~${wonMan(f.high)}) — 최근 ${f.n}번의 같은 요일 흐름으로 계산 (날씨는 넣지 않음).${holidayName(f.date) ? ` 그날은 공휴일(${holidayName(f.date)})입니다.` : ""}`] });
  return out;
}

/** 최근 28일 합 ÷ 작년 같은 28일(364일 전) 합 − 1 */
export function yoy4(board: Board, date: string, box: BoxKey): { r: number; now: number; ly: number } | null {
  const ds = dayRange(addDays(date, -27), date).filter((d) => hasData(board, d, box) && hasData(board, lyDay(d), box));
  if (ds.length < 21) return null;
  const now = ds.reduce((s, d) => s + measure(board, d, box), 0);
  const ly = ds.reduce((s, d) => s + measure(board, lyDay(d), box), 0);
  return ly > 0 ? { r: now / ly - 1, now, ly } : null;
}

/* ---------- 베이커리 ---------- */
function breadQty(board: Board, d: string): number {
  return board
    .products(d, d, "베이커리")
    .filter((p) => !NOT_BREAD.has(p.name) && p.qty > 0)
    .reduce((s, p) => s + p.qty, 0);
}
/** 18시 이후 키즈 입장 (무제한) */
function kidsEvening(board: Board, d: string): number | null {
  const h = hourDay(board, d, "키즈입장료");
  return h ? hoursSum(h.people, KIDS_UNLIMITED_HOUR, 24) : null;
}
/** 20시 이후 바리스타 · 키친 매출 (할인 빵 말고 저녁 다른 소비) */
function eveningOther(board: Board, d: string): number | null {
  const b = hourDay(board, d, "바리스타");
  const k = hourDay(board, d, "키친");
  return b || k ? hoursSum(b?.sales || [], 20, 24) + hoursSum(k?.sales || [], 20, 24) : null;
}

function bakery(board: Board, date: string, base: string[]): string[] {
  const out: string[] = [];
  const half = board.report(date)?.cafe?.bakeryHalf;
  const qty = breadQty(board, date);
  if (half == null || !qty) return ["50% 마감 할인 개수가 없는 날이라(이 칸이 생기기 전 자료) 빵 판매 해석은 건너뜁니다."];
  const known = base.filter((d) => board.report(d)?.cafe?.bakeryHalf != null && breadQty(board, d) > 0);
  const halfBase = mean(known.map((d) => board.report(d)!.cafe!.bakeryHalf!));
  const qtyBase = mean(known.map((d) => breadQty(board, d)));
  const vNow = board.day(date).visitors;
  const vBase = mean(base.map((d) => board.day(d).visitors));
  const vGap = ratio(vNow, vBase) ?? 0;
  const fullNow = qty - half;
  const fullBase = qtyBase - halfBase;
  const fGap = ratio(fullNow, fullBase);
  out.push(`빵 ${qty}개 중 정가 ${fullNow}개 · 50% 할인 ${half}개(${Math.round((half / qty) * 100)}%)${known.length ? ` — 지난 ${known.length}주 같은 요일 평균 정가 ${Math.round(fullBase)}개 · 할인 ${Math.round(halfBase)}개` : ""}.`);
  if (!known.length) return out;
  const eveningBread = (d: string) => {
    const h = hourDay(board, d, "베이커리");
    return h ? hoursSum(h.sales, 18, 20) : 0;
  };
  const eNow = eveningBread(date);
  const eBase = mean(base.map(eveningBread));
  const lowHalf = half <= Math.max(2, halfBase * 0.5);
  const highHalf = half >= Math.max(5, halfBase * 1.3);
  if (fGap != null && fGap <= -GAP) {
    if (vGap > -GAP) {
      if (lowHalf && eNow < eBase * 0.6)
        out.push(`손님은 평소만큼(${pct(vGap)}) 왔는데 정가 빵이 ${pct(fGap)} 덜 팔렸고, 저녁(18~20시) 빵 매출과 마감 할인도 거의 없었습니다 → 빵이 일찍 떨어져 더 팔 수 있었던 기회를 놓친 것으로 볼 수 있습니다. 이 요일 생산을 늘려 볼 만합니다.`);
      else if (highHalf) out.push(`손님은 평소만큼(${pct(vGap)}) 왔는데 정가 빵이 ${pct(fGap)} 덜 팔리고 할인으로 넘어간 빵이 많았습니다 → 손님은 있었지만 빵을 고르지 않은 날입니다. 진열 · 구성(종류)을 점검해 볼 만합니다.`);
      else out.push(`손님은 평소만큼(${pct(vGap)}) 왔는데 정가 빵이 ${pct(fGap)} 덜 팔렸습니다 → 빵을 산 손님 비율이 낮았던 날입니다.`);
    } else out.push(`방문 인원 자체가 ${pct(vGap)}라 정가 빵이 ${pct(fGap)} 적은 것은 빵 문제라기보다 손님이 적었던 영향입니다.`);
  } else if (fGap != null && fGap >= GAP) out.push(`정가 빵이 평소보다 ${pct(fGap)} 더 팔렸습니다 (방문 인원 ${pct(vGap)}) — ${fGap - vGap >= GAP ? "1인당 빵 구매가 늘었습니다." : "손님이 늘어난 만큼 팔렸습니다."}`);
  if (highHalf) {
    const kNow = kidsEvening(board, date);
    const kBase = mean(base.map((d) => kidsEvening(board, d) ?? 0));
    const oNow = eveningOther(board, date);
    const oBase = mean(base.map((d) => eveningOther(board, d) ?? 0));
    if (kNow != null && kBase > 0 && kNow >= kBase * 1.15)
      out.push(`마감 할인 빵이 많았던 날, 키즈 18시 이후 무제한 입장도 ${kNow}명으로 평소(${Math.round(kBase)}명)보다 많았습니다 → 키즈 손님이 집에 가며 할인 빵을 더 사 간 것으로 볼 수 있습니다.`);
    else if (oNow != null && oNow <= oBase * 0.8)
      out.push(`20시 이후 음료 · 키친 매출은 평소보다 적은데 할인 빵은 많이 팔렸습니다 → 그 시간에 할인 빵만 사러 온 손님이 많았던 날입니다.`);
    else out.push(`마감 할인 빵이 평소보다 많았습니다(${half}개, 평균 ${Math.round(halfBase)}개) → 빵이 많이 남았던 날입니다. 이 요일 생산량을 줄일 여지가 있는지 보세요.`);
  }
  // 최근 4주 꾸준히: 저녁 다른 소비는 적은데 할인 빵은 늘 팔림
  const recent = dayRange(addDays(date, -27), date).filter((d) => (board.report(d)?.cafe?.bakeryHalf ?? 0) > 0);
  if (recent.length >= 10) {
    const ev = recent.map((d) => eveningOther(board, d)).filter((x): x is number => x != null);
    const allEv = dayRange(addDays(date, -27), date).map((d) => hourDay(board, d, "바리스타")?.total ?? 0).filter((x) => x > 0);
    const lowEvening = ev.filter((x) => x <= mean(allEv) * 0.05).length;
    if (ev.length && lowEvening / ev.length >= 0.6)
      out.push(`최근 4주 ${recent.length}일 내내 20시 이후 다른 매출은 거의 없는데 마감 할인 빵은 매번 팔렸습니다 → 할인 시간을 노리고 오는 손님층이 자리 잡았다고 볼 수 있습니다.`);
  }
  return out;
}

/* ---------- 키친 ---------- */
function kitchen(board: Board, date: string, base: string[]): string[] {
  const out: string[] = [];
  const share = (d: string) => {
    const h = hourDay(board, d, "키친");
    if (!h || !(h.total > 0)) return null;
    return { event: hoursSum(h.sales, KITCHEN_EVENT_HOUR, 21) / h.total, dinner: hoursSum(h.sales, 17, KITCHEN_EVENT_HOUR) / h.total };
  };
  const t = share(date);
  if (!t) return out;
  const bs = base.map(share).filter((x): x is { event: number; dinner: number } => !!x);
  const p = (x: number) => `${Math.round(x * 100)}%`;
  out.push(`19시 이후(할인 이벤트 · 20:30 주문 마감) 주문이 하루 키친 매출의 ${p(t.event)}${bs.length ? ` (지난 ${bs.length}주 평균 ${p(mean(bs.map((x) => x.event)))})` : ""}, 식사 시간 17~19시는 ${p(t.dinner)}.`);
  // 4주 흐름
  const series = [4, 3, 2, 1, 0].map((w) => ({ w, s: share(addDays(date, -7 * w)) })).filter((x) => x.s);
  if (series.length >= 4) {
    const k = slope(series.map((x) => [-x.w, x.s!.event * 100])) || 0;
    if (k >= 1.5) out.push(`19시 이후 비중이 주마다 약 ${Math.round(k)}%p씩 커지고 있습니다 → 식사 시간이 지난 뒤 할인을 받아 먹으려는 수요가 늘고 있다고 볼 수 있습니다. 정가 시간(점심 · 17~19시) 주문을 끌어올 방법을 함께 보세요.`);
    else if (k <= -1.5) out.push(`19시 이후 비중이 주마다 약 ${Math.round(-k)}%p씩 줄고 있습니다 → 할인 이벤트로 오는 저녁 주문이 약해지고 있습니다.`);
  }
  if (t.event >= 0.3) out.push("식사 시간(17~19시)이 지나 19시 넘어 들어온 주문은 늦더라도 할인을 받겠다는 수요로 보는 것이 맞습니다 — 이 비중이 클수록 키친 매출이 할인 이벤트에 기대고 있다는 뜻입니다.");
  return out;
}

/* ---------- 키즈 ---------- */
function kids(board: Board, date: string, base: string[], weather: WeatherMap, yoy: { r: number; now: number; ly: number } | null): string[] {
  const out: string[] = [];
  const split = (h: HourDay) => ({ day: hoursSum(h.people, 10, 17), five: hoursSum(h.people, 17, KIDS_UNLIMITED_HOUR), night: hoursSum(h.people, KIDS_UNLIMITED_HOUR, 24), all: h.people.reduce((s, x) => s + x, 0) });
  const h = hourDay(board, date, "키즈입장료");
  if (h && h.people.some((x) => x > 0)) {
    const s = split(h);
    const bs = base.map((d) => hourDay(board, d, "키즈입장료")).filter((x): x is HourDay => !!x).map(split);
    const nb = mean(bs.map((x) => x.night));
    out.push(`입장 시간: 낮(10~17시) ${s.day}명 · 17시대 ${s.five}명 · 18시 이후(무제한) ${s.night}명${bs.length ? ` — 18시 이후 지난 ${bs.length}주 평균 ${Math.round(nb)}명` : ""}.`);
    if (s.all > 0 && s.five / s.all < 0.08) out.push("17시 · 17시 30분 입장이 적은 것은 18시부터 무제한이 되기 때문에 생기는 구조라 문제가 아닙니다.");
  }
  if (yoy) {
    const gapToBase = yoy.r - KIDS_YOY_BASE;
    const s = seasonOf(date);
    if (gapToBase <= -KIDS_YOY_ALERT)
      out.push(`최근 4주 입장 인원이 작년 같은 4주보다 ${pct(yoy.r)} — 유료 전환 뒤 확인된 수준(약 ${pct(KIDS_YOY_BASE)})보다 ${Math.round(-gapToBase * 100)}%p 더 떨어졌습니다${s.kind === "비수기" ? " (비수기를 감안해도)" : ""}. 평일 할인 · 재방문 혜택 같은 이벤트를 검토할 때입니다.`);
    else if (gapToBase >= KIDS_YOY_ALERT) out.push(`최근 4주 입장 인원이 작년 같은 4주보다 ${pct(yoy.r)} — 유료 전환 뒤 확인된 수준(약 ${pct(KIDS_YOY_BASE)})보다 좋습니다.`);
    else {
      // 작년 흐름을 따라가는 중 → 작년 다음 4주 × 지금 비율
      const next = dayRange(addDays(date, 1), addDays(date, 28)).map(lyDay);
      const lyNext = next.filter((d) => hasData(board, d, "키즈입장료"));
      if (lyNext.length >= 21) {
        const lyN = lyNext.reduce((sum, d) => sum + entries(board.day(d)), 0) * (28 / lyNext.length);
        const lyFlow = ratio(lyN, yoy.ly);
        out.push(`최근 4주 입장 인원은 작년보다 ${pct(yoy.r)}로 유료 전환 뒤 수준(약 ${pct(KIDS_YOY_BASE)})과 비슷합니다 → 작년 흐름을 따라간다면 다음 4주 약 ${Math.round(lyN * (1 + yoy.r)).toLocaleString("ko-KR")}명 예상 (작년 다음 4주 ${Math.round(lyN).toLocaleString("ko-KR")}명${lyFlow != null ? `, 작년에는 앞 4주보다 ${pct(lyFlow)}` : ""}).`);
      } else out.push(`최근 4주 입장 인원은 작년보다 ${pct(yoy.r)}로 유료 전환 뒤 수준(약 ${pct(KIDS_YOY_BASE)})과 비슷합니다.`);
    }
  }
  // 앞으로 7일 날씨 — 바깥 활동이 어려운 날 = 실내 놀이 수요
  const ahead = dayRange(addDays(date, 1), addDays(date, 7)).filter((d) => weather[d]);
  if (ahead.length) {
    const indoor = ahead.filter((d) => INDOOR.includes(weatherClass(weather[d])));
    const nice = ahead.filter((d) => weatherClass(weather[d]) === "쾌적");
    if (indoor.length)
      out.push(`다음 7일 중 ${indoor.map((d) => `${md(d)}(${weatherClass(weather[d])})`).join(" · ")}은 바깥 활동이 어려운 날씨라 아이와 함께 오는 실내 놀이 수요가 늘 수 있습니다.${nice.length ? ` 반대로 ${nice.map(md).join("·")}은 나들이하기 좋아 손님이 바깥으로 빠질 수 있습니다.` : ""}`);
    else if (nice.length >= 3) out.push(`다음 7일 중 ${nice.length}일이 나들이하기 좋은 날씨라 실내 놀이 수요에는 불리합니다.`);
  }
  return out;
}
