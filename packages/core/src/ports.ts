/* ============================================================
   통합 Ver.2.0 — 시스템 이름과 자료 통로(포트) 한 표
   - 시스템끼리는 서로의 코드를 부르지 않고, 여기 적힌 통로(Firebase 문서 · 그 PC 안의 파일)로만 자료를 주고받음
   - 통로마다 쓰는 쪽 · 읽는 쪽 · 공개 범위 · 개인정보 · 원가 여부 · 하루 읽기/쓰기 어림을 적고,
     packages/core/test/ports.test.ts 가 충돌(한 칸을 두 곳이 씀) · 개인정보 유출 · 무료 한도 · 보안 규칙 자리를 검사함
   - 경로는 boards/{매장 열쇠}/ 아래 (floor 만 맨 위). local: 로 시작하면 클라우드에 올리지 않는 그 PC 안의 파일
   새 통로를 만들거나 바꾸면 이 표를 먼저 고치고 시험을 돌린다
   ============================================================ */

export type SystemId = "A" | "B" | "C" | "D" | "D-1" | "E" | "E-1" | "F" | "GH" | "AGENT";

export interface SystemInfo {
  name: string;
  /** 어디서 도는지 */
  where: string;
  /** 코드 위치 */
  code: string;
  status: "운영" | "구축 중" | "계획";
}

export const SYSTEMS: Record<SystemId, SystemInfo> = {
  A: {
    name: "기초 데이터 입력창",
    where: "직원 PC 브라우저 (…/a/)",
    code: "Report apps/entry",
    status: "운영",
  },
  B: { name: "일일 영업 보고 app", where: "폰 (…/b/{열쇠}/)", code: "Report apps/view", status: "운영" },
  C: {
    name: "아스타나키즈 통합데스크",
    where: "키즈 입구 POS (설치형)",
    code: "astanakiz apps/desk (Electron) · prototype/desk.html",
    status: "구축 중",
  },
  D: { name: "베이커리 결정플랫폼", where: "매니저 폰 (…/d/)", code: "Report apps/bakery", status: "운영" },
  "D-1": {
    name: "베이커리 생산지시서",
    where: "현장 태블릿 (…/d1/{키 번호}/)",
    code: "Report apps/bakery",
    status: "운영",
  },
  E: {
    name: "재고추적관리 시스템",
    where: "GitHub 예약 작업 stock.yml (매일 10:40 계산 · 30분마다 푸시) — Firebase 만",
    code: "Report packages/core/src/stock.ts (astana 재고 계산 이식) · apps/collector/src/stock.ts",
    status: "구축 중",
  },
  "E-1": {
    name: "재고 관리 및 설정",
    where: "관리자 PC (…/e1/) · 창고 입구 태블릿 (…/e1/#in)",
    code: "Report apps/stock",
    status: "구축 중",
  },
  F: { name: "발주app", where: "관리자 폰 (…/f/ 설치형 웹앱, 푸시 알림)", code: "Report apps/stock", status: "구축 중" },
  GH: {
    name: "자동 수집 (GitHub 예약 작업)",
    where: "GitHub · POS 메인 PC 실행기 nice-pos",
    code: "Report apps/collector · apps/weather · .github/workflows",
    status: "운영",
  },
  AGENT: {
    name: "POS 상주 전송기 (마감 전 영업정보)",
    where: "카페 POS 메인 · 키즈 POS 에 상주",
    code: "계획",
    status: "계획",
  },
};

/** Firebase 무료(Spark) 하루 한도 · 저장 한도 */
export const SPARK = {
  readsPerDay: 50_000,
  writesPerDay: 20_000,
  deletesPerDay: 20_000,
  storedGiB: 1,
} as const;

export interface PortWriter {
  system: SystemId;
  /** 쓰는 칸 */
  fields: string[];
  /** 어떻게 쓰는지 — 무료 판이라 functions(Cloud Functions)는 없음 */
  via: "browser" | "actions" | "agent" | "local";
}

export interface Port {
  id: string;
  /** boards/{열쇠}/ 아래 경로 (local: 이면 그 PC 안) */
  path: string;
  writers: PortWriter[];
  readers: SystemId[];
  access: "public-read" | "sender" | "admin" | "local-only";
  /** 이름 · 전화번호 등 개인정보 */
  personal?: boolean;
  /** 공급 단가 · 원가 (매장 밖에 보이면 안 됨) */
  cost?: boolean;
  /** 두 시스템이 같은 칸을 쓸 때 누가 이기는지 */
  merge?: string;
  status: "운영" | "구축 중" | "계획";
  /** 아직 보안 규칙에 자리가 없으면 만들 규칙 */
  newRule?: string;
  /** 하루 어림 (폰 B 10대 기준) */
  writesPerDay: number;
  readsPerDay: number;
  note?: string;
}

export const PORTS: Port[] = [
  /* ---------- 운영 중 (Ver.1) ---------- */
  {
    id: "report.store",
    path: "reports/{날짜}",
    writers: [
      { system: "A", fields: ["cafe", "kids"], via: "browser" },
      { system: "GH", fields: ["cafe", "kids"], via: "actions" },
    ],
    readers: ["B", "D", "E", "GH"],
    access: "public-read",
    merge: "사람(A)이 올린 칸이 이김 — 자동 수집은 비었거나 자동이 넣은 칸만 다시 씀",
    status: "운영",
    writesPerDay: 10,
    readsPerDay: 600,
  },
  {
    id: "report.naver",
    path: "reports/{날짜}",
    writers: [
      { system: "A", fields: ["naver"], via: "browser" },
      { system: "GH", fields: ["naver"], via: "actions" },
    ],
    readers: ["B", "D", "GH"],
    access: "public-read",
    merge: "사람(A)이 이김 (naverAutoWritable)",
    status: "운영",
    writesPerDay: 5,
    readsPerDay: 0,
    note: "읽기는 report.store 에 포함 (같은 문서)",
  },
  {
    id: "report.cash",
    path: "reports/{날짜}",
    writers: [{ system: "A", fields: ["cash"], via: "browser" }],
    readers: ["B"],
    access: "public-read",
    status: "운영",
    writesPerDay: 2,
    readsPerDay: 0,
    note: "은행 입출 · 현금은 API 가 없어 사람이 A 에 적음 — Ver.2 에서도 그대로",
  },
  {
    id: "report.extra",
    path: "reports/{날짜}",
    writers: [
      { system: "A", fields: ["extra"], via: "browser" },
      { system: "GH", fields: ["extra"], via: "actions" },
    ],
    readers: ["B"],
    access: "public-read",
    merge: "사람(A)이 이김 (autoExtraKinds)",
    status: "운영",
    writesPerDay: 8,
    readsPerDay: 0,
  },
  {
    id: "lines",
    path: "lines/{날짜}_{매장}",
    writers: [
      { system: "A", fields: ["lines"], via: "browser" },
      { system: "GH", fields: ["lines"], via: "actions" },
    ],
    readers: ["GH", "E"],
    access: "sender",
    merge: "그날 보고 칸을 쓴 쪽과 같이 씀",
    status: "운영",
    writesPerDay: 4,
    readsPerDay: 60,
    note: "영수증 줄 (상품명 · 수량 · 금액) — E 가 상품별 판매 수량을 여기서 읽음",
  },
  {
    id: "products",
    path: "config/products",
    writers: [{ system: "A", fields: ["table"], via: "browser" }],
    readers: ["GH", "E-1"],
    access: "sender",
    status: "운영",
    writesPerDay: 2,
    readsPerDay: 30,
    note: "B 가 쓰는 상품명 분류표 — E-1 레시피 화면이 판매 상품 목록으로 씀",
  },
  {
    id: "weather",
    path: "weather/{날짜}",
    writers: [{ system: "GH", fields: ["*"], via: "actions" }],
    readers: ["B", "D", "GH"],
    access: "public-read",
    status: "운영",
    writesPerDay: 48,
    readsPerDay: 300,
  },
  {
    id: "settings",
    path: "settings/main",
    writers: [{ system: "A", fields: ["json"], via: "browser" }],
    readers: ["B", "D", "GH"],
    access: "public-read",
    status: "운영",
    writesPerDay: 1,
    readsPerDay: 100,
  },
  {
    id: "bakery.plan",
    path: "plans/{날짜}",
    writers: [{ system: "GH", fields: ["json"], via: "actions" }],
    readers: ["D", "B"],
    access: "public-read",
    status: "운영",
    writesPerDay: 8,
    readsPerDay: 200,
  },
  {
    id: "bakery.order",
    path: "orders/{날짜}",
    writers: [{ system: "D", fields: ["json"], via: "browser" }],
    readers: ["B", "GH", "E"],
    access: "public-read",
    status: "운영",
    writesPerDay: 5,
    readsPerDay: 200,
    note: "D 가 확정한 생산량 — B 의 오늘(마감 전 영업정보) 베이커리 칸 · E 의 베이커리 원재료 차감",
  },
  {
    id: "bakery.floor",
    path: "floor/{키 번호}/days/{날짜}",
    writers: [{ system: "D", fields: ["json"], via: "browser" }],
    readers: ["D-1"],
    access: "public-read",
    status: "운영",
    writesPerDay: 10,
    readsPerDay: 300,
    note: "D-1 은 수량 · 상태 복사본만",
  },
  {
    id: "naver.ask",
    path: "config/naverAsk",
    writers: [{ system: "A", fields: ["json"], via: "browser" }],
    readers: ["GH"],
    access: "sender",
    status: "운영",
    writesPerDay: 2,
    readsPerDay: 0,
  },
  {
    id: "naver.result",
    path: "config/naverResult",
    writers: [{ system: "GH", fields: ["json"], via: "actions" }],
    readers: ["A"],
    access: "sender",
    status: "운영",
    writesPerDay: 4,
    readsPerDay: 400,
    note: "읽기는 naver-ask.yml 5분마다 · A",
  },

  /* ---------- Ver.2 새 통로 ---------- */
  {
    id: "live.cafe",
    path: "live/{날짜}",
    writers: [{ system: "AGENT", fields: ["cafe", "kids"], via: "agent" }],
    readers: ["B"],
    access: "public-read",
    status: "계획",
    newRule: "live/{날짜}: 읽기 누구나(B) · 쓰기 senders (전송기 전용 계정), 칸은 cafe · kids · desk · at 만",
    writesPerDay: 72,
    readsPerDay: 1500,
    note: "오늘 카페 · 키즈 영수증 — POS 메인 전송기가 10분마다(10~22시) 확정과 같은 계산(buildStorePart)으로. B 는 열려 있는 동안 5분마다 바뀐 것만. 검사 live.ts checkLivePiece",
  },
  {
    id: "live.desk",
    path: "live/{날짜}",
    writers: [{ system: "C", fields: ["desk"], via: "agent" }],
    readers: ["B"],
    access: "public-read",
    status: "계획",
    newRule: "live.cafe 와 같은 문서 · 다른 칸",
    writesPerDay: 72,
    readsPerDay: 0,
    note: "C 가 10분마다 그날 desk-state 를 desk.ts deskFromState 로 숫자만(30분 칸별 네이버 입장 · 신규 · 현장) 만들어 보냄 — 검사 live.ts checkDeskLive",
  },
  {
    id: "kids.backup",
    path: "local:키즈 POS 데이터 디스크 (설치 폴더 밖)",
    writers: [{ system: "C", fields: ["*"], via: "local" }],
    readers: ["C"],
    access: "local-only",
    personal: true,
    status: "계획",
    writesPerDay: 0,
    readsPerDay: 0,
    note: "지금 C 는 %APPDATA%\\아스타나키즈 입장 데스크\\desk-state\\{날짜}.json (앱을 다시 깔아도 남음). 디스크 · 윈도 재설치에도 남게 다른 디스크 폴더에 날마다 복사본",
  },
  {
    id: "kids.customers",
    path: "local:고객 대장 엑셀 (비밀번호 보호)",
    writers: [
      {
        system: "C",
        fields: ["성명", "전화번호", "방문횟수", "평균 방문 간격일", "블랙컨슈머"],
        via: "local",
      },
    ],
    readers: ["C"],
    access: "local-only",
    personal: true,
    status: "계획",
    writesPerDay: 0,
    readsPerDay: 0,
    note: "책임자가 설정에 넣은 비밀번호로 잠근 xlsx. 클라우드 · 저장소 · 실행 기록에 올리지 않음",
  },
  {
    id: "kids.blacklist",
    path: "local:블랙컨슈머 목록",
    writers: [{ system: "C", fields: ["체크"], via: "local" }],
    readers: ["C"],
    access: "local-only",
    personal: true,
    status: "계획",
    writesPerDay: 0,
    readsPerDay: 0,
    note: "손님 카드 체크박스 → 이 목록. 자동 취소(설정에서 켜고 끔)도 C 가 그 PC 에서",
  },
  {
    id: "inv.master",
    path: "inv/master",
    writers: [{ system: "E-1", fields: ["suppliers", "materials", "recipes"], via: "browser" }],
    readers: ["E", "F", "E-1"],
    access: "sender",
    cost: true,
    status: "계획",
    newRule: "inv/{doc}: 읽기 · 쓰기 senders, master 는 운영자(admin)만 씀",
    writesPerDay: 20,
    readsPerDay: 100,
    note: "공급처 · 원재료(공급기준 · 기준단위 · 공급단가 · AI 안전재고 · 관리자 안전재고) · 레시피를 JSON 몇 문서로 (읽기 아끼려고)",
  },
  {
    id: "inv.receive",
    path: "invIn/{날짜}",
    writers: [{ system: "E-1", fields: ["rows"], via: "browser" }],
    readers: ["E"],
    access: "sender",
    cost: true,
    status: "계획",
    newRule: "invIn/{날짜}: senders 읽기 · 쓰기 (창고 입구 계정)",
    writesPerDay: 10,
    readsPerDay: 30,
    note: "창고 입구에서 입고만 등록",
  },
  {
    id: "inv.count",
    path: "invCount/{날짜}",
    writers: [{ system: "E-1", fields: ["rows"], via: "browser" }],
    readers: ["E"],
    access: "sender",
    cost: true,
    status: "계획",
    newRule: "invCount/{날짜}: senders",
    writesPerDay: 2,
    readsPerDay: 10,
    note: "실셈 — 최초 재고 · 이후 확인. − 면 레시피 재검증 · 추가 발주, + 면 절약 코드로 자산 다시 올림",
  },
  {
    id: "inv.ledger",
    path: "inv/ledger",
    writers: [{ system: "E", fields: ["json"], via: "actions" }],
    readers: ["E-1", "F"],
    access: "sender",
    cost: true,
    status: "계획",
    newRule: "inv/{doc}: ledger 는 GitHub 계정이 씀",
    writesPerDay: 4,
    readsPerDay: 100,
    note: "매일 아침(어제 판매 · 생산 확정 뒤) 레시피 × 판매(베이커리는 D 생산량)로 줄인 현재고 · 소비 속도 · 안전재고",
  },
  {
    id: "inv.use",
    path: "invUse/{YYYY-MM}",
    writers: [{ system: "E", fields: ["json"], via: "actions" }],
    readers: ["E"],
    access: "sender",
    status: "구축 중",
    writesPerDay: 2,
    readsPerDay: 13,
    note: "날짜별 레시피 사용량을 달마다 쌓아 둠 — E 가 새 날과 최근 3일만 다시 셈 (지난 영수증을 매일 다시 읽지 않게)",
  },
  {
    id: "order.alert",
    path: "alerts/{번호}",
    writers: [
      { system: "E", fields: ["kind", "title", "lines", "at"], via: "actions" },
      { system: "E-1", fields: ["kind", "title", "lines", "at"], via: "browser" },
      { system: "F", fields: ["readAt"], via: "browser" },
    ],
    readers: ["F"],
    merge: "알림 문서 이름이 달라 겹치지 않음 — E: order-날짜 · negative-날짜, E-1: count-날짜 (실셈 확정)",
    access: "sender",
    cost: true,
    status: "계획",
    newRule: "alerts/{id}: senders 읽기, E 가 만들고 F 는 readAt 만 바꿈",
    writesPerDay: 20,
    readsPerDay: 200,
    note: "안전재고 아래 · 재고 − (레시피 재검증 + 추가 발주). 푸시는 E 작업이 FCM 으로 (무료). F 는 안 읽은 수를 앱 아이콘 숫자로",
  },
  {
    id: "push.tokens",
    path: "pushTokens/{이메일}",
    writers: [{ system: "F", fields: ["token"], via: "browser" }],
    readers: ["E"],
    access: "sender",
    status: "계획",
    newRule: "pushTokens/{em}: 자기 이메일 문서만 씀",
    writesPerDay: 2,
    readsPerDay: 10,
  },
];

/** 하루 읽기 · 쓰기 합 */
export function portBudget(ports: Port[]): { reads: number; writes: number } {
  return ports.reduce((a, p) => ({ reads: a.reads + p.readsPerDay, writes: a.writes + p.writesPerDay }), {
    reads: 0,
    writes: 0,
  });
}

/* ---------- 마감 전 영업정보 — 오늘(현재일)은 다음 날 확정 ---------- */
export const LIVE_LABEL = "마감 전 영업정보";

/** 그 날짜가 확정(어제까지) · 마감 전(오늘) · 앞날 중 어디인지 */
export function dayStage(date: string, today: string): "closed" | "live" | "future" {
  return date < today ? "closed" : date === today ? "live" : "future";
}
