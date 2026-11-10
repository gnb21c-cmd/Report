/* ============================================================
   키즈대관 — 키즈 POS 통합데스크 [대관]이 보내는 그날 대관 기록 (2026-11-10 사장님)
   - 대관료 매출은 **돈이 들어온 날** 그대로 (자금 기록 입금 → 그날 키즈입장, cash.ts isRentalRow · metrics.ts) — 자금 기록과 맞추려고
   - 하지만 단체가 **실제로 와서 쓴 날**도 보고 앱에 남아야 함 → 대관이 있는 날 통합데스크에서 [대관]을 눌러
     단체 이름 · 입금일(· 금액 · 인원 · 시각 · 메모)을 적고 저장 → 클라우드 boards/{열쇠}/deskStats/rental-{이용일} 에 덮어씀
     (astanakiz-rental · 취소되면 빈 목록). 통합데스크 쪽은 앞으로 만듦 (docs/KIDS_RENTAL.md)
   - 키즈 실시간 '오늘 입장' 넷째 칸 = 키즈대관 (그날 건수), 누르면 '단체 이름 (입금 10/16)' — 매출에는 더하지 않음 (입금한 날 이미 들어감)
   ============================================================ */

export const DESK_RENTAL_PREFIX = "rental-";
/** 하루 대관 기록은 이만큼까지만 */
export const RENTAL_MAX = 20;

export interface KidsRental {
  /** 단체 이름 (예: ○○어린이집) */
  name: string;
  /** 입금일 YYYY-MM-DD (안 적으면 null) */
  paidOn: string | null;
  /** 대관료 (참고 — 매출에는 입금한 날 들어감) */
  amount: number | null;
  /** 인원 */
  people: number | null;
  /** 시작 시각 HH:MM */
  time: string | null;
  memo: string;
}

export interface DeskRentalDay {
  /** 이용일 */
  day: string;
  sentAt: string;
  list: KidsRental[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** 전화번호처럼 보이는 글 (손님 연락처는 받지 않음) */
const PHONE = /\d{2,4}[-\s.]?\d{3,4}[-\s.]?\d{4}/;
const nat = (x: unknown, max: number): number | null => (typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= max ? x : null);

/** 통합데스크 대관 글 검사 — 모양이 틀리면 null, 이상한 줄(이름 없음 · 전화번호 같음)은 빼고 이상한 칸은 비움 */
export function parseDeskRental(raw: unknown): DeskRentalDay | null {
  let x: any = raw;
  if (typeof raw === "string") {
    try {
      x = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!x || typeof x !== "object" || x.type !== "astanakiz-rental" || x.v !== 1 || !DAY.test(String(x.day || "")) || !Array.isArray(x.list)) return null;
  const list: KidsRental[] = [];
  for (const it of x.list.slice(0, RENTAL_MAX)) {
    if (!it || typeof it !== "object") continue;
    const name = typeof it.name === "string" ? it.name.trim() : "";
    if (!name || name.length > 30 || PHONE.test(name)) continue;
    const memo = typeof it.memo === "string" && it.memo.trim().length <= 40 && !PHONE.test(it.memo) ? it.memo.trim() : "";
    list.push({
      name,
      paidOn: typeof it.paidOn === "string" && DAY.test(it.paidOn) ? it.paidOn : null,
      amount: nat(it.amount, 10_000_000),
      people: nat(it.people, 999),
      time: typeof it.time === "string" && HM.test(it.time) ? it.time : null,
      memo,
    });
  }
  return { day: x.day, sentAt: typeof x.sentAt === "string" ? x.sentAt.slice(0, 16) : "", list };
}

/** 보여 줄 글 — '단체 이름 (입금 10/16)' · 이용일과 해가 다르면 '(입금 25/12/20)' · 입금일이 없으면 '(입금일 안 적음)' */
export function rentalLabel(r: KidsRental, day: string): string {
  if (!r.paidOn) return `${r.name} (입금일 안 적음)`;
  const m = Number(r.paidOn.slice(5, 7)), d = Number(r.paidOn.slice(8, 10));
  return r.paidOn.slice(0, 4) === day.slice(0, 4) ? `${r.name} (입금 ${m}/${d})` : `${r.name} (입금 ${r.paidOn.slice(2, 4)}/${m}/${d})`;
}
