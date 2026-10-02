/* 지난 자료 한꺼번에 넣기 — '상품별 (일자별)' 엑셀(기간 길게)을 매장별로 올려 작년 비교선을 채움
   시간대·팀은 없음. 이미 영수증별로 올린 날은 건드리지 않음. 카페는 OK포스 대분류로 상품 분류표도 채움 */
import { useState } from "react";
import { buildDailyPart, count, parseDailySheet, sectorFromCategory, sectorLookup, SheetError, STORE_LABEL, won, type DailySheet, type StoreId } from "@report/core";
import { readRows } from "./excel";
import { api } from "./api";

export function ImportPast({ me, table, onClose, onDone }: { me: string; table: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const [store, setStore] = useState<StoreId>("cafe");
  const [file, setFile] = useState<{ name: string; sheet: DailySheet } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const onFile = async (f: File) => {
    setErr(null);
    setMsg(null);
    setFile(null);
    try {
      const sheet = parseDailySheet(readRows(await f.arrayBuffer()));
      if (sheet.truncated) throw new SheetError("조회줄수 제한에 걸려 잘린 파일입니다. 기간을 나눠서 받아 주세요.");
      setFile({ name: f.name, sheet });
    } catch (e) {
      setErr(e instanceof SheetError ? e.message : "엑셀을 읽지 못했습니다 — '상품별 (일자별)' 엑셀이 맞는지 확인해 주세요.");
    }
  };
  const total = file ? [...file.sheet.days.values()].flat().reduce((s, l) => s + l.net, 0) : 0;

  const send = async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const products: Record<string, string> = {};
      if (store === "cafe") for (const [name, cat] of file.sheet.categories) products[name] = sectorFromCategory(cat) || "기타";
      const look = sectorLookup({ ...table, ...products });
      const parts = [...file.sheet.days.entries()].sort().map(([date, rows]) => buildDailyPart({ store, date, file: file.name, rows, sectorOf: look }));
      const r = await api.importPast({ by: me, parts, products: store === "cafe" ? products : undefined });
      setMsg(`${count(r.saved, "일")} 넣었습니다${r.skipped ? ` · 이미 영수증별로 올린 ${count(r.skipped, "일")}은 그대로 둠` : ""}.`);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-label="지난 자료 한꺼번에 넣기">
      <div className="modal wide">
        <h2>지난 자료 한꺼번에 넣기 (작년 비교용)</h2>
        <ol className="steps">
          <li>백오피스(nice.okpos.co.kr) → <b>상품별 (일자별)</b> 화면 → 매장을 하나 고르고, 조회일자를 길게 (예: 2025-01-01 ~ 2025-12-31) → 엑셀 받기</li>
          <li>아래에서 매장을 고르고 그 엑셀을 올림 → <b>C 로 보내기</b> (매장마다 한 번씩)</li>
          <li>하루 합계만 들어갑니다 (시간대 그래프는 영수증별 엑셀로 올린 날만 나옴). 이미 영수증별로 올린 날은 바꾸지 않습니다.</li>
        </ol>
        <div className="row">
          {(["cafe", "kids"] as StoreId[]).map((s) => (
            <label key={s} className={`radio${store === s ? " on" : ""}`}>
              <input type="radio" name="store" checked={store === s} onChange={() => (setStore(s), setFile(null))} /> {STORE_LABEL[s]}
            </label>
          ))}
          <label className="button ghost">
            상품별 (일자별) 엑셀 고르기
            <input type="file" accept=".xls,.xlsx" hidden onChange={(e) => (e.target.files?.[0] && onFile(e.target.files[0]), (e.target.value = ""))} />
          </label>
        </div>
        {file && (
          <table className="mini">
            <tbody>
              <tr>
                <td>파일</td>
                <td>{file.name}</td>
              </tr>
              <tr>
                <td>기간</td>
                <td>
                  {file.sheet.from} ~ {file.sheet.to} · 자료 있는 날 {count(file.sheet.days.size, "일")}
                </td>
              </tr>
              <tr>
                <td>실매출 합</td>
                <td>
                  {won(total)} {file.sheet.totalOk ? <span className="ok">✓ 합계 줄과 일치</span> : <span className="warn">⚠ 합계 줄과 다름</span>}
                </td>
              </tr>
              {store === "cafe" && (
                <tr>
                  <td>상품 분류</td>
                  <td>대분류가 있는 상품 {count(file.sheet.categories.size, "개")} → 분류표에 저장</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        {err && <p className="error">⚠ {err}</p>}
        {msg && <p className="okmsg">✓ {msg}</p>}
        <div className="row end">
          <button className="ghost" onClick={onClose}>
            닫기
          </button>
          <button disabled={!file || busy} onClick={send}>
            {busy ? "보내는 중…" : "C 로 보내기"}
          </button>
        </div>
      </div>
    </div>
  );
}
