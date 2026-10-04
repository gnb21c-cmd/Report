/* LOG 기록 — 마감일마다 마감 자료를 올린 사람 이름만 (설정할 것은 모두 A 에서) */
import { useState } from "react";
import { addDays, shortLabel, type Board, type DayReport } from "@report/core";
import { boardKey } from "../data/firebase";

const PART_LABEL = { cafe: "카페", kids: "키즈", naver: "네이버", cash: "자금", extra: "자판기 · 네컷 · 주차" } as const;
type Part = keyof typeof PART_LABEL;

/** 그날 올린 사람 → 맡은 칸들 */
function uploaders(r: DayReport | undefined): { name: string; parts: string[] }[] {
  if (!r) return [];
  const by = new Map<string, Part[]>();
  const add = (name: string | undefined, p: Part) => {
    const n = (name || "").trim() || "이름 없음";
    const xs = by.get(n) || [];
    if (!xs.includes(p)) xs.push(p);
    by.set(n, xs);
  };
  for (const p of ["cafe", "kids", "naver", "cash"] as const) if (r[p]) add(r.meta?.[p]?.by, p);
  if (r.extra) {
    const files = r.extra.files;
    if (files && Object.keys(files).length) for (const f of Object.values(files)) add(f?.by, "extra");
    else add(r.meta?.extra?.by, "extra");
  }
  return [...by.entries()].map(([name, parts]) => ({ name, parts: parts.map((p) => PART_LABEL[p]) }));
}

export function LogScreen({ board, latest, onBack }: { board: Board; latest: string | null; onBack: () => void }) {
  const end = latest || addDays(new Date().toISOString().slice(0, 10), -1);
  const days = Array.from({ length: 14 }, (_, i) => addDays(end, -i));
  return (
    <>
      <header className="detail-head">
        <button className="icon-btn" onClick={onBack} aria-label="뒤로">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1>LOG 기록</h1>
        <span />
      </header>
      <main className="content">
        <section className="card">
          <h2>마감 자료 올린 사람</h2>
          <table>
            <tbody>
              {days.map((d) => {
                const who = uploaders(board.report(d));
                return (
                  <tr key={d}>
                    <td className="log-date">{shortLabel(d)}</td>
                    <td>
                      {who.length ? (
                        who.map((w) => (
                          <div key={w.name}>
                            <b>{w.name}</b>
                            <div className="note">{w.parts.join(" · ")}</div>
                          </div>
                        ))
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <ShareCard />
      </main>
    </>
  );
}

/** 다른 폰(대표님 등)에 설치 주소 보내기 — 카톡 등 공유 창, 안 되면 주소 복사 */
function ShareCard() {
  const [msg, setMsg] = useState<string | null>(null);
  const key = boardKey();
  if (!key || __DEMO__) return null;
  const url = `${location.origin}/b/${key}/`;
  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: "매출 보고", text: "매출 보고 앱 — 링크를 Chrome(아이폰은 Safari)으로 열고 '홈 화면에 설치'를 누르세요", url });
        return;
      }
    } catch {
      return; // 보내기 창을 닫음
    }
    try {
      await navigator.clipboard.writeText(url);
      setMsg("설치 주소를 복사했습니다. 카톡 대화창에 붙여 넣어 보내 주세요.");
    } catch {
      setMsg(url);
    }
  };
  return (
    <section className="card">
      <h2>다른 폰에 설치</h2>
      <p className="sub">이 주소를 아는 폰은 누구나 보고서를 볼 수 있습니다. 볼 사람에게만 보내 주세요.</p>
      <button className="primary" onClick={() => void share()}>
        설치 주소 보내기 (카톡 등)
      </button>
      {msg && <p className="note">{msg}</p>}
    </section>
  );
}
