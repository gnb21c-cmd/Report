/* ============================================================
   날씨 · 기간 스티커 (보고 앱 총 매출 상자 오른쪽)
   - 날씨: POS PC 의 A 가 기상청에서 받아 보관함 weather/{날짜} 에 쌓아 둔 값 (apps/sender/src/report_sender/weather.py)
     지난 날 = 지상관측(ASOS 119 수원) 확정값, 오늘 = 단기예보(격자 61·119). 아스타나와 같은 규칙
   - 기간 스티커: 성수기 · 평상시 · 비수기 — SEASONS 표 (사장님이 정한 기간, 바꾸면 시험 먼저)
   ============================================================ */

export type WeatherKey = "sunny" | "cloudy" | "rain" | "heavyrain" | "snow";

export interface DayWeather {
  date: string;
  key: WeatherKey;
  label: string;
  icon: string;
  tempMax: number | null;
  tempMin: number | null;
  rainMm: number | null;
  /** observed: 기상청 관측 · forecast: 기상청 예보 */
  source: "observed" | "forecast";
}
export type WeatherMap = Record<string, DayWeather>;

export const WEATHER_SOURCE_TEXT = { observed: "기상청 관측", forecast: "기상청 예보" } as const;

/** 기온 표시: 22.2° (없으면 —) */
export function temp(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : `${Math.round(v * 10) / 10}°`;
}

export type SeasonKind = "성수기" | "평상시" | "비수기";
export const SEASON_EMOJI: Record<SeasonKind, string> = { 성수기: "🔥", 평상시: "🙂", 비수기: "🍃" };

/** 기간 스티커 표 — 해마다 같은 월·일 기간 (MM-DD ~ MM-DD, 해를 넘겨도 됨). 위에서부터 먼저 맞는 것. 나머지는 평상시
 *  기본값(키즈 카페 기준 가정): 여름·겨울 방학과 5월 가정의 달은 성수기, 개학 3월·장마 6월 말~7월 초·11월은 비수기 */
export const SEASONS: { kind: Exclude<SeasonKind, "평상시">; from: string; to: string; name: string }[] = [
  { kind: "성수기", from: "07-20", to: "08-20", name: "여름방학" },
  { kind: "성수기", from: "12-24", to: "02-28", name: "겨울방학" },
  { kind: "성수기", from: "05-01", to: "05-31", name: "가정의 달" },
  { kind: "비수기", from: "03-02", to: "03-31", name: "개학" },
  { kind: "비수기", from: "06-20", to: "07-10", name: "장마" },
  { kind: "비수기", from: "11-01", to: "11-30", name: "늦가을" },
];

export function seasonOf(date: string): { kind: SeasonKind; emoji: string; name: string } {
  const md = date.slice(5, 10);
  for (const s of SEASONS) {
    const hit = s.from <= s.to ? md >= s.from && md <= s.to : md >= s.from || md <= s.to;
    if (hit) return { kind: s.kind, emoji: SEASON_EMOJI[s.kind], name: s.name };
  }
  return { kind: "평상시", emoji: SEASON_EMOJI.평상시, name: "" };
}
