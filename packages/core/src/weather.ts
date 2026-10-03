import { currentSettings, DEFAULT_SETTINGS, type SeasonKind, type SeasonRule } from "./settings";
/* ============================================================
   날씨 · 기간 스티커 (보고 앱 총 매출 상자 오른쪽)
   - 날씨: GitHub 가 1시간마다 기상청에서 받아 보관함 weather/{날짜} 에 쌓아 둔 값 (apps/weather)
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

export type { SeasonKind } from "./settings";
export const SEASON_EMOJI: Record<SeasonKind, string> = { 성수기: "🔥", 평상시: "🙂", 비수기: "🍃" };

/** 기간 스티커 표 — 지금 설정(입력 화면 ⚙ 설정)의 것 */
export const SEASONS = DEFAULT_SETTINGS.seasons;

/** 기간 스티커 — 주어진 규칙에서 (설정 창 미리보기용) */
export function seasonIn(rules: SeasonRule[], date: string): { kind: SeasonKind; emoji: string; name: string } {
  const md = date.slice(5, 10);
  for (const s of rules) {
    const hit = s.from <= s.to ? md >= s.from && md <= s.to : md >= s.from || md <= s.to;
    if (hit) return { kind: s.kind, emoji: SEASON_EMOJI[s.kind], name: s.name };
  }
  return { kind: "평상시", emoji: SEASON_EMOJI.평상시, name: "" };
}

/** 기간 스티커 — 지금 설정 */
export function seasonOf(date: string): { kind: SeasonKind; emoji: string; name: string } {
  return seasonIn(currentSettings().seasons, date);
}
