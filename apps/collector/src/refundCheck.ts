/* 반품 확인 (손으로 실행) — 그날 마감 전(live) · 확정(reports) 카페 자료에서 반품 짝 맞추기 결과와 개수가 마이너스인 베이커리 상품
   보고 앱 베이커리에 '할인판매 −2개' 가 보인 까닭 찾기 (2026-10-13). 공개 저장소라 기록에는 개수만 (상품 이름 · 금액 없음)
   CHECK_DATE=YYYY-MM-DD (비우면 오늘) */
import { asOrder, asPlan, nowKst, orderRows, type StorePart } from "@report/core";

const env = (k: string) => process.env[k] || "";

async function doc(path: string): Promise<Record<string, any> | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${env("FIREBASE_PROJECT_ID")}/databases/(default)/documents/boards/${env("REPORT_BOARD_KEY")}/${path}?key=${env("FIREBASE_API_KEY")}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`클라우드 읽기 오류 ${res.status}`);
  const j = await res.json();
  return Object.fromEntries(Object.entries(j.fields || {}).map(([k, v]: [string, any]) => [k, v.stringValue ?? v.timestampValue ?? null]));
}

async function main() {
  const date = env("CHECK_DATE") || nowKst().date;
  const planDoc = await doc(`plans/${date}`);
  const orderDoc = await doc(`orders/${date}`);
  const names = new Set(orderRows(asPlan(planDoc?.json ? JSON.parse(planDoc.json) : null), asOrder(orderDoc?.json ? JSON.parse(orderDoc.json) : null), { date: "9999-12-31", time: "00:00" }).map((r) => r.name));
  console.log(`${date} · 작업지시 빵 ${names.size}종`);
  for (const [label, path, field] of [
    ["마감 전(live)", `live/${date}`, "cafe"],
    ["확정(reports)", `reports/${date}`, "cafe"],
  ] as const) {
    const d = await doc(path);
    const raw = d?.[field];
    if (!raw) {
      console.log(`${label}: 카페 자료 없음`);
      continue;
    }
    const x = JSON.parse(raw);
    const part: StorePart = x.p || x;
    const bread = part.products.filter((p) => p[1] === "베이커리");
    const neg = bread.filter((p) => p[2] < 0);
    const zero = bread.filter((p) => p[2] === 0);
    console.log(
      `${label}: 반품 영수증 ${part.refunds.receipts}장 · 반품 줄 ${part.refunds.lines}개 · 짝 못 찾은 반품 줄 ${part.refunds.unmatched}개 | 베이커리 상품 ${bread.length}종 중 개수 마이너스 ${neg.length}종 (작업지시에 있음 ${neg.filter((p) => names.has(p[0])).length} · 없음 ${neg.filter((p) => !names.has(p[0])).length}) · 개수 0 ${zero.length}종 · 마이너스 합 ${neg.reduce((a, p) => a + p[2], 0)}개 · 할인 표시 상품 ${Object.keys(part.bakeryHalfBy || {}).length}종`,
    );
  }
}

main().catch((e) => {
  console.log("멈춤:", String((e as Error).message).replace(/\d{4,}/g, "#").slice(0, 200));
  process.exit(1);
});
