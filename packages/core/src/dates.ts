/* 날짜 도우미 — 모두 'YYYY-MM-DD' 글자로 다룸 (시간대 문제를 피하려고 UTC 기준으로 계산) */

export const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

export function toKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function fromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(key: string, n: number): string {
  const d = fromKey(key);
  d.setUTCDate(d.getUTCDate() + n);
  return toKey(d);
}

export function weekday(key: string): number {
  return fromKey(key).getUTCDay();
}

export function weekdayLabel(key: string): string {
  return WEEKDAY_KO[weekday(key)];
}

export function daysInMonth(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 'YYYY-MM' */
export function monthOf(key: string): string {
  return key.slice(0, 7);
}

export function monthStart(key: string): string {
  return key.slice(0, 7) + "-01";
}

/** 'YYYY-MM' 에 n 달 더하기 */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** 같은 달 같은 날을 n 년 전으로 (2월 29일은 28일로) */
/** 작년 비교 날 = 364일 전 (52주 전) — 요일이 같고 작년의 같은 주(월~일)에 듦. 예: 26-09-15(화) ↔ 25-09-16(화) */
export function lyDay(key: string): string {
  return addDays(key, -364);
}

/** 달력 날짜 그대로 n년 전 (요일은 달라짐 — 작년 비교에는 lyDay) */
export function sameDayYearsAgo(key: string, n = 1): string {
  const [y, m, d] = key.split("-").map(Number);
  const yy = y - n;
  const last = new Date(Date.UTC(yy, m, 0)).getUTCDate();
  return `${yy}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** from ~ to (둘 다 포함) 날짜 목록 */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

/** 한국 시간 기준 오늘 */
export function todayKst(now: Date = new Date()): string {
  return toKey(new Date(now.getTime() + 9 * 3600_000));
}

/** 마감 자료를 보여 주기 시작하는 시각 (한국 시간) — 사무실이 아침에 전날 자료를 올림 */
export const REPORT_OPEN_HOUR = 10;

/** 지금 볼 수 있는 마지막 마감일 — 오전 10시부터는 어제, 그 전은 그제 (오늘은 아직 마감 전이라 안 보임) */
export function closedDay(now: Date = new Date()): string {
  const k = new Date(now.getTime() + 9 * 3600_000);
  return addDays(toKey(k), k.getUTCHours() >= REPORT_OPEN_HOUR ? -1 : -2);
}

/** 10월 1일 (수) */
export function shortLabel(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${m}월 ${d}일 (${weekdayLabel(key)})`;
}
