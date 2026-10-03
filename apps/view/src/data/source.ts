/* 자료를 어디서 받는지 — 클라우드 보관함(Firebase) · 체험판(가짜) */
import type { DayReport, DayWeather } from "@report/core";

/** (예전 C 상태 — 지금은 쓰지 않음) */
export interface OfficeStatus {
  at?: string;
  version?: string;
  lastDate?: string;
  pending?: number;
  lastError?: string;
  name?: string;
}

export interface Source {
  kind: "cloud" | "demo";
  /** after(받은 시각 ISO) 뒤에 올라온 보고 자료 · 다음에 쓸 표시 */
  reports(after: string | null): Promise<{ reports: DayReport[]; last: string | null }>;
  weather(after: string | null): Promise<{ days: DayWeather[]; last: string | null }>;
  status(): Promise<OfficeStatus | null>;
}

