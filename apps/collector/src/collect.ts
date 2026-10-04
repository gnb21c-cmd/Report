/* ============================================================
   POS 자동 수집 — 매일 밤 GitHub 가 OKPOS 점주 웹에서 카페 · 키즈 '영수증별 매출 상세현황' 엑셀을 받아
   입력 화면과 똑같이 계산해 클라우드(cafe · kids 칸)에 올림. 직원 PC 가 켜져 있을 필요 없음
   - 날짜: COLLECT_DATE (없으면 오늘, 한국 시간)
   - COLLECT_DRY=1 이면 올리지 않고 확인만
   - 사람이 입력 화면으로 이미 올린 칸은 덮지 않음 (사람이 나중에 올리면 사람 것이 이김)
   - 엑셀 합계 줄과 계산이 다르면 올리지 않고 실패로 끝냄 (GitHub 가 알림 메일을 보냄)
   공개 저장소라 기록(로그)에는 줄 수 · 일치 여부만 남김 (매출 숫자 · 매장 이름 없음)
   ============================================================ */
import { buildStorePart, parseReceiptSheet, partCheck, sectorLookup } from "@report/core";
import { fbLogin, readBy, readProducts, writeStores } from "./firebase";
import { mask, Okpos, readRows, say, type Store } from "./okpos";

export const AUTO_BY = "자동 수집 (OKPOS)";
const STORES: Store[] = ["cafe", "kids"];
const LABEL: Record<Store, string> = { cafe: "카페", kids: "키즈" };

const env = (k: string) => process.env[k] || "";
const todayKst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

async function main() {
  const date = env("COLLECT_DATE") || todayKst();
  const dry = env("COLLECT_DRY") === "1";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`날짜 모양이 이상함: ${date}`);
  if (!env("OKPOS_ID") || !env("OKPOS_PW")) throw new Error("OKPOS_ID · OKPOS_PW 가 없습니다 (GitHub Secrets)");
  say(`날짜 ${date}${dry ? " · 확인만 (올리지 않음)" : ""}`);

  const fb = dry
    ? null
    : await fbLogin({ apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY"), email: env("WEATHER_EMAIL"), password: env("WEATHER_PASSWORD") });
  const table = fb ? await readProducts(fb) : {};
  const have = fb ? await readBy(fb, date) : {};

  const ok = await Okpos.open();
  const out: Parameters<typeof writeStores>[3] = [];
  const problems: string[] = [];
  try {
    await ok.login(env("OKPOS_ID"), env("OKPOS_PW"));
    const mf = await ok.openReceipts();
    for (const store of STORES) {
      if (have[store] && have[store] !== AUTO_BY) {
        say(`${LABEL[store]}: 사람이 이미 올린 칸이라 건너뜀`);
        continue;
      }
      try {
        await ok.pickShop(mf, store);
        const d = await ok.download(mf, date);
        const sheet = parseReceiptSheet(readRows(d.buf));
        if (sheet.from && (sheet.from !== date || sheet.to !== date)) throw new Error(`엑셀 조회일자가 ${sheet.from} ~ ${sheet.to} (요청 ${date})`);
        const file = `OKPOS 자동 ${date} ${LABEL[store]}.xls`;
        const r = buildStorePart({ store, date, file, sheet, sectorOf: sectorLookup(table) });
        const check = partCheck(r.part);
        say(`${LABEL[store]}: 화면 ${d.rows}줄 · 판매 줄 ${sheet.lines.length}개 · 반품 짝 ${r.matches.length}건 · 짝 없는 반품 ${r.unmatched.length}건 · ${check.ok ? "엑셀 합계와 일치" : "엑셀 합계와 다름"}`);
        if (!check.ok) throw new Error("엑셀 합계와 계산이 다름 — 입력 화면에서 직접 확인해 주세요");
        out.push({ kind: store, part: r.part, file, lines: r.lines });
      } catch (e) {
        problems.push(`${LABEL[store]}: ${mask((e as Error).message)}`);
      }
    }
  } finally {
    await ok.close();
  }
  if (fb && out.length) {
    await writeStores(fb, AUTO_BY, date, out);
    say(`클라우드에 올림: ${out.map((o) => LABEL[o.kind as Store]).join(" · ")}`);
  }
  if (problems.length) {
    for (const p of problems) say(`문제 — ${p}`);
    process.exit(1);
  }
}

main().catch((e) => {
  say(`멈춤: ${mask((e as Error).message)}`);
  process.exit(1);
});
