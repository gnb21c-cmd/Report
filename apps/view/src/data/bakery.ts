/* ============================================================
   베이커리 작업지시를 보고 앱(B)에서 읽기 — 그날 계획(plans) · 매니저 확정(orders)
   D(매니저)가 확정한 그날 수량 = 그날 생산 기록 (생산날 아침 6시부터는 못 바꿈)
   → 다음 날 아침 영수증이 들어오면 베이커리 상세에서 빵별 생산 · 정가판매 · 할인판매 · 폐기 (core dayResult · breadTotals)
   체험판은 작업지시 문서가 없으므로 그날(없으면 마지막 날) 판매로 가짜 수량을 만듦
   ============================================================ */
import { useEffect, useState } from "react";
import { NOT_BREAD, type Board, type OrderDoc, type PlanDoc } from "@report/core";
import { bakeryDay } from "./firebase";

export type BakeryDoc = { plan: PlanDoc | null; order: OrderDoc | null };

/** 체험판: 판매 개수 + 조금 (빵마다 다르게) → 최종안 */
function demoDoc(board: Board, date: string): BakeryDoc | null {
  const from = board.report(date)?.cafe ? date : board.latest();
  if (!from) return null;
  const items = board
    .products(from, from, "베이커리")
    .filter((p) => !NOT_BREAD.has(p.name) && p.qty > 0)
    .map((p, i) => ({ name: p.name, qty: p.qty + (i % 3) + 1 }));
  if (!items.length) return null;
  const total = items.reduce((a, i) => a + i.qty, 0);
  return { plan: { v: 2, date, final: { madeOn: date, asOf: date, kind: "평일", visitors: 0, weather: "", total, items } as any }, order: null };
}

/** 그날 작업지시 문서 — undefined = 받는 중, null = 없음 */
export function useBakeryDoc(board: Board, date: string): BakeryDoc | null | undefined {
  const [doc, setDoc] = useState<BakeryDoc | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setDoc(undefined);
    if (!date) {
      setDoc(null);
      return;
    }
    if (__DEMO__) {
      setDoc(demoDoc(board, date));
      return;
    }
    void bakeryDay(date).then((x) => {
      if (live) setDoc(x && (x.plan || x.order) ? x : null);
    });
    return () => {
      live = false;
    };
  }, [board, date]);
  return doc;
}
