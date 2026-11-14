/* 돈까스 재방문 이벤트 — 자세히 분석 (2026-11-14 사장님)
   키즈 포스 PC 에서 이 화면을 열고 통합데스크 방문 기록 파일(visit-history.json)을 고르면
   그 PC 브라우저 안에서만 계산 → 손님 기호가 없는 요약 숫자만 클라우드(deskStats/study-revisit)에 저장 → 폰에서도 보임
   계산 · 통계 방법: packages/core/src/revisitStudy.ts */
import { useEffect, useState } from "react";
import {
  parseVisitHistory,
  revisitStudy,
  shortLabel,
  type Cohort,
  type Desc,
  type OE,
  type RevisitStudy,
} from "@report/core";
import { studyRead, studySave } from "../data/firebase";

const FOLDER = "%APPDATA%\\아스타나키즈 입장 데스크";
/** 파일 고르는 창 '파일 이름' 칸에 그대로 붙여 넣으면 바로 그 파일 (폴더를 찾아 들어가지 않아도 됨 — 2026-11-14 사장님 "폴더를 못 찾는 것 같은데") */
const FILE = `${FOLDER}\\visit-history.json`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
/** 비율 포인트 (+3.2%p) */
const pp = (x: number) => `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%p`;
/** 표 안 95% 범위 — 단위 없이 짧게 (폰 폭) */
const rng = (lo: number, hi: number) => `${(lo * 100).toFixed(1)}~${(hi * 100).toFixed(1)}`;
const rngP = (lo: number, hi: number) =>
  `${lo > 0 ? "+" : ""}${(lo * 100).toFixed(1)}~${hi > 0 ? "+" : ""}${(hi * 100).toFixed(1)}`;
const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const pv = (p: number) => (p < 0.001 ? "<0.001" : p.toFixed(3));
const sig = (p: number) => (p < 0.05 ? "우연으로 보기 어려운 차이" : "아직 우연과 구분되지 않음");
const COLOR: Record<string, string> = {
  event: "var(--cur)",
  near: "var(--series-1)",
  autumn: "var(--muted)",
  all: "var(--baseline)",
};
const BASE_NAME: Record<string, string> = {
  near: "직전 같은 기간",
  autumn: "9월 ~ 이벤트 전",
  all: "기록 처음 ~ 이벤트 전",
};
const dt = (iso: string) => {
  const d = new Date(iso);
  return isNaN(+d)
    ? iso
    : d.toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};

export function RevisitStudyScreen({ onBack }: { onBack: () => void }) {
  const [s, setS] = useState<RevisitStudy | null>(null);
  const [from, setFrom] = useState<"cloud" | "file" | null>(null);
  const [state, setState] = useState<"loading" | "idle" | "busy">("loading");
  const [msg, setMsg] = useState("");
  const [save, setSave] = useState("");
  const [copied, setCopied] = useState("");
  const [over, setOver] = useState(false);
  // 복사 — 클립보드가 막히면(오래된 브라우저 · 권한) 숨긴 글상자로 한 번 더
  const copy = (text: string, what: string) => {
    const fallback = () => {
      const t = document.createElement("textarea");
      t.value = text;
      t.style.position = "fixed";
      t.style.opacity = "0";
      document.body.appendChild(t);
      t.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      t.remove();
      setCopied(ok ? what : "fail");
    };
    if (navigator.clipboard?.writeText)
      navigator.clipboard.writeText(text).then(() => setCopied(what), fallback);
    else fallback();
  };

  useEffect(() => {
    let alive = true;
    studyRead().then(
      (x) => {
        if (!alive) return;
        if (x) {
          setS(x);
          setFrom("cloud");
        }
        setState("idle");
      },
      () => alive && setState("idle"),
    );
    return () => {
      alive = false;
    };
  }, []);

  async function pick(f: File | undefined) {
    if (!f) return;
    setState("busy");
    setMsg("");
    setSave("");
    try {
      const data = parseVisitHistory(await f.text());
      if (!data || !data.visits.size) {
        setMsg("방문 기록 파일이 아니에요 — 폴더 안의 visit-history.json 을 골라 주세요.");
        return;
      }
      const r = revisitStudy(data);
      setS(r);
      setFrom("file");
      setSave("클라우드에 요약을 저장하는 중…");
      studySave(r).then(
        () => setSave("요약을 클라우드에 저장했어요 — 폰 보고 앱에서도 이 결과가 보여요."),
        (e) =>
          setSave(
            `저장하지 못했어요: ${String((e && e.message) || e)} (결과는 이 화면에서 그대로 볼 수 있어요)`,
          ),
      );
    } catch (e) {
      setMsg(`파일을 읽지 못했어요: ${String((e && (e as Error).message) || e)}`);
    } finally {
      setState("idle");
    }
  }

  return (
    <>
      <header className="detail-head">
        <button className="icon-btn" onClick={onBack} aria-label="뒤로">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <path
              d="M15 6l-6 6 6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <h1>돈까스 재방문 분석</h1>
        <span />
      </header>
      <main className="content study">
        <section
          className={`card${over ? " study-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            pick(e.dataTransfer.files?.[0]);
          }}
        >
          <h2>키즈 포스에서 새로 계산하기</h2>
          <ol className="study-steps">
            <li>
              키즈 포스 PC 에서 이 화면을 열고 <b>[① 파일 위치 복사]</b>를 누릅니다.
            </li>
            <li>
              <b>[② 방문 기록 파일 고르기]</b> → 열린 창 <b>맨 아래 '파일 이름' 칸</b>에 붙여 넣기(Ctrl+V) →{" "}
              <b>[열기]</b>. 폴더를 찾아 들어가지 않아도 바로 그 파일이 골라져요.
            </li>
            <li>
              계산은 이 PC 브라우저 안에서만 해요. 손님 기호(해시)는 밖으로 나가지 않고, 요약 숫자만
              클라우드에 저장됩니다.
            </li>
          </ol>
          <button className="ghost study-copy" onClick={() => copy(FILE, "file")}>
            {copied === "file" ? "복사했어요 ✓ — 이제 ② 를 누르세요" : "① 파일 위치 복사"}
          </button>
          <code className="study-path study-path-line">{FILE}</code>
          {copied === "fail" && (
            <p className="note">복사가 안 돼요 — 위 글을 마우스로 끌어 골라 Ctrl+C 로 복사해 주세요.</p>
          )}
          <label className={`study-pick${state === "busy" ? " busy" : ""}`}>
            <input
              type="file"
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = ""; // 같은 파일을 다시 골라도 다시 계산
              }}
              disabled={state === "busy"}
            />
            {state === "busy" ? "계산하는 중…" : "② 방문 기록 파일 고르기"}
          </label>
          <p className="note">
            다른 방법: 키보드 <b>Windows 키 + R</b> → [폴더 위치 복사]한 것을 붙여 넣고 [확인] → 열린 폴더의{" "}
            <b>visit-history</b> 파일을 이 칸으로 끌어다 놓기.{" "}
            <button className="ghost small" onClick={() => copy(FOLDER, "folder")}>
              {copied === "folder" ? "복사했어요 ✓" : "폴더 위치 복사"}
            </button>
          </p>
          <p className="note">
            Windows 키 + R 로 열었는데 "찾을 수 없습니다"가 나오면 이 PC 가 통합데스크(방문 기록)를 쓰는 PC 가
            아니에요 — 네이버 이용완료를 읽는 키즈 포스 PC 에서 해 주세요.
          </p>
          {msg && <p className="bad">{msg}</p>}
          {save && <p className="note">{save}</p>}
        </section>

        {state === "loading" && <p className="sub">저장된 분석을 받는 중입니다…</p>}
        {state !== "loading" && !s && (
          <p className="sub">아직 저장된 분석이 없어요 — 키즈 포스 PC 에서 위 단추로 한 번 계산해 주세요.</p>
        )}
        {s && <Result s={s} from={from} />}
      </main>
    </>
  );
}

function Result({ s, from }: { s: RevisitStudy; from: "cloud" | "file" | null }) {
  const ev = s.cohorts.find((c) => c.key === "event")!;
  const near = s.cohorts.find((c) => c.key === "near");
  const cNear = s.compare.find((c) => c.base === "near");
  const cAut = s.compare.find((c) => c.base === "autumn");
  const D = s.event.deadline;
  const pair = s.paired.h14 || s.paired.h7;
  const evDays = Math.round((Date.parse(s.data.to) - Date.parse(s.event.from)) / 864e5) + 1;
  return (
    <>
      <p className="sub study-made">
        {from === "file" ? "방금 이 PC 에서 계산" : "클라우드에 저장된 분석"} · 만든 때 {dt(s.madeAt)}
      </p>

      <section className="card">
        <h2>
          결론{" "}
          <span className="sub">
            이벤트 {shortLabel(s.event.from)} 부터 · 기록 {shortLabel(s.data.to)} 까지 {evDays}일
          </span>
        </h2>
        <ul className="study-points">
          <li>
            이벤트 기간에 온 손님이 (그 기간 첫 방문 뒤){" "}
            <b>
              {D}일 안에 다시 온 비율 {pct(ev.at[D].p)}
            </b>{" "}
            (95% 범위 {pct(ev.at[D].lo)} ~ {pct(ev.at[D].hi)}, {ev.n.toLocaleString()}명)
            {near && <> — 직전 같은 기간 {pct(near.at[D].p)}</>}
          </li>
          {cNear && (
            <li>
              직전 같은 기간과 견주면 다시 오는 속도 <b>{cNear.hr.toFixed(2)}배</b> (95% 범위{" "}
              {cNear.lo.toFixed(2)} ~ {cNear.hi.toFixed(2)}) · p = {pv(cNear.p)} → <b>{sig(cNear.p)}</b>
            </li>
          )}
          {cAut && (
            <li>
              9월 ~ 이벤트 전과 견주면 {cAut.hr.toFixed(2)}배 · p = {pv(cAut.p)} → {sig(cAut.p)}
            </li>
          )}
          {pair && (
            <li>
              같은 손님끼리(이벤트 전에도 온 손님) {pair.h}일 안 재방문: 평소대로면 {pair.expected}명 → 실제{" "}
              <b>
                {pair.observed}명 ({pair.ratio.toFixed(2)}배)
              </b>{" "}
              · p = {pv(pair.p)} → {sig(pair.p)}
            </li>
          )}
          {s.its && (
            <li>
              날마다 '다시 온 손님' 비율: 이벤트 전 4주 {pct(s.its.before)} → 이벤트 때 {pct(s.its.during)} ·
              추세 · 휴일을 빼면 <b>{pp(s.its.effect)}</b> (p = {pv(s.its.p)})
            </li>
          )}
        </ul>
        <p className="note">
          위험비(배) = 같은 날짜 · 같은 손님 종류(신규/기존 · 평일/휴일)끼리 견줘 '다시 오는 속도'가 몇
          배인지. 1 보다 크면 빨리 다시 옴. p 가 0.05 보다 작으면 우연으로 보기 어렵다는 뜻이에요.
        </p>
      </section>

      <Coverage s={s} />
      <KmCard s={s} />
      <CompareCard s={s} />
      <PairCard s={s} />
      <GapCard s={s} />
      {s.its && <ItsCard s={s} />}

      <section className="card">
        <h2>읽을 때 주의</h2>
        <ul className="study-points">
          <li>
            이벤트가 아직 진행 중이에요. 최근에 온 손님은 {D}일을 다 지켜보지 못해 '아직 안 옴'으로 따로
            셈(생존분석)해서 비율이 낮게 깎이지는 않지만, 범위가 넓어요. 이벤트가 끝나고 {D}일 뒤 다시
            계산하면 가장 정확해요.
          </li>
          <li>
            계절 · 날씨 · 방학 · 다른 행사(마일리지 멈춤 등)도 함께 바뀌었어요. 그래서 '직전 같은 기간' ·
            '같은 손님 평소' · '추세 빼기' 세 가지로 견줬어요 — 셋이 같은 쪽을 가리킬수록 이벤트 효과로 볼 수
            있어요.
          </li>
          <li>네이버 예약으로 입장(이용완료)한 손님만이에요. 현장 결제 손님은 방문 기록에 없어요.</li>
          <li>'신규'는 그 손님의 네이버 첫 이용이 기록 안에 있는 손님이에요 (카드 '완료 n' 으로 셈).</li>
        </ul>
      </section>
    </>
  );
}

function Coverage({ s }: { s: RevisitStudy }) {
  const k = s.data.kinds;
  return (
    <section className="card">
      <h2>쓴 자료</h2>
      <table className="study-table">
        <tbody>
          <tr>
            <th>기간</th>
            <td>
              {shortLabel(s.data.from)} ~ {shortLabel(s.data.to)}{" "}
              <span className="sub">({s.data.days}일)</span>
            </td>
          </tr>
          <tr>
            <th>손님 · 방문</th>
            <td className="num">
              {s.data.customers.toLocaleString()}명 · {s.data.visits.toLocaleString()}번
            </td>
          </tr>
          <tr>
            <th>신규 · 기존</th>
            <td className="num">
              {k.new.toLocaleString()} · {k.old.toLocaleString()}
              {k.unknown ? <span className="sub"> · 모름 {k.unknown.toLocaleString()}</span> : null}
            </td>
          </tr>
          <tr>
            <th>이벤트 전 · 때 모두 온 손님</th>
            <td className="num">{s.paired.both.toLocaleString()}명</td>
          </tr>
        </tbody>
      </table>
      {s.data.from > "2026-04-01" && (
        <p className="note strong">
          방문 기록이 4월 1일이 아니라 {shortLabel(s.data.from)} 부터 있어요. 통합데스크 [지난 방문 기록
          읽기]로 앞 기록을 채운 뒤 다시 계산하면 평소 기준이 더 길어져요.
        </p>
      )}
    </section>
  );
}

/** N일 안에 다시 온 비율 — Kaplan–Meier 누적 곡선 */
function KmCard({ s }: { s: RevisitStudy }) {
  const D = s.event.deadline;
  const W = 320,
    H = 190,
    L = 34,
    R = 10,
    T = 10,
    B = 26;
  const max = Math.max(0.05, ...s.cohorts.flatMap((c) => c.F));
  const top = Math.ceil(max * 10) / 10;
  const x = (t: number) => L + ((W - L - R) * t) / D;
  const y = (p: number) => T + (H - T - B) * (1 - p / top);
  const ticks = Array.from({ length: Math.round(top / 0.1) + 1 }, (_, i) => i * 0.1).filter(
    (v) => v <= top + 1e-9,
  );
  const path = (c: Cohort) => {
    let d = `M${x(0)},${y(0)}`;
    c.F.forEach((p, i) => {
      d += ` H${x(i + 1)} V${y(p)}`;
    });
    return d;
  };
  const at = [7, 14, D];
  return (
    <section className="card">
      <h2>
        며칠 안에 다시 왔나 <span className="sub">처음 온 날 뒤 누적 (생존분석)</span>
      </h2>
      <svg viewBox={`0 0 ${W} ${H}`} className="study-km" role="img" aria-label="며칠 안에 다시 온 비율 곡선">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
            <text x={L - 4} y={y(v) + 3} textAnchor="end" className="study-ax">
              {Math.round(v * 100)}%
            </text>
          </g>
        ))}
        {at.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={T} y2={H - B} stroke="var(--grid)" strokeDasharray="2 3" />
            <text x={x(t)} y={H - B + 14} textAnchor="middle" className="study-ax">
              {t}일
            </text>
          </g>
        ))}
        {[...s.cohorts].reverse().map((c) => (
          <path
            key={c.key}
            d={path(c)}
            fill="none"
            stroke={COLOR[c.key]}
            strokeWidth={c.key === "event" ? 2.5 : 1.5}
            strokeDasharray={c.key === "all" ? "4 3" : undefined}
          />
        ))}
      </svg>
      <div className="study-legend">
        {s.cohorts.map((c) => (
          <span key={c.key}>
            <i style={{ background: COLOR[c.key] }} />
            {c.label}
          </span>
        ))}
      </div>
      <table className="study-table">
        <thead>
          <tr>
            <th>기간</th>
            <th className="num">손님</th>
            {at.map((t) => (
              <th key={t} className="num">
                {t}일 안
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {s.cohorts.map((c) => (
            <tr key={c.key} className={c.key === "event" ? "cur" : ""}>
              <td>
                {c.label}
                <div className="sub">
                  {md(c.from)}~{md(c.to)}
                </div>
              </td>
              <td className="num">{c.n.toLocaleString()}</td>
              {at.map((t) => (
                <td key={t} className="num">
                  {pct(c.at[t].p)}
                  <div className="sub">{rng(c.at[t].lo, c.at[t].hi)}</div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        손님마다 그 기간 첫 방문 하나를 기준으로, 다음 방문까지 며칠 걸렸는지 셉니다. 아직 다시 안 온 손님도
        지켜본 날까지는 넣어 셉니다(Kaplan–Meier). 작은 글씨 = 95% 범위(%).
      </p>
    </section>
  );
}

function CompareCard({ s }: { s: RevisitStudy }) {
  const D = s.event.deadline;
  return (
    <section className="card">
      <h2>
        이벤트 ↔ 평소 견줌 <span className="sub">신규/기존 · 평일/휴일 나눠 견줌</span>
      </h2>
      <table className="study-table">
        <thead>
          <tr>
            <th>견준 기간</th>
            <th className="num">속도(배)</th>
            <th className="num">p</th>
            <th className="num">14일 차이</th>
            <th className="num">{D}일</th>
          </tr>
        </thead>
        <tbody>
          {s.compare.map((c) => (
            <tr key={c.base}>
              <td>{BASE_NAME[c.base] || c.base}</td>
              <td className="num">
                <b>{c.hr.toFixed(2)}</b>
                <div className="sub">
                  {c.lo.toFixed(2)}~{c.hi.toFixed(2)}
                </div>
              </td>
              <td className={`num${c.p < 0.05 ? " up-text" : ""}`}>{pv(c.p)}</td>
              <td className="num">
                {pp(c.diff[14].d)}
                <div className="sub">{rngP(c.diff[14].lo, c.diff[14].hi)}</div>
              </td>
              <td className="num">
                {pp(c.diff[D].d)}
                <div className="sub">{rngP(c.diff[D].lo, c.diff[D].hi)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        속도(위험비) = 층화 로그순위 검정. 범위가 1 을 넘지 않고 걸치면 아직 확실하지 않아요. 차이 = 이벤트
        비율 − 그 기간 비율 (%p).
      </p>
    </section>
  );
}

function PairCard({ s }: { s: RevisitStudy }) {
  const rows: [string, OE | null][] = [
    ["7일 안", s.paired.h7],
    ["14일 안", s.paired.h14],
    [`${s.event.deadline}일 안`, s.paired.h19],
  ];
  return (
    <section className="card">
      <h2>
        같은 손님 — 평소와 견줌 <span className="sub">이벤트 전에도 온 손님만</span>
      </h2>
      <table className="study-table">
        <thead>
          <tr>
            <th>다시 옴</th>
            <th className="num">손님</th>
            <th className="num">평소대로면</th>
            <th className="num">실제</th>
            <th className="num">배</th>
            <th className="num">p</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([l, o]) =>
            o ? (
              <tr key={l}>
                <td>{l}</td>
                <td className="num">{o.n.toLocaleString()}</td>
                <td className="num">{o.expected}</td>
                <td className="num">{o.observed}</td>
                <td className="num">
                  <b>{o.ratio.toFixed(2)}</b>
                  <div className="sub">
                    {o.lo.toFixed(2)}~{o.hi.toFixed(2)}
                  </div>
                </td>
                <td className={`num${o.p < 0.05 ? " up-text" : ""}`}>{pv(o.p)}</td>
              </tr>
            ) : (
              <tr key={l}>
                <td>{l}</td>
                <td colSpan={5} className="sub">
                  아직 견줄 수 없음 (이벤트 뒤 지켜본 날이 모자라거나 평소 기록이 없음)
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      <p className="note">
        손님마다 이벤트 전 방문에서 'N일 안에 다시 온 비율'을 구하고(기록이 적은 손님은 전체 평균 쪽으로
        당김), 그 비율대로라면 이벤트 때 몇 명이 다시 왔을지(평소대로면)와 실제를 견줍니다. 손님마다 원래 자주
        오는지 · 가끔 오는지를 빼고 볼 수 있어요.
      </p>
    </section>
  );
}

function GapCard({ s }: { s: RevisitStudy }) {
  const g = s.gaps;
  const evLen = Math.round((Date.parse(s.data.to) - Date.parse(s.event.from)) / 864e5) + 1;
  const rows: [string, string, Desc, Desc][] = [
    [`같은 길이(${evLen}일) 기간끼리 — 공정한 견줌`, "직전 같은 기간", g.near, g.event],
    ["이벤트 전 모든 간격 — 참고", "이벤트 전 모두", g.pre, g.event],
  ];
  const f = (x: number) => x.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return (
    <section className="card">
      <h2>
        재방문 간격 숫자 <span className="sub">평균 · 표준편차 · 분산 …</span>
      </h2>
      {rows.map(([title, aName, a, b]) => (
        <div key={title}>
          <h3 className="study-h3">{title}</h3>
          <table className="study-table">
            <thead>
              <tr>
                <th />
                <th className="num">{aName}</th>
                <th className="num">이벤트 때</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["간격 수", (d: Desc) => d.n.toLocaleString()],
                  ["평균", (d: Desc) => `${f(d.mean)}일`],
                  ["표준편차", (d: Desc) => `${f(d.sd)}일`],
                  ["분산", (d: Desc) => f(d.variance)],
                  ["가운데 값", (d: Desc) => `${f(d.median)}일`],
                  ["가운데 절반", (d: Desc) => `${f(d.q1)} ~ ${f(d.q3)}일`],
                  ["기하평균", (d: Desc) => `${f(d.geoMean)}일`],
                  ["왜도", (d: Desc) => d.skew.toFixed(2)],
                ] as [string, (d: Desc) => string][]
              ).map(([l, fn]) => (
                <tr key={l}>
                  <th>{l}</th>
                  <td className="num">{a.n ? fn(a) : "-"}</td>
                  <td className="num">{b.n ? fn(b) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p className="note">
        같은 길이 기간끼리 순위 견줌(맨–휘트니 — 정규분포를 가정하지 않음): p = {pv(g.mw.p)} → {sig(g.mw.p)}.
      </p>
      <p className="note">
        간격은 정규분포가 아니에요 — 왜도가 0 보다 크면 오른쪽으로 긴 꼬리(가끔 아주 늦게 오는 손님)가 있어
        평균 · 표준편차가 크게 흔들려요. 또 이벤트 기간은 아직 짧아 '빨리 다시 온 손님'만 간격이 생기니, 긴
        기간(이벤트 전 모두)과 견주면 이벤트 때 평균이 저절로 짧아 보여요. 그래서 같은 길이 기간끼리 견주고,
        결론은 위의 생존분석 · 같은 손님 견줌으로 냅니다.
      </p>
    </section>
  );
}

/** 날마다 '다시 온 손님' 비율 — 이벤트 앞뒤 */
function ItsCard({ s }: { s: RevisitStudy }) {
  const its = s.its!;
  const W = 320,
    H = 130,
    L = 30,
    R = 6,
    T = 8,
    B = 20;
  const days = its.daily;
  const n = days.length;
  const top = Math.max(0.25, Math.ceil(Math.max(...days.map((d) => d.share)) * 4) / 4);
  const bw = (W - L - R) / Math.max(1, n);
  const y = (p: number) => T + (H - T - B) * (1 - p / top);
  const evAt = days.findIndex((d) => d.d >= s.event.from);
  return (
    <section className="card">
      <h2>
        날마다 다시 온 손님 비율{" "}
        <span className="sub">그 앞 {its.lookback}일 안에 온 적이 있는 손님 ÷ 그날 손님</span>
      </h2>
      <svg viewBox={`0 0 ${W} ${H}`} className="study-km" role="img" aria-label="날마다 다시 온 손님 비율">
        {[0, 0.25, 0.5, 0.75, 1]
          .filter((v) => v <= top)
          .map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
              <text x={L - 4} y={y(v) + 3} textAnchor="end" className="study-ax">
                {Math.round(v * 100)}%
              </text>
            </g>
          ))}
        {days.map((d, i) => (
          <rect
            key={d.d}
            x={L + i * bw + 0.5}
            y={y(d.share)}
            width={Math.max(1, bw - 1)}
            height={H - B - y(d.share)}
            fill={d.d >= s.event.from ? "var(--cur)" : "var(--spark)"}
          />
        ))}
        {evAt >= 0 && (
          <text x={W - R} y={H - 6} textAnchor="end" className="study-ax">
            이벤트 {md(s.event.from)}~
          </text>
        )}
        <text x={L} y={H - 6} className="study-ax">
          {md(its.from)}
        </text>
      </svg>
      <table className="study-table">
        <tbody>
          <tr>
            <th>이벤트 전 4주 평균</th>
            <td className="num">{pct(its.before)}</td>
          </tr>
          <tr>
            <th>이벤트 때 평균</th>
            <td className="num">{pct(its.during)}</td>
          </tr>
          <tr>
            <th>추세 · 휴일 빼고 바뀐 크기</th>
            <td className="num">
              <b>{pp(its.effect)}</b>
              <div className="sub">
                {rngP(its.lo, its.hi)} · p = {pv(its.p)}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="note">
        단절 시계열: 원래 오르내리던 흐름(추세)과 휴일 여부를 빼고, 이벤트 시작 뒤 '다시 온 손님 비율'이 따로
        얼마나 바뀌었는지 봅니다 (그날 손님 수로 무게).
      </p>
    </section>
  );
}
