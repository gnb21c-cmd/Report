/* LOG 기록 — 마감일마다 마감 자료를 올린 사람 이름만 (설정할 것은 모두 A 에서) */
import { addDays, shortLabel, type Board, type DayReport } from "@report/core";

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
      </main>
    </>
  );
}
