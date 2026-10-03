/* ============================================================
   보고 설정 — 해마다 · 때때로 바뀌어 사람이 정하는 것 (입력 화면의 ⚙ 설정에서 바꾸고, 클라우드 settings/main 에 저장)
   - 기간 스티커: 성수기 · 평상시 · 비수기 (해마다 같은 월·일, 위에서부터 먼저 맞는 것, 나머지는 평상시)
   - 휴일: 공휴일 표(대체공휴일 · 알려진 임시공휴일 포함, holidays.ts)는 자동.
           갑자기 정한 임시공휴일은 '더하기', 표에 있지만 쉬지 않는 날은 '빼기'
   보고 앱 · 입력 화면 모두 자료를 계산하기 전에 applySettings 로 넣음
   ============================================================ */

export type SeasonKind = "성수기" | "평상시" | "비수기";

export interface SeasonRule {
  kind: SeasonKind;
  /** MM-DD (해를 넘겨도 됨: 12-24 ~ 02-28) */
  from: string;
  to: string;
  name: string;
}

export interface ReportSettings {
  v: 1;
  seasons: SeasonRule[];
  /** 더한 휴일 — 날짜 → 이름 (예: 임시공휴일) */
  holidaysAdd: Record<string, string>;
  /** 공휴일 표에 있지만 휴일로 보지 않는 날 */
  holidaysOff: string[];
  by?: string;
  at?: string;
}

/** 기본값(키즈 카페 기준 가정): 여름·겨울 방학과 5월 가정의 달은 성수기, 개학 3월·장마 6월 말~7월 초·11월은 비수기 */
export const DEFAULT_SETTINGS: ReportSettings = {
  v: 1,
  seasons: [
    { kind: "성수기", from: "07-20", to: "08-20", name: "여름방학" },
    { kind: "성수기", from: "12-24", to: "02-28", name: "겨울방학" },
    { kind: "성수기", from: "05-01", to: "05-31", name: "가정의 달" },
    { kind: "비수기", from: "03-02", to: "03-31", name: "개학" },
    { kind: "비수기", from: "06-20", to: "07-10", name: "장마" },
    { kind: "비수기", from: "11-01", to: "11-30", name: "늦가을" },
  ],
  holidaysAdd: {},
  holidaysOff: [],
};

const MD = /^\d{2}-\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** 클라우드에서 받은 값 → 고친 설정 (모양이 틀린 줄은 버림, 비면 기본값) */
export function cleanSettings(x: unknown): ReportSettings {
  const o = (x && typeof x === "object" ? x : {}) as Partial<ReportSettings>;
  const seasons = Array.isArray(o.seasons)
    ? o.seasons
        .filter((s) => s && (s.kind === "성수기" || s.kind === "평상시" || s.kind === "비수기") && MD.test(s.from) && MD.test(s.to))
        .map((s) => ({ kind: s.kind, from: s.from, to: s.to, name: String(s.name || "").slice(0, 30) }))
    : DEFAULT_SETTINGS.seasons;
  const holidaysAdd: Record<string, string> = {};
  for (const [d, n] of Object.entries(o.holidaysAdd || {})) if (DAY.test(d)) holidaysAdd[d] = String(n || "휴일").slice(0, 30);
  const holidaysOff = Array.isArray(o.holidaysOff) ? [...new Set(o.holidaysOff.filter((d) => DAY.test(d)))].sort() : [];
  return { v: 1, seasons, holidaysAdd, holidaysOff, ...(o.by ? { by: String(o.by) } : {}), ...(o.at ? { at: String(o.at) } : {}) };
}

let current: ReportSettings = DEFAULT_SETTINGS;
let version = 0;

/** 설정 넣기 (null = 기본값). 넣은 뒤 Board 를 새로 만들어야 휴일 단가 등이 다시 계산됨 */
export function applySettings(s: ReportSettings | null): void {
  current = s ? cleanSettings(s) : DEFAULT_SETTINGS;
  version++;
}
export function currentSettings(): ReportSettings {
  return current;
}
/** 설정이 바뀔 때마다 늘어나는 번호 (화면 다시 계산용) */
export function settingsVersion(): number {
  return version;
}
