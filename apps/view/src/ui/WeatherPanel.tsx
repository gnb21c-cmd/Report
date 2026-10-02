/* 총 매출 상자 오른쪽 — 2 × 2 칸: [기간 스티커] [날씨] / [최고기온] [최저기온] (지난 날도 쌓인 자료로 그대로) */
import { seasonOf, temp, WEATHER_SOURCE_TEXT, type DayWeather } from "@report/core";

export function WeatherPanel({ date, w, compact = false }: { date: string; w?: DayWeather; compact?: boolean }) {
  const season = seasonOf(date);
  return (
    <div className={`wx${compact ? " compact" : ""}`} aria-label="그날 기간과 날씨">
      <div className={`season s-${season.kind}`} title={season.name || "평상시"}>
        <span aria-hidden>{season.emoji}</span> {season.kind}
      </div>
      <div className="wx-row" title={w ? WEATHER_SOURCE_TEXT[w.source] : "날씨 자료 없음"}>
        <span className="wx-emoji" aria-hidden>
          {w?.icon || "❔"}
        </span>
        <span className="wx-text">
          {w?.label || "없음"}
          {w?.source === "forecast" && <small> 예보</small>}
        </span>
      </div>
      <div className="wx-row">
        <span className="wx-emoji" aria-hidden>
          🌡️
        </span>
        <span className="wx-text">
          <span className="wx-key">최고</span>
          {temp(w?.tempMax)}
        </span>
      </div>
      <div className="wx-row">
        <span className="wx-emoji" aria-hidden>
          🧊
        </span>
        <span className="wx-text">
          <span className="wx-key">최저</span>
          {temp(w?.tempMin)}
        </span>
      </div>
    </div>
  );
}
