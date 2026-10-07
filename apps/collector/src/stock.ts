/* ============================================================
   E 재고추적관리 — 매일 아침 GitHub(stock.yml)이 어제 끝 기준 장부를 새로 계산 (통합 Ver.2.0)
   - 원재료 · 레시피 · 공급처: inv/master (E-1) · 입고: invIn/{날짜} (창고 입구) · 실셈: invCount/{날짜}
   - 사용량: 베이커리 = D 확정 생산량(orders · plans → orderRows 의 확정 · 자동), 그 밖 = B 영수증 줄(lines/{날짜}_cafe · kids) × 레시피
     날짜별 사용량은 invUse/{YYYY-MM} 에 쌓아 두고, 새 날과 최근 3일(늦게 들어온 영수증 · 확정)만 다시 셈 → 지난 날을 매일 다시 읽지 않음
   - 장부 · AI 안전재고 · 발주 필요 → inv/ledger (E-1 · F 가 읽음)
   - 알림: 발주 필요 · 장부 − (레시피 재검증) → alerts/{order-날짜 · negative-날짜} (pushed=false) → 푸시
   - STOCK_PUSH_ONLY=1: 계산 없이 아직 안 보낸 알림만 푸시 (E-1 실셈 확정 알림 — 30분마다)
   - Firebase 만 읽고 쓰므로 GitHub 쪽에서 돎 (베이커리 계획과 같음 — 국내 사이트 접속 없음)
   공개 저장소라 기록에는 원재료 수 · 날 수 · 알림 수만 (이름 · 금액 · 수량 없음)
   ============================================================ */
import {
  addDays,
  alertsFor,
  asOrder,
  asPlan,
  ledgerDoc,
  orderRows,
  productList,
  recipeUsage,
  soldFromLines,
  stockReport,
  sumUsage,
  usageFromCache,
  type LedgerDoc,
  type StockAlert,
  type StockCount,
  type StockIn,
  type StockMaster,
  type UseCache,
} from "@report/core";
import { fcmSend, fcmToken } from "./fcm";
import { fbLogin, listJson, readJson, readLines, readOrder, readPlan, readStores, removeDoc, unpushedAlerts, writeJson, type Fb } from "./firebase";
import { mask, say } from "./okpos";

const env = (k: string) => process.env[k] || "";
const todayKst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const REDO_DAYS = 3;

/** 그날 베이커리 생산 (D 확정 · 자동) — B 베이커리 상세와 같은 orderRows */
async function productionOf(fb: Fb, date: string) {
  const [p, o] = await Promise.all([readPlan(fb, date), readOrder(fb, date)]);
  const plan = asPlan(p ? JSON.parse(p) : null);
  const order = asOrder(o ? JSON.parse(o) : null);
  if (!plan && !order) return null;
  const rows = orderRows(plan, order, { date: "9999-12-31", time: "00:00" }).filter((r) => (r.state === "확정" || r.state === "자동") && (r.qty || 0) > 0);
  return rows.length ? { date, items: rows.map((r) => ({ product: r.name, qty: r.qty || 0 })) } : null;
}

async function push(fb: Fb, alerts: { id: string; json: StockAlert }[]) {
  if (!alerts.length) return;
  if (!env("FIREBASE_SERVICE_ACCOUNT")) {
    say(`푸시 못 보냄 — FIREBASE_SERVICE_ACCOUNT 없음 (알림 ${alerts.length}개는 발주app 을 열면 보임)`);
    return;
  }
  const tokens = await listJson<{ token: string }>(fb, "pushTokens");
  const auth = await fcmToken(env("FIREBASE_SERVICE_ACCOUNT"));
  const link = env("STOCK_APP_URL") || `https://${env("FIREBASE_PROJECT_ID")}.web.app/f/`;
  let ok = 0;
  let fail = 0;
  for (const a of alerts) {
    for (const t of tokens) {
      if (!t.json?.token) continue;
      const r = await fcmSend(auth, t.json.token, { title: a.json.title, body: a.json.lines.slice(0, 3).join(" / ").slice(0, 180), link, tag: a.id });
      if (r === "ok") ok++;
      else {
        fail++;
        if (r === "gone") await removeDoc(fb, `pushTokens/${t.id}`); // 지운 앱 · 끈 알림
      }
    }
    await writeJson(fb, `alerts/${a.id}`, { ...a.json, pushedAt: new Date().toISOString() }, { pushed: { booleanValue: true } });
  }
  say(`푸시: 알림 ${alerts.length}개 · 폰 ${tokens.length}대 · 보냄 ${ok} · 실패 ${fail}`);
}

async function main() {
  const fb = await fbLogin({ apiKey: env("FIREBASE_API_KEY"), projectId: env("FIREBASE_PROJECT_ID"), board: env("REPORT_BOARD_KEY"), email: env("WEATHER_EMAIL"), password: env("WEATHER_PASSWORD") });
  const dry = env("STOCK_DRY") === "1";

  if (env("STOCK_PUSH_ONLY") === "1") {
    const list = await unpushedAlerts(fb);
    say(`안 보낸 알림 ${list.length}개`);
    if (!dry) await push(fb, list);
    return;
  }

  const master = await readJson<StockMaster>(fb, "inv/master");
  if (!master?.materials?.length) {
    say("원재료가 아직 없음 — E-1 에서 원재료 · 레시피 · 최초 실셈을 넣으면 그다음 날부터 계산");
    return;
  }
  const upTo = env("STOCK_UPTO") || addDays(todayKst(), -1);
  const start = master.materials.map((m) => m.asOf || upTo).sort()[0];

  // 1) 사용량 — 쌓아 둔 달 문서 + 새 날 · 최근 3일만 다시
  const months = new Set<string>();
  for (let d = start; d <= upTo; d = addDays(d, 1)) months.add(d.slice(0, 7));
  const cache: Record<string, UseCache> = {};
  for (const m of months) cache[m] = (await readJson<UseCache>(fb, `invUse/${m}`)) || {};
  const redoFrom = addDays(upTo, -(REDO_DAYS - 1));
  let computed = 0;
  const seenLines: { name: string; qty: number }[] = [];
  for (let d = start; d <= upTo; d = addDays(d, 1)) {
    const m = d.slice(0, 7);
    if (cache[m][d] && d < redoFrom) continue;
    const [cafe, kids, prod] = await Promise.all([readLines(fb, d, "cafe"), readLines(fb, d, "kids"), productionOf(fb, d)]);
    const lines = [...(cafe || []), ...(kids || [])].map((l: any) => ({ name: String(l.name || ""), qty: Number(l.qty) || 0 }));
    seenLines.push(...lines);
    const rows = recipeUsage({ recipes: master.recipes, materials: master.materials, sold: soldFromLines(d, lines), production: prod ? [prod] : [] });
    cache[m][d] = sumUsage(rows)[d] || {};
    computed++;
  }
  say(`원재료 ${master.materials.length}개 · 레시피 ${master.recipes.length}개 · ${start} ~ ${upTo} · 새로 센 날 ${computed}일`);
  if (!dry) for (const m of months) await writeJson(fb, `invUse/${m}`, cache[m], { month: { stringValue: m } });
  const usage = usageFromCache(Object.assign({}, ...Object.values(cache)));

  // 2) 입고 · 실셈
  const ins = (await listJson<StockIn[]>(fb, "invIn")).flatMap((d) => d.json || []);
  const counts = (await listJson<StockCount>(fb, "invCount")).map((d) => d.json).filter(Boolean);

  // 3) 레시피에 고를 판매 상품 — 지난 장부 목록 + 이번에 읽은 날 (처음이면 최근 30일 B 카페 보고)
  const prev = await readJson<LedgerDoc>(fb, "inv/ledger");
  let parts: { products: [string, string, number, number][] }[] = [];
  if (!prev?.products?.length) {
    for (let d = addDays(upTo, -29); d <= upTo; d = addDays(d, 1)) {
      const s = await readStores(fb, d);
      if (s.cafe?.p?.products) parts.push({ products: s.cafe.p.products });
    }
  } else {
    parts = [{ products: prev.products.map((p) => [p.name, p.sector, p.qty, 0] as [string, string, number, number]) }];
    const sector = new Map(prev.products.map((p) => [p.name, p.sector]));
    parts.push({ products: seenLines.map((l) => [l.name, sector.get(l.name) || "기타", l.qty, 0] as [string, string, number, number]) });
  }
  const products = productList(parts).slice(0, 400);

  // 4) 장부 · 안전재고 · 발주
  const rep = stockReport({ master, ins, counts, usage, upTo });
  const doc = ledgerDoc(rep, products, upTo, new Date().toISOString());
  say(`장부: 발주 필요 ${doc.orders.length}개 · 장부 − ${doc.rows.filter((r) => r.negative).length}개 · AI 안전재고 자료 부족 ${doc.rows.filter((r) => r.ai == null).length}개`);
  if (dry) return;
  await writeJson(fb, "inv/ledger", doc);

  // 5) 알림 (같은 날 두 번 만들지 않음) → 푸시
  const exists: string[] = [];
  for (const id of [`order-${upTo}`, `negative-${upTo}`]) if (await readJson(fb, `alerts/${id}`)) exists.push(id);
  const fresh = alertsFor(doc, master.suppliers, exists);
  for (const a of fresh) await writeJson(fb, `alerts/${a.id}`, a, { pushed: { booleanValue: false } });
  say(`새 알림 ${fresh.length}개`);
  await push(fb, await unpushedAlerts(fb));
}

main().catch((e) => {
  say(`멈춤: ${mask((e as Error).message).split("\n")[0].slice(0, 200)}`);
  process.exit(1);
});
