/* 자료 받기 상태 — 체험판이면 가짜 자료, 아니면 설치 주소의 열쇠로 → 폰 저장소 → 새로 온 것만 받기 */
import { useCallback, useEffect, useState } from "react";
import { addDays, sampleUntilYesterday, todayKst, type Adjusts, type DayBatch, type KidsAdjust, type PosId, type WeatherKey, type WeatherMap } from "@report/core";
import { boardKey, fetchAdjusts, fetchDays, fetchDevices, fetchWeather, firebaseConfig, saveAdjust, type DeviceStatus } from "./firebase";
import demoWeatherRaw from "./demoWeather.json";
import { clearCached, loadCached, local, saveCached } from "./cache";

export type Phase = "setup" | "nokey" | "loading" | "ready";

export interface DataState {
  phase: Phase;
  batches: DayBatch[];
  adjusts: Adjusts;
  /** 날짜별 날씨 (쌓아 두고 지난 날도 봄) */
  weather: WeatherMap;
  devices: DeviceStatus[];
  /** 마지막으로 새 자료를 확인한 시각 */
  syncedAt: string | null;
  syncing: boolean;
  error: string | null;
  demo: boolean;
}

const SYNCED = "report.syncedAt";
const CURSOR = "report.cursor";
const ADJUSTS = "report.adjusts";
const DEMO_ADJUSTS = "report.demoAdjusts";
const WEATHER = "report.weather";
const WEATHER_CURSOR = "report.weatherCursor";

const LABEL: Record<WeatherKey, [string, string]> = { sunny: ["맑음", "☀️"], cloudy: ["구름", "☁️"], rain: ["비", "🌧️"], heavyrain: ["강우", "⛈️"], snow: ["눈", "❄️"] };
/** 체험판: 기상청에서 받아 둔 실제 날씨 (2025-01-01 ~ 만든 날) */
function demoWeather(): WeatherMap {
  const out: WeatherMap = {};
  for (const [date, [key, tempMax, tempMin, rainMm, src]] of Object.entries(demoWeatherRaw as unknown as Record<string, [WeatherKey, number | null, number | null, number | null, string]>))
    out[date] = { date, key, label: LABEL[key][0], icon: LABEL[key][1], tempMax, tempMin, rainMm, source: src === "o" ? "observed" : "forecast" };
  return out;
}

function demoDevices(today: string): DeviceStatus[] {
  const y = addDays(today, -1);
  return (["cafe", "kids"] as PosId[]).map((pos) => ({
    pos,
    at: `${y}T${pos === "cafe" ? "13:08" : "12:41"}:00.000Z`,
    lastDate: y,
    pending: 0,
    lastError: "",
    source: "엑셀 폴더 (C:\\PosReport\\엑셀)",
    version: "0.1.0",
  }));
}

export function useData() {
  const cfg = firebaseConfig();
  const board = __DEMO__ ? null : boardKey();
  const [s, set] = useState<DataState>(() => ({
    phase: __DEMO__ ? "ready" : !cfg ? "setup" : !board ? "nokey" : "loading",
    batches: __DEMO__ ? sampleUntilYesterday(todayKst()) : [],
    adjusts: (__DEMO__ ? local.get<Adjusts>(DEMO_ADJUSTS) : local.get<Adjusts>(ADJUSTS)) || {},
    weather: __DEMO__ ? demoWeather() : local.get<WeatherMap>(WEATHER) || {},
    devices: __DEMO__ ? demoDevices(todayKst()) : [],
    syncedAt: __DEMO__ ? new Date().toISOString() : local.get<string>(SYNCED),
    syncing: false,
    error: null,
    demo: __DEMO__,
  }));

  const sync = useCallback(async () => {
    if (__DEMO__ || !cfg || !board) return;
    set((p) => ({ ...p, syncing: true, error: null }));
    // 폰에 저장된 자료부터 바로 보여 줌
    const cached = await loadCached();
    set((p) => ({ ...p, batches: cached.length ? cached : p.batches, phase: "ready" }));
    try {
      const got = await fetchDays(cfg, board, local.get<string>(CURSOR));
      await saveCached(got);
      if (got.length) local.set(CURSOR, got[got.length - 1].sentAt);
      const [adjusts, devices, wx] = await Promise.all([
        fetchAdjusts(cfg, board),
        fetchDevices(cfg, board).catch(() => [] as DeviceStatus[]),
        fetchWeather(cfg, board, local.get<string>(WEATHER_CURSOR)).catch(() => ({ days: [], last: null })),
      ]);
      local.set(ADJUSTS, adjusts);
      let weather = local.get<WeatherMap>(WEATHER) || {};
      if (wx.days.length) {
        weather = { ...weather };
        for (const w of wx.days) weather[w.date] = w;
        local.set(WEATHER, weather);
        if (wx.last) local.set(WEATHER_CURSOR, wx.last);
      }
      const now = new Date().toISOString();
      local.set(SYNCED, now);
      set((p) => ({ ...p, batches: got.length ? [...p.batches, ...got] : p.batches, adjusts, devices, weather, syncedAt: now, syncing: false }));
    } catch (e) {
      set((p) => ({ ...p, syncing: false, error: (e as Error).message }));
    }
  }, [cfg, board]);

  /** 네이버 입장권 수 고치기 (null = POS 값으로 되돌림) */
  const setAdjust = useCallback(
    async (date: string, adj: KidsAdjust | null) => {
      const apply = (p: DataState) => {
        const next = { ...p.adjusts };
        if (adj) next[date] = { ...adj, at: new Date().toISOString() };
        else delete next[date];
        return next;
      };
      if (__DEMO__) {
        set((p) => {
          const adjusts = apply(p);
          local.set(DEMO_ADJUSTS, adjusts);
          return { ...p, adjusts };
        });
        return;
      }
      if (!cfg || !board) return;
      await saveAdjust(cfg, board, date, adj);
      set((p) => {
        const adjusts = apply(p);
        local.set(ADJUSTS, adjusts);
        return { ...p, adjusts };
      });
    },
    [cfg, board],
  );

  /** 저장된 자료를 지우고 처음부터 다시 받음 */
  const reload = useCallback(async () => {
    local.set(CURSOR, null);
    local.set(WEATHER_CURSOR, null);
    local.set(WEATHER, null);
    await clearCached();
    set((p) => ({ ...p, batches: [] }));
    await sync();
  }, [sync]);

  useEffect(() => {
    if (s.phase === "loading") void sync();
    // 앱을 다시 열 때(폰 화면 켬)마다 새 자료 확인
    const onVis = () => document.visibilityState === "visible" && void sync();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...s, sync, reload, setAdjust };
}
