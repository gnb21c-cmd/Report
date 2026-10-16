/* 빵별 마지막 판매 시각(매진 시각) 채우기 — 이미 올린 날(영수증별)의 정리한 영수증 줄(lines)로 다시 셈 (OKPOS 를 다시 받지 않음)
   매진 목표 20:40 (2026-10-16 사장님) 판단용 — packages/core/src/bakery.ts stepOf · part.ts breadLastTimes
   카페 칸의 bakeryLastBy 만 더함 (올린 사람 · 매출 · 할인 개수 등 다른 값은 그대로)
   SELLOUT_FROM ~ SELLOUT_TO · SELLOUT_DRY=1 이면 쓰지 않음 · 공개 저장소라 기록에는 날짜 수 · 빵 종류 수만 (시각 · 개수 없음) */
import { breadLastTimes, dayRange } from "@report/core";
import { fbLogin, readCafePiece, readLines, writeCafePiece } from "./firebase";

const env = (k: string) => process.env[k] || "";

async function main() {
  const from = env("SELLOUT_FROM") || "2026-10-01";
  const to = env("SELLOUT_TO") || new Date(Date.now() + 9 * 3600e3 - 86400e3).toISOString().slice(0, 10);
  const dry = env("SELLOUT_DRY") === "1";
  const fb = await fbLogin({ apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY"), email: env("WEATHER_EMAIL"), password: env("WEATHER_PASSWORD") });
  let done = 0;
  let same = 0;
  let kinds = 0;
  const skipped: string[] = [];
  for (const date of dayRange(from, to)) {
    const piece = await readCafePiece(fb, date);
    const lines = await readLines(fb, date, "cafe");
    if (!piece?.p || piece.p.basis !== "receipt" || !lines) {
      skipped.push(date);
      continue;
    }
    // 그날 베이커리로 셈한 상품 (카페 칸의 상품 목록 — 옮김 규칙까지 반영된 분류)
    const bread = new Set<string>((piece.p.products || []).filter((t: any[]) => t[1] === "베이커리").map((t: any[]) => String(t[0])));
    const by = breadLastTimes(lines, (n) => bread.has(n));
    kinds += Object.keys(by).length;
    if (JSON.stringify(piece.p.bakeryLastBy || null) === JSON.stringify(by)) {
      same++;
      continue;
    }
    if (!dry) await writeCafePiece(fb, date, { ...piece, p: { ...piece.p, bakeryLastBy: by } });
    done++;
  }
  console.log(`${from} ~ ${to}: ${dry ? "확인만 — 채울 날" : "채움"} ${done}일 · 이미 같음 ${same}일 · 빵 종류 합 ${kinds}${skipped.length ? ` · 영수증 줄이 없어 건너뜀 ${skipped.length}일 (${skipped.join(", ")})` : ""}`);
}

main().catch((e) => {
  console.log("멈춤:", String((e as Error).message).slice(0, 200));
  process.exit(1);
});
