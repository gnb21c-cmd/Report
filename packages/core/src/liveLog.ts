/* ============================================================
   하루 수집 기록 (2026-10-29 사장님) — POS 메인 PC 하루 수집(apps/collector/src/liveLoop.ts)의 작업 일지
   - 하루 수집은 21:50 에 끝난 뒤 컴퓨터가 꺼질 때까지 붙들고 있음(다음 날 아침 수집을 놓치지 않게) → 꺼지는 순간 작업이 끊겨
     GitHub 작업 기록이 통째로 안 남음 (10-27 · 10-28 — 20:00 빵 숫자가 왜 그대로였는지 볼 수 없었음)
   - 그래서 이 PC 에 날마다 기록 파일(줄마다 시각)을 남기고, 붙들기 전 · 비켜 줄 때 · 다음 작업을 시작할 때(지난 날 것)
     저장소 live-log 가지의 log/날짜.log 로 올림. 글은 원래 GitHub 작업 기록과 같음 (공개 저장소 — 시각 · 성공/실패 · 개수만)
   ============================================================ */
import { addDays } from "./dates";

/** 기록을 올리는 저장소 가지 (main 과 따로 — 앱 배포 · 작업이 돌지 않음) */
export const LIVE_LOG_BRANCH = "live-log";
/** 이 PC 에 기록 파일을 두는 날 수 */
export const LIVE_LOG_KEEP_DAYS = 31;
/** 저장소 안 자리 */
export const liveLogPath = (date: string): string => `log/${date}.log`;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** 받은 글 → 줄마다 앞에 시각 ("HH:MM:SS 글\n") · 아직 줄이 안 끝난 나머지는 rest 로 (다음 글에 이어 붙임) */
export function logLines(rest: string, chunk: string, time: string): { text: string; rest: string } {
  const parts = (rest + chunk).replace(/\r\n?/g, "\n").split("\n");
  const tail = parts.pop() ?? "";
  return { text: parts.map((l) => `${time} ${l}\n`).join(""), rest: tail };
}

/** 올릴 날 — 오늘 전 날 중 파일에 글이 있고 올린 크기와 다른 것 (오래된 순). 오늘은 붙들기 전 · 비켜 줄 때 따로 올림 */
export function logPushDue(today: string, files: { date: string; size: number; up: number | null }[]): string[] {
  return files
    .filter((f) => DAY.test(f.date) && f.date < today && f.size > 0 && f.up !== f.size)
    .map((f) => f.date)
    .sort();
}

/** 지울 기록 파일 날 — LIVE_LOG_KEEP_DAYS 보다 오래된 것 */
export function logPrune(today: string, dates: string[], keep = LIVE_LOG_KEEP_DAYS): string[] {
  const from = addDays(today, -(keep - 1));
  return dates.filter((d) => DAY.test(d) && d < from).sort();
}
