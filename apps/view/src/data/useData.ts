/* 자료 받기 상태 — 체험판이면 가짜 자료, 아니면 설치 주소의 열쇠로 클라우드에서
   → 폰 저장소 → 새로 온 것만 받기 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  cleanSettings,
  NAVER_SLOTS,
  sampleReports,
  sampleUntilYesterday,
  sum,
  todayKst,
  type DayReport,
  type LiveDoc,
  type ReportSettings,
  type StorePart,
  type WeatherKey,
  type WeatherMap,
} from "@report/core";
import { boardKey, firebaseConfig, firebaseSource } from "./firebase";
import type { OfficeStatus, Source } from "./source";
import demoWeatherRaw from "./demoWeather.json";
import { clearCached, loadCached, local, saveCached } from "./cache";

export type Phase = "setup" | "nokey" | "loading" | "ready";

export interface DataState {
  phase: Phase;
  reports: DayReport[];
  /** 날짜별 날씨 (쌓아 두고 지난 날도 봄) */
  weather: WeatherMap;
  status: OfficeStatus | null;
  /** 마지막으로 새 자료를 확인한 시각 */
  syncedAt: string | null;
  syncing: boolean;
  error: string | null;
  source: Source["kind"];
  /** 보고 설정 (기간 스티커 · 휴일) — 계산 전에 applySettings */
  settings: ReportSettings | null;
  /** 마감 전 영업정보 — 오늘 · 어제의 live 문서 (폰에 쌓지 않음, 열려 있는 동안 5분마다) */
  live: Record<string, LiveDoc | null>;
}

const SYNCED = "report.syncedAt";
const CURSOR = "report.reportCursor";
const WEATHER = "report.weather";
const WEATHER_CURSOR = "report.weatherCursor";
const SETTINGS = "report.settings";
/** 보고 문서 모양이 바뀌면(새 칸) 폰에 쌓인 자료를 한 번 처음부터 다시 받음 — 예전 화면이 새 칸을 모르고 지나친 문서를 다시 읽으려고 */
const DATA_SHAPE = "report.dataShape";
const SHAPE = "2026-10-extra-2"; // 2: 같은 시각 문서를 건너뛰던 받기 고침 → 한 번 더 처음부터

const LABEL: Record<WeatherKey, [string, string]> = {
  sunny: ["맑음", "☀️"],
  cloudy: ["구름", "☁️"],
  rain: ["비", "🌧️"],
  heavyrain: ["강우", "⛈️"],
  snow: ["눈", "❄️"],
};
/** 체험판: 기상청에서 받아 둔 실제 날씨 (2025-01-01 ~ 만든 날) */
function demoWeather(): WeatherMap {
  const out: WeatherMap = {};
  for (const [date, [key, tempMax, tempMin, rainMm, src]] of Object.entries(
    demoWeatherRaw as unknown as Record<
      string,
      [WeatherKey, number | null, number | null, number | null, string]
    >,
  ))
    out[date] = {
      date,
      key,
      label: LABEL[key][0],
      icon: LABEL[key][1],
      tempMax,
      tempMin,
      rainMm,
      source: src === "o" ? "observed" : "forecast",
    };
  return out;
}

/** 체험판: 오늘 가짜 자료를 마감 전 영업정보로 (지금 시각까지만 — 시간대 칸은 지금 시각 뒤를 비움) */
function demoLive(today: string): LiveDoc {
  const r = sampleReports(today, today)[0];
  const at = new Date().toISOString();
  const fix = (p?: StorePart) => (p ? { p: { ...p, teams: sum(p.teamSizes) }, by: "체험판", at } : undefined);
  const nv = r?.naver;
  const hour = Number(new Date(Date.now() + 9 * 3600e3).toISOString().slice(11, 13));
  const cut = (xs: number[]) => xs.map((x, i) => (Number(NAVER_SLOTS[i].slice(0, 2)) <= hour ? x : 0));
  const naver = nv ? cut(nv.tickets) : NAVER_SLOTS.map(() => 0);
  return {
    date: today,
    at,
    cafe: fix(r?.cafe),
    kids: fix(r?.kids),
    desk: {
      p: {
        v: 1,
        date: today,
        naver,
        naverNew: nv ? cut(nv.newVisitors).map((n, i) => Math.min(n, naver[i])) : naver.map(() => 0),
        onsite: naver.map((_, i) =>
          i === 0 ? (r?.kids?.kids?.walkIn || 0) + (r?.kids?.kids?.walkIn20 || 0) : 0,
        ),
        eventFree: r?.kids?.kids?.eventFree || 0,
      },
      by: "체험판",
      at,
    },
  };
}

/** 이 화면이 어디서 자료를 받는지 */
function pickSource(): { source: Source | null; phase: Phase; kind: Source["kind"] } {
  if (__DEMO__) return { source: null, phase: "ready", kind: "demo" };
  const cfg = firebaseConfig();
  if (!cfg) return { source: null, phase: "setup", kind: "cloud" };
  const board = boardKey();
  if (!board) return { source: null, phase: "nokey", kind: "cloud" };
  return { source: firebaseSource(cfg, board), phase: "loading", kind: "cloud" };
}

const byDate = (list: DayReport[]) => {
  const m = new Map<string, DayReport>();
  for (const r of list) m.set(r.date, r);
  return [...m.values()];
};

export function useData() {
  const picked = useMemo(pickSource, []);
  const [s, set] = useState<DataState>(() => ({
    phase: picked.phase,
    reports: __DEMO__ ? sampleUntilYesterday(todayKst()) : [],
    weather: __DEMO__ ? demoWeather() : local.get<WeatherMap>(WEATHER) || {},
    status: __DEMO__
      ? { at: new Date().toISOString(), version: "체험판", lastDate: "", pending: 0, lastError: "" }
      : null,
    syncedAt: __DEMO__ ? new Date().toISOString() : local.get<string>(SYNCED),
    syncing: false,
    error: null,
    source: picked.kind,
    settings: (() => {
      const c = local.get<ReportSettings>(SETTINGS);
      return c ? cleanSettings(c) : null;
    })(),
    live: __DEMO__ ? { [todayKst()]: demoLive(todayKst()) } : {},
  }));

  /** 마감 전 영업정보 — 오늘 · 어제 live 문서 (읽기 2번) */
  const syncLive = useCallback(async () => {
    const src = picked.source;
    if (!src) return;
    const today = todayKst();
    const days = [today, addDays(today, -1)];
    const got = await Promise.all(days.map((d) => src.live(d).catch(() => null)));
    set((p) => ({ ...p, live: Object.fromEntries(days.map((d, i) => [d, got[i]])) }));
  }, [picked]);

  const sync = useCallback(async () => {
    const src = picked.source;
    if (!src) return;
    set((p) => ({ ...p, syncing: true, error: null }));
    if (local.get<string>(DATA_SHAPE) !== SHAPE) {
      local.set(CURSOR, null);
      await clearCached();
      set((p) => ({ ...p, reports: [] }));
      local.set(DATA_SHAPE, SHAPE);
    }
    // 폰에 저장된 자료부터 바로 보여 줌
    const cached = await loadCached();
    set((p) => ({
      ...p,
      reports: cached.length ? byDate([...p.reports, ...cached]) : p.reports,
      phase: "ready",
    }));
    void syncLive();
    try {
      const got = await src.reports(local.get<string>(CURSOR));
      await saveCached(got.reports);
      if (got.last) local.set(CURSOR, got.last);
      const [status, wx, settings] = await Promise.all([
        src.status(),
        src.weather(local.get<string>(WEATHER_CURSOR)).catch(() => ({ days: [], last: null })),
        src.settings().catch(() => null),
      ]);
      local.set(SETTINGS, settings);
      let weather = local.get<WeatherMap>(WEATHER) || {};
      if (wx.days.length) {
        weather = { ...weather };
        for (const w of wx.days) weather[w.date] = w;
        local.set(WEATHER, weather);
        if (wx.last) local.set(WEATHER_CURSOR, wx.last);
      }
      const now = new Date().toISOString();
      local.set(SYNCED, now);
      set((p) => ({
        ...p,
        reports: got.reports.length ? byDate([...p.reports, ...got.reports]) : p.reports,
        status,
        weather,
        syncedAt: now,
        syncing: false,
        settings: JSON.stringify(settings) === JSON.stringify(p.settings) ? p.settings : settings,
      }));
    } catch (e) {
      set((p) => ({ ...p, syncing: false, error: (e as Error).message }));
    }
  }, [picked, syncLive]);

  /** 저장된 자료를 지우고 처음부터 다시 받음 */
  const reload = useCallback(async () => {
    local.set(CURSOR, null);
    local.set(WEATHER_CURSOR, null);
    local.set(WEATHER, null);
    await clearCached();
    set((p) => ({ ...p, reports: [], weather: {} }));
    await sync();
  }, [sync]);

  useEffect(() => {
    if (s.phase === "loading") void sync();
    // 앱을 다시 열 때(폰 화면 켬)마다 새 자료 확인
    const onVis = () => document.visibilityState === "visible" && void sync();
    document.addEventListener("visibilitychange", onVis);
    // 열려 있는 동안 5분마다 마감 전 영업정보만 (바뀐 문서 하나씩)
    const t = setInterval(() => document.visibilityState === "visible" && void syncLive(), 5 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...s, sync, reload };
}
