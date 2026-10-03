/* 자판기 · 인생네컷 · 주차정산기 칸 — 나이스 '통합거래조회' 엑셀(비밀번호 걸린 채로)을 끌어다 놓기 또는 선택
   그 칸 단말기의 입력 날짜 매출(승인 − 취소)만 꺼냄. 인생네컷은 두 대라 파일 두 개를 함께 골라도 됨 */
import { useRef, useState } from "react";
import { count, EXTRA_LABEL, EXTRA_TERMINALS, mergeExtra, parseNiceSheet, won, type ExtraKind, type NiceSheet } from "@report/core";
import { readRows } from "./excel";
import { decryptXlsx, isEncrypted } from "./officeCrypto";

export interface ExtraLoaded {
  names: string[];
  /** 입력 날짜 매출 */
  value: number;
  /** 그날 건 수 */
  lines: number;
  error?: string;
  sheets: NiceSheet[];
}

const terminals = (k: ExtraKind) =>
  Object.entries(EXTRA_TERMINALS)
    .filter(([, v]) => v === k)
    .map(([c]) => c);

/** 파일들 → 그 칸 · 그 날짜 매출 */
export async function loadExtra(kind: ExtraKind, files: File[], date: string, password: string): Promise<ExtraLoaded> {
  const names = files.map((f) => f.name);
  const sheets: NiceSheet[] = [];
  try {
    for (const f of files) {
      let buf = await f.arrayBuffer();
      if (isEncrypted(buf)) buf = await decryptXlsx(buf, password);
      const s = parseNiceSheet(readRows(buf));
      if (!s) throw new Error(`${f.name}: 나이스 '통합거래조회' 엑셀 모양이 아닙니다.`);
      if (s.from && (date < s.from || date > s.to)) throw new Error(`${f.name}: 조회 기간이 ${s.from} ~ ${s.to} 라 ${date} 가 없습니다. 거래일자를 ${date} 로 받아 주세요.`);
      const other = s.kinds.filter((k) => k !== kind);
      if (other.length && !s.kinds.includes(kind)) throw new Error(`${f.name}: ${other.map((k) => EXTRA_LABEL[k]).join(" · ")} 단말기 파일입니다. ${EXTRA_LABEL[kind]} 칸에는 ${terminals(kind).join(" · ")} 를 받아 올려 주세요.`);
      sheets.push(s);
    }
  } catch (e) {
    return { names, value: 0, lines: 0, error: (e as Error).message, sheets: [] };
  }
  const day = mergeExtra(sheets).get(date);
  const lines = sheets.reduce((a, s) => a + s.items.filter((it) => it.date === date && it.kind === kind).length, 0);
  return { names, value: day ? day[kind] : 0, lines, sheets };
}

export function ExtraBox(props: { kind: ExtraKind; loaded?: ExtraLoaded; busy?: boolean; onFiles: (fs: File[]) => void; onClear: () => void; serverValue?: number; locked?: boolean; date: string }) {
  const { kind, loaded: l } = props;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = () => input.current?.click();
  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const fs = Array.from(e.dataTransfer.files || []);
    if (fs.length) props.onFiles(fs);
  };
  return (
    <section className={`filebox extrabox${over ? " over" : ""}${l?.error ? " bad" : l ? " good" : ""}`} onDragOver={(e) => (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)} onDrop={drop}>
      <input ref={input} type="file" accept=".xlsx,.xls" multiple hidden onChange={(e) => (e.target.files?.length && props.onFiles(Array.from(e.target.files)), (e.target.value = ""))} />
      {!l && props.locked && props.serverValue != null ? (
        <table className="mini">
          <tbody>
            <tr>
              <td>매출</td>
              <td>{won(props.serverValue)}</td>
            </tr>
          </tbody>
        </table>
      ) : props.busy ? (
        <div className="file-body muted">파일을 푸는 중…</div>
      ) : !l ? (
        <button className="drop" onClick={pick} disabled={props.locked}>
          <span className="drop-big">📄 끌어다 놓거나 눌러서 선택</span>
          <span className="drop-small">
            나이스 통합거래조회 · 단말기 <b>{terminals(kind).join(" · ")}</b>
          </span>
        </button>
      ) : (
        <div className="file-body">
          <div className="file-name">
            📄 {l.names.join(", ")}
            {!props.locked && (
              <button className="ghost small" onClick={props.onClear}>
                빼기
              </button>
            )}
          </div>
          {l.error ? (
            <div className="file-error">
              ⚠ {l.error}
              <div className="row">
                <button className="ghost" onClick={pick}>
                  다른 파일 고르기
                </button>
              </div>
            </div>
          ) : (
            <table className="mini">
              <tbody>
                <tr>
                  <td>{props.date.slice(5).replace("-", "/")} 매출</td>
                  <td>
                    <b>{won(l.value)}</b> · {count(l.lines, "건")}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
