/* ============================================================
   자판기 · 인생네컷 · 주차정산기 자동 수집 — 매일 밤 GitHub 가 나이스 NIBS 통합거래조회에서
   단말기 4대(자판기 · 네컷 1 · 네컷 2 · 주차)의 전체 엑셀을 받아 입력 화면과 똑같이 계산해 클라우드(extra 칸)에 올림
   - 날짜: 어제 ~ 오늘 (밤 10시 넘어 생긴 어제 결제도 다음 날 다시 받아 고침) · 지난 자료 채우기는 COLLECT_FROM ~ COLLECT_TO
   - COLLECT_DRY=1 이면 올리지 않고 확인만
   - 사람이 A 에서 엑셀로 올린 칸은 덮지 않음 (packages/core/src/extra.ts autoExtraKinds)
   - 인생네컷은 두 대 합 — 한 대라도 못 받으면 그 기간 네컷 칸은 올리지 않음
   공개 저장소라 기록(로그)에는 건수 · 일치 여부만 남김 (매출 숫자 · 가맹점 이름 없음)
   ============================================================ */
import { addDays, applyExtra, autoExtraKinds, dayRange, EXTRA_AUTO_BY, EXTRA_LABEL, EXTRA_TERMINALS, extraUpdates, NICE_FROM, parseNiceSheet, type ExtraKind, type ExtraPart, type NiceSheet } from "@report/core";
// 비밀번호 걸린 엑셀 풀기 — 입력 화면(A)과 같은 것을 씀
import { decryptXlsx, isEncrypted } from "../../entry/src/officeCrypto";
import { fbLogin, readExtraPiece, writeExtraPieces } from "./firebase";
import { Nibs } from "./nibs";
import { mask, readRows, say } from "./okpos";

const env = (k: string) => process.env[k] || "";
const todayKst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

/** 정한 시간 안에 안 끝나면 실패 */
const timeout = <T>(p: Promise<T>, ms: number) => {
  p.catch(() => {});
  let t: NodeJS.Timeout | undefined;
  return Promise.race([p, new Promise<never>((_, no) => (t = setTimeout(() => no(new Error(`${ms / 1000}초 안에 안 끝남`)), ms)))]).finally(() => clearTimeout(t));
};

/** 단말기 번호 → 기록용 이름 (번호는 남기지 않음) */
const CATS = Object.entries(EXTRA_TERMINALS) as [string, ExtraKind][];
const catLabel = (cat: string) => {
  const k = EXTRA_TERMINALS[cat];
  const same = CATS.filter(([, x]) => x === k);
  return same.length > 1 ? `${EXTRA_LABEL[k]} ${same.findIndex(([c]) => c === cat) + 1}` : EXTRA_LABEL[k];
};

/** 31일씩 끊기 */
function chunks(from: string, to: string): [string, string][] {
  const out: [string, string][] = [];
  for (let a = from; a <= to; a = addDays(a, 31)) {
    const b = addDays(a, 30);
    out.push([a, b < to ? b : to]);
  }
  return out;
}

async function main() {
  const today = todayKst();
  let from = env("COLLECT_FROM") || env("COLLECT_DATE") || addDays(today, -1);
  const to = env("COLLECT_TO") || (env("COLLECT_FROM") || env("COLLECT_DATE") ? from : today);
  const dry = env("COLLECT_DRY") === "1";
  const probe = env("NICE_PROBE") === "1";
  if (![from, to].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) || from > to) throw new Error(`날짜 모양이 이상함: ${from} ~ ${to}`);
  if (from < NICE_FROM) from = NICE_FROM; // 그 전은 KIS 라 나이스에 없음
  if (!env("NICE_ID") || !env("NICE_PW")) {
    say("NICE_ID · NICE_PW 가 아직 없어 건너뜀 (GitHub Secrets 에 넣으면 다음 실행부터 받음)");
    return;
  }
  say(`날짜 ${from}${to !== from ? ` ~ ${to} (${dayRange(from, to).length}일)` : ""}${dry ? " · 확인만 (올리지 않음)" : ""}`);

  const fb = env("WEATHER_EMAIL")
    ? await fbLogin({ apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY"), email: env("WEATHER_EMAIL"), password: env("WEATHER_PASSWORD") })
    : null;

  let nb = await Nibs.open();
  const start = async () => {
    await nb.login(env("NICE_ID"), env("NICE_PW"));
    await nb.openSearch();
  };
  const restart = async () => {
    await nb.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 30000)); // 바로 다시 들어가면 나이스가 빈 응답을 줄 때가 있음
    nb = await Nibs.open();
    await start();
  };
  /** 단말기 하나 · 기간 하나 → 나이스 시트 (건이 없으면 빈 시트) */
  const fetchOne = (cat: string, a: string, b: string) =>
    timeout(
      (async (): Promise<NiceSheet> => {
        const kind = EXTRA_TERMINALS[cat];
        await nb.pickTerminal(cat);
        await nb.setDates(a, b);
        const count = await nb.search();
        let s: NiceSheet | null;
        if (count === 0) {
          s = { days: new Map(), sum: 0, summary: 0, cafePos: 0, unknown: {}, lines: 0, from: a, to: b, kinds: [], items: [] };
        } else {
          const { buf, password } = await nb.excelAll();
          let ab: ArrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
          if (isEncrypted(ab)) ab = await decryptXlsx(ab, password);
          s = parseNiceSheet(readRows(new Uint8Array(ab)));
          if (!s) throw new Error("받은 엑셀이 통합거래조회 모양이 아님");
          if (s.from && (s.from !== a || s.to !== b)) throw new Error(`엑셀 조회기간이 ${s.from} ~ ${s.to} (요청 ${a} ~ ${b})`);
          const other = s.kinds.filter((k) => k !== kind);
          if (other.length || Object.keys(s.unknown).length) throw new Error("다른 단말기 건이 섞여 있음");
          say(`  ${catLabel(cat)}: 건 ${s.lines}개${count != null ? ` · 화면 총건수와 ${count === s.lines ? "같음" : "다름(승인거절 등)"}` : ""}${s.summary != null ? ` · 엑셀 합계와 ${Math.round(s.summary) === Math.round(s.sum) ? "일치" : "다름"}` : ""}`);
        }
        // 이 단말기 · 이 기간은 받은 값으로 (건이 없는 날은 0)
        return { ...s, from: a, to: b, kinds: [kind] };
      })(),
      150_000,
    );

  const problems: string[] = [];
  let sent = 0;
  try {
    try {
      await start();
    } catch (e) {
      say(`처음 들어가기: ${mask((e as Error).message)} → 새로 열어 한 번 더`);
      if (probe) await nb.probe("로그인 · 메뉴");
      try {
        await restart();
      } catch (e2) {
        if (probe) await nb.probe("로그인 · 메뉴 (두 번째)");
        throw e2;
      }
    }
    for (const [a, b] of chunks(from, to)) {
      say(`${a} ~ ${b}`);
      const sheets: NiceSheet[] = [];
      const failed = new Set<ExtraKind>();
      for (const [cat, kind] of CATS) {
        if (failed.has(kind)) continue;
        try {
          let s: NiceSheet;
          try {
            s = await fetchOne(cat, a, b);
          } catch (e) {
            if (probe) await nb.probe(catLabel(cat));
            // 같은 화면에서 한 번 더 (다시 로그인은 접속이 끊겼을 때만 — 자주 들어가면 나이스가 막음)
            if (await nb.alive()) {
              say(`  ${catLabel(cat)}: ${mask((e as Error).message)} → 같은 화면에서 한 번 더`);
              await nb.openSearch().catch(() => {});
            } else {
              say(`  ${catLabel(cat)}: ${mask((e as Error).message)} → 접속이 끊겨 다시 로그인`);
              await restart();
            }
            s = await fetchOne(cat, a, b);
          }
          if (!s.lines) say(`  ${catLabel(cat)}: 건 없음`);
          sheets.push(s);
        } catch (e) {
          failed.add(kind);
          problems.push(`${a} ~ ${b} ${catLabel(cat)}: ${mask((e as Error).message)}`);
          if (probe) await nb.probe(`${catLabel(cat)} 실패`);
        }
      }
      // 한 대라도 못 받은 종류는 빼고 (네컷 두 대 중 하나만 받으면 합이 틀림)
      const good = sheets.filter((s) => !s.kinds.some((k) => failed.has(k)));
      const items: { date: string; part: ExtraPart }[] = [];
      const at = new Date().toISOString();
      for (const u of extraUpdates(good)) {
        const old = fb ? ((await readExtraPiece(fb, u.date))?.p as ExtraPart | undefined) : undefined;
        const kinds = autoExtraKinds(old, u.kinds);
        const kept = u.kinds.filter((k) => !kinds.includes(k));
        const diff = old ? kinds.filter((k) => Math.round(old[k] || 0) !== Math.round(u.part[k])) : kinds;
        say(`  ${u.date}: ${kinds.length ? `${kinds.map((k) => EXTRA_LABEL[k]).join(" · ")} ${old ? (diff.length ? `바뀜(${diff.map((k) => EXTRA_LABEL[k]).join(" · ")})` : "같음") : "새로"}` : "바꿀 칸 없음"}${kept.length ? ` · 사람이 올린 ${kept.map((k) => EXTRA_LABEL[k]).join(" · ")} 그대로` : ""}`);
        if (!kinds.length) continue;
        items.push({ date: u.date, part: applyExtra(old, { ...u, kinds }, { by: EXTRA_AUTO_BY, at }) });
      }
      if (fb && !dry && items.length) {
        await writeExtraPieces(fb, EXTRA_AUTO_BY, items);
        sent += items.length;
      }
    }
  } finally {
    await nb.close();
  }
  if (!dry) say(`클라우드에 올림: ${sent}일`);
  if (problems.length) {
    for (const p of problems) say(`문제 — ${p}`);
    process.exit(1);
  }
}

main().catch((e) => {
  say(`멈춤: ${mask((e as Error).message)}`);
  process.exit(1);
});
