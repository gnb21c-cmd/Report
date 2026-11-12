/* ============================================================
   빵 이름 바꿈 (2026-10-25 사장님) — POS 이름이 바뀌어도 같은 빵으로 판매 기록 · 계획 · 결과 · 같은 요일 칸을 이어서 셈
   - 인절미팥빵 → 저당팥빵 (POS 10-24 부터) · 고소한옛날맘모스(맘모스) → 팥앙금샌드 (POS 10-28 수요일부터)
   - from = 새 이름으로 계획하는 첫 날: 10-29(목)에 발표하는 11-02 ~ 08 주간안부터 새 이름
     그 전 날짜 계획(이미 발표한 것)은 옛 이름 그대로 — 화면에는 "인절미팥빵 (변경명칭:저당팥빵)"
   - 그 전 날짜와 견줄 때(결과 · 매진)는 새 이름으로 팔린 것도 옛 이름으로 셈, 그날부터는 옛 이름으로 팔린 것도 새 이름으로
   - 저당팥빵 → 단팥빵 (2026-11-12 사장님 — 포스에 단팥빵으로 팔리기 시작한 11-12 부터): 이미 발표한 계획 · 확정이든 앞으로 발표할 계획이든
     그날부터 날짜의 이름을 모두 단팥빵으로 — 계획 · 확정을 읽을 때(asPlan · asOrder) 그날 이름으로 바꿈 (매니저 앱 · 현장 태블릿 · 보고 앱 · 계획 작업이 모두 이렇게 읽음)
     이름이 이어서 바뀐 빵은 한 줄(인절미팥빵 → 저당팥빵 → 단팥빵) — 그날 이름은 그 줄에서 날짜로, 화면 표기의 (변경명칭)은 가장 새 이름
   - 앞으로 이름이 바뀌면: 포스에 새 이름으로 팔리기 시작한 날을 from 으로 한 줄 더하면 됨 (이미 발표한 계획도 그날부터 바뀜)
   ============================================================ */
import type { Board } from "./metrics";

export interface BreadRename {
  old: string;
  to: string;
  /** 새 이름으로 계획하는 첫 날 */
  from: string;
  /** POS 에 찍힐 수 있는 다른 이름 */
  also?: readonly string[];
}
export const BREAD_RENAME: readonly BreadRename[] = [
  { old: "인절미팥빵", to: "저당팥빵", from: "2026-11-02" },
  { old: "고소한옛날맘모스", to: "팥앙금샌드", from: "2026-11-02", also: ["맘모스", "팥앙금빵"] },
  // 2026-11-12 사장님 — 포스에 단팥빵으로 팔리기 시작한 날 (11-12 마감 전 판매에서 확인 · 저당팥빵은 11-11 까지)
  { old: "저당팥빵", to: "단팥빵", from: "2026-11-12" },
];

/** 이름 견줄 때 — 띄어쓰기는 상관없음 */
export const breadKey = (n: string) => n.replace(/\s+/g, "");
/** 이름이 이어서 바뀐 빵 한 줄 — 이름 · 그 이름으로 계획하는 첫 날 (처음 이름은 "") */
interface Stage {
  name: string;
  from: string;
}
const FAMILY = new Map<string, Stage[]>();
for (const r of BREAD_RENAME) {
  let st = FAMILY.get(breadKey(r.old));
  if (!st) {
    st = [{ name: r.old, from: "" }];
    FAMILY.set(breadKey(r.old), st);
  }
  st.push({ name: r.to, from: r.from });
  st.sort((a, b) => a.from.localeCompare(b.from));
  FAMILY.set(breadKey(r.to), st);
  for (const n of r.also || []) FAMILY.set(breadKey(n), st);
}

/* ---------- 단종 빵 (2026-11-05 매니저 요청 · 사장님 전달) ----------
   마지막으로 만드는 날까지만 — 그 뒤 날짜의 계획 · 확정 · 추세 · 현장 표 · 매니저 앱 · 두 계획 견주기에서 뺌
   (이미 만든 계획 · 확정에 있어도 asPlan · asOrder 가 뺌, 다음 계획부터는 하루 목표로 다른 빵이 채움)
   - 초코바게트: 11-05(목)까지 · 감계무량샌드위치: 11-08(일)까지 */
export const DISCONTINUED: Readonly<Record<string, string>> = { 초코바게트: "2026-11-05", 감계무량샌드위치: "2026-11-08" };
const GONE = new Map(Object.entries(DISCONTINUED).map(([n, last]) => [breadKey(n), last]));
/** 그날 단종된 빵인지 (마지막으로 만드는 날 다음 날부터) */
export function isDiscontinued(name: string, date: string): boolean {
  const last = GONE.get(breadKey(name || ""));
  return last != null && date > last;
}

/** 그날 계획에서 쓰는 이름 — 바꾸기 전 날짜는 옛 이름, 그날부터 새 이름 (옛 · 새 · 다른 이름 모두) */
export function breadNameOn(name: string, date: string): string {
  const st = FAMILY.get(breadKey(name || ""));
  if (!st) return name;
  let cur = st[0].name;
  for (const s of st) if (date >= s.from) cur = s.name;
  return cur;
}

/** 이름이 바뀐 빵인지 (옛 · 새 · 다른 이름) — POS 에서 새 이름이 상품 분류표에 없어 기타로 찍혀도 베이커리로 (rules.ts etcMove, 2026-11-04 사장님:
 *  판매코드는 같은데 이름만 바뀜 — 10-28 ~ 11-03 팥앙금샌드 84개가 기타로 저장돼 빵 판매에서 빠졌었음) */
export const isRenamedBread = (name: string): boolean => FAMILY.has(breadKey(name || ""));

/** 새 이름 (날짜와 상관없이 — 순서 · 올림 단위 · 같은 요일 칸을 찾을 때) */
export const breadNewName = (name: string): string => {
  const st = FAMILY.get(breadKey(name || ""));
  return st ? st[st.length - 1].name : name;
};

/** 화면 표기 — 그날 이름 (이미 발표한 계획에 옛 이름으로 적혀 있어도), 바꾸기 전 날짜면 "그날 이름 (변경명칭:가장 새 이름)" */
export function breadLabel(name: string, date: string): string {
  if (!FAMILY.has(breadKey(name || ""))) return name;
  const cur = breadNameOn(name, date);
  const latest = breadNewName(name);
  return cur === latest ? cur : `${cur} (변경명칭:${latest})`;
}

/** 그날(d) 베이커리 판매 개수 — 계획 날(date) 기준 이름으로 묶음 (생산품이 아닌 잼 등은 Board 가 이미 뺌) */
export function breadSold(board: Board, d: string, date: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of board.products(d, d, "베이커리")) {
    const n = breadNameOn(p.name, date);
    m.set(n, (m.get(n) || 0) + p.qty);
  }
  return m;
}

/** 이름 → 개수 묶음을 그날 기준 이름으로 (더함 — 50% 할인 개수) */
export function renameSum(x: Record<string, number>, date: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [n, v] of Object.entries(x)) {
    const k = breadNameOn(n, date);
    out[k] = (out[k] || 0) + v;
  }
  return out;
}

/** 이름 → 시각 묶음을 그날 기준 이름으로 (늦은 시각 — 마지막 판매) */
export function renameLast(x: Record<string, string>, date: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [n, v] of Object.entries(x)) {
    const k = breadNameOn(n, date);
    if (!out[k] || v > out[k]) out[k] = v;
  }
  return out;
}
