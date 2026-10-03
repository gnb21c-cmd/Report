/* 영수증별 엑셀 올리는 칸 (매장 하나) — 끌어다 놓기 또는 파일 선택 → 바로 확인 결과 */
import { useRef, useState } from "react";
import { count, STORE_LABEL, won, type PartMeta, type StoreId } from "@report/core";
import type { Loaded } from "./load";
import type { compute } from "./load";

type Computed = ReturnType<typeof compute>;

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export function FileBox(props: { store: StoreId; loaded?: Loaded; result: Computed; onFile: (f: File) => void; onClear: () => void; onUseDate: (d: string) => void; onServer?: PartMeta; date: string }) {
  const { store, loaded: l, result: r } = props;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = () => input.current?.click();
  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) props.onFile(f);
  };
  const part = r?.part;
  return (
    <section className={`filebox${over ? " over" : ""}${l?.error ? " bad" : r ? " good" : ""}`} onDragOver={(e) => (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)} onDrop={drop}>
      <div className="filebox-head">
        <h3>
          <span className="store-tag">{store === "cafe" ? "카페" : "키즈"}</span> {STORE_LABEL[store]}
        </h3>
        {l && (
          <button className="ghost small" onClick={props.onClear}>
            빼기
          </button>
        )}
      </div>
      <input ref={input} type="file" accept=".xls,.xlsx" hidden onChange={(e) => (e.target.files?.[0] && props.onFile(e.target.files[0]), (e.target.value = ""))} />
      {!l ? (
        <button className="drop" onClick={pick}>
          <span className="drop-big">📄 여기에 끌어다 놓거나 눌러서 파일 선택</span>
          <span className="drop-small">
            매장 <b>[{STORE_LABEL[store]}]</b> 으로 받은 '영수증별 매출 상세현황' 엑셀 (예: 영수증별 매출 상세현황 (27).xls)
          </span>
        </button>
      ) : (
        <div className="file-body">
          <div className="file-name">📄 {l.name}</div>
          {l.error ? (
            <div className="file-error">
              ⚠ {l.error}
              <div className="row">
                {l.sheet?.from && l.sheet.from === l.sheet.to && l.sheet.from !== props.date && (
                  <button onClick={() => props.onUseDate(l.sheet!.from!)}>입력 날짜를 {l.sheet.from} 로 바꾸기</button>
                )}
                <button className="ghost" onClick={pick}>
                  다른 파일 고르기
                </button>
              </div>
            </div>
          ) : part ? (
            <table className="mini">
              <tbody>
                <tr>
                  <td>조회일자</td>
                  <td>{l.sheet?.from}</td>
                </tr>
                <tr>
                  <td>실매출 (엑셀 합계)</td>
                  <td>
                    {won(part.posNet)} <span className={r!.check.ok ? "ok" : "warn"}>{r!.check.ok ? "✓ 일치" : `⚠ ${r!.check.text}`}</span>
                  </td>
                </tr>
                {store === "cafe" ? (
                  <tr>
                    <td>팀 · 음료</td>
                    <td>
                      {count(part.teams, "팀")} · {count(part.cups, "잔")}
                    </td>
                  </tr>
                ) : (
                  <tr>
                    <td>입장</td>
                    <td>
                      발행 {count(part.kids?.issued || 0, "장")} · 현장 결제 {count(part.kids?.walkIn || 0, "장")} · 이벤트 무료 {count(part.kids?.eventFree || 0, "팀")}
                    </td>
                  </tr>
                )}
                <tr>
                  <td>반품</td>
                  <td>
                    {r!.matches.length ? `${r!.matches.length}장 찾아서 지움 (${won(part.refunds.amount)})` : "없음"}
                    {r!.unmatched.length > 0 && <div className="warn">⚠ 짝을 못 찾은 반품 {r!.unmatched.length}줄 ({r!.unmatched.map((u) => u.name).join(", ")}) — 금액만 뺌</div>}
                  </td>
                </tr>
                {part.voucher > 0 && (
                  <tr>
                    <td>상품권 결제</td>
                    <td>{won(part.voucher)} (결제 수단 — 매출에서 안 뺌)</td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : null}
          {l.warnings.map((w) => (
            <div key={w} className="warn">
              ⚠ {w}
            </div>
          ))}
        </div>
      )}
      {props.onServer && (
        <div className="server-note">
          클라우드에 올라간 자료: {props.onServer.file || "엑셀"} · {props.onServer.by} {when(props.onServer.at)}
          {l && !l.error ? " → 이번에 보내면 이 파일로 바뀝니다" : ""}
        </div>
      )}
    </section>
  );
}
