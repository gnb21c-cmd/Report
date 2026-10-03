/* ============================================================
   지난 자료 한꺼번에 넣기 (작년 비교선 · 시간대 분석을 빨리 채우려고) — 파일을 여러 개 한 번에 골라도 됨
   ① 상품별 (일자별) 엑셀: 기간으로 받음 (카페는 조회줄수 때문에 한 달씩, 키즈는 6개월씩) → 하루 합계. 카페는 OK포스 대분류로 분류표도 채움
   ② 영수증별 매출 상세현황 엑셀: 하루치만 받아지므로 여러 날 파일을 한꺼번에 → 날짜 · 매장은 파일에서 알아냄 (시간대 분석은 최근 5주면 충분)
   ③ 네이버 지난 자료: 주 단위 화면 캡처를 정리한 표 (날짜 × 10:00~19:30)
   ④ Claude 가 정리한 파일 (.json): 자금(날짜별 자금현황표) · 매출(상품별 엑셀 여러 개를 하나로 묶은 것) — 이미 넣은 날은 그대로 둠
   ⑤ 자판기 · 인생네컷 · 주차 (POS 밖 카드 매출): 나이스 '통합거래조회' 엑셀 (비밀번호 걸린 채로) — 파일에 든 종류 · 기간만 바꿈
   이미 A 에서 넣은 날(영수증별 · 네이버)은 상품별 · 네이버 정리표로 덮지 않음
   ============================================================ */
import { useState } from "react";
import {
  cashBook,
  cleanCashPart,
  EXTRA_LABEL,
  extraUpdates,
  parseNiceSheet,
  type NiceSheet,
  money,
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
  type CashPart,
  type NaverPart,
  type StoreId,
  type StorePart,
} from "@report/core";
import { readRows } from "./excel";
import { decryptXlsx, isEncrypted } from "./officeCrypto";
import { api, type PastPart } from "./api";

type Kind = "daily" | "receipt" | "naver" | "cash" | "extra";
const TABS: [Kind, string][] = [
  ["daily", "① 상품별 (일자별) — 1년치 하루 합계"],
  ["receipt", "② 영수증별 — 여러 날 파일"],
  ["naver", "③ 네이버 지난 자료"],
  ["cash", "④ Claude 정리 파일 (자금 · 매출)"],
  ["extra", "⑤ 자판기 · 네컷 · 주차 (나이스)"],
];

interface Row {
  file: string;
  ok: boolean;
  text: string;
  parts: PastPart[];
  products?: Record<string, string>;
  /** ⑤ 나이스 엑셀 */
  nice?: NiceSheet;
}

/** 파일 하나 → 보낼 조각들 + 한 줄 설명 */
async function readOne(kind: Kind, f: File, table: Record<string, string>, store: StoreId | "auto", password: string): Promise<Row> {
  try {
    if (kind === "extra") {
      let buf = await f.arrayBuffer();
      if (isEncrypted(buf)) {
        try {
          buf = await decryptXlsx(buf, password);
        } catch (e) {
          throw new SheetError((e as Error).message || "비밀번호 걸린 엑셀을 풀지 못했습니다.");
        }
      }
      const s = parseNiceSheet(readRows(buf));
      if (!s) throw new SheetError("나이스 '통합거래조회' 엑셀 모양이 아닙니다 (CAT_ID · 거래일자 칸이 없음).");
      const ok = s.summary == null || Math.round(s.sum - s.summary) === 0;
      const unknown = Object.entries(s.unknown);
      const kinds = s.kinds.map((k) => EXTRA_LABEL[k]).join(" · ") || "해당 단말기 건 없음";
      return {
        file: f.name,
        ok: ok && !unknown.length,
        text: `${s.from} ~ ${s.to} · ${kinds} · ${won(s.sum - s.cafePos - unknown.reduce((a, [, v]) => a + v, 0))}${s.cafePos ? ` (카페 POS 결제 ${won(s.cafePos)} 뺌)` : ""}${unknown.length ? ` · ⚠ 모르는 단말기 ${unknown.map(([c, v]) => `${c} ${won(v)}`).join(", ")} 뺌` : ""}${ok ? "" : " · ⚠ 위 합계 줄과 다름"}`,
        parts: [],
        nice: s,
      };
    }
    if (kind === "cash") {
      // Claude 가 정리한 파일: { kind: "cash", parts: CashPart[] }
      let j: any;
      try {
        j = JSON.parse(await f.text());
      } catch {
        throw new SheetError("자금 지난 자료 파일(.json)이 아닙니다.");
      }
      if (j && j.kind === "sales" && Array.isArray(j.parts) && j.parts.length) {
        // 매출: 상품별(일자별) 엑셀 여러 개를 Claude 가 미리 계산해 묶은 것 (매장 하루치들 + 상품 분류표)
        const parts = (j.parts as StorePart[]).filter((p) => p && (p.store === "cafe" || p.store === "kids") && /^\d{4}-\d{2}-\d{2}$/.test(p.date || "")).sort((a, b) => a.date.localeCompare(b.date));
        const span = (st: StoreId) => {
          const xs = parts.filter((p) => p.store === st);
          return xs.length ? `${STORE_LABEL[st]} ${xs[0].date} ~ ${xs[xs.length - 1].date} · ${count(xs.length, "일")} · 실매출 ${won(xs.reduce((s, p) => s + p.posNet, 0))}` : `${STORE_LABEL[st]} 없음`;
        };
        return { file: f.name, ok: true, text: `${span("cafe")} / ${span("kids")}`, parts, products: j.products && typeof j.products === "object" ? j.products : undefined };
      }
      if (!j || j.kind !== "cash" || !Array.isArray(j.parts) || !j.parts.length) throw new SheetError("Claude 가 정리한 파일(자금 · 매출) 모양이 아닙니다.");
      const parts = (j.parts as CashPart[]).filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p?.date || "")).map(cleanCashPart).sort((a, b) => a.date.localeCompare(b.date));
      const book = cashBook(parts);
      const last = book.get(parts[parts.length - 1].date)!;
      return { file: f.name, ok: true, text: `${parts[0].date} ~ ${last.date} · ${count(parts.length, "일")} · 마지막 날 잔액 합계 ${money(last.total, "KRW", false)}원`, parts };
    }
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
  // 나이스 엑셀 비밀번호 (내려받을 때 넣은 것 — 저장하지 않음)
  const [password, setPassword] = useState("1");
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
    for (const f of Array.from(files).sort((a, b) => a.name.localeCompare(b.name, "ko"))) out.push(await readOne(kind, f, table, store, password));
    setRows(out);
    setBusy(false);
  };
  const good = rows.filter((r) => r.parts.length || r.nice);
  const updates = kind === "extra" ? extraUpdates(good.map((r) => r.nice!)) : [];
  // 네이버는 10:00~17:30 캡처와 18:00~19:30(야간 무제한) 캡처가 따로 오므로 같은 날짜를 파일끼리 합침
  const mergeNaver = (parts: PastPart[]): PastPart[] => {
    const by = new Map<string, NaverPart>();
    for (const p of parts as NaverPart[]) {
      const o = by.get(p.date);
      by.set(p.date, o ? { ...o, tickets: o.tickets.map((v, i) => v + (p.tickets[i] || 0)) } : p);
    }
    return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
  };
  const n = kind === "extra" ? updates.length : good.reduce((s, r) => s + r.parts.length, 0);

  const send = async () => {
    setBusy(true);
    setErr(null);
    let saved = 0;
    let skipped = 0;
    try {
      if (kind === "extra") {
        const file = good.map((r) => r.file).join(", ").slice(0, 200);
        for (let i = 0; i < updates.length; i += 300) {
          const r = await api.importExtra({ by: me, updates: updates.slice(i, i + 300), file });
          saved += r.saved;
          setMsg(`보내는 중… ${count(Math.min(updates.length, i + 300))} / ${count(updates.length)}`);
        }
        setMsg(`${count(saved, "일치")} 넣었습니다 (자판기 · 네컷 · 주차).`);
        setRows([]);
        onDone();
        return;
      }
      // 한 번에 너무 크지 않게 300개씩
      const flat = good.flatMap((r) => r.parts);
      const all = kind === "naver" ? mergeNaver(flat) : flat;
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
        {kind === "cash" && (
          <ol className="steps">
            <li>Claude 에게 엑셀을 주면 A 모양으로 바꾼 파일(.json)을 돌려 드립니다 → 그 파일을 여기에 올림</li>
            <li>매출 파일: 상품별(일자별) 엑셀 여러 개를 하나로 묶은 것 — ① 에 하나씩 올린 것과 같음 (영수증별로 이미 넣은 날은 그대로)</li>
            <li>전일 잔고는 맨 첫날만 쓰고 그 뒤는 앞 보고의 금일 잔고로 이어짐 · 엑셀과 다른 곳은 '(잔고 맞춤)' 줄로 표시</li>
            <li>자금 파일: A 에서 이미 자금을 올린 날은 바꾸지 않습니다</li>
          </ol>
        )}
        {kind === "extra" && (
          <ol className="steps">
            <li>
              나이스 가맹점 사이트 → <b>통합거래조회</b> → 단말기(자판기 3974466 · 주차 3974965 · 인생네컷 3974963 · 3974964) · 기간 → 엑셀. 단말기마다 따로 받아도 되고, 여러 파일을 한 번에 올려도 됩니다
            </li>
            <li>내려받을 때 넣은 비밀번호를 아래 칸에 (풀기만 하고 저장하지 않음)</li>
            <li>파일 기간 안의 날은 그 파일 종류(자판기 · 네컷 · 주차)만 새 값으로 바뀝니다 — 같은 파일을 다시 올려도 두 번 더해지지 않음. 승인거절은 빼고 취소는 뺌</li>
            <li>2026-07-01 하루는 자판기 번호에 카페 POS 결제가 섞여 있어 카페 POS 단말기 결제를 뺍니다 (카페 매출에 이미 있음)</li>
          </ol>
        )}
        {kind === "naver" && (
          <ol className="steps">
            <li>네이버 예약 화면을 주 단위로 띄워 캡처 → Claude 가 표로 정리해 드림 (엑셀 · CSV)</li>
            <li>표 모양: 첫 칸 날짜, 머리글 10:00 · 10:30 … 19:30 (판매 입장권 수). 10:00~17:30 표와 18:00~19:30(야간 무제한) 표를 따로 올려도 같은 날짜는 합쳐짐</li>
            <li>신규방문자는 지난 자료로는 알 수 없어 '—' 로 보입니다 (A 에 직접 넣는 날부터)</li>
            <li>A 에서 이미 네이버를 넣은 날은 바꾸지 않습니다</li>
          </ol>
        )}
        <div className="row">
          {(kind === "daily" || kind === "receipt") && (
            <select value={store} onChange={(e) => setStore(e.target.value as StoreId | "auto")} aria-label="매장">
              <option value="auto">매장: 파일에서 알아냄</option>
              <option value="cafe">매장: {STORE_LABEL.cafe}</option>
              <option value="kids">매장: {STORE_LABEL.kids}</option>
            </select>
          )}
          {kind === "extra" && (
            <label>
              엑셀 비밀번호 <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: 80 }} autoComplete="off" />
            </label>
          )}
          <label className="button ghost">
            파일 고르기 (여러 개 가능)
            <input type="file" multiple accept={kind === "cash" ? ".json" : kind === "extra" ? ".xlsx,.xls" : ".xls,.xlsx,.csv"} hidden onChange={(e) => (void onFiles(e.target.files), (e.target.value = ""))} />
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
                    <td className={r.parts.length || r.nice ? (r.ok ? "" : "warn") : "error"}>
                      {r.parts.length || r.nice ? (r.ok ? "✓ " : "⚠ ") : "✗ "}
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
            {busy ? "보내는 중…" : `클라우드로 보내기 (${count(n, "일치")})`}
          </button>
        </div>
      </div>
    </div>
  );
}
