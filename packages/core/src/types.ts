/* ============================================================
   자료 모양 — A(입력 화면)가 계산해 C(사무실 PC)로 보내고, B(보고 앱)가 읽는 모양
   C(apps/office/src/report_office/store.py)는 이 모양을 그대로 보관·합칩니다.
   ============================================================ */

/** 매장 — 카페아스타나(카페 POS: 메인 01 · 서브 02) · 아스타나키즈(키즈 POS) */
export type StoreId = "cafe" | "kids";
/** 예전 이름 (POS = 매장) */
export type PosId = StoreId;
export const STORE_IDS: StoreId[] = ["cafe", "kids"];
export const POS_IDS = STORE_IDS;
export const STORE_LABEL: Record<StoreId, string> = { cafe: "카페아스타나", kids: "아스타나키즈" };
export const POS_LABEL: Record<StoreId, string> = { cafe: "카페", kids: "키즈" };

/** 상품별(일자별) 엑셀 한 줄 — 지난 자료 넣기에서 씀 (반품·취소는 음수 그대로) */
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
