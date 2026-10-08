/* ============================================================
   POS 상주 전송기 — 마감 전 영업정보 (통합 Ver.2.0, docs/V2_INTEGRATION.md)
   - 카페 POS 메인 PC 에서 하루 내내 켜 두고, 10분마다 OKPOS 점주 웹에서 오늘 카페 · 키즈 영수증별 엑셀을 받아
     아침 확정 수집(collect.ts)과 **같은 계산**(buildStorePart)으로 만든 조각을 live/{오늘} 의 cafe · kids 칸에 올림
   - 로그인은 한 번 하고 그 세션을 이어 씀 (10분마다 다시 로그인하지 않음 — 계정 잠김 막기). 세션이 끊기면 그때만 다시 로그인
   - 올리기 전 검사: 엑셀 합계 = 계산(partCheck) · live.ts checkLivePiece. 틀리면 올리지 않음 (B 에 틀린 숫자가 안 가게)
   - 확정 칸(reports)은 건드리지 않음 — 다음 날 아침 수집 그대로
   환경: OKPOS_ID · OKPOS_PW · FIREBASE_API_KEY · FIREBASE_PROJECT_ID · REPORT_BOARD_KEY · WEATHER_EMAIL · WEATHER_PASSWORD
         LIVE_START(10:00) · LIVE_END(22:30) · LIVE_EVERY(분, 10) · LIVE_CYCLES(시험: 몇 번 돌고 끝) · LIVE_DATE(시험: 그 날짜 · yesterday = 어제) · COLLECT_DRY=1(올리지 않음)
   공개 저장소라 기록에는 줄 수 · 일치 여부 · 로그인 횟수만 (매출 숫자 · 매장 이름 없음)
   ============================================================ */
import { buildStorePart, checkLivePiece, parseReceiptSheet, partCheck, sectorLookup, SheetError } from "@report/core";
import type { Frame } from "playwright";
import { fbLogin, readProducts, writeLive } from "./firebase";
import { mask, Okpos, readRows, say, type Store } from "./okpos";

export const LIVE_BY = "POS 전송기 (마감 전)";
const env = (k: string) => process.env[k] || "";
const kstNow = () => new Date(Date.now() + 9 * 3600e3);
const today = () => kstNow().toISOString().slice(0, 10);
const hm = () => kstNow().toISOString().slice(11, 16);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LABEL: Record<Store, string> = { cafe: "카페", kids: "키즈" };

const timeout = <T>(p: Promise<T>, ms: number) => {
  p.catch(() => {});
  let t: NodeJS.Timeout | undefined;
  return Promise.race([p, new Promise<never>((_, no) => (t = setTimeout(() => no(new Error(`${ms / 1000}초 안에 안 끝남`)), ms)))]).finally(() => clearTimeout(t));
};

async function main() {
  const dry = env("COLLECT_DRY") === "1";
  const start = env("LIVE_START") || "10:00";
  const end = env("LIVE_END") || "22:30";
  const every = Math.max(1, Number(env("LIVE_EVERY") || 10)) * 60_000;
  const cycles = Number(env("LIVE_CYCLES") || 0);
  if (!env("OKPOS_ID") || !env("OKPOS_PW")) throw new Error("OKPOS_ID · OKPOS_PW 가 없습니다");
  const fbEnv = { apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY"), email: env("WEATHER_EMAIL"), password: env("WEATHER_PASSWORD") };
  // Firebase 출입증은 1시간 — 50분마다 새로
  let fb = fbEnv.email ? await fbLogin(fbEnv) : null;
  let fbAt = Date.now();
  const table = fb ? await readProducts(fb) : {};
  say(`전송기 시작 · ${start} ~ ${end} · ${every / 60_000}분마다${cycles ? ` · 시험 ${cycles}번` : ""}${dry ? " · 확인만 (올리지 않음)" : ""}`);

  let ok = await Okpos.open();
  let mf: Frame | undefined;
  let logins = 0;
  const login = async () => {
    await ok.login(env("OKPOS_ID"), env("OKPOS_PW"));
    logins++;
    mf = await ok.openReceipts();
  };
  const relogin = async () => {
    await ok.close().catch(() => {});
    ok = await Okpos.open();
    await login();
  };
  const fetchDay = (store: Store, date: string) =>
    timeout(
      (async () => {
        await ok.pickShop(mf!, store);
        return ok.download(mf!, date);
      })(),
      120_000,
    );

  let n = 0;
  let sentTotal = 0;
  let fails = 0;
  try {
    for (;;) {
      const now = hm();
      if (!cycles && now >= end) break;
      if (!cycles && now < start) {
        await sleep(60_000);
        continue;
      }
      const t0 = Date.now();
      n++;
      const date = env("LIVE_DATE") === "yesterday" ? new Date(Date.now() + 9 * 3600e3 - 86400e3).toISOString().slice(0, 10) : env("LIVE_DATE") || today();
      try {
        if (!mf) await login();
        if (fb && Date.now() - fbAt > 50 * 60_000) {
          fb = await fbLogin(fbEnv);
          fbAt = Date.now();
        }
        const parts: { kind: Store; part: unknown }[] = [];
        for (const store of ["cafe", "kids"] as Store[]) {
          let d: Awaited<ReturnType<typeof fetchDay>>;
          try {
            d = await fetchDay(store, date);
          } catch (e) {
            // 세션이 끊겼거나 화면이 멈춤 → 그때만 다시 로그인
            say(`  ${LABEL[store]}: ${mask((e as Error).message)} → 다시 로그인`);
            await relogin();
            d = await fetchDay(store, date);
          }
          let sheet;
          try {
            sheet = parseReceiptSheet(readRows(d.buf));
          } catch (e) {
            if (e instanceof SheetError && d.rows === 0) {
              say(`  ${LABEL[store]}: 아직 영수증 없음`);
              continue;
            }
            throw e;
          }
          if (sheet.from && sheet.from !== date) throw new Error(`엑셀 조회일자가 다름`);
          const r = buildStorePart({ store, date, file: `OKPOS 마감 전 ${LABEL[store]}`, sheet, sectorOf: sectorLookup(table) });
          const check = partCheck(r.part);
          const bad = checkLivePiece(r.part, store, date);
          say(`  ${LABEL[store]}: 판매 줄 ${sheet.lines.length}개 · ${check.ok ? "엑셀 합계와 일치" : "엑셀 합계와 다름"} · 검사 ${bad.length ? `걸림 ${bad.length}` : "통과"}`);
          if (!check.ok || bad.length) continue; // 틀린 숫자는 올리지 않음
          parts.push({ kind: store, part: r.part });
        }
        if (fb && !dry && parts.length) {
          await writeLive(fb, date, LIVE_BY, parts);
          sentTotal += parts.length;
        }
        say(`${n}회 ${now} · ${parts.length}칸 ${dry ? "확인" : "올림"} · ${Math.round((Date.now() - t0) / 1000)}초 · 지금까지 로그인 ${logins}번`);
        fails = 0;
      } catch (e) {
        fails++;
        say(`${n}회 ${now} · 실패: ${mask((e as Error).message)}`);
        mf = undefined; // 다음 차례에 다시 로그인
        if (fails >= 6) throw new Error("6번 잇달아 실패 — 멈춤 (작업 스케줄러가 다음에 다시 켬)");
      }
      if (cycles && n >= cycles) break;
      await sleep(Math.max(0, every - (Date.now() - t0)));
    }
  } finally {
    await ok.close().catch(() => {});
  }
  say(`전송기 끝 · ${n}회 · 올린 칸 ${sentTotal} · 로그인 ${logins}번`);
}

main().catch((e) => {
  say(`멈춤: ${mask((e as Error).message)}`);
  process.exit(1);
});
