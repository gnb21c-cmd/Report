/* 자료를 어디서 받는지 — 클라우드 보관함(Firebase) · 체험판(가짜) */
import type { DayReport, DayWeather, LiveDoc, ReportSettings, SurveyDoc } from "@report/core";

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
  /** 보고 설정 (기간 스티커 · 휴일) — 없으면 null */
  settings(): Promise<ReportSettings | null>;
  /** 오늘 마감 전 영업정보 — 그날 live 문서 (없으면 null) */
  live(date: string): Promise<LiveDoc | null>;
  /** 통합데스크 설문 집계 (설문 보고함 surveyInbox + 예전 settings/surveys, 없으면 null) */
  surveys(): Promise<SurveyDoc | null>;
  /** 통합데스크 이벤트 입장 수 — 날짜 → 그날 수 (deskStats/event-날짜 · 2026-10-21) */
  deskEvents(): Promise<Record<string, number>>;
  /** 그날 하나만 (오늘 · 5분마다) — 문서가 없으면 null */
  deskEventDay(date: string): Promise<number | null>;
}

