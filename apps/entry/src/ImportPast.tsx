/* ============================================================
   지난 자료 한꺼번에 넣기 (작년 비교선 · 시간대 분석을 빨리 채우려고) — 파일을 여러 개 한 번에 골라도 됨
   ① 상품별 (일자별) 엑셀: 기간으로 받음 (카페는 조회줄수 때문에 한 달씩, 키즈는 6개월씩) → 하루 합계. 카페는 OK포스 대분류로 분류표도 채움
   ② 영수증별 매출 상세현황 엑셀: 하루치만 받아지므로 여러 날 파일을 한꺼번에 → 날짜 · 매장은 파일에서 알아냄 (시간대 분석은 최근 5주면 충분)
   ③ 네이버 지난 자료: 주 단위 화면 캡처를 정리한 표 (날짜 × 10:00~19:30)
   이미 A 에서 넣은 날(영수증별 · 네이버)은 상품별 · 네이버 정리표로 덮지 않음
   ============================================================ */
import { useState } from "react";
import {
  buildDailyPart,
  buildStorePart,
  count,
  guessStore,
  naverPastPart,
  parseDailySheet,
  parseNaverPast,
  parseReceiptSheet,
  sectorFromCategory,
  sectorLookup,
  SheetError,
  STORE_LABEL,
  sum,
  won,
  type StoreId,
} from "@report/core";
import { readRows } from "./excel";
import { api, type PastPart } from "./api";

type Kind = "daily" | "receipt" | "naver";
const TABS: [Kind, string][] = [
  ["daily", "① 상품별 (일자별) — 1년치 하루 합계"],
  ["receipt", "② 영수증별 — 여러 날 파일"],
  ["naver", "③ 네이버 지난 자료"],
];

interface Row {
  file: string;
  ok: boolean;
  text: string;
  parts: PastPart[];
  products?: Record<string, string>;
}

/** 파일 하나 → 보낼 조각들 + 한 줄 설명 */
async function readOne(kind: Kind, f: File, table: Record<string, string>, store: StoreId | "auto"): Promise<Row> {
  try {
    const rows = readRows(await f.arrayBuffer());
    if (kind === "naver") {
      const r = parseNaverPast(rows);
      const total = r.reduce((s, x) => s + sum(x.tickets), 0);
      return { file: f.name, ok: true, text: `${r[0].date} ~ ${r[r.length - 1].date} · ${count(r.length, "일")} · 판매 ${count(total, "장")}`, parts: r.map(naverPastPart) };
    }
    if (kind === "daily") {
      const sheet = parseDailySheet(rows);
      if (sheet.truncated) throw new SheetError("조회줄수 제한에 걸려 잘린 파일입니다 — 기간을 나눠서 다시 받아 주세요.");
      const lines = [...sheet.days.values()].flat();
      const st = store === "auto" ? guessStore(lines.map((l) => ({ ...l, refund: false }))) : store;
      if (!st) throw new SheetError("카페 상품과 키즈 입장권이 섞여 있습니다 — 매장을 [전체]로 받은 파일 같습니다.");
      const products: Record<string, string> = {};
      if (st === "cafe") for (const [name, cat] of sheet.categories) products[name] = sectorFromCategory(cat) || "기타";
      const look = sectorLookup({ ...table, ...products });
      const parts = [...sheet.days.entries()].sort().map(([date, rows]) => buildDailyPart({ store: st, date, file: f.name, rows, sectorOf: look }));
      return {
        file: f.name,
        ok: sheet.totalOk,
        text: `${STORE_LABEL[st]} · ${sheet.from} ~ ${sheet.to} · ${count(parts.length, "일")} · 실매출 ${won(lines.reduce((s, l) => s + l.net, 0))}${sheet.totalOk ? "" : " · ⚠ 합계 줄과 다름"}`,
        parts,
        products: st === "cafe" ? products : undefined,
      };
    }
    const sheet = parseReceiptSheet(rows);
    if (!sheet.from || sheet.from !== sheet.to) throw new SheetError("조회일자가 하루가 아닙니다.");
    const st = store === "auto" ? guessStore(sheet.lines) : store;
    if (!st) throw new SheetError("카페 상품과 키즈 입장권이 섞여 있습니다 — 매장을 [전체]로 받은 파일 같습니다.");
    const r = buildStorePart({ store: st, date: sheet.from, file: f.name, sheet, sectorOf: sectorLookup(table) });
    const ok = r.part.sheetNet == null || Math.round(r.part.posNet - r.part.sheetNet) === 0;
    return { file: f.name, ok, text: `${STORE_LABEL[st]} · ${sheet.from} · 실매출 ${won(r.part.posNet)}${ok ? "" : " · ⚠ 합계와 다름"} · 반품 ${count(r.matches.length, "장")}`, parts: [r.part] };
  } catch (e) {
    return { file: f.name, ok: false, text: e instanceof SheetError ? e.message : "엑셀을 읽지 못했습니다.", parts: [] };
  }
}

export function ImportPast({ me, table, onClose, onDone }: { me: string; table: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<Kind>("daily");
  const [store, setStore] = useState<StoreId | "auto">("auto");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setMsg(null);
    setErr(null);
    setBusy(true);
    const out: Row[] = [];
    for (const f of Array.from(files).sort((a, b) => a.name.localeCompare(b.name, "ko"))) out.push(await readOne(kind, f, table, store));
    setRows(out);
    setBusy(false);
  };
  const good = rows.filter((r) => r.parts.length);
  const n = good.reduce((s, r) => s + r.parts.length, 0);

  const send = async () => {
    setBusy(true);
    setErr(null);
    let saved = 0;
    let skipped = 0;
    try {
      // 한 번에 너무 크지 않게 300개씩
      const all = good.flatMap((r) => r.parts);
      const products = Object.assign({}, ...good.map((r) => r.products || {}));
      for (let i = 0; i < all.length; i += 300) {
        const r = await api.importPast({ by: me, parts: all.slice(i, i + 300), products: i === 0 && Object.keys(products).length ? products : undefined });
        saved += r.saved;
        skipped += r.skipped;
        setMsg(`보내는 중… ${count(Math.min(all.length, i + 300))} / ${count(all.length)}`);
      }
      setMsg(`${count(saved, "개")} 넣었습니다${skipped ? ` · 이미 A 에서 넣은 ${count(skipped, "개")}는 그대로 둠` : ""}.`);
      setRows([]);
      onDone();
    } catch (e) {
      setErr(`${(e as Error).message} — 넣은 것: ${count(saved, "개")}. 같은 파일을 다시 보내도 두 번 더해지지 않습니다.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-label="지난 자료 한꺼번에 넣기">
      <div className="modal wide">
        <h2>지난 자료 한꺼번에 넣기</h2>
        <div className="row">
          {TABS.map(([k, label]) => (
            <label key={k} className={`radio${kind === k ? " on" : ""}`}>
              <input type="radio" name="kind" checked={kind === k} onChange={() => (setKind(k), setRows([]), setMsg(null), setErr(null))} /> {label}
            </label>
          ))}
        </div>
        {kind === "daily" && (
          <ol className="steps">
            <li>
              백오피스 → <b>상품별 (일자별)</b> → 매장 하나 · 조회일자 길게 → 엑셀. <b>카페아스타나는 한 달씩</b>(조회줄수 5000 때문에 1년이면 12개), <b>아스타나키즈는 6개월씩</b>(2개)
            </li>
            <li>받은 파일을 모두 골라 한 번에 올림 (Ctrl 이나 Shift 를 누르고 여러 개 선택) → 매장은 파일에서 알아냄</li>
            <li>하루 합계만 들어갑니다 (누계 · 작년 비교선 · 방문인원 · 현장 · 이벤트 · 네이버 추정). 카페는 상품 분류표도 채워집니다 — <b>이것을 먼저</b> 하면 ② 의 분류가 정확해집니다</li>
          </ol>
        )}
        {kind === "receipt" && (
          <ol className="steps">
            <li>영수증별 매출 상세현황은 하루씩만 받아집니다. 시간대 분석(4주 같은 요일)은 <b>최근 5주</b>면 충분 — 35일 × 2매장 ≈ 70개</li>
            <li>받은 파일을 모두 골라 한 번에 올림 → 날짜(조회일자) · 매장은 파일마다 알아냄. 같은 날을 다시 올리면 그날이 바뀜</li>
          </ol>
        )}
        {kind === "naver" && (
          <ol className="steps">
            <li>네이버 예약 화면을 주 단위로 띄워 캡처 → Claude 가 표로 정리해 드림 (엑셀 · CSV)</li>
            <li>표 모양: 첫 칸 날짜, 머리글 10:00 · 10:30 … 19:30 (판매 입장권 수). 신규방문자는 지난 자료에 없어 0 으로 둡니다</li>
            <li>A 에서 이미 네이버를 넣은 날은 바꾸지 않습니다</li>
          </ol>
        )}
        <div className="row">
          {kind !== "naver" && (
            <select value={store} onChange={(e) => setStore(e.target.value as StoreId | "auto")} aria-label="매장">
              <option value="auto">매장: 파일에서 알아냄</option>
              <option value="cafe">매장: {STORE_LABEL.cafe}</option>
              <option value="kids">매장: {STORE_LABEL.kids}</option>
            </select>
          )}
          <label className="button ghost">
            파일 고르기 (여러 개 가능)
            <input type="file" multiple accept=".xls,.xlsx,.csv" hidden onChange={(e) => (void onFiles(e.target.files), (e.target.value = ""))} />
          </label>
          {busy && <span className="muted">읽는 중…</span>}
        </div>
        {rows.length > 0 && (
          <div className="table-scroll">
            <table className="list">
              <thead>
                <tr>
                  <th>파일</th>
                  <th>내용</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.file}>
                    <td>{r.file}</td>
                    <td className={r.parts.length ? (r.ok ? "" : "warn") : "error"}>
                      {r.parts.length ? (r.ok ? "✓ " : "⚠ ") : "✗ "}
                      {r.text}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && (
          <p className="muted">
            보낼 것: 파일 {count(good.length, "개")} · {count(n, "일치")}
            {rows.length > good.length ? ` (✗ ${count(rows.length - good.length, "개")}는 빼고)` : ""}
          </p>
        )}
        {err && <p className="error">⚠ {err}</p>}
        {msg && <p className="okmsg">✓ {msg}</p>}
        <div className="row end">
          <button className="ghost" onClick={onClose} disabled={busy}>
            닫기
          </button>
          <button disabled={!n || busy} onClick={send}>
            {busy ? "보내는 중…" : `C 로 보내기 (${count(n, "일치")})`}
          </button>
        </div>
      </div>
    </div>
  );
}
