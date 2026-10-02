/* ============================================================
   자료 모양 — A(보내는 프로그램)와 B(보고 앱)가 같은 모양을 씀
   A 의 apps/sender/src/report_sender/normalize.py 와 칸 이름이 같아야 합니다.
   ============================================================ */

/** 어느 POS 에서 온 자료인지 — 카페 메인 POS(서브 결제 포함) · 키즈 POS */
export type PosId = "cafe" | "kids";
export const POS_IDS: PosId[] = ["cafe", "kids"];
export const POS_LABEL: Record<PosId, string> = { cafe: "카페", kids: "키즈" };

/** POS 하루 × 상품 한 줄 (반품·취소는 음수 그대로) */
export interface SaleLine {
  code: string;
  name: string;
  cat1: string;
  cat2: string;
  cat3: string;
  qty: number;
  /** 총매출액 (원) */
  gross: number;
  /** 총할인액 (원) */
  discount: number;
  /** 실매출액 (원) */
  net: number;
}

/** A 가 보내는 한 묶음 = 한 POS 의 하루치 전체. 같은 POS·날짜가 다시 오면 통째로 바뀜 */
export interface DayBatch {
  pos: PosId;
  /** 매장 날짜 YYYY-MM-DD */
  date: string;
  rows: SaleLine[];
  /** 보낸 시각 (ISO) — 같은 POS·날짜가 여러 번 오면 늦은 것을 씀 */
  sentAt: string;
  /** 어떻게 읽었는지 (예: "엑셀:상품별.xls", "DB") */
  source?: string;
}

/** 보고 계산에 쓰는 한 줄 (묶음을 펼친 것) */
export interface Sale extends SaleLine {
  pos: PosId;
  date: string;
}
