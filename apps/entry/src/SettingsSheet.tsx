/* ⚙ 설정 — 아래에서 올라오는 창. 해마다 · 때때로 바뀌는 보고 기준만 (클라우드 settings/main, 보고 앱도 씀)
   ① 기간 스티커: 성수기(빨강) · 평상시(노랑) · 비수기(파랑) — 해마다 같은 월·일, 위에서부터 먼저 맞는 것, 나머지는 평상시
   ② 휴일 달력: 토 · 일 · 공휴일(대체공휴일 · 알려진 임시공휴일 포함)은 자동 빨강.
      평일을 누르면 휴일 더하기(갑자기 정한 임시공휴일 등), 자동 공휴일을 누르면 휴일 빼기(쉬지 않는 날) — 키즈 휴일 단가 · 숏타임 단가 · 휴일 표시에 쓰임 */
import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, EXTRA_HOLIDAYS, HOLIDAYS, seasonIn, weekday, type ReportSettings, type SeasonKind, type SeasonRule } from "@report/core";

const KINDS: SeasonKind[] = ["성수기", "평상시", "비수기"];
const KIND_CLASS: Record<SeasonKind, string> = { 성수기: "s-hot", 평상시: "s-normal", 비수기: "s-low" };
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n: number) => String(n).padStart(2, "0");

export function SettingsSheet(props: { initial: ReportSettings; busy: boolean; onSave: (s: ReportSettings) => void; onClose: () => void }) {
  const [s, setS] = useState<ReportSettings>(() => JSON.parse(JSON.stringify(props.initial)));
  const [ym, setYm] = useState(() => new Date().toISOString().slice(0, 7));
  const dirty = JSON.stringify(s) !== JSON.stringify(props.initial);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [props]);

  const setRule = (i: number, r: Partial<SeasonRule>) => setS({ ...s, seasons: s.seasons.map((x, j) => (j === i ? { ...x, ...r } : x)) });
  const move = (i: number, d: -1 | 1) => {
    const xs = [...s.seasons];
    const j = i + d;
    if (j < 0 || j >= xs.length) return;
    [xs[i], xs[j]] = [xs[j], xs[i]];
    setS({ ...s, seasons: xs });
  };
  const okMd = (v: string) => /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);
  const bad = s.seasons.some((r) => !okMd(r.from) || !okMd(r.to));

  /* 휴일 달력 */
  const [y, m] = ym.split("-").map(Number);
  const first = `${ym}-01`;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = weekday(first);
  const auto = (d: string) => HOLIDAYS[d] || EXTRA_HOLIDAYS[d] || null;
  const toggle = (d: string) => {
    const w = weekday(d);
    if (s.holidaysAdd[d]) {
      const add = { ...s.holidaysAdd };
      delete add[d];
      return setS({ ...s, holidaysAdd: add });
    }
    if (auto(d)) {
      const off = s.holidaysOff.includes(d) ? s.holidaysOff.filter((x) => x !== d) : [...s.holidaysOff, d].sort();
      return setS({ ...s, holidaysOff: off });
    }
    if (w === 0 || w === 6) return; // 토 · 일은 늘 휴일
    const name = window.prompt(`${d} 를 휴일로 더합니다. 이름을 적어 주세요.`, "임시공휴일");
    if (name == null) return;
    setS({ ...s, holidaysAdd: { ...s.holidaysAdd, [d]: name.trim() || "임시공휴일" } });
  };
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setYm(d.toISOString().slice(0, 7));
  };

  return (
    <div className="sheet-bg" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <section className="sheet settings-sheet" role="dialog" aria-modal="true" aria-label="설정">
        <header className="sheet-head">
          <h2>⚙ 설정</h2>
          <span className="hint">보고 앱의 기간 스티커 · 휴일(키즈 휴일 단가)에 바로 쓰입니다. 바꾼 뒤 [저장]</span>
          <button className="ghost" onClick={() => setS(JSON.parse(JSON.stringify({ ...DEFAULT_SETTINGS })))} disabled={props.busy}>
            처음 값으로
          </button>
          <button className="ghost" onClick={props.onClose} disabled={props.busy}>
            닫기
          </button>
          <button className="primary" onClick={() => props.onSave(s)} disabled={!dirty || bad || props.busy}>
            {props.busy ? "저장 중…" : "저장"}
          </button>
        </header>
        <div className="sheet-body settings-body">
          <section>
            <h3>① 기간 스티커 (해마다 같은 월·일)</h3>
            <p className="hint">위에서부터 먼저 맞는 기간을 씁니다. 어디에도 없는 날은 평상시. 날짜는 월-일 (예: 07-20). 해를 넘겨도 됩니다 (12-24 ~ 02-28)</p>
            <table className="list season-table">
              <thead>
                <tr>
                  <th>종류</th>
                  <th>시작</th>
                  <th>끝</th>
                  <th>이름</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {s.seasons.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <select className={`season-pick ${KIND_CLASS[r.kind]}`} value={r.kind} onChange={(e) => setRule(i, { kind: e.target.value as SeasonKind })}>
                        {KINDS.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input className={okMd(r.from) ? "" : "bad"} value={r.from} onChange={(e) => setRule(i, { from: e.target.value.trim() })} placeholder="MM-DD" size={6} />
                    </td>
                    <td>
                      <input className={okMd(r.to) ? "" : "bad"} value={r.to} onChange={(e) => setRule(i, { to: e.target.value.trim() })} placeholder="MM-DD" size={6} />
                    </td>
                    <td>
                      <input value={r.name} onChange={(e) => setRule(i, { name: e.target.value })} placeholder="예: 여름방학" />
                    </td>
                    <td className="row-tools">
                      <button className="ghost small" onClick={() => move(i, -1)} disabled={i === 0} aria-label="위로">
                        ▲
                      </button>
                      <button className="ghost small" onClick={() => move(i, 1)} disabled={i === s.seasons.length - 1} aria-label="아래로">
                        ▼
                      </button>
                      <button className="ghost small" onClick={() => setS({ ...s, seasons: s.seasons.filter((_, j) => j !== i) })} aria-label="지우기">
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="ghost" onClick={() => setS({ ...s, seasons: [...s.seasons, { kind: "성수기", from: "01-01", to: "01-01", name: "" }] })}>
              + 기간 추가
            </button>
            {bad && <p className="error">날짜는 월-일 (예: 07-20) 로 적어 주세요.</p>}
          </section>

          <section>
            <h3>② 휴일 달력</h3>
            <p className="hint">토 · 일 · 공휴일(대체공휴일 포함)은 자동으로 빨강입니다. 평일을 누르면 휴일로 더하고(임시공휴일 등), 자동 공휴일을 누르면 휴일에서 뺍니다. 아래 색 줄 = 그날 기간 스티커</p>
            <div className="cal-head">
              <button className="ghost small" onClick={() => shift(-1)} aria-label="지난달">
                ◀
              </button>
              <b>
                {y}년 {m}월
              </b>
              <button className="ghost small" onClick={() => shift(1)} aria-label="다음 달">
                ▶
              </button>
            </div>
            <div className="hcal">
              {WD.map((w, i) => (
                <div key={w} className={`hcal-wd ${i === 0 || i === 6 ? "off" : ""}`}>
                  {w}
                </div>
              ))}
              {Array.from({ length: lead }, (_, i) => (
                <div key={`e${i}`} />
              ))}
              {Array.from({ length: days }, (_, i) => {
                const d = `${ym}-${pad(i + 1)}`;
                const w = weekday(d);
                const added = s.holidaysAdd[d];
                const a = auto(d);
                const off = a && s.holidaysOff.includes(d);
                const red = added || (a && !off) || w === 0 || w === 6;
                const season = seasonIn(s.seasons, d);
                return (
                  <button key={d} className={`hcal-day${red ? " red" : ""}${added ? " added" : ""}${off ? " removed" : ""}`} onClick={() => toggle(d)} title={added || (a ? `${a}${off ? " (휴일에서 뺌)" : ""}` : "")}>
                    <span className="hd-n">{i + 1}</span>
                    <span className="hd-name">{added ? `+${added}` : a ? a : ""}</span>
                    <span className={`hd-season ${KIND_CLASS[season.kind]}`} />
                  </button>
                );
              })}
            </div>
            <p className="hint">
              <span className="legend red">■</span> 휴일 · <span className="legend added">+</span> 더한 휴일 · <s>줄 그음</s> 뺀 공휴일 · 색 줄: <span className="legend s-hot">■</span> 성수기 <span className="legend s-normal">■</span> 평상시 <span className="legend s-low">■</span> 비수기
            </p>
          </section>
        </div>
      </section>
    </div>
  );
}
