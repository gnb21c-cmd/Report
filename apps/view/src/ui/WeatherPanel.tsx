/* 총 매출 상자 오른쪽 — 그날 날씨 · 최고기온 · 최저기온 · 기간 스티커 (지난 날도 쌓인 자료로 그대로) */
import { seasonOf, temp, WEATHER_SOURCE_TEXT, type DayWeather } from "@report/core";

export function WeatherPanel({ date, w, compact = false }: { date: string; w?: DayWeather; compact?: boolean }) {
  const season = seasonOf(date);
  return (
    <div className={`wx${compact ? " compact" : ""}`} aria-label="그날 날씨와 기간">
      <div className="wx-row" title={w ? WEATHER_SOURCE_TEXT[w.source] : "날씨 자료 없음"}>
        <span className="wx-emoji" aria-hidden>
          {w?.icon || "❔"}
        </span>
        <span className="wx-text">
          {w?.label || "날씨 없음"}
          {w?.source === "forecast" && <small> 예보</small>}
        </span>
      </div>
      <div className="wx-row">
        <span className="wx-emoji" aria-hidden>
          🌡️
        </span>
        <span className="wx-text">
          최고 <b>{temp(w?.tempMax)}</b>
        </span>
      </div>
      <div className="wx-row">
        <span className="wx-emoji" aria-hidden>
          🧊
        </span>
        <span className="wx-text">
          최저 <b>{temp(w?.tempMin)}</b>
        </span>
      </div>
      <div className={`season s-${season.kind}`} title={season.name || "평상시"}>
        <span aria-hidden>{season.emoji}</span> {season.kind}
      </div>
    </div>
  );
}
