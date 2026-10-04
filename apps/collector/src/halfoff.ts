/* 베이커리 50% 할인 개수 채우기 — 이미 올린 날(영수증별)의 정리한 영수증 줄(lines)로 다시 셈 (OKPOS 를 다시 받지 않음)
   규칙: packages/core/src/rules.ts isHalfOff (20:25 뒤 · 할인 40% 이상 · 베이커리 상품)
   카페 칸의 bakeryHalf · bakeryHalfBy 만 더함 (올린 사람 · 다른 값은 그대로)
   HALF_FROM ~ HALF_TO · 공개 저장소라 기록에는 날짜 · 처리 여부만 (개수 없음) */
import { dayRange, isHalfOff } from "@report/core";
import { fbLogin, readCafePiece, readLines, writeCafePiece } from "./firebase";

const env = (k: string) => process.env[k] || "";

async function main() {
  const from = env("HALF_FROM") || "2026-07-02";
  const to = env("HALF_TO") || new Date(Date.now() + 9 * 3600e3 - 86400e3).toISOString().slice(0, 10);
  const fb = await fbLogin({ apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY"), email: env("WEATHER_EMAIL"), password: env("WEATHER_PASSWORD") });
  let done = 0;
  const skipped: string[] = [];
  for (const date of dayRange(from, to)) {
    const piece = await readCafePiece(fb, date);
    const lines = await readLines(fb, date, "cafe");
    if (!piece?.p || piece.p.basis !== "receipt" || !lines) {
      skipped.push(date);
      continue;
    }
    const sector = new Map<string, string>((piece.p.products || []).map((t: any[]) => [String(t[0]), String(t[1])]));
    const by: Record<string, number> = {};
    let total = 0;
    for (const l of lines) {
      if (sector.get(l.name) !== "베이커리" || !isHalfOff(l)) continue;
      by[l.name] = (by[l.name] || 0) + l.qty;
      total += l.qty;
    }
    await writeCafePiece(fb, date, { ...piece, p: { ...piece.p, bakeryHalf: total, bakeryHalfBy: by } });
    done++;
  }
  console.log(`${from} ~ ${to}: ${done}일 채움${skipped.length ? ` · 영수증 줄이 없어 건너뜀 ${skipped.length}일 (${skipped.join(", ")})` : ""}`);
}

main().catch((e) => {
  console.log("멈춤:", String((e as Error).message).slice(0, 200));
  process.exit(1);
});
