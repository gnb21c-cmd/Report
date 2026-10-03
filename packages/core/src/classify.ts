/* ============================================================
   상품 분류 · 키즈 입장 구분
   - 카페아스타나 상품 → 바리스타 · 베이커리 · 키친 · 기타 (분류 = 섹터)
     영수증별 엑셀에는 대분류 칸이 없으므로 C 의 '상품 분류표'(상품명 → 분류)로 나눔.
     분류표에 없는 새 상품은 이름으로 짐작(guessSector)해 A 화면에서 사람이 한 번 확인 → 분류표에 저장
     상품별(일자별) 엑셀(지난 자료)에는 OK포스 대분류가 있어 그대로 씀 (분류표도 채워짐)
   - 아스타나키즈 상품 → 입장 발행 · 현장 결제 · 이벤트 무료 · 추가 인원 · 기타 (kidsKind)
   ============================================================ */
import type { SaleLine } from "./types";

export type Sector = "바리스타" | "베이커리" | "키친" | "기타";
export const SECTORS: Sector[] = ["바리스타", "베이커리", "키친", "기타"];
/** 예전 이름 */
export type Team = Sector;

export function isSector(v: unknown): v is Sector {
  return typeof v === "string" && (SECTORS as string[]).includes(v);
}

const CAT_WORDS: [Sector, RegExp][] = [
  ["바리스타", /바리스타|음료|커피|주류/],
  ["베이커리", /베이커리|빵|디저트/],
  ["키친", /키친|식사|브런치/],
];

/** OK포스 대분류 → 분류. 대분류가 비었으면 null (이름으로 짐작해야 함) */
export function sectorFromCategory(cat1: string): Sector | null {
  const cat = (cat1 || "").trim();
  if (!cat) return null;
  if (isSector(cat)) return cat;
  for (const [s, re] of CAT_WORDS) if (re.test(cat)) return s;
  return "기타";
}

// 이름 낱말 (2026-09-27 · 10-01 · 10-02 카페 실제 상품과 OK포스 대분류를 보고 맞춤). 키친 → 베이커리 → 바리스타 순서로 봄
const KITCHEN = /파스타|리조또|샐러드|스테이크|폭립|덮밥|돈까스|돈가스|튀김|프라이|플래터|라자냐|피자|버거|치킨|불고기|치즈볼|밥으로|소스 따로|브런치|플레이트|토스트|식사|키친/;
const BAKERY =
  /빵|번(?![가-힣])|베이글|롤(?![가-힣])|파운드|스콘|바게트|파니니|파누쪼|샌드위치|떡|몽블랑|맘모스|보스톡|파삭|케이크|타르트|쿠키|크로플|크루아상|마카롱|파이(?![가-힣])|휘낭시에|마들렌|잼|티라미|브레드|치즈(?![가-힣])|베이커리|디저트/;
const BARISTA =
  /아메리카노|아메(?![가-힣])|라떼|에스프레소|카푸치노|모카|콜드브루|커피|에이드|스무디|주스|프라페|요거트|밀크티|티(?![가-힣])|차(?![가-힣])|캐모마일|얼그레이|우롱|루이보스|진저|유자|민트|소다|아포가토|아이스크림|맥주|생맥|필스너|에일|라거|하이볼|와인|생수|드립백|원두|샷|시럽|디카페인|연하게|진하게|less|no ice|tea|coffee|beer/i;

/** 상품명으로 분류 짐작 — 분류표에 없는 새 상품. 틀릴 수 있어 A 화면에서 확인받음 */
export function guessSector(name: string): Sector {
  const n = name || "";
  if (/종이쿠폰|상품권|교환권|금액권/.test(n)) return "기타";
  if (KITCHEN.test(n)) return "키친";
  if (BAKERY.test(n)) return "베이커리";
  if (BARISTA.test(n)) return "바리스타";
  return "기타";
}

export type KidsKind = "입장발행" | "현장결제" | "이벤트무료" | "추가인원" | "기타";
export const KIDS_KINDS: KidsKind[] = ["입장발행", "현장결제", "이벤트무료", "추가인원", "기타"];

const TICKET = /입장|이용|자유|시간권|퇴장|네이버/;
const EXTRA = /추가/;
const EVENT = /쿠폰|이벤트|무료/;

/**
 * 아스타나키즈 상품 한 줄의 종류 (2026-10-02 사장님이 정한 기준, 실제 자료 10/1 · 9/27)
 * - '인원추가 [평일만]' 처럼 이름에 '추가' → 추가 인원 (기타 매출)
 * - 0원 쿠폰·이벤트 입장 ('[평일] 한가위 무제한 쿠폰', 분류 서비스.쿠폰) → 이벤트 무료입장 (팀 수, 입장료 없음)
 * - 돈을 받은 입장권 ('[평일] 1시간 50분 입장권' 12,000 · '[휴일] …' 14,000) → 현장 결제
 * - 0원 입장 발행 ('[평일] 무제한 이용' · '야간자유입장권' · '3시 20분 퇴장 [1시30분 입장]' …) → 입장 발행
 *   발행은 네이버 예약과 현장 결제 손님 모두에게 나감 → 네이버를 A 에서 넣지 않은 날은 발행 − 현장 으로 추정
 * - 그 밖 (간식·음료 등) → 기타
 */
export function kidsKind(line: Pick<SaleLine, "name" | "gross" | "net"> & { cat1?: string }): KidsKind {
  const name = line.name || "";
  const free = line.gross === 0 && line.net === 0;
  if (EXTRA.test(name)) return "추가인원";
  if (free && (EVENT.test(name) || /쿠폰/.test(line.cat1 || ""))) return "이벤트무료";
  if (!TICKET.test(name)) return "기타";
  return free ? "입장발행" : "현장결제";
}
