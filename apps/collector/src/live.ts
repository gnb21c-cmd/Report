/* ============================================================
   오늘 마감 전 영업정보 — POS 메인 PC(GitHub 실행기 nice-pos)에서 매시 15분 · 45분(10:15 ~ 22:45, live-collect.yml)
   OKPOS 점주 웹에서 오늘 카페 · 키즈 영수증별 엑셀을 받아 아침 확정 수집(collect.ts)과 **같은 계산**(buildStorePart)으로 만든
   조각을 live/{오늘} 의 cafe · kids 칸에 올림 → B 가 '마감 전 영업정보 · HH:MM 기준'으로 보여 줌
   - 올리기 전 검사: 엑셀 합계 = 계산(partCheck) · checkLivePiece (packages/core/src/live.ts). 틀리면 올리지 않음 (B 에 틀린 숫자가 안 가게)
   - 확정 칸(reports)은 건드리지 않음 — 다음 날 아침 09:12 확정 수집 그대로
   - GitHub 클라우드에서는 돌리지 않음 (사용자 지시 — POS 에서만)
   환경: OKPOS_ID · OKPOS_PW · FIREBASE_API_KEY · FIREBASE_PROJECT_ID · REPORT_BOARD_KEY · WEATHER_EMAIL · WEATHER_PASSWORD
         LIVE_DATE(시험: 그 날짜 · yesterday = 어제) · COLLECT_DRY=1(올리지 않음)
   공개 저장소라 기록에는 줄 수 · 일치 여부만 (매출 숫자 · 매장 이름 없음)
   ============================================================ */
import { buildStorePart, checkLiveNaver, checkLivePiece, isNaverTicketProduct, liveNaverPart, parseReceiptSheet, partCheck, sectorLookup } from "@report/core";
import type { Frame } from "playwright";
import { fbLogin, readProducts, writeLive } from "./firebase";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { NaverBook } from "./naverBook";
import { mask, Okpos, readRows, say, type Store } from "./okpos";

export const LIVE_BY = "자동 수집 (OKPOS, 마감 전)";
export const LIVE_BY_NAVER = "자동 수집 (네이버 예약현황, 마감 전 — 이용완료 + 입장예정)";
const env = (k: string) => process.env[k] || "";
const kst = (ms = 0) => new Date(Date.now() + 9 * 3600e3 + ms).toISOString();
const LABEL: Record<Store, string> = { cafe: "카페", kids: "키즈" };

const timeout = <T>(p: Promise<T>, ms: number) => {
  p.catch(() => {});
  let t: NodeJS.Timeout | undefined;
  return Promise.race([p, new Promise<never>((_, no) => (t = setTimeout(() => no(new Error(`${ms / 1000}초 안에 안 끝남`)), ms)))]).finally(() => clearTimeout(t));
};

async function main() {
  const dry = env("COLLECT_DRY") === "1";
  const date = env("LIVE_DATE") === "yesterday" ? kst(-86400e3).slice(0, 10) : env("LIVE_DATE") || kst().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("날짜 모양이 이상함");
  if (!env("OKPOS_ID") || !env("OKPOS_PW")) throw new Error("OKPOS_ID · OKPOS_PW 가 없습니다");
  const t0 = Date.now();
  say(`${date} ${kst().slice(11, 16)} 마감 전 영업정보${dry ? " · 확인만 (올리지 않음)" : ""}`);
  const fb = await fbLogin({ apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY"), email: env("WEATHER_EMAIL"), password: env("WEATHER_PASSWORD") });
  const table = await readProducts(fb);

  let ok = await Okpos.open();
  let mf: Frame | undefined;
  let logins = 0;
  const login = async () => {
    await ok.login(env("OKPOS_ID"), env("OKPOS_PW"));
    logins++;
    mf = await ok.openReceipts();
  };
  // 같은 브라우저에서 다시 로그인하면 OKPOS 가 '세션 유지 중'으로 막음 → 새 브라우저로
  const relogin = async () => {
    await ok.close().catch(() => {});
    ok = await Okpos.open();
    await login();
  };
  const fetchDay = (store: Store) =>
    timeout(
      (async () => {
        await ok.pickShop(mf!, store);
        return ok.download(mf!, date, { allowEmpty: true });
      })(),
      120_000,
    );

  const parts: { kind: Store; part: unknown }[] = [];
  const problems: string[] = [];
  try {
    await login();
    for (const store of ["cafe", "kids"] as Store[]) {
      try {
        let d: Awaited<ReturnType<typeof fetchDay>>;
        try {
          d = await fetchDay(store);
        } catch (e) {
          say(`  ${LABEL[store]}: ${mask((e as Error).message)} → 새로 로그인해서 한 번 더`);
          await relogin();
          d = await fetchDay(store);
        }
        if (d.rows === 0) {
          say(`  ${LABEL[store]}: 아직 영수증 없음`);
          continue;
        }
        const sheet = parseReceiptSheet(readRows(d.buf));
        if (sheet.from && (sheet.from !== date || sheet.to !== date)) throw new Error("엑셀 조회일자가 다름");
        const r = buildStorePart({ store, date, file: `OKPOS 마감 전 ${LABEL[store]}`, sheet, sectorOf: sectorLookup(table) });
        const check = partCheck(r.part).ok;
        const bad = checkLivePiece(r.part, store, date);
        say(`  ${LABEL[store]}: 판매 줄 ${sheet.lines.length}개 · ${check ? "엑셀 합계와 일치" : "엑셀 합계와 다름"} · 검사 ${bad.length ? `걸림 ${bad.length}` : "통과"}`);
        // 장수만 (금액 없음) — 키즈 입장료 계산이 맞는지 보려고
        const k = r.part.kids;
        if (k) say(`    키즈 장수: 현장 결제 입장 ${k.walkIn}장 · 0원 입장 발행 ${k.issued}장 · 이벤트 무료 ${k.eventFree}장`);
        if (store === "cafe") say(`    카페에서 쓴 키즈 사은권 · 교환권: ${(r.part.kidsCoupon || 0) > 0 ? "있음" : "없음"}`);
        if (!check || bad.length) throw new Error("검사에 걸려 올리지 않음"); // 틀린 숫자는 B 에 보내지 않음
        parts.push({ kind: store, part: r.part });
      } catch (e) {
        problems.push(`${LABEL[store]}: ${mask((e as Error).message)}`);
      }
    }
  } finally {
    await ok.close().catch(() => {});
  }
  if (!dry && parts.length) await writeLive(fb, date, LIVE_BY, parts);
  say(`OKPOS ${parts.length}칸 ${dry ? "확인" : "올림"} · ${Math.round((Date.now() - t0) / 1000)}초 · 로그인 ${logins}번`);

  // 네이버 예약현황(오늘) — 30분 칸별 이용완료 + 확정(입장예정) 장수. 로그인은 아침 네이버 수집과 같은 상태(POS 메인 PC)
  // 따로 올림 — 네이버가 안 돼도(로그인 풀림 등) 카페 · 키즈 숫자는 그대로. 기록에는 칸 개수만 (인원 숫자 없음)
  const statePath = env("NAVER_STATE_DIR") ? join(env("NAVER_STATE_DIR"), "state.json") : "";
  if (!statePath || !existsSync(statePath)) say("네이버: 로그인 상태가 없어 건너뜀 (POS 메인 PC 의 naver-login.cmd)");
  else {
    const nb = await NaverBook.open(statePath);
    try {
      await nb.enter(env("NAVER_BIZ_ID"));
      await nb.gotoDate(date);
      const done = await nb.readCells("완료");
      if (!done.rows) throw new Error("회차 표를 못 찾음");
      await nb.showStatus("확정");
      const booked = await nb.readCells("확정");
      await nb.showStatus("전체").catch(() => {});
      await nb.saveState(statePath);
      const part = liveNaverPart(date, done.cells, booked.cells);
      const bad = checkLiveNaver(part, date);
      const used = (cs: { product: string }[]) => cs.filter((c) => isNaverTicketProduct(c.product)).length;
      say(`네이버: 이용완료 칸 ${used(done.cells)}개 · 입장예정 칸 ${used(booked.cells)}개 (입장권 상품) · 검사 ${bad.length ? `걸림 ${bad.length}` : "통과"}`);
      if (bad.length) throw new Error("검사에 걸려 올리지 않음");
      if (!dry) {
        try {
          await writeLive(fb, date, LIVE_BY_NAVER, [{ kind: "naver", part }]);
          say("네이버 1칸 올림");
        } catch (e) {
          // 보안 규칙에 naver 칸이 아직 없으면 403 — 카페 · 키즈는 이미 올라감
          problems.push(`네이버 올리기: ${mask((e as Error).message)}${/403/.test(String((e as Error).message)) ? " — Firebase 보안 규칙(live 의 naver 칸) 붙여 넣기 필요" : ""}`);
        }
      }
    } catch (e) {
      problems.push(`네이버: ${mask((e as Error).message)}`);
    } finally {
      await nb.close().catch(() => {});
    }
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
