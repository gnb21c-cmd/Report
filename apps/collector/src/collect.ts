/* ============================================================
   POS 자동 수집 — 매일 밤 GitHub 가 OKPOS 점주 웹에서 카페 · 키즈 '영수증별 매출 상세현황' 엑셀을 받아
   입력 화면과 똑같이 계산해 클라우드(cafe · kids 칸)에 올림. 직원 PC 가 켜져 있을 필요 없음
   - 날짜: COLLECT_DATE (없으면 오늘, 한국 시간) · 지난 자료 채우기는 COLLECT_FROM ~ COLLECT_TO
   - COLLECT_DRY=1 이면 올리지 않고 확인만
   - 사람이 영수증별 엑셀로 이미 올린 칸은 덮지 않음 (사람이 나중에 올리면 사람 것이 이김). 상품별 정리표로 넣은 지난 자료는 영수증별로 바꿈
   - 엑셀 합계 줄과 계산이 다르면 올리지 않고 실패로 끝냄 (GitHub 가 알림 메일을 보냄)
   공개 저장소라 기록(로그)에는 줄 수 · 일치 여부만 남김 (매출 숫자 · 매장 이름 없음)
   ============================================================ */
import { buildStorePart, dayRange, parseReceiptSheet, partCheck, sectorLookup } from "@report/core";
import { fbLogin, readProducts, readStores, writeStores } from "./firebase";
import type { Frame } from "playwright";
import { mask, Okpos, readRows, say, type Store } from "./okpos";

/** 정한 시간 안에 안 끝나면 실패 */
const timeout = <T>(p: Promise<T>, ms: number) => {
  p.catch(() => {}); // 늦게 실패해도 프로그램이 죽지 않게 (브라우저를 닫으면 남은 일이 실패함)
  let t: NodeJS.Timeout | undefined;
  return Promise.race([p, new Promise<never>((_, no) => (t = setTimeout(() => no(new Error(`${ms / 1000}초 안에 안 끝남`)), ms)))]).finally(() => clearTimeout(t));
};

export const AUTO_BY = "자동 수집 (OKPOS)";
const STORES: Store[] = ["cafe", "kids"];
const LABEL: Record<Store, string> = { cafe: "카페", kids: "키즈" };

const env = (k: string) => process.env[k] || "";
const todayKst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

async function main() {
  // 하루: COLLECT_DATE (없으면 오늘) · 여러 날: COLLECT_FROM ~ COLLECT_TO (지난 자료 채우기)
  const from = env("COLLECT_FROM") || env("COLLECT_DATE") || todayKst();
  const to = env("COLLECT_TO") || from;
  const dry = env("COLLECT_DRY") === "1";
  if (![from, to].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) || from > to) throw new Error(`날짜 모양이 이상함: ${from} ~ ${to}`);
  if (!env("OKPOS_ID") || !env("OKPOS_PW")) throw new Error("OKPOS_ID · OKPOS_PW 가 없습니다 (GitHub Secrets)");
  const dates = dayRange(from, to);
  say(`날짜 ${from}${to !== from ? ` ~ ${to} (${dates.length}일)` : ""}${dry ? " · 확인만 (올리지 않음)" : ""}`);

  // 확인만 할 때도 클라우드는 읽음 (분류표 · 이미 올린 값과 견주기)
  const fb = env("WEATHER_EMAIL")
    ? await fbLogin({ apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY"), email: env("WEATHER_EMAIL"), password: env("WEATHER_PASSWORD") })
    : null;
  const table = fb ? await readProducts(fb) : {};

  // OKPOS 화면이 가끔 응답 없이 멈춤 → 한 칸에 2분이 넘으면 끊고 다시 로그인해서 한 번 더
  let ok = await Okpos.open();
  let mf: Frame;
  const start = async () => {
    await ok.login(env("OKPOS_ID"), env("OKPOS_PW"));
    mf = await ok.openReceipts();
  };
  const restart = async () => {
    await ok.close().catch(() => {});
    ok = await Okpos.open();
    await start();
  };
  const fetchDay = (store: Store, date: string) =>
    timeout(
      (async () => {
        await ok.pickShop(mf, store);
        return ok.download(mf, date);
      })(),
      120_000,
    );
  const range = dates.length > 1;
  const problems: string[] = [];
  let sent = 0;
  try {
    await start();
    for (const date of dates) {
      const have = fb ? await readStores(fb, date) : {};
      const out: Parameters<typeof writeStores>[3] = [];
      for (const store of STORES) {
        const old = have[store];
        // 사람이 영수증별 엑셀로 올린 칸은 그대로 (상품별 정리표로 넣은 지난 자료는 영수증별로 바꿈 — 입력 화면과 같은 규칙)
        if (!dry && old && old.by !== AUTO_BY && old.p?.basis === "receipt") {
          say(`${date} ${LABEL[store]}: 사람이 영수증별로 올린 칸이라 건너뜀`);
          continue;
        }
        // 여러 날 채우기는 이미 자동으로 올린 날을 건너뜀 (멈춘 데서 이어 하기)
        if (!dry && range && old?.by === AUTO_BY) continue;
        try {
          let d: Awaited<ReturnType<typeof fetchDay>>;
          try {
            d = await fetchDay(store, date);
          } catch (e) {
            say(`${date} ${LABEL[store]}: ${mask((e as Error).message)} → 다시 로그인해서 한 번 더`);
            await restart();
            d = await fetchDay(store, date);
          }
          const sheet = parseReceiptSheet(readRows(d.buf));
          if (sheet.from && (sheet.from !== date || sheet.to !== date)) throw new Error(`엑셀 조회일자가 ${sheet.from} ~ ${sheet.to} (요청 ${date})`);
          const file = `OKPOS 자동 ${date} ${LABEL[store]}.xls`;
          const r = buildStorePart({ store, date, file, sheet, sectorOf: sectorLookup(table) });
          const check = partCheck(r.part);
          say(`${date} ${LABEL[store]}: 판매 줄 ${sheet.lines.length}개 · 반품 짝 ${r.matches.length}건 · 짝 없는 반품 ${r.unmatched.length}건 · ${check.ok ? "엑셀 합계와 일치" : "엑셀 합계와 다름"}`);
          if (!check.ok) throw new Error("엑셀 합계와 계산이 다름 — 입력 화면에서 직접 확인해 주세요");
          if (old?.p) {
            // 이미 있던 값과 견줌 (숫자는 기록에 남기지 않고 같다 · 다르다만)
            const same = (k: string) => Math.round(Number(old.p[k]) || 0) === Math.round(Number((r.part as any)[k]) || 0);
            const keys = ["posNet", "voucher", "cups", "teams"].filter((k) => k in old.p);
            const diff = keys.filter((k) => !same(k));
            const sec = Object.keys(old.p.sectors || {}).filter((k) => Math.round(old.p.sectors[k]) !== Math.round((r.part.sectors as any)[k] || 0));
            const who = old.by === AUTO_BY ? "자동" : old.p.basis === "receipt" ? "사람 · 영수증별" : "사람 · 상품별";
            say(`  있던 값(${who})과 견줌: ${diff.length || sec.length ? `다름 — ${[...diff, ...sec.map((k) => `분류 ${k}`)].join(", ")}` : "같음"}`);
          }
          out.push({ kind: store, part: r.part, file, lines: r.lines });
        } catch (e) {
          problems.push(`${date} ${LABEL[store]}: ${mask((e as Error).message)}`);
        }
      }
      if (fb && !dry && out.length) {
        await writeStores(fb, AUTO_BY, date, out);
        sent += out.length;
      }
    }
  } finally {
    await ok.close();
  }
  if (!dry) say(`클라우드에 올림: ${sent}칸`);
  if (problems.length) {
    for (const p of problems) say(`문제 — ${p}`);
    process.exit(1);
  }
}

main().catch((e) => {
  say(`멈춤: ${mask((e as Error).message)}`);
  process.exit(1);
});
