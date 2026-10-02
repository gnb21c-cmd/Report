/* ============================================================
   팀 나누기 · 키즈 입장 구분 (아스타나 packages/domain/src/report.ts posTeam 을 가져와 다듬음)
   - 카페 POS: OK포스 대분류(바리스타 · 베이커리 · 키친 …)가 있으면 그대로, 없으면 상품명 낱말로
   - 키즈 POS: 모두 '키즈' 팀. 입장권은 현장(돈 받음) · 네이버(0원 코드로 발행) · 추가 인원으로 나눔
   실제 상품명을 처음 받으면 낱말 목록을 맞춥니다 (docs/PLAN.md).
   ============================================================ */
import type { PosId, SaleLine } from "./types";

export type Team = "바리스타" | "베이커리" | "키친" | "키즈" | "기타";
export const TEAMS: Team[] = ["바리스타", "베이커리", "키친", "키즈", "기타"];

const CAFE_TEAMS: [Team, RegExp][] = [
  ["바리스타", /바리스타|음료|커피|라떼|아메리카노|에스프레소|에이드|스무디|주스|프라페|티\b|차\b|tea|coffee/i],
  ["베이커리", /베이커리|빵|케이크|디저트|쿠키|스콘|크로플|크루아상|마카롱|파이|타르트|휘낭시에|마들렌/],
  ["키친", /키친|식사|브런치|파스타|샐러드|플레이트|토스트|리조또|버거|스테이크|피자|덮밥/],
];

/** 한 줄이 어느 팀 매출인지 */
export function teamOf(pos: PosId, line: Pick<SaleLine, "cat1" | "name">): Team {
  if (pos === "kids") return "키즈";
  const cat = (line.cat1 || "").trim();
  // 대분류가 팀 이름 그대로면 그것을 씀
  for (const [team] of CAFE_TEAMS) if (cat === team) return team;
  for (const [team, re] of CAFE_TEAMS) if (re.test(cat)) return team;
  for (const [team, re] of CAFE_TEAMS) if (re.test(line.name || "")) return team;
  return "기타";
}

export type KidsKind = "현장입장" | "네이버입장" | "추가인원" | "기타";

const TICKET = /입장|이용권|자유|시간권|네이버/;
const EXTRA = /추가/;

/**
 * 키즈 POS 한 줄의 종류
 * - 이름에 '추가' → 추가 인원
 * - 입장권 이름 + 0원 → 네이버 예약 입장 (입장권 발행용 0원 코드)
 * - 입장권 이름 + 돈 받음 → 현장 결제 입장
 * - 그 밖 (간식·음료 등) → 기타
 */
export function kidsKind(line: Pick<SaleLine, "name" | "gross" | "net">): KidsKind {
  const name = line.name || "";
  if (EXTRA.test(name)) return "추가인원";
  if (!TICKET.test(name)) return "기타";
  return line.gross === 0 && line.net === 0 ? "네이버입장" : "현장입장";
}
