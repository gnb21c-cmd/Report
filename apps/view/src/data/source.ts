/* 자료를 어디서 받는지 — 클라우드 보관함(폰, 밖에서) · 사무실 PC(C) 직접(사무실 안 · 미리보기) · 체험판(가짜) */
import type { DayReport, DayWeather } from "@report/core";

/** C(사무실 PC) 상태 — 보고 앱 설정 화면에 보임 */
export interface OfficeStatus {
  at?: string;
  version?: string;
  lastDate?: string;
  pending?: number;
  lastError?: string;
  name?: string;
}

export interface Source {
  kind: "cloud" | "office" | "demo";
  /** after(받은 시각 ISO) 뒤에 올라온 보고 자료 · 다음에 쓸 표시 */
  reports(after: string | null): Promise<{ reports: DayReport[]; last: string | null }>;
  weather(after: string | null): Promise<{ days: DayWeather[]; last: string | null }>;
  status(): Promise<OfficeStatus | null>;
}

async function get(url: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch {
    throw new Error("사무실 PC(C)에 연결하지 못했습니다. 저장된 자료로 보여 드립니다.");
  }
  if (!res.ok) throw new Error(`사무실 PC(C) 오류 ${res.status}`);
  return res.json();
}

/** 사무실 PC(C)가 직접 보여 주는 보고 화면 (http://C이름:8770/b/) — 같은 주소의 /api 를 읽음 */
export function officeSource(): Source {
  const q = (after: string | null) => (after ? `?after=${encodeURIComponent(after)}` : "");
  return {
    kind: "office",
    async reports(after) {
      const j = await get(`/api/reports${q(after)}`);
      return { reports: (j.reports || []) as DayReport[], last: j.last || after };
    },
    async weather(after) {
      const j = await get(`/api/weather${q(after)}`);
      return { days: (j.days || []) as DayWeather[], last: j.last || after };
    },
    async status() {
      try {
        return (await get("/api/info")) as OfficeStatus;
      } catch {
        return null;
      }
    },
  };
}
