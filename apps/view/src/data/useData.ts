/* 자료 받기 상태 — 체험판이면 가짜 자료, 아니면 로그인 → 폰 저장소 → 새로 온 것만 받기 */
import { useCallback, useEffect, useState } from "react";
import { sampleUntilYesterday, todayKst, type DayBatch, type PosId } from "@report/core";
import { checkViewer, fetchDays, fetchDevices, firebaseConfig, fresh, login, FirebaseError, type DeviceStatus, type Session } from "./firebase";
import { clearCached, loadCached, local, saveCached } from "./cache";

export type Phase = "setup" | "login" | "loading" | "ready";

export interface DataState {
  phase: Phase;
  batches: DayBatch[];
  devices: DeviceStatus[];
  /** 마지막으로 새 자료를 확인한 시각 */
  syncedAt: string | null;
  syncing: boolean;
  error: string | null;
  email: string | null;
  demo: boolean;
}

const SESSION = "report.session";
const SYNCED = "report.syncedAt";
const CURSOR = "report.cursor";

function demoDevices(today: string): DeviceStatus[] {
  const y = new Date(Date.parse(today) - 86400_000).toISOString().slice(0, 10);
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
  const [s, set] = useState<DataState>(() => ({
    phase: __DEMO__ ? "ready" : !cfg ? "setup" : local.get<Session>(SESSION) ? "loading" : "login",
    batches: __DEMO__ ? sampleUntilYesterday(todayKst()) : [],
    devices: __DEMO__ ? demoDevices(todayKst()) : [],
    syncedAt: __DEMO__ ? new Date().toISOString() : local.get<string>(SYNCED),
    syncing: false,
    error: null,
    email: __DEMO__ ? "체험판" : local.get<Session>(SESSION)?.email ?? null,
    demo: __DEMO__,
  }));

  const sync = useCallback(async () => {
    if (__DEMO__ || !cfg) return;
    let session = local.get<Session>(SESSION);
    if (!session) return;
    set((p) => ({ ...p, syncing: true, error: null }));
    // 폰에 저장된 자료부터 바로 보여 줌
    const cached = await loadCached();
    set((p) => ({ ...p, batches: cached.length ? cached : p.batches, phase: "ready" }));
    try {
      session = await fresh(cfg, session);
      local.set(SESSION, session);
      const got = await fetchDays(cfg, session, local.get<string>(CURSOR));
      await saveCached(got);
      if (got.length) local.set(CURSOR, got[got.length - 1].sentAt);
      const devices = await fetchDevices(cfg, session).catch(() => [] as DeviceStatus[]);
      const now = new Date().toISOString();
      local.set(SYNCED, now);
      set((p) => ({ ...p, batches: got.length ? [...p.batches, ...got] : p.batches, devices, syncedAt: now, syncing: false }));
    } catch (e) {
      const err = e as FirebaseError;
      if (err.auth) {
        local.set(SESSION, null);
        set((p) => ({ ...p, phase: "login", syncing: false, error: err.message, email: null }));
      } else set((p) => ({ ...p, syncing: false, error: err.message }));
    }
  }, [cfg]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!cfg) return;
      set((p) => ({ ...p, syncing: true, error: null }));
      try {
        const session = await login(cfg, email.trim(), password);
        await checkViewer(cfg, session);
        local.set(SESSION, session);
        set((p) => ({ ...p, email: session.email, phase: "loading" }));
        await sync();
      } catch (e) {
        set((p) => ({ ...p, syncing: false, error: (e as Error).message }));
      }
    },
    [cfg, sync],
  );

  const signOut = useCallback(async () => {
    local.set(SESSION, null);
    local.set(CURSOR, null);
    local.set(SYNCED, null);
    await clearCached();
    set((p) => ({ ...p, phase: "login", batches: [], devices: [], email: null, syncedAt: null }));
  }, []);

  /** 저장된 자료를 지우고 처음부터 다시 받음 */
  const reload = useCallback(async () => {
    local.set(CURSOR, null);
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

  return { ...s, sync, signIn, signOut, reload };
}
