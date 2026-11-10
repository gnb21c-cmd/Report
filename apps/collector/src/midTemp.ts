/* 기상청 중기 기온예보 (수원) — 목요일 빵 주간안 기온 미세 조정용 (2026-11-10 사장님, packages/core/src/breadBinary.ts)
   06 · 18시 발표, 4(18시 발표는 5) ~ 10일 뒤 최저 · 최고. 앞선 발표 위에 새 발표를 덮어 날짜마다 가장 새 예보
   공개 저장소라 기록에는 발표 시각 · 날 수 · 오류 코드만 (기상청 키 · 주소는 남기지 않음) — 기온은 공개 정보지만 계획 기록과 섞이지 않게 날 수만 */
import { addDays, MID_TA_REGION, parseMidTa, type MidTemp } from "@report/core";

const BASE = "https://apis.data.go.kr/1360000/MidFcstInfoService/getMidTa";
const key = () => {
  const k = (process.env.KMA_SERVICE_KEY || "").trim();
  return /%[0-9A-Fa-f]{2}/.test(k) ? decodeURIComponent(k) : k;
};

/** 한 발표 받기 — 없거나 오류면 {} (오류는 코드만 기록) */
async function one(tmFc: string): Promise<Record<string, MidTemp>> {
  const qs = new URLSearchParams({ serviceKey: key(), dataType: "JSON", numOfRows: "10", pageNo: "1", regId: MID_TA_REGION, tmFc });
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(`${BASE}?${qs}`);
      const text = await res.text();
      if (!res.ok || text.trimStart().startsWith("<")) {
        const code = /<returnReasonCode>(\d+)</.exec(text)?.[1] || /<resultCode>(\d+)</.exec(text)?.[1] || String(res.status);
        console.log(`중기 기온예보 ${tmFc}: 받지 못함 (${code})`);
        if (res.status >= 500) continue;
        return {};
      }
      const j = JSON.parse(text);
      const head = j?.response?.header || {};
      if (head.resultCode === "03") return {};
      if (head.resultCode !== "00") {
        console.log(`중기 기온예보 ${tmFc}: 받지 못함 (${head.resultCode})`);
        return {};
      }
      const raw = j?.response?.body?.items?.item;
      const item = Array.isArray(raw) ? raw[0] : raw;
      return parseMidTa(item, tmFc);
    } catch {
      await new Promise((r) => setTimeout(r, 1500 * (a + 1)));
    }
  }
  console.log(`중기 기온예보 ${tmFc}: 연결하지 못함`);
  return {};
}

/** 지금(한국 날짜 · 시각) 받을 수 있는 가장 새 발표들 — 어제 18시 · 오늘 06시(06:10 뒤) · 오늘 18시(18:10 뒤) 차례로 덮음 */
export async function midTemps(today: string, hm: string): Promise<Record<string, MidTemp>> {
  if (!key()) {
    console.log("중기 기온예보: 기상청 열쇠가 없어 건너뜀 (기온 조정 없이 반반 그대로 — 기다림)");
    return {};
  }
  const ymd = (d: string) => d.replace(/-/g, "");
  const list = [`${ymd(addDays(today, -1))}1800`, ...(hm >= "06:10" ? [`${ymd(today)}0600`] : []), ...(hm >= "18:10" ? [`${ymd(today)}1800`] : [])];
  const out: Record<string, MidTemp> = {};
  for (const tm of list) Object.assign(out, await one(tm));
  const days = Object.keys(out).sort();
  console.log(`중기 기온예보: ${list.slice(-1)[0]} 까지 · ${days.length}일${days.length ? ` (${days[0]} ~ ${days[days.length - 1]})` : ""}`);
  return out;
}
